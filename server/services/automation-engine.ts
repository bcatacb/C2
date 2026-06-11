import { supabase } from '../utils/supabase.js'
import { sendMessage } from './message-sender.js'
import { moveConversationToStage, updateLabels } from './pipeline-service.js'
import { renderTemplate } from './template-renderer.js'

// ─── Types ──────────────────────────────────────────────────

export interface AutomationTrigger {
  type: 'keyword' | 'any_message' | 'first_reply'
  keywords?: string[]
}

export interface AutomationConditions {
  accounts?: string[]
  labels?: string[]
}

export type AutomationActionType = 'auto_reply' | 'move_to_stage' | 'add_label' | 'assign_account' | 'notify'

export interface AutomationAction {
  type: AutomationActionType
  template?: string
  stage_id?: string
  label?: string
  account_id?: string
  message?: string
}

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  conditions: AutomationConditions
  actions: AutomationAction[]
  priority: number
  created_at: string
  updated_at: string
}

export interface AutomationLogEntry {
  id: string
  rule_id: string
  conversation_id: string
  trigger_type: string
  actions_taken: AutomationAction[]
  created_at: string
}

export interface ExecutionResult {
  rule_id: string
  rule_name: string
  actions_executed: AutomationActionType[]
}

export interface InboundMessageContext {
  account_id: string
  conversation_id: string
  peer_username: string
  peer_display_name: string | null
  message_text: string
  is_new_sender: boolean
  is_first_campaign_reply: boolean
  conversation_labels: string[]
}

export interface CreateRuleInput {
  name: string
  trigger: AutomationTrigger
  conditions?: AutomationConditions
  actions: AutomationAction[]
  priority?: number
}

export interface UpdateRuleInput {
  name?: string
  trigger?: AutomationTrigger
  conditions?: AutomationConditions
  actions?: AutomationAction[]
  priority?: number
  enabled?: boolean
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}


// ─── Validation ─────────────────────────────────────────────

const VALID_TRIGGER_TYPES = ['keyword', 'any_message', 'first_reply']
const VALID_ACTION_TYPES: AutomationActionType[] = ['auto_reply', 'move_to_stage', 'add_label', 'assign_account', 'notify']

