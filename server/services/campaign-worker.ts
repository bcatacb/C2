import { supabase } from '../utils/supabase.js'
import type { Campaign, CampaignLead } from './campaign-service.js'
import { sendMessage } from './message-sender.js'
import { renderTemplate } from './template-renderer.js'
import { listLeads, type Lead } from './lead-service.js'
import { isInCooldown } from '../utils/cooldown.js'

const CAMPAIGN_WORKER_INTERVAL_MS = parseInt(
  process.env.CAMPAIGN_WORKER_INTERVAL_MS || '60000'
)
const MAX_SENDS_PER_CAMPAIGN_PER_TICK = 10

let workerTimer: ReturnType<typeof setInterval> | null = null

// --- Public API ---

export function startCampaignWorker() {
  if (workerTimer) return
  console.log(`[campaign-worker] starting (interval: ${CAMPAIGN_WORKER_INTERVAL_MS}ms)`)
  workerTimer = setInterval(tick, CAMPAIGN_WORKER_INTERVAL_MS)
  tick()
}

export function stopCampaignWorker() {
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
    console.log('[campaign-worker] stopped')
  }
}

// --- Core Tick ---

export async function tick(): Promise<void> {
  try {
    const activeCampaigns = await getActiveCampaigns()
    if (activeCampaigns.length === 0) return

    for (const campaign of activeCampaigns) {
      await processCampaign(campaign)
    }
  } catch (err) {
    console.error('[campaign-worker] tick error:', err)
  }
}

// --- Campaign Processing ---

async function getActiveCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active')

  if (error) {
    console.error('[campaign-worker] failed to fetch active campaigns:', error.message)
    return []
  }
  return (data || []) as Campaign[]
}

export async function processCampaign(campaign: Campaign): Promise<void> {
  try {
    // Step 1: Find uncontacted leads and enroll them
    await enrollNewLeads(campaign)

    // Step 2: Find leads due for next step
    const actionableLeads = await getActionableLeads(campaign)

    if (actionableLeads.length === 0) {
      await checkCampaignCompletion(campaign)
      return
    }

    // Step 3: Get account capacities
    const accountCapacities = await getAccountCapacities(campaign.assigned_account_ids)
    const availableAccounts = accountCapacities
      .filter(a => a.remaining > 0)
      .sort((a, b) => a.sent - b.sent)

    if (availableAccounts.length === 0) return

    // Step 4: Distribute and send via round-robin
    let accountIndex = 0
    let totalSentThisTick = 0
    const maxPerTick = Math.min(campaign.daily_send_limit, MAX_SENDS_PER_CAMPAIGN_PER_TICK)

    for (const campaignLead of actionableLeads) {
      if (totalSentThisTick >= maxPerTick) break

      // Check lead status before each send
      const lead = await getLeadById(campaignLead.lead_id)
      if (!lead) continue
      if (lead.status === 'do_not_contact') {
        await markCampaignLeadSkipped(campaignLead.id)
        continue
      }

      // Re-check campaign_lead status (may have changed since query)
      const freshStatus = await getCampaignLeadStatus(campaignLead.id)
      if (freshStatus === 'replied' || freshStatus === 'skipped' || freshStatus === 'converted') continue

      // Find next account with capacity (round-robin)
      let attempts = 0
      while (availableAccounts[accountIndex].remaining <= 0 && attempts < availableAccounts.length) {
        accountIndex = (accountIndex + 1) % availableAccounts.length
        attempts++
      }
      if (attempts >= availableAccounts.length) break // No capacity left

      const account = availableAccounts[accountIndex]

      // Determine which step to send
      const stepToSend = campaignLead.current_step + 1
      const step = campaign.steps[stepToSend - 1]

      if (!step) {
        // Lead has completed all steps — leave as 'contacted' (terminal)
        continue
      }

      // Check skip_if_replied (using freshStatus from re-check above)
      if (step.skip_if_replied && freshStatus === 'replied') {
        continue
      }

      // Render template
      const variables = { username: lead.username, display_name: lead.display_name || '' }
      const message = renderTemplate(step.template, variables)

      // Send message
      try {
        await sendMessage(account.id, lead.username, message)
      } catch (err) {
        // Transport error: log, don't advance step, leave next_send_at for retry
        console.error(
          `[campaign-worker] send failed for lead ${lead.username} via account ${account.id}:`,
          err instanceof Error ? err.message : err
        )
        continue
      }

      // Update progress
      await advanceLeadProgress(campaignLead, stepToSend, campaign)

      account.remaining--
      totalSentThisTick++
      accountIndex = (accountIndex + 1) % availableAccounts.length
    }

    // After processing, check completion again
    if (totalSentThisTick === 0) {
      await checkCampaignCompletion(campaign)
    }
  } catch (err) {
    console.error(`[campaign-worker] error processing campaign ${campaign.id}:`, err)
  }
}

// --- Lead Enrollment ---

