import { useEffect, useState, useCallback, useRef } from 'react'
import { get, put } from '../lib/api'
import { connectWs, onWsMessage, disconnectWs } from '../lib/ws'
import { cn, timeAgo } from '../lib/utils'
import { Kanban, GripVertical } from 'lucide-react'

// --- Types ---

interface PipelineStage {
  id: string
  name: string
  position: number
  color: string
  created_at: string
}

interface Conversation {
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

interface PipelineGroupedConversations {
  unassigned: Conversation[]
  stages: {
    stage: PipelineStage
    conversations: Conversation[]
  }[]
}

interface TikTokAccount {
  id: string
  username: string
}

// --- Component ---

export function Pipeline() {
  const [grouped, setGrouped] = useState<PipelineGroupedConversations | null>(null)
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedConvId, setDraggedConvId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  // Keep a ref to grouped for WebSocket handler
  const groupedRef = useRef(grouped)
  groupedRef.current = grouped

  const fetchData = useCallback(async () => {
    const pipelineData = await get<PipelineGroupedConversations>('/conversations/pipeline')
    setGrouped(pipelineData)
  }, [])

  useEffect(() => {
    get<TikTokAccount[]>('/accounts').then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  // WebSocket subscription
  useEffect(() => {
    connectWs()
    const unsub = onWsMessage((data: unknown) => {
      const msg = data as { type?: string; payload?: unknown }
      if (msg.type === 'conversation:updated') {
        const conv = msg.payload as Conversation
        setGrouped((prev) => {
          if (!prev) return prev
          // Remove conversation from its current position
          const newUnassigned = prev.unassigned.filter((c) => c.id !== conv.id)
          const newStages = prev.stages.map((sg) => ({
            ...sg,
            conversations: sg.conversations.filter((c) => c.id !== conv.id),
          }))

          // Add to the correct column
          if (conv.pipeline_stage_id === null) {
            newUnassigned.unshift(conv)
          } else {
            const targetStage = newStages.find(
              (sg) => sg.stage.id === conv.pipeline_stage_id
            )
            if (targetStage) {
              targetStage.conversations.unshift(conv)
            }
          }

          return { unassigned: newUnassigned, stages: newStages }
        })
      }
    })
    return () => {
      unsub()
      disconnectWs()
    }
  }, [])

  // --- Drag and Drop ---

  function handleDragStart(e: React.DragEvent, conversationId: string) {
    e.dataTransfer.setData('text/plain', conversationId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedConvId(conversationId)
  }

  function handleDragEnd() {
    setDraggedConvId(null)
    setDragOverColumn(null)
  }

  function handleDragOver(e: React.DragEvent, columnId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnId)
  }

  function handleDragLeave() {
    setDragOverColumn(null)
  }

  async function handleDrop(e: React.DragEvent, stageId: string | null) {
    e.preventDefault()
    setDragOverColumn(null)
    const conversationId = e.dataTransfer.getData('text/plain')
    if (!conversationId || !grouped) return

    // Find the conversation
    let conv: Conversation | undefined
    conv = grouped.unassigned.find((c) => c.id === conversationId)
    if (!conv) {
      for (const sg of grouped.stages) {
        conv = sg.conversations.find((c) => c.id === conversationId)
        if (conv) break
      }
    }
    if (!conv) return

    // Skip if already in the target stage
    if (conv.pipeline_stage_id === stageId) return

    // Optimistic update
    const previousGrouped = grouped
    setGrouped((prev) => {
      if (!prev) return prev
      const newUnassigned = prev.unassigned.filter((c) => c.id !== conversationId)
      const newStages = prev.stages.map((sg) => ({
        ...sg,
        conversations: sg.conversations.filter((c) => c.id !== conversationId),
      }))

      const movedConv = { ...conv!, pipeline_stage_id: stageId }

      if (stageId === null) {
        newUnassigned.unshift(movedConv)
      } else {
        const targetStage = newStages.find((sg) => sg.stage.id === stageId)
        if (targetStage) {
          targetStage.conversations.unshift(movedConv)
        }
      }

      return { unassigned: newUnassigned, stages: newStages }
    })

    // API call
    try {
      await put(`/conversations/${conversationId}/stage`, { stage_id: stageId })
    } catch {
      // Revert on error
      setGrouped(previousGrouped)
    }
  }

  // --- Helpers ---

  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  function getAccountBadge(accountId: string) {
    const acct = accountMap.get(accountId)
    if (!acct) return null
    return (
      <span className="shrink-0 rounded bg-zinc-700 px-1 text-[10px] text-zinc-400">
        @{acct.username}
      </span>
    )
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        Loading pipeline...
      </div>
    )
  }

  if (!grouped) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        Failed to load pipeline data.
      </div>
    )
  }

  // Build columns: Unassigned + stages
  const columns: {
    id: string | null
    name: string
    color: string
    conversations: Conversation[]
  }[] = [
    {
      id: null,
      name: 'Unassigned',
      color: '#6b7280',
      conversations: grouped.unassigned,
    },
    ...grouped.stages.map((sg) => ({
      id: sg.stage.id,
      name: sg.stage.name,
      color: sg.stage.color,
      conversations: sg.conversations,
    })),
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Kanban size={20} /> Pipeline
          </h1>
          <p className="text-sm text-zinc-400">
            {grouped.unassigned.length + grouped.stages.reduce((sum, sg) => sum + sg.conversations.length, 0)} conversations
          </p>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {columns.map((col) => {
          const columnKey = col.id ?? 'unassigned'
          return (
            <div
              key={columnKey}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/50',
                dragOverColumn === columnKey && 'border-blue-500/50 bg-zinc-800/50'
              )}
              onDragOver={(e) => handleDragOver(e, columnKey)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* Column Header */}
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <span className="text-sm font-medium text-white">{col.name}</span>
                <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {col.conversations.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {col.conversations.map((conv) => (
                  <div
                    key={conv.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, conv.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'group cursor-grab rounded-md border border-zinc-700 bg-zinc-800 p-3 transition-colors hover:border-zinc-600 hover:bg-zinc-750',
                      draggedConvId === conv.id && 'opacity-50'
                    )}
                  >
                    {/* Drag handle hint + peer name */}
                    <div className="flex items-start gap-2">
                      <GripVertical
                        size={14}
                        className="mt-0.5 shrink-0 text-zinc-600 group-hover:text-zinc-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-white">
                            {conv.peer_display_name || `@${conv.peer_username}`}
                          </span>
                        </div>
                        {/* Account badge */}
                        <div className="mt-0.5">
                          {getAccountBadge(conv.account_id)}
                        </div>
                      </div>
                    </div>

                    {/* Last message preview */}
                    {conv.last_message_text && (
                      <p className="mt-2 truncate text-xs text-zinc-500">
                        {conv.last_message_text.length > 60
                          ? conv.last_message_text.slice(0, 60) + '…'
                          : conv.last_message_text}
                      </p>
                    )}

                    {/* Labels */}
                    {conv.labels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {conv.labels.map((label) => (
                          <span
                            key={label}
                            className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Time since last message */}
                    {conv.last_message_at && (
                      <div className="mt-2 text-[10px] text-zinc-500">
                        {timeAgo(conv.last_message_at)}
                      </div>
                    )}
                  </div>
                ))}

                {col.conversations.length === 0 && (
                  <div className="py-8 text-center text-xs text-zinc-600">
                    No conversations
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