export function validateRule(input: CreateRuleInput | UpdateRuleInput): void {
  const errors: string[] = []

  // Validate name
  if ('name' in input && input.name !== undefined) {
    if (!input.name || input.name.trim().length === 0) {
      errors.push('Rule name is required')
    } else if (input.name.trim().length > 100) {
      errors.push('Rule name must be 100 characters or less')
    }
  }

  // Validate trigger
  if ('trigger' in input && input.trigger !== undefined) {
    if (!VALID_TRIGGER_TYPES.includes(input.trigger.type)) {
      errors.push(`Invalid trigger type: ${input.trigger.type}`)
    }
    if (input.trigger.type === 'keyword') {
      if (!input.trigger.keywords || input.trigger.keywords.length === 0) {
        errors.push('Keyword trigger must have at least one keyword')
      }
    }
  }

  // Validate actions
  if ('actions' in input && input.actions !== undefined) {
    if (!input.actions || input.actions.length === 0) {
      errors.push('At least one action is required')
    } else {
      for (const action of input.actions) {
        if (!VALID_ACTION_TYPES.includes(action.type)) {
          errors.push(`Invalid action type: ${action.type}`)
        }
        if (action.type === 'auto_reply' && !action.template) {
          errors.push('auto_reply action requires a template')
        }
        if (action.type === 'move_to_stage' && !action.stage_id) {
          errors.push('move_to_stage action requires a stage_id')
        }
        if (action.type === 'add_label' && !action.label) {
          errors.push('add_label action requires a label')
        }
        if (action.type === 'assign_account' && !action.account_id) {
          errors.push('assign_account action requires an account_id')
        }
        if (action.type === 'notify' && !action.message) {
          errors.push('notify action requires a message')
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
}

// ─── Trigger Matching (Pure Functions) ──────────────────────

export function matchesTrigger(trigger: AutomationTrigger, context: InboundMessageContext): boolean {
  switch (trigger.type) {
    case 'keyword': {
      const messageLower = context.message_text.toLowerCase()
      return (trigger.keywords || []).some(kw => messageLower.includes(kw.toLowerCase()))
    }
    case 'any_message':
      // Fire on any conversation that has an unread inbound message
      return context.message_text.length > 0
    case 'first_reply':
      return context.is_first_campaign_reply
    default:
      return false
  }
}

export function matchesConditions(conditions: AutomationConditions | undefined | null, context: InboundMessageContext): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true

  // Account filter
  if (conditions.accounts && conditions.accounts.length > 0) {
    if (!conditions.accounts.includes(context.account_id)) return false
  }

  // Label filter — conversation must have at least one matching label
  if (conditions.labels && conditions.labels.length > 0) {
    const hasMatch = conditions.labels.some(l => context.conversation_labels.includes(l))
    if (!hasMatch) return false
  }

  return true
}

export function matchesRule(rule: AutomationRule, context: InboundMessageContext): boolean {
  if (!rule.enabled) return false
  if (!matchesTrigger(rule.trigger, context)) return false
  if (!matchesConditions(rule.conditions, context)) return false
  return true
}


// ─── Action Execution ───────────────────────────────────────

export async function executeAction(
  action: AutomationAction,
  context: InboundMessageContext,
  options: { autoReplySent: boolean }
): Promise<{ executed: boolean; error?: string }> {
  // Skip duplicate auto_reply
  if (action.type === 'auto_reply' && options.autoReplySent) {
    return { executed: false }
  }

  try {
    switch (action.type) {
      case 'auto_reply': {
        const rendered = renderTemplate(action.template!, {
          username: context.peer_username,
          display_name: context.peer_display_name || undefined,
        })
        await sendMessage(context.account_id, context.peer_username, rendered)
        return { executed: true }
      }

      case 'move_to_stage': {
        await moveConversationToStage(context.conversation_id, action.stage_id!)
        return { executed: true }
      }

      case 'add_label': {
        const newLabels = [...context.conversation_labels]
        if (!newLabels.includes(action.label!)) {
          newLabels.push(action.label!)
        }
        await updateLabels(context.conversation_id, newLabels)
        return { executed: true }
      }

      case 'assign_account': {
        const { error } = await supabase
          .from('conversations')
          .update({ assigned_account_id: action.account_id })
          .eq('id', context.conversation_id)
        if (error) throw new Error(error.message)
        return { executed: true }
      }

      case 'notify': {
        const rendered = renderTemplate(action.message!, {
          username: context.peer_username,
          display_name: context.peer_display_name || undefined,
        })
        // Use dynamic import to avoid circular dependency with index.ts
        const { broadcast } = await import('../index.js')
        broadcast('automation:fired', {
          rule_action: 'notify',
          conversation_id: context.conversation_id,
          message: rendered,
        })
        return { executed: true }
      }

      default:
        return { executed: false, error: `Unknown action type: ${(action as AutomationAction).type}` }
    }
  } catch (err: any) {
    console.error(`[automation] action ${action.type} failed:`, err.message)
    return { executed: false, error: err.message }
  }
}

// ─── Rule Evaluation ────────────────────────────────────────

export async function evaluateRules(context: InboundMessageContext): Promise<ExecutionResult[]> {
  const { data: rules, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error) {
    console.error('[automation] failed to load rules:', error.message)
    return []
  }

  if (!rules || rules.length === 0) return []

  const results: ExecutionResult[] = []
  let autoReplySent = false

  for (const rule of rules as AutomationRule[]) {
    if (!matchesRule(rule, context)) continue

    const actionsExecuted: AutomationActionType[] = []
    const actionResults: { type: AutomationActionType; success: boolean; error?: string }[] = []

    for (const action of rule.actions) {
      const result = await executeAction(action, context, { autoReplySent })

      if (result.executed) {
        actionsExecuted.push(action.type)
        actionResults.push({ type: action.type, success: true })
        if (action.type === 'auto_reply') {
          autoReplySent = true
        }
      } else if (result.error) {
        actionResults.push({ type: action.type, success: false, error: result.error })
      }
    }

    // Log execution
    await logExecution(rule.id, context.conversation_id, rule.trigger.type, actionResults)

    results.push({
      rule_id: rule.id,
      rule_name: rule.name,
      actions_executed: actionsExecuted,
    })
  }

  return results
}


// ─── Rule CRUD ──────────────────────────────────────────────

export async function listRules(): Promise<AutomationRule[]> {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .order('priority', { ascending: true })

  if (error) throw new Error(error.message)
  return data as AutomationRule[]
}

export async function createRule(input: CreateRuleInput): Promise<AutomationRule> {
  validateRule(input)

  // Assign priority = max + 1 if not provided
  let priority = input.priority
  if (priority === undefined || priority === null) {
    const { data: maxRow } = await supabase
      .from('automation_rules')
      .select('priority')
      .order('priority', { ascending: false })
      .limit(1)

    priority = (maxRow && maxRow.length > 0) ? maxRow[0].priority + 1 : 0
  }

  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      name: input.name.trim(),
      trigger: input.trigger,
      conditions: input.conditions || {},
      actions: input.actions,
      priority,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as AutomationRule
}

export async function updateRule(id: string, input: UpdateRuleInput): Promise<AutomationRule> {
  // Validate changed fields
  if (input.name !== undefined || input.trigger !== undefined || input.actions !== undefined) {
    validateRule(input)
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (input.name !== undefined) updatePayload.name = input.name.trim()
  if (input.trigger !== undefined) updatePayload.trigger = input.trigger
  if (input.conditions !== undefined) updatePayload.conditions = input.conditions
  if (input.actions !== undefined) updatePayload.actions = input.actions
  if (input.priority !== undefined) updatePayload.priority = input.priority
  if (input.enabled !== undefined) updatePayload.enabled = input.enabled

  const { data, error } = await supabase
    .from('automation_rules')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Automation rule not found')
  return data as AutomationRule
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase
    .from('automation_rules')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function toggleRule(id: string): Promise<AutomationRule> {
  // Fetch current state
  const { data: current, error: fetchError } = await supabase
    .from('automation_rules')
    .select('enabled')
    .eq('id', id)
    .single()

  if (fetchError || !current) throw new Error('Automation rule not found')

  const { data, error } = await supabase
    .from('automation_rules')
    .update({ enabled: !current.enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as AutomationRule
}

// ─── Logging ────────────────────────────────────────────────

export async function logExecution(
  ruleId: string,
  conversationId: string,
  triggerType: string,
  actionResults: { type: AutomationActionType; success: boolean; error?: string }[]
): Promise<void> {
  const { error } = await supabase
    .from('automation_log')
    .insert({
      rule_id: ruleId,
      conversation_id: conversationId,
      trigger_type: triggerType,
      actions_taken: actionResults,
    })

  if (error) {
    console.error('[automation] failed to log execution:', error.message)
  }
}

export async function getLog(options: { page?: number; per_page?: number } = {}): Promise<PaginatedResult<AutomationLogEntry>> {
  const page = options.page || 1
  const per_page = options.per_page || 25
  const offset = (page - 1) * per_page

  // Get total count
  const { count, error: countError } = await supabase
    .from('automation_log')
    .select('*', { count: 'exact', head: true })

  if (countError) throw new Error(countError.message)

  const total = count || 0
  const total_pages = Math.ceil(total / per_page)

  // Get paginated data
  const { data, error } = await supabase
    .from('automation_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + per_page - 1)

  if (error) throw new Error(error.message)

  return {
    data: (data || []) as AutomationLogEntry[],
    total,
    page,
    per_page,
    total_pages,
  }
}
