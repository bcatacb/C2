import type { Frame, Page } from 'playwright'
import type { TikTokTransport, ConversationData, MessageData, AccountStatus } from './interface.js'
import { acquireSession, destroySession, releaseSession } from './session-pool.js'
import { randomDelay } from '../utils/fingerprint.js'

const TIKTOK_BASE = 'https://www.tiktok.com'
const DM_URL = `${TIKTOK_BASE}/messages`

async function getPage(accountId: string, proxyUrl: string | null, sessionData: Record<string, unknown> | null): Promise<Page> {
  const session = await acquireSession(accountId, proxyUrl, sessionData)
  const pages = session.context.pages()
  if (pages.length > 0) return pages[0]
  return session.context.newPage()
}

async function dismissCookieBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const banner = document.querySelector('tiktok-cookie-banner')
    if (banner) banner.remove()
    const shadowBanners = document.querySelectorAll('[class*="cookie"], [class*="Cookie"], [id*="cookie"], [id*="Cookie"]')
    shadowBanners.forEach(el => el.remove())
  }).catch(() => {})

  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const banner = document.querySelector('tiktok-cookie-banner')
      if (banner) banner.remove()
    }).catch(() => {})
  }
}

async function navigateToDMs(page: Page): Promise<void> {
  const url = page.url()
  if (!url.includes('/messages') && !url.includes('/business-suite/messages')) {
    await page.goto(DM_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await randomDelay(3000, 5000)
  }
  await dismissCookieBanner(page)
}

async function getMessagesFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const frame = page.frames().find(f =>
      f.url().includes('/messages') && f.url().includes('scene=business')
    )
    if (frame) return frame
    await new Promise(r => setTimeout(r, 1000))
  }
  return page.mainFrame()
}

