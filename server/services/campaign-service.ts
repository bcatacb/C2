import { supabase } from '../utils/supabase.js'
import type { LeadFilters } from './lead-service.js'

// --- Types ---

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived'

export type CampaignLeadStatus = 'pending' | 'contacted' | 'replied' | 'converted' | 'skipped'

export interface CampaignStep {
  step_number: number
  delay_hours: number
  template: string
  skip_if_replied: boolean
}

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  steps: CampaignStep[]
  target_filters: LeadFilters
  assigned_account_ids: string[]
  daily_send_limit: number
  created_at: string
  updated_at: string
}

export interface CampaignLead {
  id: string
  campaign_id: string
  lead_id: string
  account_id: string | null
  current_step: number
  status: CampaignLeadStatus
  last_sent_at: string | null
  next_send_at: string | null
  created_at: string
}

export interface StepStats {
  step_number: number
  sent: number
  pending: number
}

export interface CampaignStats {
  total_leads: number
  pending: number
  contacted: number
  replied: number
  converted: number
  skipped: number
  by_step: StepStats[]
}

export interface CreateCampaignInput {
  name: string
  steps?: CampaignStep[]
  target_filters?: LeadFilters
  assigned_account_ids?: string[]
  daily_send_limit?: number
}

export interface UpdateCampaignInput {
  name?: string
  steps?: CampaignStep[]
  target_filters?: LeadFilters
  assigned_account_ids?: string[]
  daily_send_limit?: number
}

export interface CampaignLeadFilters {
  status?: CampaignLeadStatus
  page?: number
  per_page?: number
}

export type CampaignWithStats = Campaign & { stats: CampaignStats }

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// --- Validation Helpers ---

function validateName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Campaign name is required')
  }
  if (name.length > 100) {
    throw new Error('Campaign name must be 100 characters or less')
  }
}

function validateSteps(steps: CampaignStep[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step.step_number !== i + 1) {
      throw new Error(`Steps must have sequential step_number values starting from 1`)
    }
    if (!step.template || step.template.trim().length === 0) {
      throw new Error(`Step ${step.step_number} must have a non-empty template`)
    }
    if (step.delay_hours < 0) {
      throw new Error(`Step ${step.step_number} delay_hours must be >= 0`)
    }
  }
}

// --- Valid Status Transitions ---

const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
}

function isValidTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  if (to === 'archived') return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// --- CRUD Functions ---

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  validateName(input.name)

  const steps = input.steps || []
  if (steps.length > 0) {
    validateSteps(steps)
  }

  // Apply defaults for skip_if_replied
  const normalizedSteps = steps.map((s) => ({
    ...s,
    skip_if_replied: s.skip_if_replied ?? true,
  }))

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      name: input.name.trim(),
      status: 'draft',
      steps: normalizedSteps,
      target_filters: input.target_filters || {},
      assigned_account_ids: input.assigned_account_ids || [],
      daily_send_limit: input.daily_send_limit ?? 100,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Campaign
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data as Campaign[]
}

