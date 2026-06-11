import { supabase } from '../utils/supabase.js'

// --- Types ---

export type LeadStatus = 'new' | 'queued' | 'contacted' | 'replied' | 'converted' | 'do_not_contact'

export interface Lead {
  id: string
  account_id: string | null
  username: string
  display_name: string | null
  source: string | null
  status: LeadStatus
  tags: string[]
  notes: string | null
  contacted_at: string | null
  replied_at: string | null
  created_at: string
}

export interface LeadFilters {
  status?: LeadStatus | LeadStatus[]
  tags?: string[]
  account_id?: string | null
  search?: string
  created_after?: string
  created_before?: string
  page?: number
  per_page?: number
  list_id?: string
}

export interface CreateLeadInput {
  username: string
  display_name?: string
  source?: string
  status?: LeadStatus
  tags?: string[]
  notes?: string
  account_id?: string
}

export interface UpdateLeadInput {
  display_name?: string
  source?: string
  status?: LeadStatus
  tags?: string[]
  notes?: string
  account_id?: string | null
  contacted_at?: string
  replied_at?: string
}

export type BulkAction =
  | { type: 'tag'; tags: string[] }
  | { type: 'untag'; tags: string[] }
  | { type: 'assign'; account_id: string | null }
  | { type: 'status'; status: LeadStatus }
  | { type: 'delete' }

export interface BulkResult {
  affected: number
  ids: string[]
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface LeadStats {
  total: number
  by_status: Record<LeadStatus, number>
}

// --- Helper Functions ---

export function normalizeUsername(raw: string | undefined | null): string | null {
  if (!raw) return null
  let username = raw.trim().toLowerCase()
  if (username.startsWith('@')) username = username.slice(1)
  return username || null
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_.]{1,24}$/.test(username)
}

// --- CRUD Functions ---

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const normalized = normalizeUsername(input.username)
  if (!normalized || !isValidUsername(normalized)) {
    throw new Error('Invalid username format')
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('username', normalized)
    .single()

  if (existing) {
    throw new Error('Duplicate username')
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      username: normalized,
      display_name: input.display_name || null,
      source: input.source || null,
      status: input.status || 'new',
      tags: input.tags || [],
      notes: input.notes || null,
      account_id: input.account_id || null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Lead
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).single()
  if (error) return null
  return data as Lead
}

export async function updateLead(id: string, fields: UpdateLeadInput): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Lead
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --- List with Pagination and Filtering ---

export async function listLeads(filters: LeadFilters): Promise<PaginatedResult<Lead>> {
  const page = Math.max(1, filters.page || 1)
  const perPage = Math.min(100, Math.max(1, filters.per_page || 50))
  const offset = (page - 1) * perPage

  let query = supabase.from('leads').select('*', { count: 'exact' })

  // Apply filters
  if (filters.list_id) {
    const { data: members, error: memError } = await supabase
      .from('lead_list_members')
      .select('lead_id')
      .eq('list_id', filters.list_id)
    if (memError) throw new Error(memError.message)
    const leadIds = (members || []).map(m => m.lead_id)
    if (leadIds.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        per_page: perPage,
        total_pages: 0,
      }
    }
    query = query.in('id', leadIds)
  }

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
    query = query.in('status', statuses)
  }
  if (filters.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags)
  }
  if (filters.account_id !== undefined) {
    const isValidUuid = filters.account_id === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.account_id)
    if (isValidUuid) {
      query = filters.account_id === null
        ? query.is('account_id', null)
        : query.eq('account_id', filters.account_id)
    } else {
      console.warn(`[leads] ignoring non-UUID account_id filter: "${filters.account_id}"`)
    }
  }
  if (filters.search) {
    query = query.ilike('username', `%${filters.search}%`)
  }
  if (filters.created_after) {
    query = query.gte('created_at', filters.created_after)
  }
  if (filters.created_before) {
    query = query.lte('created_at', filters.created_before)
  }

  query = query.order('created_at', { ascending: false }).range(offset, offset + perPage - 1)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  return {
    data: data as Lead[],
    total: count || 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  }
}

// --- Bulk Operations ---

export async function executeBulkAction(ids: string[], action: BulkAction): Promise<BulkResult> {
  if (ids.length === 0) return { affected: 0, ids: [] }
  if (ids.length > 500) throw new Error('Maximum 500 IDs per bulk operation')

  switch (action.type) {
    case 'delete': {
      const { error } = await supabase.from('leads').delete().in('id', ids)
      if (error) throw new Error(error.message)
      return { affected: ids.length, ids }
    }

    case 'status': {
      const { data, error } = await supabase
        .from('leads')
        .update({ status: action.status })
        .in('id', ids)
        .select('id')
      if (error) throw new Error(error.message)
      return { affected: data.length, ids: data.map((r: { id: string }) => r.id) }
    }

    case 'assign': {
      const { data, error } = await supabase
        .from('leads')
        .update({ account_id: action.account_id })
        .in('id', ids)
        .select('id')
      if (error) throw new Error(error.message)
      return { affected: data.length, ids: data.map((r: { id: string }) => r.id) }
    }

    case 'tag': {
      const { data: leads } = await supabase.from('leads').select('id, tags').in('id', ids)
      const updates = (leads || []).map((lead: { id: string; tags: string[] }) => ({
        id: lead.id,
        tags: [...new Set([...lead.tags, ...action.tags])],
      }))
      for (const update of updates) {
        await supabase.from('leads').update({ tags: update.tags }).eq('id', update.id)
      }
      return { affected: updates.length, ids: updates.map((u) => u.id) }
    }

    case 'untag': {
      const { data: leads } = await supabase.from('leads').select('id, tags').in('id', ids)
      const tagsToRemove = new Set(action.tags)
      const updates = (leads || []).map((lead: { id: string; tags: string[] }) => ({
        id: lead.id,
        tags: lead.tags.filter((t: string) => !tagsToRemove.has(t)),
      }))
      for (const update of updates) {
        await supabase.from('leads').update({ tags: update.tags }).eq('id', update.id)
      }
      return { affected: updates.length, ids: updates.map((u) => u.id) }
    }
  }
}

// --- Statistics ---

export async function getStats(): Promise<LeadStats> {
  const allStatuses: LeadStatus[] = ['new', 'queued', 'contacted', 'replied', 'converted', 'do_not_contact']

  const { count: total, error: totalError } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })

  if (totalError) throw new Error(totalError.message)

  const byStatus: Record<LeadStatus, number> = {
    new: 0,
    queued: 0,
    contacted: 0,
    replied: 0,
    converted: 0,
    do_not_contact: 0,
  }

  for (const status of allStatuses) {
    const { count, error } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    if (error) throw new Error(error.message)
    byStatus[status] = count || 0
  }

  return {
    total: total || 0,
    by_status: byStatus,
  }
}