async function waitForConversationList(frame: Frame): Promise<boolean> {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const loaded = await frame.evaluate(() => {
      const items = document.querySelectorAll('[data-e2e="dm-new-conversation-item"]')
      return items.length > 0
    }).catch(() => false)
    if (loaded) return true
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

export const playwrightTransport: TikTokTransport = {
  async connect(accountId, sessionData, proxyUrl) {
    const page = await getPage(accountId, proxyUrl, sessionData)

    await page.goto(TIKTOK_BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await randomDelay(2000, 3000)

    const isLoggedIn = await page.evaluate(() => {
      return document.cookie.includes('sessionid') ||
             document.querySelector('[data-e2e="profile-icon"]') !== null
    })

    if (!isLoggedIn && !sessionData) {
      throw new Error(`Account ${accountId} requires manual login — no session data provided`)
    }

    const state = await page.context().storageState()
    await releaseSession(accountId)
    return state as unknown as Record<string, unknown>
  },

  async disconnect(accountId) {
    const sessionData = await destroySession(accountId)
    return sessionData as unknown as void
  },

  async fetchConversations(accountId) {
    const session = await acquireSession(accountId)
    const page = session.context.pages()[0] || await session.context.newPage()
    await navigateToDMs(page)

    const frame = await getMessagesFrame(page)
    const loaded = await waitForConversationList(frame)
    if (!loaded) {
      console.log(`[playwright] conversation list did not load for ${accountId}, URL: ${page.url()}`)
      await releaseSession(accountId)
      return []
    }

    const rawConversations = await frame.evaluate(() => {
      const results: Array<{
        peerUsername: string
        peerDisplayName: string | null
        peerAvatar: string | null
        lastMessageText: string | null
        lastMessageAt: string | null
        lastMessageDirection: 'inbound' | 'outbound' | null
        unreadCount: number
        conversationId: string | null
      }> = []

      const items = document.querySelectorAll('[data-e2e="dm-new-conversation-item"]')

      items.forEach((item) => {
        const nameEl = item.querySelector('[data-e2e="dm-new-conversation-nickname"]')
        const peerDisplayName = nameEl?.textContent?.trim() || null
        if (!peerDisplayName) return

        const extractEl = item.querySelector('[class*="InfoExtract"]')
        const timeEl = item.querySelector('[class*="InfoTime"]')
        const avatarEl = item.querySelector('img[class*="Avatar"], img[class*="avatar"]')
        const badgeEl = item.querySelector('[class*="Badge"], [class*="unread"], [class*="UnreadCount"]')
        const convId = item.closest('[data-conversation-id]')?.getAttribute('data-conversation-id') || null

        results.push({
          peerUsername: peerDisplayName,
          peerDisplayName,
          peerAvatar: avatarEl?.getAttribute('src') || null,
          lastMessageText: extractEl?.textContent?.trim() || null,
          lastMessageAt: timeEl?.textContent?.trim() || null,
          lastMessageDirection: null,
          unreadCount: badgeEl ? parseInt(badgeEl.textContent || '1') || 1 : 0,
          conversationId: convId,
        })
      })

      return results
    })

    await releaseSession(accountId)

    return rawConversations.map((c) => ({
      ...c,
      lastMessageAt: c.lastMessageAt ? parseRelativeDate(c.lastMessageAt) : new Date(),
    }))
  },

  async fetchMessages(accountId, peerUsername, _since) {
    const session = await acquireSession(accountId)
    const page = session.context.pages()[0] || await session.context.newPage()
    await navigateToDMs(page)

    let frame = await getMessagesFrame(page)
    const listLoaded = await waitForConversationList(frame)
    if (!listLoaded) {
      await releaseSession(accountId)
      return []
    }
    await randomDelay(1000, 2000)

    await dismissCookieBanner(page)

    let clicked = false
    const items = await frame.$$('[data-e2e="dm-new-conversation-item"]').catch(() => [])
    for (const item of items) {
      const text = await item.textContent().catch(() => '')
      if (text?.toLowerCase().includes(peerUsername.toLowerCase())) {
        await item.click()
        clicked = true
        await randomDelay(3000, 5000)
        break
      }
    }

    if (!clicked) {
      console.log(`[fetchMessages] could not find conversation for "${peerUsername}"`)
      await releaseSession(accountId)
      return []
    }

    // After clicking, TikTok rebuilds the iframe — wait for it to come back
    await new Promise(r => setTimeout(r, 2000))
    const deadline = Date.now() + 25_000
    let msgFrame: Frame | null = null
    while (Date.now() < deadline) {
      const frames = page.frames()
      for (const f of frames) {
        const url = f.url()
        if (url.includes('/messages') && (url.includes('scene=business') || url.includes('im.tiktok'))) {
          const hasMessages = await f.evaluate(() => {
            return document.querySelectorAll('[class*="Message"], [class*="message"], [class*="Bubble"], [class*="bubble"]').length > 0 ||
                   document.querySelectorAll('[data-e2e*="msg"], [data-e2e*="message"]').length > 0
          }).catch(() => false)
          if (hasMessages) {
            msgFrame = f
            break
          }
        }
      }
      if (msgFrame) break
      await new Promise(r => setTimeout(r, 1500))
    }

    if (!msgFrame) {
      // Fallback: use original frame reference, it might still be valid
      msgFrame = frame
      console.log(`[fetchMessages] could not find message frame after click, using original`)
    }

    const debug = await msgFrame.evaluate(() => {
      const allEls = document.querySelectorAll('div')
      const candidates = Array.from(allEls).filter(el => {
        const cls = el.className?.toString() || ''
        return cls.includes('Message') || cls.includes('message') ||
               cls.includes('Chat') || cls.includes('chat') ||
               cls.includes('Bubble') || cls.includes('bubble')
      }).slice(0, 30)

      return {
        candidateCount: candidates.length,
        candidates: candidates.map(el => ({
          cls: (el.className?.toString() || '').substring(0, 150),
          text: (el.textContent || '').substring(0, 100),
          children: el.children.length,
          dataAttrs: Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`).join(', '),
        })),
        allFrameDataE2e: Array.from(document.querySelectorAll('[data-e2e]')).map(el => el.getAttribute('data-e2e')).filter((v, i, a) => a.indexOf(v) === i),
      }
    }).catch(() => ({ candidateCount: 0, candidates: [] as { cls: string; text: string; children: number; dataAttrs: string }[], allFrameDataE2e: [] as string[] }))

    console.log(`[fetchMessages] found ${debug.candidateCount} message-like elements in frame`)
    console.log(`[fetchMessages] data-e2e in frame: ${JSON.stringify(debug.allFrameDataE2e)}`)
    debug.candidates.slice(0, 8).forEach((c, i) => console.log(`  [${i}] class="${c.cls}" text="${c.text}" data="${c.dataAttrs}"`))

    const rawMessages = await msgFrame.evaluate(() => {
      const results: Array<{
        tiktokMsgId: string
        direction: 'inbound' | 'outbound'
        body: string | null
        mediaUrl: string | null
        sentAt: string
      }> = []

      const chatItems = document.querySelectorAll('[data-e2e="dm-new-chat-item"]')

      let lastTimestamp = ''
      chatItems.forEach((el, idx) => {
        const wrapper = el.closest('[data-index]')
        const msgId = wrapper?.getAttribute('data-index') || `msg_${idx}_${Date.now()}`

        const timeContainer = wrapper?.querySelector('[class*="TimeContainer"]')
        if (timeContainer) lastTimestamp = timeContainer.textContent?.trim() || lastTimestamp

        const allClasses = (el.className?.toString() || '') + ' ' + (el.parentElement?.className?.toString() || '')
        const hasAvatar = el.querySelector('[data-e2e="chat-avatar"]') !== null
        const isSelf = !hasAvatar && (
          allClasses.includes('Self') || allClasses.includes('self') ||
          allClasses.includes('Right') || allClasses.includes('right')
        )

        const textEls = el.querySelectorAll('p, span')
        let body = ''
        textEls.forEach(t => {
          const text = t.textContent?.trim() || ''
          if (text.length > 0 && text.length < 2000 &&
              !t.closest('[class*="Nickname"]') &&
              !t.closest('[class*="UniqueId"]') &&
              !t.closest('[class*="TimeContainer"]') &&
              !t.closest('[class*="Warning"]')) {
            if (body) body += '\n'
            body += text
          }
        })

        const imgEl = el.querySelector('img:not([class*="Avatar"]):not([class*="avatar"])')
        const mediaUrl = imgEl?.getAttribute('src') || null

        if (!body && !mediaUrl) return

        results.push({
          tiktokMsgId: msgId,
          direction: isSelf ? 'outbound' : 'inbound',
          body: body || null,
          mediaUrl,
          sentAt: lastTimestamp || new Date().toISOString(),
        })
      })

      return results
    }).catch(() => [] as Array<{ tiktokMsgId: string; direction: 'inbound' | 'outbound'; body: string | null; mediaUrl: string | null; sentAt: string }>)

    await releaseSession(accountId)

    return rawMessages.map((m) => ({
      ...m,
      sentAt: new Date(m.sentAt),
    }))
  },

  async sendMessage(accountId, peerUsername, body) {
    const session = await acquireSession(accountId)
    const page = session.context.pages()[0] || await session.context.newPage()
    await navigateToDMs(page)
    await dismissCookieBanner(page)

    const frame = await getMessagesFrame(page)
    await waitForConversationList(frame)
    await randomDelay(1000, 2000)
    await dismissCookieBanner(page)

    const items = await frame.$$('[data-e2e="dm-new-conversation-item"]')
    for (const item of items) {
      const text = await item.textContent()
      if (text?.toLowerCase().includes(peerUsername.toLowerCase())) {
        await item.click()
        await randomDelay(1500, 2500)
        break
      }
    }

    const inputSelector = '[data-e2e="dm-new-input-editor"], [data-e2e="dm-input"], [class*="ChatInput"] [contenteditable], [class*="DraftEditor"] [contenteditable]'
    await frame.waitForSelector(inputSelector, { timeout: 10_000 })

    for (const char of body) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 100 })
    }

    await randomDelay(500, 1000)
    await page.keyboard.press('Enter')
    await randomDelay(1000, 2000)

    await releaseSession(accountId)

    return {
      tiktokMsgId: `sent_${Date.now()}`,
      direction: 'outbound' as const,
      body,
      mediaUrl: null,
      sentAt: new Date(),
    }
  },

  async getAccountStatus(accountId) {
    const session = await acquireSession(accountId)
    const page = session.context.pages()[0] || await session.context.newPage()

    const isLoggedIn = await page.evaluate(() => {
      return document.cookie.includes('sessionid') ||
             document.querySelector('[data-e2e="profile-icon"]') !== null
    })

    await releaseSession(accountId)

    return {
      connected: isLoggedIn,
      restricted: false,
      banned: false,
    }
  },
}

function parseRelativeDate(text: string): Date {
  const now = new Date()
  const direct = new Date(text)
  if (!isNaN(direct.getTime()) && text.length > 8) return direct
  if (text.includes('/')) {
    const parsed = new Date(text)
    if (!isNaN(parsed.getTime())) return parsed
  }
  if (text.toLowerCase().includes('just now') || text.toLowerCase().includes('now')) return now
  const minuteMatch = text.match(/(\d+)\s*m/)
  if (minuteMatch) return new Date(now.getTime() - parseInt(minuteMatch[1]) * 60_000)
  const hourMatch = text.match(/(\d+)\s*h/)
  if (hourMatch) return new Date(now.getTime() - parseInt(hourMatch[1]) * 3600_000)
  const dayMatch = text.match(/(\d+)\s*d/)
  if (dayMatch) return new Date(now.getTime() - parseInt(dayMatch[1]) * 86400_000)
  return now
}
