import { supabase } from '../utils/supabase.js'
import { getAccountsDueForSync, updateAccount, type TikTokAccount } from './account-manager.js'
import { playwrightTransport } from '../transport/playwright.js'
import { apiTransport } from '../transport/api.js'
import type { TikTokTransport, ConversationData, MessageData } from '../transport/interface.js'
import { isInCooldown, nextCooldown } from '../utils/cooldown.js'
import { broadcast } from '../index.js'
import { markLeadReplied } from './campaign-service.js'
import { evaluateRules, type InboundMessageContext } from './automation-engine.js'

const SYNC_INTERVAL = parseInt(process.env.INBOX_SYNC_INTERVAL_MS || '30000')
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '5')

let syncTimer: ReturnType<typeof setInterval> | null = null

function getTransport(account: TikTokAccount): TikTokTransport {
  return account.transport_type === 'api' ? apiTransport : playwrightTransport
}

async function upsertConversation(accountId: string, conv: ConversationData) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, unread_count')
    .eq('account_id', accountId)
    .eq('peer_username', conv.peerUsername)
    .single()

  if (existing) {
    const updates: Record<string, unknown> = {
      peer_display_name: conv.peerDisplayName,
      peer_avatar: conv.peerAvatar,
    }
    if (conv.lastMessageText) {
      updates.last_message_text = conv.lastMessageText
      updates.last_message_at = conv.lastMessageAt?.toISOString() ?? new Date().toISOString()
      updates.last_message_direction = conv.lastMessageDirection
      updates.unread_count = (existing.unread_count || 0) + conv.unreadCount
      if (conv.unreadCount > 0) {
        updates.status = 'unread'
      }
    }
    const { data } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single()
    return data
  }

  const { data } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      peer_username: conv.peerUsername,
      peer_display_name: conv.peerDisplayName,
      peer_avatar: conv.peerAvatar,
      last_message_text: conv.lastMessageText,
      last_message_at: conv.lastMessageAt?.toISOString(),
      last_message_direction: conv.lastMessageDirection,
      unread_count: conv.unreadCount,
      status: conv.unreadCount > 0 ? 'unread' : 'read',
    })
    .select()
    .single()

  // Auto-create a lead from this new inbound contact (skip group chats)
  if (data && !isGroupChat(conv.peerUsername)) {
    const { createLead } = await import('./lead-service.js')
    createLead({
      username: conv.peerUsername,
      display_name: conv.peerDisplayName || undefined,
      source: 'inbox',
    }).catch(() => { /* already exists or invalid username — that's fine */ })
  }

  return data
}

async function upsertMessages(accountId: string, conversationId: string, messages: MessageData[]) {
  const inserted: unknown[] = []

  for (const msg of messages) {
    const { data, error } = await supabase
      .from('messages')
      .upsert(
        {
          conversation_id: conversationId,
          account_id: accountId,
          direction: msg.direction,
          body: msg.body,
          media_url: msg.mediaUrl,
          tiktok_msg_id: msg.tiktokMsgId,
          status: 'delivered',
          sent_at: msg.sentAt.toISOString(),
        },
        { onConflict: 'account_id,tiktok_msg_id' }
      )
      .select()
      .single()

    if (!error && data) inserted.push(data)
  }

  return inserted
}

// Group chats have spaces or apostrophes in their names and can't be
// treated as individual TikTok usernames.
function isGroupChat(peerUsername: string): boolean {
  return peerUsername.includes(' ') || peerUsername.includes("'")
}

async function detectCampaignReplies(accountId: string, conversations: ConversationData[]): Promise<void> {
  for (const conv of conversations) {
    if (conv.unreadCount <= 0) continue
    // Skip group chats — they don't map to individual leads
    if (isGroupChat(conv.peerUsername)) continue

    // Find a lead with matching username
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('username', conv.peerUsername)
      .single()

    if (!lead) continue

    // Find campaign_leads for this lead where status is pending/contacted and campaign is active
    const { data: campaignLeads } = await supabase
      .from('campaign_leads')
      .select('id, campaign_id')
      .eq('lead_id', lead.id)
      .in('status', ['pending', 'contacted'])

    if (!campaignLeads || campaignLeads.length === 0) continue

    for (const cl of campaignLeads) {
      // Verify the campaign is active
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('id, status')
        .eq('id', cl.campaign_id)
        .eq('status', 'active')
        .single()

      if (!campaign) continue

      try {
        await markLeadReplied(cl.id)
        broadcast('campaign:lead-replied', { campaignLeadId: cl.id, campaignId: cl.campaign_id, leadId: lead.id })
        console.log(`[sync] detected campaign reply from ${conv.peerUsername} (campaign_lead: ${cl.id})`)
      } catch (err) {
        console.error(`[sync] error marking lead replied:`, err instanceof Error ? err.message : err)
      }
    }
  }
}

