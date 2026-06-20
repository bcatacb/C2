import { supabase } from '../utils/supabase.js'

export interface TikTokAccount {
  id: string
  user_id: string | null
  username: string
  display_name: string | null
  profile_photo: string | null
  transport_type: 'playwright' | 'api'
  status: 'connected' | 'disconnected' | 'restricted' | 'banned'
  proxy_id: string | null
  session_data: Record<string, unknown> | null
  daily_dm_limit: number
  dms_sent_today: number
  dms_sent_reset: string | null
  cooldown_until: string | null
  cooldown_step: number
  last_health_check: string | null
  last_inbox_sync: string | null
  sync_enabled: boolean
  created_at: string
}

export async function listAccounts(userId?: string): Promise<TikTokAccount[]> {
  let query = supabase.from('tiktok_accounts').select('*').order('created_at', { ascending: true })
  if (userId) query = query.eq('user_id', userId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as TikTokAccount[]
}

export async function getAccount(id: string): Promise<TikTokAccount | null> {
  const { data, error } = await supabase.from('tiktok_accounts').select('*').eq('id', id).single()
  if (error) return null
  return data as TikTokAccount
}

export async function createAccount(
  fields: Partial<TikTokAccount>
): Promise<TikTokAccount> {
  // username is NOT NULL but we no longer ask for it up front — the real @handle is
  // backfilled from the logged-in session, so seed a placeholder until then.
  const username = fields.username?.trim() || `pending-${Math.random().toString(16).slice(2, 8)}`
  const { data, error } = await supabase
    .from('tiktok_accounts')
    .insert({ ...fields, username })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TikTokAccount
}

export async function updateAccount(
  id: string,
  fields: Partial<TikTokAccount>
): Promise<TikTokAccount> {
  const { data, error } = await supabase
    .from('tiktok_accounts')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TikTokAccount
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('tiktok_accounts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getAccountsDueForSync(limit: number): Promise<TikTokAccount[]> {
  const { data, error } = await supabase
    .from('tiktok_accounts')
    .select('*')
    .in('status', ['connected', 'disconnected'])
    .not('session_data', 'is', null)
    .eq('sync_enabled', true)
    .order('last_inbox_sync', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as TikTokAccount[]
}

export async function resetDailyCounts(): Promise<void> {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  const { error } = await supabase
    .from('tiktok_accounts')
    .update({ dms_sent_today: 0, dms_sent_reset: new Date().toISOString() })
    .lt('dms_sent_reset', cutoff.toISOString())
  if (error) throw new Error(error.message)
}