export async function updateCampaign(id: string, fields: UpdateCampaignInput): Promise<Campaign> {
  const campaign = await getCampaign(id)
  if (!campaign) throw new Error('Campaign not found')

  // Reject updates to steps/target_filters on active campaigns
  if (campaign.status === 'active') {
    if (fields.steps !== undefined) {
      throw new Error('Cannot update steps on an active campaign')
    }
    if (fields.target_filters !== undefined) {
      throw new Error('Cannot update target_filters on an active campaign')
    }
  }

  // Validate name if provided
  if (fields.name !== undefined) {
    validateName(fields.name)
  }

  // Validate steps if provided
  if (fields.steps !== undefined && fields.steps.length > 0) {
    validateSteps(fields.steps)
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.name !== undefined) updatePayload.name = fields.name.trim()
  if (fields.steps !== undefined) {
    updatePayload.steps = fields.steps.map((s) => ({
      ...s,
      skip_if_replied: s.skip_if_replied ?? true,
    }))
  }
  if (fields.target_filters !== undefined) updatePayload.target_filters = fields.target_filters
  if (fields.assigned_account_ids !== undefined) updatePayload.assigned_account_ids = fields.assigned_account_ids
  if (fields.daily_send_limit !== undefined) updatePayload.daily_send_limit = fields.daily_send_limit

  const { data, error } = await supabase
    .from('campaigns')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// --- Status Transition Functions ---

export async function activateCampaign(id: string): Promise<Campaign> {
  const campaign = await getCampaign(id)
  if (!campaign) throw new Error('Campaign not found')

  if (!isValidTransition(campaign.status, 'active')) {
    throw new Error(`Cannot activate campaign with status '${campaign.status}'. Only draft or paused campaigns can be activated.`)
  }

  // Only draft→active requires validation (paused→active is handled by resumeCampaign)
  if (campaign.status !== 'draft') {
    throw new Error(`Cannot activate campaign with status '${campaign.status}'. Only draft campaigns can be activated.`)
  }

  if (!campaign.steps || campaign.steps.length === 0) {
    throw new Error('Campaign must have at least one step to be activated')
  }

  // Fall back to auto-rotation of all connected accounts if no specific accounts are assigned

  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  const campaign = await getCampaign(id)
  if (!campaign) throw new Error('Campaign not found')

  if (campaign.status !== 'active') {
    throw new Error(`Cannot pause campaign with status '${campaign.status}'. Only active campaigns can be paused.`)
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  const campaign = await getCampaign(id)
  if (!campaign) throw new Error('Campaign not found')

  if (campaign.status !== 'paused') {
    throw new Error(`Cannot resume campaign with status '${campaign.status}'. Only paused campaigns can be resumed.`)
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

// --- Campaign Leads and Stats ---

export async function getCampaignLeads(
  campaignId: string,
  filters?: CampaignLeadFilters
): Promise<PaginatedResult<CampaignLead>> {
  const page = Math.max(1, filters?.page || 1)
  const perPage = Math.min(100, Math.max(1, filters?.per_page || 50))
  const offset = (page - 1) * perPage

  let query = supabase
    .from('campaign_leads')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  query = query.order('created_at', { ascending: false }).range(offset, offset + perPage - 1)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  return {
    data: data as CampaignLead[],
    total: count || 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  }
}

export async function getCampaignWithStats(id: string): Promise<CampaignWithStats | null> {
  const campaign = await getCampaign(id)
  if (!campaign) return null

  const stats = await getStats(id)
  return { ...campaign, stats }
}

export async function getStats(campaignId: string): Promise<CampaignStats> {
  const allStatuses: CampaignLeadStatus[] = ['pending', 'contacted', 'replied', 'converted', 'skipped']

  // Get total count
  const { count: totalLeads, error: totalError } = await supabase
    .from('campaign_leads')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)

  if (totalError) throw new Error(totalError.message)

  // Get counts by status
  const statusCounts: Record<CampaignLeadStatus, number> = {
    pending: 0,
    contacted: 0,
    replied: 0,
    converted: 0,
    skipped: 0,
  }

  for (const status of allStatuses) {
    const { count, error } = await supabase
      .from('campaign_leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', status)
    if (error) throw new Error(error.message)
    statusCounts[status] = count || 0
  }

  // Get the campaign to know how many steps there are
  const campaign = await getCampaign(campaignId)
  const stepCount = campaign?.steps?.length || 0

  // Get per-step breakdown
  const byStep: StepStats[] = []
  for (let i = 1; i <= stepCount; i++) {
    // Sent: leads whose current_step >= this step number
    const { count: sent, error: sentError } = await supabase
      .from('campaign_leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .gte('current_step', i)

    if (sentError) throw new Error(sentError.message)

    // Pending: leads whose current_step is exactly step - 1 (waiting for this step)
    // and status is 'pending' or 'contacted'
    const { count: pending, error: pendingError } = await supabase
      .from('campaign_leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('current_step', i - 1)
      .in('status', ['pending', 'contacted'])

    if (pendingError) throw new Error(pendingError.message)

    byStep.push({
      step_number: i,
      sent: sent || 0,
      pending: pending || 0,
    })
  }

  return {
    total_leads: totalLeads || 0,
    pending: statusCounts.pending,
    contacted: statusCounts.contacted,
    replied: statusCounts.replied,
    converted: statusCounts.converted,
    skipped: statusCounts.skipped,
    by_step: byStep,
  }
}

export async function markLeadReplied(campaignLeadId: string): Promise<void> {
  // Update campaign_lead status to 'replied' and clear next_send_at
  const { data: campaignLead, error: updateError } = await supabase
    .from('campaign_leads')
    .update({ status: 'replied', next_send_at: null })
    .eq('id', campaignLeadId)
    .select()
    .single()

  if (updateError) throw new Error(updateError.message)

  // Also update the lead's status in the leads table to 'replied'
  const { error: leadError } = await supabase
    .from('leads')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', (campaignLead as CampaignLead).lead_id)

  if (leadError) throw new Error(leadError.message)
}
