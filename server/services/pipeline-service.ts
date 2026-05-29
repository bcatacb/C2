import { supabase } from '../utils/supabase.js'

// --- Types ---

export interface PipelineStage {
  id: string
  name: string
  position: number
  color: string
  created_at: string
}

export interface CreateStageInput {
  name: string
  color?: string
  position?: number
}

export interface UpdateStageInput {
  name?: string
  color?: string
  position?: number
}

export interface Conversation {
  id: string
  account_id: string
  peer_username: string
  peer_display_name: string | null
  peer_avatar: string | null
  last_message_text: string | null
  last_message_at: string | null
  last_message_direction: string | null
  unread_count: number
  archived: boolean
  labels: string[]
  pipeline_stage_id: string | null
  created_at: string
}

export interface PipelineGroupedConversations {
  unassigned: Conversation[]
  stages: {
    stage: PipelineStage
    conversations: Conversation[]
  }[]
}

export interface PipelineStats {
  total_conversations: number
  unassigned_count: number
  per_stage: {
    stage_id: string
    stage_name: string
    count: number
    avg_time_in_stage_hours: number | null
  }[]
  conversion_rates: {
    from_stage: string
    to_stage: string
    rate: number
  }[]
}

export interface PipelineFilters {
  account_id?: string
  labels?: string[]
}

// --- Pipeline Stage CRUD ---

export async function listStages(): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('*')
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  return data as PipelineStage[]
}

export async function createStage(input: CreateStageInput): Promise<PipelineStage> {
  // Validate name
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('Stage name is required')
  }
  if (input.name.trim().length > 50) {
    throw new Error('Stage name must be 50 characters or less')
  }

  // Check uniqueness
  const { data: existing } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('name', input.name.trim())
    .single()

  if (existing) {
    throw new Error('Stage name already exists')
  }

  // Get max position
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)

  const maxPosition = stages && stages.length > 0 ? stages[0].position : -1
  const position = maxPosition + 1

  const { data, error } = await supabase
    .from('pipeline_stages')
    .insert({
      name: input.name.trim(),
      position,
      color: input.color || '#6b7280',
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as PipelineStage
}

export async function updateStage(id: string, input: UpdateStageInput): Promise<PipelineStage> {
  // Get current stage
  const { data: current, error: fetchError } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !current) {
    throw new Error('Pipeline stage not found')
  }

  // Validate name if changed
  if (input.name !== undefined) {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Stage name is required')
    }
    if (input.name.trim().length > 50) {
      throw new Error('Stage name must be 50 characters or less')
    }

    // Check uniqueness (only if name actually changed)
    if (input.name.trim() !== current.name) {
      const { data: existing } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('name', input.name.trim())
        .single()

      if (existing) {
        throw new Error('Stage name already exists')
      }
    }
  }

  // Handle position reordering
  if (input.position !== undefined && input.position !== current.position) {
    await reorderStages(id, current.position, input.position)
  }

  // Build update payload (excluding position which is handled by reorder)
  const updatePayload: Record<string, unknown> = {}
  if (input.name !== undefined) updatePayload.name = input.name.trim()
  if (input.color !== undefined) updatePayload.color = input.color
  if (input.position !== undefined) updatePayload.position = input.position

  if (Object.keys(updatePayload).length > 0) {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    return data as PipelineStage
  }

  return current as PipelineStage
}

async function reorderStages(movedId: string, oldPosition: number, newPosition: number): Promise<void> {
  // Get all stages ordered by position
  const { data: stages, error } = await supabase
    .from('pipeline_stages')
    .select('id, position')
    .order('position', { ascending: true })

  if (error || !stages) throw new Error('Failed to fetch stages for reordering')

  // Clamp newPosition to valid range
  const maxPos = stages.length - 1
  const clampedNew = Math.max(0, Math.min(newPosition, maxPos))

  if (oldPosition === clampedNew) return

  // Remove the moved stage and reinsert at new position
  const ordered = stages.filter(s => s.id !== movedId)
  ordered.splice(clampedNew, 0, { id: movedId, position: clampedNew })

  // Reassign contiguous positions
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].position !== i) {
      await supabase
        .from('pipeline_stages')
        .update({ position: i })
        .eq('id', ordered[i].id)
    }
  }
}