async function enrollNewLeads(campaign: Campaign): Promise<void> {
  // Get leads matching target_filters
  const filters = campaign.target_filters || {}
  const result = await listLeads({ ...filters, per_page: 100 })
  const matchingLeads = result.data

  if (matchingLeads.length === 0) return

  // Get existing campaign lead IDs for this campaign
  const { data: existingRows } = await supabase
    .from('campaign_leads')
    .select('lead_id')
    .eq('campaign_id', campaign.id)

  const existingLeadIds = new Set((existingRows || []).map((r: { lead_id: string }) => r.lead_id))

  // Filter out already-enrolled and do_not_contact leads
  const newLeads = matchingLeads.filter(
    (lead) => !existingLeadIds.has(lead.id) && lead.status !== 'do_not_contact'
  )

  if (newLeads.length === 0) return

  // Enroll new leads with status 'pending'
  const rows = newLeads.map((lead) => ({
    campaign_id: campaign.id,
    lead_id: lead.id,
    current_step: 0,
    status: 'pending',
    next_send_at: new Date().toISOString(), // Ready for immediate first send
  }))

  const { error } = await supabase.from('campaign_leads').insert(rows)
  if (error) {
    console.error(`[campaign-worker] failed to enroll leads for campaign ${campaign.id}:`, error.message)
  }
}

// --- Actionable Leads ---

async function getActionableLeads(campaign: Campaign): Promise<CampaignLead[]> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('campaign_leads')
    .select('*')
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'contacted'])
    .lte('next_send_at', now)
    .order('next_send_at', { ascending: true })

  if (error) {
    console.error(`[campaign-worker] failed to fetch actionable leads:`, error.message)
    return []
  }

  return (data || []) as CampaignLead[]
}

// --- Account Capacities ---

async function getAccountCapacities(
  accountIds: string[]
): Promise<Array<{ id: string; remaining: number; sent: number }>> {
  let query = supabase
    .from('tiktok_accounts')
    .select('id, daily_dm_limit, dms_sent_today, status, cooldown_until')

  if (accountIds && accountIds.length > 0) {
    query = query.in('id', accountIds)
  }

  const { data, error } = await query

  if (error) {
    console.error('[campaign-worker] failed to fetch account capacities:', error.message)
    return []
  }

  return (data || [])
    .filter(
      (a: { status: string; cooldown_until: string | null }) =>
        a.status === 'connected' && !isInCooldown(a.cooldown_until)
    )
    .map((a: { id: string; daily_dm_limit: number; dms_sent_today: number }) => ({
      id: a.id,
      remaining: Math.max(0, a.daily_dm_limit - a.dms_sent_today),
      sent: a.dms_sent_today,
    }))
}

// --- Progress Advancement ---

async function advanceLeadProgress(
  campaignLead: CampaignLead,
  stepJustSent: number,
  campaign: Campaign
): Promise<void> {
  const totalSteps = campaign.steps.length
  const isLastStep = stepJustSent >= totalSteps

  const updates: Record<string, unknown> = {
    current_step: stepJustSent,
    last_sent_at: new Date().toISOString(),
    status: 'contacted',
  }

  if (isLastStep) {
    // Lead completed all steps — leave status as 'contacted' (terminal), clear next_send_at
    updates.next_send_at = null
  } else {
    // Calculate next_send_at based on next step's delay_hours + jitter
    const nextStep = campaign.steps[stepJustSent] // 0-indexed, stepJustSent is the next index
    const delayHours = nextStep.delay_hours
    const delayMs = delayHours * 60 * 60 * 1000
    // Add randomized jitter (60-300 seconds) to space out sends naturally
    const jitterMs = Math.floor(Math.random() * (300_000 - 60_000 + 1)) + 60_000
    const nextSendAt = new Date(Date.now() + delayMs + jitterMs)
    updates.next_send_at = nextSendAt.toISOString()
  }

  const { error } = await supabase
    .from('campaign_leads')
    .update(updates)
    .eq('id', campaignLead.id)

  if (error) {
    console.error(`[campaign-worker] failed to advance lead ${campaignLead.id}:`, error.message)
  }
}

// --- Campaign Completion ---

async function checkCampaignCompletion(campaign: Campaign): Promise<void> {
  // A campaign is complete if all enrolled leads are in terminal status:
  // - 'replied', 'converted', 'skipped' are terminal
  // - 'contacted' with current_step >= total steps is terminal (completed all steps)
  // - 'pending' or 'contacted' with steps remaining are NOT terminal

  const { count: totalLeads, error: totalError } = await supabase
    .from('campaign_leads')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)

  if (totalError || !totalLeads || totalLeads === 0) return

  // Count non-terminal leads (pending, or contacted with steps remaining)
  const { count: pendingCount } = await supabase
    .from('campaign_leads')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')

  const { count: contactedWithStepsRemaining } = await supabase
    .from('campaign_leads')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'contacted')
    .lt('current_step', campaign.steps.length)

  const nonTerminalCount = (pendingCount || 0) + (contactedWithStepsRemaining || 0)

  if (nonTerminalCount === 0) {
    // All leads are in terminal status — mark campaign completed
    const { error } = await supabase
      .from('campaigns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', campaign.id)

    if (error) {
      console.error(`[campaign-worker] failed to mark campaign ${campaign.id} as completed:`, error.message)
    } else {
      console.log(`[campaign-worker] campaign ${campaign.id} marked as completed`)
    }
  }
}

// --- Helpers ---

async function getLeadById(leadId: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (error) return null
  return data as Lead
}

async function getCampaignLeadStatus(campaignLeadId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaign_leads')
    .select('status')
    .eq('id', campaignLeadId)
    .single()

  if (error || !data) return null
  return (data as { status: string }).status
}

async function markCampaignLeadSkipped(campaignLeadId: string): Promise<void> {
  const { error } = await supabase
    .from('campaign_leads')
    .update({ status: 'skipped', next_send_at: null })
    .eq('id', campaignLeadId)

  if (error) {
    console.error(`[campaign-worker] failed to mark campaign lead ${campaignLeadId} as skipped:`, error.message)
  }
}
