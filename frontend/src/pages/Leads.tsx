import { useEffect, useState, useRef, useCallback } from 'react'
import { get, post } from '../lib/api'
import { connectWs, onWsMessage, disconnectWs } from '../lib/ws'
import { cn } from '../lib/utils'
import { CSVUploadModal } from '../components/CSVUploadModal'
import {
  Target,
  Plus,
  Upload,
  Trash2,
  Tag,
  UserPlus,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'

// --- Types ---

type LeadStatus = 'new' | 'queued' | 'contacted' | 'replied' | 'converted' | 'do_not_contact'

interface Lead {
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

interface TikTokAccount {
  id: string
  username: string
}

interface PaginatedLeads {
  data: Lead[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// --- Status badge config ---

const statusColors: Record<LeadStatus, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  queued: 'bg-yellow-500/20 text-yellow-400',
  contacted: 'bg-purple-500/20 text-purple-400',
  replied: 'bg-green-500/20 text-green-400',
  converted: 'bg-emerald-500/20 text-emerald-400',
  do_not_contact: 'bg-red-500/20 text-red-400',
}

const statusLabels: Record<LeadStatus, string> = {
  new: 'New',
  queued: 'Queued',
  contacted: 'Contacted',
  replied: 'Replied',
  converted: 'Converted',
  do_not_contact: 'Do Not Contact',
}

const ALL_STATUSES: LeadStatus[] = ['new', 'queued', 'contacted', 'replied', 'converted', 'do_not_contact']

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const perPage = 50

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterTag, setFilterTag] = useState<string>('')
  const [filterAccount, setFilterAccount] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Add lead form
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ username: '', display_name: '', source: 'manual', tags: '', notes: '', account_id: '' })

  // CSV modal
  const [showCSVModal, setShowCSVModal] = useState(false)



  // --- Data fetching ---

  const fetchLeads = useCallback(async () => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('per_page', String(perPage))
    if (filterStatus) params.set('status', filterStatus)
    if (filterTag) params.set('tags', filterTag)
    if (filterAccount) params.set('account_id', filterAccount)
    if (debouncedSearch) params.set('search', debouncedSearch)

    const result = await get<PaginatedLeads>(`/leads?${params.toString()}`)
    setLeads(result.data)
    setTotal(result.total)
    setTotalPages(result.total_pages)
  }, [page, filterStatus, filterTag, filterAccount, debouncedSearch])

  useEffect(() => {
    get<TikTokAccount[]>('/accounts').then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchLeads().finally(() => setLoading(false))
  }, [fetchLeads])

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setPage(1)
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchTerm])

  // WebSocket subscription
  useEffect(() => {
    connectWs()
    const unsub = onWsMessage((data: unknown) => {
      const msg = data as { event?: string }
      if (
        msg.event === 'leads:created' ||
        msg.event === 'leads:updated' ||
        msg.event === 'leads:deleted' ||
        msg.event === 'leads:bulk-updated'
      ) {
        fetchLeads()
      }
    })
    return () => {
      unsub()
      disconnectWs()
    }
  }, [fetchLeads])

  // --- Selection ---

  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id))

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // --- Add Lead ---

  async function handleAddLead() {
    const payload = {
      username: addForm.username,
      display_name: addForm.display_name || undefined,
      source: addForm.source || 'manual',
      tags: addForm.tags ? addForm.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      notes: addForm.notes || undefined,
      account_id: addForm.account_id || undefined,
    }
    try {
      await post('/leads', payload)
      setShowAdd(false)
      setAddForm({ username: '', display_name: '', source: 'manual', tags: '', notes: '', account_id: '' })
      fetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create lead')
    }
  }

  // --- Bulk Actions ---

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} lead(s)?`)) return
    try {
      await post('/leads/bulk', { ids: Array.from(selectedIds), action: { type: 'delete' } })
      setSelectedIds(new Set())
      fetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk delete failed')
    }
  }

  async function handleBulkTag() {
    const tags = prompt('Enter tags (comma-separated):')
    if (!tags) return
    try {
      await post('/leads/bulk', {
        ids: Array.from(selectedIds),
        action: { type: 'tag', tags: tags.split(',').map((t) => t.trim()).filter(Boolean) },
      })
      setSelectedIds(new Set())
      fetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk tag failed')
    }
  }

  async function handleBulkAssign() {
    const usernamesList = accounts.map(a => `@${a.username}`).join(', ')
    const input = prompt(
      `Enter TikTok username to assign (options: ${usernamesList}) or leave empty to unassign:`
    )
    if (input === null) return

    let accountId: string | null = null
    if (input.trim()) {
      const cleanInput = input.trim().replace(/^@/, '').toLowerCase()
      const matched = accounts.find(a => a.username.toLowerCase() === cleanInput)
      if (!matched) {
        alert(`Could not find account with username "${input}"`)
        return
      }
      accountId = matched.id
    }

    try {
      await post('/leads/bulk', {
        ids: Array.from(selectedIds),
        action: { type: 'assign', account_id: accountId },
      })
      setSelectedIds(new Set())
      fetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk assign failed')
    }
  }

  async function handleBulkStatus() {
    const status = prompt(`Enter new status (${ALL_STATUSES.join(', ')}):`)
    if (!status || !ALL_STATUSES.includes(status as LeadStatus)) {
      if (status) alert('Invalid status')
      return
    }
    try {
      await post('/leads/bulk', {
        ids: Array.from(selectedIds),
        action: { type: 'status', status },
      })
      setSelectedIds(new Set())
      fetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk status change failed')
    }
  }

  // --- Render ---

  if (loading && leads.length === 0) {
    return <div className="flex h-full items-center justify-center text-zinc-400">Loading...</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Target size={20} /> Leads
          </h1>
          <p className="text-sm text-zinc-400">{total} leads total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCSVModal(true)}
            className="flex items-center gap-2 rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
          >
            <Upload size={16} /> Import CSV
          </button>
          <button
            onClick={() => { setShowAdd(true) }}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-6 py-2">
          <span className="text-sm text-zinc-300">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkTag}
            className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            <Tag size={12} /> Tag
          </button>
          <button
            onClick={handleBulkAssign}
            className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            <UserPlus size={12} /> Assign
          </button>
          <button
            onClick={handleBulkStatus}
            className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            <Filter size={12} /> Status
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1 rounded bg-red-600/20 px-3 py-1 text-xs text-red-400 hover:bg-red-600/30"
          >
            <Trash2 size={12} /> Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <X size={12} /> Clear
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search username..."
            className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-9 pr-3 text-sm text-white placeholder-zinc-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabels[s]}</option>
          ))}
        </select>
        <input
          value={filterTag}
          onChange={(e) => { setFilterTag(e.target.value); setPage(1) }}
          placeholder="Filter by tag..."
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-500"
        />
        <select
          value={filterAccount}
          onChange={(e) => { setFilterAccount(e.target.value); setPage(1) }}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>@{a.username}</option>
          ))}
        </select>
      </div>

      {/* Add Lead Form */}
      {showAdd && (
        <div className="border-b border-zinc-700 bg-zinc-900 px-6 py-4">
          <h2 className="mb-3 text-sm font-medium text-white">Add Lead</h2>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Username</span>
              <input
                value={addForm.username}
                onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                placeholder="@handle"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Display Name</span>
              <input
                value={addForm.display_name}
                onChange={(e) => setAddForm({ ...addForm, display_name: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Source</span>
              <input
                value={addForm.source}
                onChange={(e) => setAddForm({ ...addForm, source: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Tags (comma-separated)</span>
              <input
                value={addForm.tags}
                onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                placeholder="tag1, tag2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Notes</span>
              <input
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Assign Account</span>
              <select
                value={addForm.account_id}
                onChange={(e) => setAddForm({ ...addForm, account_id: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
              >
                <option value="">Unassigned</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleAddLead} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
              Add
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
            <tr className="text-left text-xs text-zinc-400">
              <th className="px-6 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-zinc-600"
                />
              </th>
              <th className="px-3 py-3">Username</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Tags</th>
              <th className="px-3 py-3">Account</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={cn(
                  'border-b border-zinc-800 hover:bg-zinc-800/50',
                  selectedIds.has(lead.id) && 'bg-zinc-800/70'
                )}
              >
                <td className="px-6 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="rounded border-zinc-600"
                  />
                </td>
                <td className="px-3 py-3 font-medium text-white">@{lead.username}</td>
                <td className="px-3 py-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColors[lead.status])}>
                    {statusLabels[lead.status]}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.map((tag) => (
                      <span key={tag} className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-zinc-400">
                  {lead.account_id
                    ? `@${accounts.find((a) => a.id === lead.account_id)?.username || 'unknown'}`
                    : '—'}
                </td>
                <td className="px-3 py-3 text-zinc-400">{lead.source || '—'}</td>
                <td className="px-3 py-3 text-zinc-400">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-zinc-500">
                  No leads found. Import a CSV or add leads manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3">
        <span className="text-sm text-zinc-400">
          Page {page} of {totalPages} ({total} total)
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* CSV Upload Modal */}
      {showCSVModal && (
        <CSVUploadModal onClose={() => setShowCSVModal(false)} onImported={() => { setShowCSVModal(false); fetchLeads() }} />
      )}
    </div>
  )
}