export async function deleteStage(id: string): Promise<void> {
  // Nullify pipeline_stage_id on affected conversations
  await supabase
    .from('conversations')
    .update({ pipeline_stage_id: null })
    .eq('pipeline_stage_id', id)

  // Get the stage's position before deleting
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('id', id)
    .single()

  if (!stage) throw new Error('Pipeline stage not found')

  // Delete the stage
  const { error } = await supabase
    .from('pipeline_stages')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)

  // Reorder remaining stages to maintain contiguous positions
  const { data: remaining, error: reorderError } = await supabase
    .from('pipeline_stages')
    .select('id, position')
    .order('position', { ascending: true })

  if (reorderError || !remaining) return

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position !== i) {
      await supabase
        .from('pipeline_stages')
        .update({ position: i })
        .eq('id', remaining[i].id)
    }
  }
}

// --- Conversation Stage Assignment ---

export async function moveConversationToStage(
  conversationId: string,
  stageId: string | null
): Promise<Conversation> {
  // Validate stage exists if not null
  if (stageId !== null) {
    const { data: stage, error: stageError } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('id', stageId)
      .single()

    if (stageError || !stage) {
      throw new Error('Pipeline stage not found')
    }
  }

  // Update conversation
  const { data, error } = await supabase
    .from('conversations')
    .update({ pipeline_stage_id: stageId })
    .eq('id', conversationId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Conversation not found')

  return data as Conversation
}

// --- Pipeline Grouped Conversations ---

export async function getConversationsByPipeline(
  filters?: PipelineFilters
): Promise<PipelineGroupedConversations> {
  const stages = await listStages()

  // Build base query for non-archived conversations
  let query = supabase
    .from('conversations')
    .select('*')
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (filters?.account_id) {
    query = query.eq('account_id', filters.account_id)
  }
  if (filters?.labels && filters.labels.length > 0) {
    query = query.overlaps('labels', filters.labels)
  }

  const { data: conversations, error } = await query
  if (error) throw new Error(error.message)

  const allConversations = (conversations || []) as Conversation[]

  // Group by stage
  const unassigned = allConversations.filter(c => c.pipeline_stage_id === null)
  const stageGroups = stages.map(stage => ({
    stage,
    conversations: allConversations.filter(c => c.pipeline_stage_id === stage.id),
  }))

  return {
    unassigned,
    stages: stageGroups,
  }
}

// --- Pipeline Statistics ---

export async function getStats(): Promise<PipelineStats> {
  const stages = await listStages()

  // Total non-archived conversations
  const { count: totalCount, error: totalError } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('archived', false)

  if (totalError) throw new Error(totalError.message)
  const total_conversations = totalCount || 0

  // Unassigned count
  const { count: unassignedCount, error: unassignedError } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('archived', false)
    .is('pipeline_stage_id', null)

  if (unassignedError) throw new Error(unassignedError.message)
  const unassigned_count = unassignedCount || 0

  // Per-stage counts
  const per_stage: PipelineStats['per_stage'] = []
  for (const stage of stages) {
    const { count, error } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('archived', false)
      .eq('pipeline_stage_id', stage.id)

    if (error) throw new Error(error.message)

    per_stage.push({
      stage_id: stage.id,
      stage_name: stage.name,
      count: count || 0,
      avg_time_in_stage_hours: null, // MVP: skip — needs stage transition history
    })
  }

  // MVP: skip conversion rates — needs stage transition history
  const conversion_rates: PipelineStats['conversion_rates'] = []

  return {
    total_conversations,
    unassigned_count,
    per_stage,
    conversion_rates,
  }
}

// --- Label Management ---

export async function updateLabels(
  conversationId: string,
  labels: string[]
): Promise<Conversation> {
  // Validate each label
  for (const label of labels) {
    if (!label || label.length === 0 || label.length > 50) {
      throw new Error('Each label must be 1-50 characters')
    }
  }

  // Deduplicate preserving first-occurrence order
  const seen = new Set<string>()
  const deduplicated: string[] = []
  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label)
      deduplicated.push(label)
    }
  }

  // Update conversation
  const { data, error } = await supabase
    .from('conversations')
    .update({ labels: deduplicated })
    .eq('id', conversationId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Conversation not found')

  return data as Conversation
}
