import { supabase } from '../utils/supabase.js'
import { getAccount, updateAccount, type TikTokAccount } from './account-manager.js'
import { playwrightTransport } from '../transport/playwright.js'
import { apiTransport } from '../transport/api.js'
import type { TikTokTransport } from '../transport/interface.js'
import { isInCooldown } from '../utils/cooldown.js'
import { broadcast } from '../index.js'

function getTransport(account: TikTokAccount): TikTokTransport {
  return account.transport_type === 'api' ? apiTransport : playwrightTransport
}

export async function sendMessage(accountId: string, peerUsername: string, body: string) {
  const account = await getAccount(accountId)
  if (!account) throw new Error('Account not found')
  if (account.status !== 'connected') throw new Error(`Account ${account.username} is not connected`)
  if (isInCooldown(account.cooldown_until)) throw new Error(`Account ${account.username} is in cooldown`)
  if (account.dms_sent_today >= account.daily_dm_limit) throw new Error(`Account ${account.username} has reached daily DM limit`)

  const transport = getTransport(account)
  const sent = await transport.sendMessage(accountId, peerUsername, body)

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('peer_username', peerUsername)
    .single()

  let conversationId = conversation?.id

  if (!conversationId) {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({
        account_id: accountId,
        peer_username: peerUsername,
        last_message_text: body,
        last_message_at: sent.sentAt.toISOString(),
        last_message_direction: 'outbound',
        status: 'replied',
      })
      .select()
      .single()
    conversationId = newConv?.id
  } else {
    await supabase
      .from('conversations')
      .update({
        last_message_text: body,
        last_message_at: sent.sentAt.toISOString(),
        last_message_direction: 'outbound',
        status: 'replied',
      })
      .eq('id', conversationId)
  }

  const { data: message } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      account_id: accountId,
      direction: 'outbound',
      body,
      tiktok_msg_id: sent.tiktokMsgId,
      status: 'delivered',
      sent_at: sent.sentAt.toISOString(),
    })
    .select()
    .single()

  await updateAccount(accountId, {
    dms_sent_today: account.dms_sent_today + 1,
  } as Partial<TikTokAccount>)

  broadcast('messages:new', {
    accountId,
    conversationId,
    messages: [message],
  })

  return message
}