async function runAutomation(
  accountId: string,
  conversations: ConversationData[],
  existingConvIds: Set<string>,
  convRecords: Map<string, { id: string; labels?: string[] }>
): Promise<void> {
  for (const conv of conversations) {
    if (conv.unreadCount <= 0) continue
    // Skip group chats — automation rules only apply to 1:1 conversations
    if (isGroupChat(conv.peerUsername)) continue
    // Skip if the last message was outbound (we sent it — don't reply to ourselves)
    if (conv.lastMessageDirection === 'outbound') continue

    const record = convRecords.get(conv.peerUsername)
    if (!record) continue

    const isNewSender = !existingConvIds.has(record.id)

    const context: InboundMessageContext = {
      account_id: accountId,
      conversation_id: record.id,
      peer_username: conv.peerUsername,
      peer_display_name: conv.peerDisplayName,
      message_text: conv.lastMessageText || '',
      is_new_sender: isNewSender,
      is_first_campaign_reply: false, // already handled by detectCampaignReplies
      conversation_labels: record.labels || [],
    }

    try {
      const results = await evaluateRules(context)
      if (results.length > 0) {
        console.log(`[automation] ${results.length} rules fired for ${conv.peerUsername}`)
      }
    } catch (err) {
      console.error(`[automation] error evaluating rules for ${conv.peerUsername}:`, err instanceof Error ? err.message : err)
    }
  }
}

async function syncAccount(account: TikTokAccount): Promise<void> {
  if (isInCooldown(account.cooldown_until)) {
    console.log(`[sync] skipping ${account.username} — in cooldown`)
    return
  }

  const transport = getTransport(account)

  try {
    const proxyUrl = account.proxy_id ? await getProxyUrl(account.proxy_id) : null

    const sessionData = await transport.connect(account.id, account.session_data, proxyUrl)
    await updateAccount(account.id, {
      status: 'connected',
      session_data: sessionData,
      last_health_check: new Date().toISOString(),
    } as Partial<TikTokAccount>)

    const conversations = await transport.fetchConversations(account.id)
    console.log(`[sync] ${account.username}: found ${conversations.length} conversations`)
    if (conversations.length === 0) {
      const { getSession } = await import('../transport/session-pool.js')
      const sess = getSession(account.id)
      if (sess) {
        const page = sess.context.pages()[0]
        if (page) console.log(`[sync] ${account.username}: browser is on ${page.url()}`)
      }
    }

    // Query existing conversation IDs before upsert to detect new senders
    const { data: existingConvs } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', account.id)

    const existingConvIds = new Set((existingConvs || []).map(c => c.id))

    const convRecords = new Map<string, { id: string; labels?: string[] }>()

    for (const conv of conversations) {
      const convRecord = await upsertConversation(account.id, conv)
      if (!convRecord) continue
      convRecords.set(conv.peerUsername, { id: convRecord.id, labels: convRecord.labels })
      broadcast('conversation:updated', convRecord)
    }

    // Detect replies from leads enrolled in active campaigns
    await detectCampaignReplies(account.id, conversations)

    // Evaluate automation rules for conversations with unread messages
    await runAutomation(account.id, conversations, existingConvIds, convRecords)

    await updateAccount(account.id, {
      last_inbox_sync: new Date().toISOString(),
      last_health_check: new Date().toISOString(),
      cooldown_step: 0,
    } as Partial<TikTokAccount>)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sync] error syncing ${account.username}:`, message)

    if (message.includes('rate') || message.includes('limit') || message.includes('flood')) {
      const cd = nextCooldown(account.cooldown_step)
      await updateAccount(account.id, {
        cooldown_until: new Date(cd.untilMs).toISOString(),
        cooldown_step: cd.step,
      } as Partial<TikTokAccount>)
      console.log(`[sync] ${account.username} entered cooldown step ${cd.step}`)
    }

    if (message.includes('login') || message.includes('session') || message.includes('not logged in')) {
      // Keep session_data — the login check can false-negative on slow page
      // loads, and a kept session self-heals on a later tick. Space retries
      // 10 minutes apart without stepping the rate-limit backoff (6h+ would
      // be excessive for a transient detection miss).
      await updateAccount(account.id, {
        status: 'disconnected',
        cooldown_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      } as Partial<TikTokAccount>)
    }
  }
}

async function getProxyUrl(proxyId: string): Promise<string | null> {
  const { data } = await supabase.from('proxies').select('*').eq('id', proxyId).single()
  if (!data) return null
  const auth = data.username ? `${data.username}:${data.password}@` : ''
  return `http://${auth}${data.host}:${data.port}`
}

async function syncTick() {
  try {
    const accounts = await getAccountsDueForSync(MAX_CONCURRENT)
    if (accounts.length === 0) return

    console.log(`[sync] syncing ${accounts.length} accounts`)
    await Promise.allSettled(accounts.map(syncAccount))
  } catch (err) {
    console.error('[sync] tick error:', err)
  }
}

export function startInboxSync() {
  if (syncTimer) return
  console.log(`[sync] starting inbox sync (interval: ${SYNC_INTERVAL}ms)`)
  syncTimer = setInterval(syncTick, SYNC_INTERVAL)
  syncTick()
}

export function stopInboxSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
