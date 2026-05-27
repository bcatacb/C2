import { supabase } from '../utils/supabase.js'

export interface Proxy {
  id: string
  user_id: string | null
  type: 'residential' | 'mobile' | 'datacenter' | null
  host: string
  port: number
  username: string | null
  password: string | null
  country: string | null
  assigned_account_id: string | null
  status: 'active' | 'dead' | 'rotating'
  last_checked: string | null
  created_at: string
}

export async function listProxies(userId?: string): Promise<Proxy[]> {
  let query = supabase.from('proxies').select('*').order('created_at', { ascending: true })
  if (userId) query = query.eq('user_id', userId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Proxy[]
}

export async function createProxy(
  fields: Pick<Proxy, 'host' | 'port'> & Partial<Proxy>
): Promise<Proxy> {
  const { data, error } = await supabase.from('proxies').insert(fields).select().single()
  if (error) throw new Error(error.message)
  return data as Proxy
}

export async function updateProxy(id: string, fields: Partial<Proxy>): Promise<Proxy> {
  const { data, error } = await supabase
    .from('proxies')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Proxy
}

export async function deleteProxy(id: string): Promise<void> {
  const { error } = await supabase.from('proxies').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function assignProxyToAccount(proxyId: string, accountId: string): Promise<void> {
  const { error: proxyErr } = await supabase
    .from('proxies')
    .update({ assigned_account_id: accountId })
    .eq('id', proxyId)
  if (proxyErr) throw new Error(proxyErr.message)

  const { error: acctErr } = await supabase
    .from('tiktok_accounts')
    .update({ proxy_id: proxyId })
    .eq('id', accountId)
  if (acctErr) throw new Error(acctErr.message)
}
