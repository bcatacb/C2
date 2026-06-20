import type { Frame, Page } from 'playwright'
import { createHash } from 'crypto'
import type { TikTokTransport, ConversationData, MessageData, AccountStatus } from './interface.js'
import { acquireSession, destroySession, releaseSession } from './session-pool.js'
import { randomDelay } from '../utils/fingerprint.js'
import { supabase } from '../utils/supabase.js'

const TIKTOK_BASE = 'https://www.tiktok.com'
const DM_URL = `${TIKTOK_BASE}/messages`

async function getPage(accountId: string, proxyUrl: string | null, sessionData: Record<string, unknown> | null): Promise<Page> {
  const session = await acquireSession(accountId, proxyUrl, sessionData)
  const pages = session.context.pages()
  if (pages.length > 0) return pages[0]
  return session.context.newPage()
}

export async function dismissCookieBanner(page: Page): Promise<void> {
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

/**
 * Best-effort read of the *logged-in* account's own identity from a live page.
 * Used to backfill username/avatar after QR or manual login. Never throws —
 * returns nulls for anything it can't find so callers can merge partial data.
 *
 * NOTE: selectors mirror TikTok's current markup; verify live via /debug-page if backfill fails.
 */
export async function readOwnProfile(page: Page): Promise<{ username: string | null; displayName: string | null; photo: string | null }> {
  const empty = { username: null, displayName: null, photo: null }
  try {
    await page.goto(TIKTOK_BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await randomDelay(1500, 2500)
    await dismissCookieBanner(page)

    const found = await page.evaluate(() => {
      // The profile icon sits inside an anchor pointing at the logged-in user's profile.
      const icon = document.querySelector('[data-e2e="profile-icon"]')
      const anchor = (icon?.closest('a') as HTMLAnchorElement | null)
        || (document.querySelector('a[href^="/@"]') as HTMLAnchorElement | null)
      const href = anchor?.getAttribute('href') || ''
      const m = href.match(/\/@([^/?#]+)/)
      const username = m ? m[1] : null

      const img = (anchor?.querySelector('img') as HTMLImageElement | null)
        || (icon?.querySelector('img') as HTMLImageElement | null)
      const photo = img?.getAttribute('src') || null

      return { username, photo }
    }).catch(() => ({ username: null, photo: null }))

    let displayName: string | null = null
    if (found.username) {
      // Visit the profile page to read the display name (title block).
      await page.goto(`${TIKTOK_BASE}/@${found.username}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      await randomDelay(1500, 2500)
      displayName = await page.evaluate(() => {
        const el = document.querySelector('[data-e2e="user-subtitle"]') || document.querySelector('[data-e2e="user-title"]')
        return el?.textContent?.trim() || null
      }).catch(() => null)
    }

    return { username: found.username, displayName, photo: found.photo }
  } catch {
    return empty
  }
}

async function navigateToDMs(page: Page): Promise<void> {
  console.log(`[playwright] navigating to DMs: ${DM_URL}`)
  await page.goto(DM_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await randomDelay(3000, 5000)
  await dismissCookieBanner(page)
}

async function getMessagesFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const frame = page.frames().find(f =>
      (f.url().includes('/messages') && f.url().includes('scene=business')) ||
      f.url().includes('im.tiktok.com')
    )
    if (frame) {
      console.log(`[playwright] found subframe: ${frame.url()}`)
      return frame
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  console.log(`[playwright] no subframe found, returning mainFrame: ${page.mainFrame().url()}`)
  return page.mainFrame()
}

async function waitForConversationList(frame: Frame): Promise<boolean> {
  const deadline = Date.now() + 25_000
  console.log(`[playwright] waiting for conversation list on frame: ${frame.url()}`)
  while (Date.now() < deadline) {
    const itemCount = await frame.evaluate(() => {
      const items = document.querySelectorAll('[data-e2e="dm-new-conversation-item"]')
      return items.length
    }).catch(() => 0)
    console.log(`[playwright] conversation items count: ${itemCount}`)
    if (itemCount > 0) return true
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

export const playwrightTransport: TikTokTransport = {
  async connect(accountId, sessionData, proxyUrl) {
    const page = await getPage(accountId, proxyUrl, sessionData)

    try {
      await page.goto(TIKTOK_BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await randomDelay(2000, 3000)

      // sessionid is HttpOnly so it never appears in document.cookie —
      // read it through the browser context instead
      const cookies = await page.context().cookies()
      let isLoggedIn = cookies.some(c =>
        (c.name === 'sessionid' || c.name === 'sessionid_ss') && c.value
      )

      if (!isLoggedIn) {
        isLoggedIn = await page
          .waitForSelector('[data-e2e="profile-icon"]', { timeout: 10_000 })
          .then(() => true)
          .catch(() => false)
      }

      if (!isLoggedIn) {
        throw new Error(`Account ${accountId} requires manual login — not logged in or session expired`)
      }

      const state = await page.context().storageState()
      return state as unknown as Record<string, unknown>
    } finally {
      await releaseSession(accountId)
    }
  },

  async disconnect(accountId) {
    const sessionData = await destroySession(accountId)
    return sessionData as unknown as void
  },

  async fetchConversations(accountId) {
    const session = await acquireSession(accountId)
    try {
      const page = session.context.pages()[0] || await session.context.newPage()
      await navigateToDMs(page)

      const frame = await getMessagesFrame(page)
      const loaded = await waitForConversationList(frame)
      if (!loaded) {
        console.log(`[playwright] conversation list did not load for ${accountId}, URL: ${page.url()}`)
        return []
      }

      // Scroll the conversation list to force TikTok to render all items
      // (TikTok virtualizes the list and only renders visible conversations)
      await frame.evaluate(async () => {
        const list = document.querySelector('[class*="ConversationList"], [class*="conversationList"], [class*="ChatList"]') ||
                     document.querySelector('[data-e2e="dm-new-conversation-item"]')?.parentElement?.parentElement
        if (!list) return
        const scrollable = list.closest('[class*="scroll"], [class*="Scroll"]') || list.parentElement
        if (!scrollable) return
        for (let i = 0; i < 5; i++) {
          scrollable.scrollBy(0, 800)
          await new Promise(r => setTimeout(r, 600))
        }
        scrollable.scrollTo(0, 0)
      }).catch(() => {})
      await new Promise(r => setTimeout(r, 1000))

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

          // Strip any time suffix the DOM may have concatenated onto the message preview
          const timeText = timeEl?.textContent?.trim() || ''
          let rawMsgText = extractEl?.textContent?.trim() || null
          if (rawMsgText && timeText && rawMsgText.endsWith(timeText)) {
            rawMsgText = rawMsgText.slice(0, -timeText.length).trim() || null
          }

          // Detect direction from 'You: ' prefix in the message preview
          let lastMessageDirection: 'inbound' | 'outbound' | null = null
          if (rawMsgText) {
            if (rawMsgText.startsWith('You: ') || rawMsgText.startsWith('You ')) {
              lastMessageDirection = 'outbound'
              rawMsgText = rawMsgText.replace(/^You:?\s+/, '')
            } else {
              lastMessageDirection = 'inbound'
            }
          }

          results.push({
            peerUsername: peerDisplayName,
            peerDisplayName,
            peerAvatar: avatarEl?.getAttribute('src') || null,
            lastMessageText: rawMsgText,
            lastMessageAt: timeText || null,
            lastMessageDirection,
            unreadCount: badgeEl ? parseInt(badgeEl.textContent || '1') || 1 : 0,
            conversationId: convId,
          })
        })

        return results
      })

      return rawConversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt ? parseRelativeDate(c.lastMessageAt) : new Date(),
      }))
    } finally {
      await releaseSession(accountId)
    }
  },

  async fetchMessages(accountId, peerUsername, _since) {
    const session = await acquireSession(accountId)
    try {
      const page = session.context.pages()[0] || await session.context.newPage()
      await navigateToDMs(page)

      let frame = await getMessagesFrame(page)
      const listLoaded = await waitForConversationList(frame)
      if (!listLoaded) {
        return []
      }
      await randomDelay(1000, 2000)

      await dismissCookieBanner(page)

      let clicked = false
      // Scroll through the conversation list to find the target, then click it
      const scrollDeadline = Date.now() + 15_000
      while (!clicked && Date.now() < scrollDeadline) {
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
          // Scroll down to reveal more conversations and try again
          await frame.evaluate(() => {
            const list = document.querySelector('[data-e2e="dm-new-conversation-item"]')?.parentElement?.parentElement
            const scrollable = list?.closest('[class*="scroll"], [class*="Scroll"]') || list?.parentElement
            if (scrollable) scrollable.scrollBy(0, 400)
          }).catch(() => {})
          await new Promise(r => setTimeout(r, 800))
        }
      }

      if (!clicked) {
        console.log(`[fetchMessages] could not find conversation for "${peerUsername}"`)
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

      // ── Scroll the virtualized thread to load full history ──────
      // TikTok only renders the messages near the viewport, so we first scroll
      // to the very top, then walk down extracting the rendered window each step,
      // merging into an ordered list keyed by stable content (oldest → newest).

      type RawItem = { realId: string | null; direction: 'inbound' | 'outbound'; body: string | null; mediaUrl: string | null; rawTime: string }

      // Extract the currently-rendered window in DOM order (top → bottom).
      const extract = (): Promise<RawItem[]> => msgFrame!.evaluate(() => {
        const out: Array<{ realId: string | null; direction: 'inbound' | 'outbound'; body: string | null; mediaUrl: string | null; rawTime: string }> = []
        let lastTimestamp = ''
        document.querySelectorAll('[data-e2e="dm-new-chat-item"]').forEach((el) => {
          const wrapper = el.closest('[data-index]')

          const timeContainer = wrapper?.querySelector('[class*="TimeContainer"]')
          if (timeContainer) lastTimestamp = timeContainer.textContent?.trim() || lastTimestamp

          // Prefer a real TikTok message id if one is exposed on the node/wrapper.
          const realId = el.getAttribute('data-msg-id') || el.getAttribute('data-message-id')
            || wrapper?.getAttribute('data-msg-id') || wrapper?.getAttribute('data-message-id')
            || el.id || null

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

          out.push({ realId: realId || null, direction: isSelf ? 'outbound' : 'inbound', body: body || null, mediaUrl, rawTime: lastTimestamp })
        })
        return out
      }).catch(() => [] as RawItem[])

      // Scroll the message container; returns scroll metrics so Node can decide when to stop.
      const scrollBy = (dir: 'up' | 'down'): Promise<{ scrollTop: number; scrollHeight: number; clientHeight: number }> =>
        msgFrame!.evaluate((d) => {
          const item = document.querySelector('[data-e2e="dm-new-chat-item"]')
          let sc: HTMLElement | null = item ? (item.closest('[class*="scroll"], [class*="Scroll"]') as HTMLElement | null) : null
          if (!sc && item) sc = (item.parentElement?.parentElement as HTMLElement | null) || null
          if (sc) sc.scrollTop = d === 'up' ? Math.max(0, sc.scrollTop - Math.round(sc.clientHeight * 0.85)) : sc.scrollTop + Math.round(sc.clientHeight * 0.85)
          return sc ? { scrollTop: sc.scrollTop, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight } : { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
        }, dir).catch(() => ({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }))

      // Phase 1: climb to the top of the thread.
      const topDeadline = Date.now() + 15_000
      while (Date.now() < topDeadline) {
        const m = await scrollBy('up')
        await new Promise(r => setTimeout(r, 500))
        if (m.scrollTop <= 0) break
      }

      // Phase 2: walk down, accumulating unique messages in chronological order.
      const stableKey = (it: RawItem): string =>
        it.realId || createHash('sha1').update(`${peerUsername}|${it.direction}|${it.body || ''}|${it.mediaUrl || ''}`).digest('hex')

      const ordered: Array<{ tiktokMsgId: string; direction: 'inbound' | 'outbound'; body: string | null; mediaUrl: string | null; rawTime: string }> = []
      const seen = new Set<string>()
      const merge = (items: RawItem[]) => {
        for (const it of items) {
          const key = stableKey(it)
          if (seen.has(key)) continue
          seen.add(key)
          ordered.push({ tiktokMsgId: key, direction: it.direction, body: it.body, mediaUrl: it.mediaUrl, rawTime: it.rawTime })
        }
      }

      const downDeadline = Date.now() + 25_000
      while (Date.now() < downDeadline) {
        merge(await extract())
        const m = await scrollBy('down')
        await new Promise(r => setTimeout(r, 500))
        if (m.scrollTop + m.clientHeight >= m.scrollHeight - 2) {
          merge(await extract()) // final window at the bottom
          break
        }
      }

      console.log(`[fetchMessages] collected ${ordered.length} messages for "${peerUsername}"`)

      return ordered.map((m) => {
        const parsed = parseRelativeDate(m.rawTime)
        return {
          tiktokMsgId: m.tiktokMsgId,
          direction: m.direction,
          body: m.body,
          mediaUrl: m.mediaUrl,
          sentAt: isNaN(parsed.getTime()) ? new Date() : parsed,
        }
      })
    } finally {
      await releaseSession(accountId)
    }
  },

  async sendMessage(accountId, peerUsername, body) {
    const session = await acquireSession(accountId)
    try {
      const page = session.context.pages()[0] || await session.context.newPage()
      await navigateToDMs(page)
      await dismissCookieBanner(page)

      const frame = await getMessagesFrame(page)
      await waitForConversationList(frame)
      await randomDelay(1000, 2000)
      await dismissCookieBanner(page)

      let clicked = false
      for (let attempt = 0; attempt < 5; attempt++) {
        const items = await frame.$$('[data-e2e="dm-new-conversation-item"]')
        for (const item of items) {
          const text = await item.textContent()
          console.log(`[playwright] checking item text: "${text?.replace(/\s+/g, ' ').trim()}" against: "${peerUsername}"`)
          if (text?.toLowerCase().includes(peerUsername.toLowerCase())) {
            await item.click()
            await randomDelay(1500, 2500)
            clicked = true
            break
          }
        }
        if (clicked) break

        // Scroll list down to load more items
        await frame.evaluate(() => {
          const list = document.querySelector('[class*="ConversationList"], [class*="conversationList"], [class*="ChatList"]') ||
                       document.querySelector('[data-e2e="dm-new-conversation-item"]')?.parentElement?.parentElement
          if (!list) return
          const scrollable = list.closest('[class*="scroll"], [class*="Scroll"]') || list.parentElement
          if (scrollable) scrollable.scrollBy(0, 500)
        }).catch(() => {})
        await randomDelay(1000, 1500)
      }

      if (!clicked) {
        throw new Error(`Conversation with peer "${peerUsername}" not found in list (virtualized list or scrolled out of view)`)
      }

      const inputSelector = '[data-e2e="dm-new-input-editor"], [data-e2e="dm-input"], [class*="ChatInput"] [contenteditable], [class*="DraftEditor"] [contenteditable]'
      await frame.waitForSelector(inputSelector, { timeout: 10_000 })
      // Click the input inside the iframe to properly focus it before typing.
      // page.keyboard targets the top-level page focus, so we must click first.
      await frame.locator(inputSelector).first().click()
      await randomDelay(200, 400)

      for (const char of body) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 })
      }

      await randomDelay(500, 1000)
      await page.keyboard.press('Enter')
      await randomDelay(1000, 2000)

      return {
        tiktokMsgId: `sent_${Date.now()}`,
        direction: 'outbound' as const,
        body,
        mediaUrl: null,
        sentAt: new Date(),
      }
    } finally {
      await releaseSession(accountId)
    }
  },

  async getAccountStatus(accountId) {
    const session = await acquireSession(accountId)
    try {
      const page = session.context.pages()[0] || await session.context.newPage()

      const isLoggedIn = await page.evaluate(() => {
        return document.cookie.includes('sessionid') ||
               document.querySelector('[data-e2e="profile-icon"]') !== null
      })

      return {
        connected: isLoggedIn,
        restricted: false,
        banned: false,
      }
    } finally {
      await releaseSession(accountId)
    }
  },

  async scrapeFollowers(accountId, limit = 50) {
    const session = await acquireSession(accountId)
    try {
      const page = session.context.pages()[0] || await session.context.newPage()
      
      const { data: account } = await supabase
        .from('tiktok_accounts')
        .select('username')
        .eq('id', accountId)
        .single()
      
      if (!account) throw new Error('Account not found')
      
      const profileUrl = `${TIKTOK_BASE}/@${account.username}`
      console.log(`[playwright] navigating to profile: ${profileUrl}`)
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await randomDelay(2000, 3000)
      await dismissCookieBanner(page)

      const followersSelector = '[data-e2e="followers"], [href*="/followers"], [class*="Followers"]'
      await page.waitForSelector(followersSelector, { timeout: 10_000 })
      await page.click(followersSelector)
      await randomDelay(2000, 3000)

      const modalListSelector = '[class*="DivFollowListContainer"], [class*="DivUserListContainer"], [class*="FollowList"], [class*="UserList"]'
      let items: Array<{ username: string; displayName: string | null; isMutual: boolean }> = []
      
      const scrollDeadline = Date.now() + 45_000
      let lastCount = 0
      while (items.length < limit && Date.now() < scrollDeadline) {
        items = await page.evaluate(() => {
          const listItems = document.querySelectorAll('[class*="ItemContainer"], [class*="ItemUser"], [class*="UserItem"], [class*="ItemUser"]')
          const results: Array<{ username: string; displayName: string | null; isMutual: boolean }> = []
          
          listItems.forEach(el => {
            const handleEl = el.querySelector('[class*="UniqueId"], [class*="username"], a[href*="/@"]')
            const nameEl = el.querySelector('[class*="Nickname"]')
            const btnEl = el.querySelector('button')
            
            let username = ''
            if (handleEl) {
              const href = handleEl.getAttribute('href') || ''
              const match = href.match(/@([a-zA-Z0-9_\.]+)/)
              username = match ? match[1] : handleEl.textContent?.trim().replace(/^@/, '') || ''
            }
            
            if (!username) return
            
            const btnText = btnEl?.textContent?.trim().toLowerCase() || ''
            const isMutual = btnText.includes('friends') || btnText.includes('message') || btnText.includes('following')
            
            results.push({
              username,
              displayName: nameEl?.textContent?.trim() || null,
              isMutual
            })
          })
          
          return results
        })

        if (items.length >= limit || items.length === lastCount) {
          if (items.length === lastCount) break
        }
        
        lastCount = items.length
        
        await page.evaluate((sel) => {
          const list = document.querySelector(sel)
          if (list) {
            const scrollable = list.closest('[class*="scroll"], [class*="Scroll"]') || list.parentElement || list
            scrollable.scrollBy(0, 400)
          }
        }, modalListSelector)
        
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 500))
      }

      console.log(`[playwright] scraped ${items.length} followers for ${account.username}`)
      return items.slice(0, limit)
    } finally {
      await releaseSession(accountId)
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
