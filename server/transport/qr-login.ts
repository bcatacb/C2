import type { Page } from 'playwright'
import { acquireSession, destroySession, pinSession, releaseSession, getSession } from './session-pool.js'
import { dismissCookieBanner, readOwnProfile } from './playwright.js'
import { updateAccount, getAccount } from '../services/account-manager.js'
import { broadcast } from '../index.js'

const TIKTOK_BASE = 'https://www.tiktok.com'
const QR_LOGIN_URL = `${TIKTOK_BASE}/login/qrcode`
const LOGIN_URL = `${TIKTOK_BASE}/login`

const POLL_INTERVAL_MS = 2500
const SESSION_DEADLINE_MS = 3 * 60_000 // QR scanning window before we give up

// Candidate selectors for the QR <canvas>/<img>. TikTok markup shifts over time, so we try a few
// from most-specific to most-generic and screenshot the first one that resolves.
const QR_SELECTORS = [
  '[data-e2e="qr-code"] canvas',
  '[data-e2e="qr-code"] img',
  '[data-e2e="qr-code"]',
  'canvas',
]

// "Use QR code" entry point on the password login page, in case /login/qrcode redirects to it.
const QR_TAB_SELECTORS = [
  'div[role="link"]:has-text("Use QR code")',
  'a:has-text("QR code")',
  'div:has-text("Use QR code")',
]

interface QrLoginState {
  cancelled: boolean
  timer: ReturnType<typeof setTimeout> | null
  deadline: number
}

const activeQrLogins = new Map<string, QrLoginState>()

async function gotoQrLogin(page: Page): Promise<void> {
  await page.goto(QR_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await dismissCookieBanner(page)

  // If the QR canvas isn't there, we likely landed on the password tab — click "Use QR code".
  const hasQr = await page.locator(QR_SELECTORS.join(', ')).first().isVisible().catch(() => false)
  if (hasQr) return

  for (const sel of QR_TAB_SELECTORS) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {})
      await page.waitForTimeout(1500)
      break
    }
  }
}

async function captureQr(page: Page): Promise<string | null> {
  for (const sel of QR_SELECTORS) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      const buf = await el.screenshot({ type: 'png' }).catch(() => null)
      if (buf) return buf.toString('base64')
    }
  }
  return null
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies().catch(() => [])
  return cookies.some(c => (c.name === 'sessionid' || c.name === 'sessionid_ss') && !!c.value)
}

function clearState(accountId: string): void {
  const state = activeQrLogins.get(accountId)
  if (state?.timer) clearTimeout(state.timer)
  activeQrLogins.delete(accountId)
}

export async function startQrLogin(
  accountId: string,
  proxyUrl: string | null,
  sessionData: Record<string, unknown> | null,
): Promise<void> {
  // Replace any in-flight QR login for this account.
  if (activeQrLogins.has(accountId)) await stopQrLogin(accountId)

  const session = await acquireSession(accountId, proxyUrl, sessionData)
  pinSession(accountId) // keep the idle reaper from closing the browser mid-scan
  const page = session.context.pages()[0] || await session.context.newPage()
  // Release the busy lock — the poll loop reads the page without holding it.
  await releaseSession(accountId)

  const state: QrLoginState = { cancelled: false, timer: null, deadline: Date.now() + SESSION_DEADLINE_MS }
  activeQrLogins.set(accountId, state)

  try {
    await gotoQrLogin(page)
  } catch (err) {
    console.log(`[qr-login] navigation failed for ${accountId}: ${(err as Error).message}`)
    clearState(accountId)
    await destroySession(accountId)
    broadcast('account:qr-expired', { accountId })
    return
  }

  const poll = async () => {
    if (state.cancelled) return

    try {
      if (await isLoggedIn(page)) {
        const sd = await page.context().storageState().catch(() => null)
        // Read the logged-in handle/avatar before tearing the browser down (best-effort).
        const profile = await readOwnProfile(page)
        clearState(accountId)
        await destroySession(accountId)

        const fields: Record<string, unknown> = { status: 'connected' }
        if (sd) fields.session_data = sd as unknown as Record<string, unknown>
        if (profile.username) fields.username = profile.username
        if (profile.displayName) fields.display_name = profile.displayName
        if (profile.photo) fields.profile_photo = profile.photo
        await updateAccount(accountId, fields)

        broadcast('account:qr-success', { accountId })
        broadcast('account:updated', await getAccount(accountId))
        return
      }

      if (Date.now() > state.deadline) {
        clearState(accountId)
        await destroySession(accountId)
        broadcast('account:qr-expired', { accountId })
        return
      }

      const image = await captureQr(page)
      if (image) broadcast('account:qr', { accountId, image })
    } catch (err) {
      console.log(`[qr-login] poll error for ${accountId}: ${(err as Error).message}`)
    }

    if (!state.cancelled) state.timer = setTimeout(poll, POLL_INTERVAL_MS)
  }

  void poll()
}

export async function stopQrLogin(accountId: string): Promise<void> {
  const state = activeQrLogins.get(accountId)
  if (state) state.cancelled = true
  clearState(accountId)
  if (getSession(accountId)) await destroySession(accountId)
}
