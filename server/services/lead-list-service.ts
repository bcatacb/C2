import { supabase } from '../utils/supabase.js'

export interface LeadList {
  id: string
  name: string
  description: string | null
  created_at: string
  lead_count?: number
}

export async function listLeadLists(): Promise<LeadList[]> {
  const { data: lists, error } = await supabase
    .from('lead_lists')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) throw new Error(error.message)

  // Fetch counts to avoid complex postgrest joins
  const { data: counts, error: countError } = await supabase
    .from('lead_list_members')
    .select('list_id')

  const countsMap: Record<string, number> = {}
  if (!countError && counts) {
    for (const c of counts) {
      countsMap[c.list_id] = (countsMap[c.list_id] || 0) + 1
    }
  }

  return (lists || []).map(list => ({
    ...list,
    lead_count: countsMap[list.id] || 0
  }))
}

export async function createLeadList(name: string, description?: string): Promise<LeadList> {
  if (!name || name.trim().length === 0) {
    throw new Error('List name cannot be empty')
  }

  const { data, error } = await supabase
    .from('lead_lists')
    .insert({
      name: name.trim(),
      description: description?.trim() || null
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as LeadList
}

export async function deleteLeadList(id: string): Promise<void> {
  const { error } = await supabase
    .from('lead_lists')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function addLeadsToList(listId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return

  const inserts = leadIds.map(leadId => ({
    list_id: listId,
    lead_id: leadId
  }))

  const { error } = await supabase
    .from('lead_list_members')
    .upsert(inserts, { onConflict: 'list_id,lead_id' })

  if (error) throw new Error(error.message)
}

export async function removeLeadsFromList(listId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return

  const { error } = await supabase
    .from('lead_list_members')
    .delete()
    .eq('list_id', listId)
    .in('lead_id', leadIds)

  if (error) throw new Error(error.message)
}
