import type { Browser, BrowserContext } from 'playwright'
import { chromium } from 'playwright'
import { generateFingerprint } from '../utils/fingerprint.js'
import { supabase } from '../utils/supabase.js'

interface PooledSession {
  accountId: string
  context: BrowserContext
  browser: Browser
  lastUsed: number
  pinned: boolean
  busy: boolean
  waiters: Array<() => void>
}

interface QueuedTask {
  accountId: string
  resolve: (session: PooledSession) => void
  reject: (err: Error) => void
}

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '5')
const IDLE_TIMEOUT = parseInt(process.env.BROWSER_IDLE_TIMEOUT_MS || '60000')

const activeSessions = new Map<string, PooledSession>()
const taskQueue: QueuedTask[] = []
let idleTimer: ReturnType<typeof setInterval> | null = null

function startIdleReaper() {
  if (idleTimer) return
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of activeSessions) {
      if (!session.pinned && !session.busy && now - session.lastUsed > IDLE_TIMEOUT) {
        console.log(`[pool] closing idle session for ${session.accountId}`)
        session.context.close().catch(() => {})
        session.browser.close().catch(() => {})
        activeSessions.delete(id)
        drainQueue()
      }
    }
    if (activeSessions.size === 0 && taskQueue.length === 0) {
      clearInterval(idleTimer!)
      idleTimer = null
    }
  }, 10_000)
}

async function createSession(accountId: string, proxyUrl: string | null, sessionData: Record<string, unknown> | null): Promise<PooledSession> {
  let resolvedProxyUrl = proxyUrl
  let resolvedSessionData = sessionData

  if (!resolvedSessionData) {
    const { data: account } = await supabase
      .from('tiktok_accounts')
      .select('session_data, proxy_id')
      .eq('id', accountId)
      .single()

    if (account) {
      resolvedSessionData = account.session_data as any
      if (account.proxy_id && !resolvedProxyUrl) {
        const { data: proxy } = await supabase
          .from('proxies')
          .select('*')
          .eq('id', account.proxy_id)
          .single()
        if (proxy) {
          const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : ''
          resolvedProxyUrl = `http://${auth}${proxy.host}:${proxy.port}`
        }
      }
    }
  }

  const fp = generateFingerprint(accountId)

  const launchOptions: Record<string, unknown> = {
    headless: process.env.HEADED_MODE !== 'true',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      `--window-size=${fp.viewport.width},${fp.viewport.height}`,
    ],
  }

  if (resolvedProxyUrl) {
    const url = new URL(resolvedProxyUrl)
    launchOptions.proxy = {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: url.username || undefined,
      password: url.password || undefined,
    }
  }

  const browser = await chromium.launch(launchOptions)

  const contextOptions: Record<string, unknown> = {
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezone,
    permissions: [],
    bypassCSP: true,
  }

  if (resolvedSessionData?.cookies) {
    contextOptions.storageState = resolvedSessionData as unknown
  }

  const context = await browser.newContext(contextOptions)

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })

  return {
    accountId,
    context,
    browser,
    lastUsed: Date.now(),
    pinned: false,
    busy: false,
    waiters: [],
  }
}

function drainQueue() {
  while (taskQueue.length > 0 && activeSessions.size < MAX_CONCURRENT) {
    const task = taskQueue.shift()!
    const existing = activeSessions.get(task.accountId)
    if (existing) {
      existing.lastUsed = Date.now()
      task.resolve(existing)
    } else {
      createSession(task.accountId, null, null)
        .then((session) => {
          activeSessions.set(task.accountId, session)
          startIdleReaper()
          task.resolve(session)
        })
        .catch(task.reject)
    }
  }
}

export async function acquireSession(
  accountId: string,
  proxyUrl: string | null = null,
  sessionData: Record<string, unknown> | null = null
): Promise<PooledSession> {
  const existing = activeSessions.get(accountId)
  if (existing) {
    if (existing.busy) {
      await new Promise<void>(resolve => existing.waiters.push(resolve))
    }
    existing.lastUsed = Date.now()
    existing.busy = true
    return existing
  }

  if (activeSessions.size < MAX_CONCURRENT) {
    const session = await createSession(accountId, proxyUrl, sessionData)
    session.busy = true
    activeSessions.set(accountId, session)
    startIdleReaper()
    return session
  }

  return new Promise((resolve, reject) => {
    taskQueue.push({ accountId, resolve, reject })
  })
}

export function getSession(accountId: string): PooledSession | undefined {
  return activeSessions.get(accountId)
}

export function pinSession(accountId: string): void {
  const session = activeSessions.get(accountId)
  if (session) session.pinned = true
}

export async function releaseSession(accountId: string): Promise<void> {
  const session = activeSessions.get(accountId)
  if (session) {
    session.lastUsed = Date.now()
    session.pinned = false
    session.busy = false
    const waiter = session.waiters.shift()
    if (waiter) waiter()
  }
}

export async function destroySession(accountId: string): Promise<Record<string, unknown> | null> {
  const session = activeSessions.get(accountId)
  if (!session) return null

  let sessionData: Record<string, unknown> | null = null
  try {
    const state = await session.context.storageState()
    sessionData = state as unknown as Record<string, unknown>
  } catch { /* ignore */ }

  await session.context.close().catch(() => {})
  await session.browser.close().catch(() => {})
  activeSessions.delete(accountId)
  drainQueue()

  return sessionData
}

export function getPoolStatus() {
  return {
    active: activeSessions.size,
    maxConcurrent: MAX_CONCURRENT,
    queued: taskQueue.length,
    sessions: Array.from(activeSessions.values()).map((s) => ({
      accountId: s.accountId,
      idleMs: Date.now() - s.lastUsed,
    })),
  }
}

export async function shutdownPool(): Promise<void> {
  if (idleTimer) clearInterval(idleTimer)
  for (const [id, session] of activeSessions) {
    await session.context.close().catch(() => {})
    await session.browser.close().catch(() => {})
    activeSessions.delete(id)
  }
  taskQueue.length = 0
}
