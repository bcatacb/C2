import { useEffect, useState, useRef, useCallback } from 'react'
import { get, post, put } from '../lib/api'
import { connectWs, onWsMessage, disconnectWs } from '../lib/ws'
import { cn, timeAgo } from '../lib/utils'
import { Send, Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, X, Download, Folder, RefreshCw } from 'lucide-react'

interface TikTokAccount {
  id: string
  username: string
  display_name: string | null
  status: string
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
  status: 'unread' | 'read' | 'replied'
}

interface Note {
  id: string
  conversation_id: string
  body: string
  created_at: string
}

interface PipelineStage {
  id: string
  name: string
  position: number
}

interface Message {
  id: string
  conversation_id: string
  account_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  media_url: string | null
  sent_at: string
  status: string
}

const statusDot: Record<string, string> = {
  connected: 'bg-green-400',
  disconnected: 'bg-zinc-500',
  restricted: 'bg-yellow-400',
  banned: 'bg-red-400',
}

export function Unibox() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [tabFilter, setTabFilter] = useState<'all' | 'unread' | 'replied'>('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Notes state (7.1)
  const [notes, setNotes] = useState<Note[]>([])
  const [noteText, setNoteText] = useState('')
  const [notesExpanded, setNotesExpanded] = useState(true)

  // Pipeline stages state (7.2)
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])

  // Labels state (7.3)
  const [labelInput, setLabelInput] = useState('')

  useEffect(() => {
    get<TikTokAccount[]>('/accounts').then(setAccounts)
    get<PipelineStage[]>('/pipeline-stages').then(setPipelineStages)
  }, [])

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams()
    params.set('archived', String(showArchived))
    params.set('limit', '100')

    if (selectedAccounts.size === 1) {
      params.set('account_id', [...selectedAccounts][0])
    }

    const data = await get<Conversation[]>(`/conversations?${params}`)
    setConversations(data)
  }, [selectedAccounts, showArchived])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    connectWs()
    const unsub = onWsMessage((data: unknown) => {
      const msg = data as { type: string; payload: unknown }
      if (msg.type === 'messages:new') {
        const p = msg.payload as { conversationId: string; messages: Message[] }
        if (p.conversationId === selectedConvId) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id))
            const newMsgs = p.messages.filter((m: Message) => !ids.has(m.id))
            return [...prev, ...newMsgs]
          })
        }
        loadConversations()
      }
      if (msg.type === 'conversation:updated') {
        const conv = msg.payload as Conversation
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? conv : c))
        )
      }
    })
    return () => { unsub(); disconnectWs() }
  }, [selectedConvId, loadConversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const [fetchingMessages, setFetchingMessages] = useState(false)

  async function selectConversation(conv: Conversation) {
    setSelectedConvId(conv.id)
    setMessages([])
    setNotes([])

    const cached = await get<Message[]>(`/messages?conversation_id=${conv.id}`)
    if (cached.length > 0) {
      setMessages(cached)
    } else {
      setFetchingMessages(true)
      try {
        const fetched = await post<Message[]>(`/conversations/${conv.id}/fetch-messages`, {})
        setMessages(fetched)
      } catch {
        setMessages([])
      } finally {
        setFetchingMessages(false)
      }
    }

    // Fetch notes for this conversation
    get<Note[]>(`/conversations/${conv.id}/notes`).then(setNotes).catch(() => setNotes([]))

    if (conv.unread_count > 0 || conv.status === 'unread') {
      await put(`/conversations/${conv.id}`, { unread_count: 0, status: 'read' })
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0, status: 'read' } : c))
      )
    }
  }

  async function refreshConversation() {
    if (!selectedConvId || fetchingMessages) return
    setFetchingMessages(true)
    try {
      // Force a live re-scrape, then reload the full thread from the DB.
      await post<Message[]>(`/conversations/${selectedConvId}/fetch-messages`, {})
      const fresh = await get<Message[]>(`/messages?conversation_id=${selectedConvId}`)
      setMessages(fresh)
      loadConversations()
    } catch {
      /* ignore — keep current messages on failure */
    } finally {
      setFetchingMessages(false)
    }
  }

  async function handleSend() {
    const conv = conversations.find((c) => c.id === selectedConvId)
    if (!conv || !replyText.trim()) return

    setSending(true)
    try {
      const msg = await post<Message>('/messages/send', {
        accountId: conv.account_id,
        peerUsername: conv.peer_username,
        body: replyText.trim(),
      })
      setMessages((prev) => [...prev, msg])
      setReplyText('')
      loadConversations()
    } finally {
      setSending(false)
    }
  }

  async function toggleArchive(conv: Conversation) {
    await put(`/conversations/${conv.id}`, { archived: !conv.archived })
    loadConversations()
    if (conv.id === selectedConvId) {
      setSelectedConvId(null)
      setMessages([])
    }
  }

  function toggleAccount(id: string) {
    setSelectedAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 7.1 - Add note
  async function handleAddNote() {
    if (!selectedConvId || !noteText.trim()) return
    try {
      const note = await post<Note>(`/conversations/${selectedConvId}/notes`, { body: noteText.trim() })
      setNotes((prev) => [...prev, note])
      setNoteText('')
    } catch { /* ignore */ }
  }

  // 7.2 - Change pipeline stage
  async function handleStageChange(stageId: string) {
    if (!selectedConvId) return
    const newStageId = stageId || null
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedConvId ? { ...c, pipeline_stage_id: newStageId } : c))
    )
    try {
      await put(`/conversations/${selectedConvId}/stage`, { stage_id: newStageId })
    } catch {
      // Revert on failure
      loadConversations()
    }
  }

  // 7.3 - Label management
  async function handleAddLabel(label: string) {
    if (!selectedConv || !label.trim()) return
    const updated = [...selectedConv.labels, label.trim()]
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedConvId ? { ...c, labels: updated } : c))
    )
    setLabelInput('')
    try {
      await put(`/conversations/${selectedConvId}/labels`, updated)
    } catch {
      loadConversations()
    }
  }

  async function handleRemoveLabel(label: string) {
    if (!selectedConv) return
    const updated = selectedConv.labels.filter((l) => l !== label)
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedConvId ? { ...c, labels: updated } : c))
    )
    try {
      await put(`/conversations/${selectedConvId}/labels`, updated)
    } catch {
      loadConversations()
    }
  }

  async function handleAddConvToFolder() {
    if (!selectedConv) return
    const username = selectedConv.peer_username
    
    const listsData = await get<any[]>('/lists').catch(() => [])
    if (listsData.length === 0) {
      alert('Create a folder first in the Leads page.')
      return
    }

    const listNames = listsData.map((l: any) => l.name).join(', ')
    const folderName = prompt(`Enter folder name to add @${username} to (options: ${listNames}):`)
    if (!folderName) return

    const matched = listsData.find((l: any) => l.name.toLowerCase() === folderName.toLowerCase().trim())
    if (!matched) {
      alert(`Folder "${folderName}" not found.`)
      return
    }

    try {
      let lead: any = null
      const leadsRes = await get<any>(`/leads?search=${username}`)
      const existing = (leadsRes?.data || []).find((l: any) => l.username.toLowerCase() === username.toLowerCase())
      
      if (existing) {
        lead = existing
      } else {
        lead = await post('/leads', {
          username: username,
          display_name: selectedConv.peer_display_name || undefined,
          source: 'inbox',
          status: 'new'
        })
      }

      await post(`/lists/${matched.id}/leads`, { leadIds: [lead.id] })
      alert(`Added @${username} to folder "${matched.name}".`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add to folder')
    }
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  const filteredConvs = conversations.filter((c) => {
    if (selectedAccounts.size > 0 && !selectedAccounts.has(c.account_id)) return false
    if (tabFilter === 'unread') {
      return c.status === 'unread' || c.unread_count > 0
    }
    if (tabFilter === 'replied') {
      return c.status === 'replied'
    }
    return true
  })

  const selectedConv = conversations.find((c) => c.id === selectedConvId)
  const selectedAccount = selectedConv ? accountMap.get(selectedConv.account_id) : null

  return (
    <div className="flex h-full">
      {/* Left pane: Account selector */}
      <div className="flex w-48 flex-col border-r border-zinc-800 bg-zinc-900/50">
        <div className="border-b border-zinc-800 px-3 py-2">
          <div className="text-xs font-medium text-zinc-400">Accounts</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setSelectedAccounts(new Set())}
            className={cn(
              'mb-1 w-full rounded px-2 py-1.5 text-left text-xs',
              selectedAccounts.size === 0 ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'
            )}
          >
            All ({accounts.length})
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => toggleAccount(a.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                selectedAccounts.has(a.id) ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'
              )}
            >
              <div className={cn('h-1.5 w-1.5 rounded-full', statusDot[a.status] || 'bg-zinc-500')} />
              <span className="truncate">@{a.username}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-zinc-800 p-2 space-y-1">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={cn('flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs', showArchived ? 'text-blue-400' : 'text-zinc-500')}
          >
            <Archive size={12} /> {showArchived ? 'Show active' : 'Show archived'}
          </button>
        </div>
      </div>

      {/* Center pane: Conversation list */}
      <div className="flex w-80 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <div>
            <div className="text-sm font-medium text-white">Conversations</div>
            <div className="text-xs text-zinc-500">{filteredConvs.length} conversations</div>
          </div>
          <button
            onClick={async () => {
              const usernames = filteredConvs.map(c => c.peer_username)
              let imported = 0
              for (const username of usernames) {
                try {
                  await post('/leads', { username, source: 'inbox' })
                  imported++
                } catch { /* skip duplicates */ }
              }
              alert(`Exported ${imported} conversations to Leads (${usernames.length - imported} already existed)`)
            }}
            className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
            title="Export visible conversations as leads"
          >
            <Download size={12} /> To Leads
          </button>
        </div>
        
        {/* Status filter tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950 p-1 gap-1">
          {(['all', 'unread', 'replied'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setTabFilter(tab)
                setSelectedConvId(null)
                setMessages([])
              }}
              className={cn(
                "flex-1 py-1 text-center text-[11px] font-medium rounded capitalize transition-colors",
                tabFilter === tab
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredConvs.map((conv) => {
            const acct = accountMap.get(conv.account_id)
            return (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv)}
                className={cn(
                  'flex w-full gap-3 border-b border-zinc-800/50 px-4 py-3 text-left transition-colors',
                  conv.id === selectedConvId ? 'bg-zinc-800' : 'hover:bg-zinc-800/30'
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-medium text-white">
                  {(conv.peer_display_name || conv.peer_username).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-white">
                      {conv.peer_display_name || `@${conv.peer_username}`}
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">
                      {conv.last_message_at ? timeAgo(conv.last_message_at) : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {acct && (
                      <span className="shrink-0 rounded bg-zinc-700 px-1 text-[10px] text-zinc-400">
                        @{acct.username}
                      </span>
                    )}
                    <span className="truncate text-xs text-zinc-500">
                      {conv.last_message_text || 'No messages'}
                    </span>
                  </div>
                </div>
                {conv.unread_count > 0 && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-medium text-white">
                    {conv.unread_count}
                  </div>
                )}
              </button>
            )
          })}
          {filteredConvs.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-500">
              No conversations yet
            </div>
          )}
        </div>
      </div>

      {/* Right pane: Messages */}
      <div className="flex flex-1 flex-col">
        {selectedConv ? (
          <>
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {selectedConv.peer_display_name || `@${selectedConv.peer_username}`}
                  </span>
                  {/* 7.2 - Pipeline stage selector */}
                  <select
                    value={selectedConv.pipeline_stage_id || ''}
                    onChange={(e) => handleStageChange(e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">No stage</option>
                    {pipelineStages.map((stage) => (
                      <option key={stage.id} value={stage.id}>{stage.name}</option>
                    ))}
                  </select>
                </div>
                {selectedAccount && (
                  <div className="text-xs text-zinc-500">
                    via @{selectedAccount.username}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 items-center">
                <button
                  onClick={refreshConversation}
                  disabled={fetchingMessages}
                  className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  title="Refresh this conversation"
                >
                  <RefreshCw size={16} className={cn(fetchingMessages && 'animate-spin')} />
                </button>
                <button
                  onClick={handleAddConvToFolder}
                  className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  title="Add to Folder/List"
                >
                  <Folder size={16} />
                </button>
                <button
                  onClick={() => toggleArchive(selectedConv)}
                  className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  title={selectedConv.archived ? 'Unarchive' : 'Archive'}
                >
                  {selectedConv.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                </button>
              </div>
            </div>

            {/* 7.3 - Labels section */}
            <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-1.5 flex-wrap">
              {selectedConv.labels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-0.5 rounded-full bg-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300"
                >
                  {label}
                  <button
                    onClick={() => handleRemoveLabel(label)}
                    className="ml-0.5 rounded-full p-0.5 text-zinc-400 hover:bg-zinc-600 hover:text-white"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault()
                    handleAddLabel(labelInput)
                  }
                }}
                placeholder="+ label"
                className="w-16 bg-transparent text-[11px] text-zinc-400 placeholder-zinc-600 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {fetchingMessages && messages.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
                  Fetching messages from TikTok...
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.direction === 'outbound' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                      msg.direction === 'outbound'
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-800 text-zinc-200'
                    )}
                  >
                    {msg.body}
                    {msg.media_url && (
                      <img src={msg.media_url} alt="" className="mt-1 max-h-48 rounded" />
                    )}
                    <div
                      className={cn(
                        'mt-1 text-[10px]',
                        msg.direction === 'outbound' ? 'text-blue-200' : 'text-zinc-500'
                      )}
                    >
                      {new Date(msg.sent_at).toLocaleTimeString()}
                      {msg.direction === 'outbound' && msg.status === 'delivered' && (
                        <Check size={10} className="ml-1 inline" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* 7.1 - Notes section */}
            <div className="border-t border-zinc-800">
              <button
                onClick={() => setNotesExpanded(!notesExpanded)}
                className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-900/10"
              >
                {notesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Notes ({notes.length})
              </button>
              {notesExpanded && (
                <div className="px-4 pb-2 space-y-1.5">
                  {notes.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1.5">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded bg-amber-900/20 border border-amber-800/30 px-2.5 py-1.5 text-xs text-amber-200"
                        >
                          <div>{note.body}</div>
                          <div className="mt-0.5 text-[10px] text-amber-400/60">
                            {new Date(note.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleAddNote()
                        }
                      }}
                      placeholder="Add a note..."
                      className="flex-1 rounded border border-amber-800/30 bg-amber-900/10 px-2 py-1 text-xs text-amber-100 placeholder-amber-600/50 focus:border-amber-600 focus:outline-none"
                    />
                    <button
                      onClick={handleAddNote}
                      disabled={!noteText.trim()}
                      className="rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Add Note
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-zinc-800 p-3">
              <div className="flex gap-2">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Type a reply..."
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                  disabled={sending}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !replyText.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-zinc-500">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  )
}
