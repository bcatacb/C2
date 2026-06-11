import { useEffect, useState, useCallback } from 'react'
import { get, post, del } from '../lib/api'
import { Zap, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'

// --- Types ---

interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  trigger: { type: string; keywords?: string[] }
  conditions: { accounts?: string[]; labels?: string[] }
  actions: { type: string; template?: string; stage_id?: string; label?: string; account_id?: string; message?: string }[]
  priority: number
  created_at: string
  updated_at: string
}

interface AutomationLogEntry {
  id: string
  rule_id: string
  trigger_type: string
  actions_taken: string[]
  success: boolean
  created_at: string
}

interface RuleAction {
  type: string
  template?: string
  stage_id?: string
  label?: string
  account_id?: string
  message?: string
}

interface TikTokAccount {
  id: string
  username: string
}

// --- Trigger type badge colors ---

const triggerColors: Record<string, string> = {
  keyword: 'bg-purple-500/20 text-purple-400',
  any_message: 'bg-blue-500/20 text-blue-400',
  first_reply: 'bg-green-500/20 text-green-400',
}

export function Automation() {
  const [tab, setTab] = useState<'rules' | 'log'>('rules')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Zap size={18} /> Automation
        </h1>
        <div className="flex gap-1 rounded-md bg-zinc-800 p-1">
          <button
            onClick={() => setTab('rules')}
            className={cn(
              'rounded px-3 py-1 text-sm font-medium transition-colors',
              tab === 'rules' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            Rules
          </button>
          <button
            onClick={() => setTab('log')}
            className={cn(
              'rounded px-3 py-1 text-sm font-medium transition-colors',
              tab === 'log' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            Log
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'rules' ? <RulesTab /> : <LogTab />}
      </div>
    </div>
  )
}

// --- Rules Tab ---

function RulesTab() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const fetchRules = useCallback(async () => {
    try {
      const result = await get<AutomationRule[]>('/automation-rules')
      setRules(result)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchRules().finally(() => setLoading(false))
  }, [fetchRules])

  async function handleToggle(id: string) {
    try {
      await post(`/automation-rules/${id}/toggle`, {})
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
      )
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this automation rule?')) return
    try {
      await del(`/automation-rules/${id}`)
      setRules((prev) => prev.filter((r) => r.id !== id))
    } catch {
      // ignore
    }
  }

  function handleCreated() {
    setShowCreate(false)
    fetchRules()
  }

  if (loading && rules.length === 0) {
    return <div className="flex h-64 items-center justify-center text-zinc-400">Loading...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-zinc-400">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> Create Rule
        </button>
      </div>

      {showCreate && (
        <CreateRuleForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-800/30 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleToggle(rule.id)}
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  rule.enabled ? 'bg-blue-600' : 'bg-zinc-600'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                    rule.enabled ? 'left-[18px]' : 'left-0.5'
                  )}
                />
              </button>
              <div>
                <span className="text-sm font-medium text-white">{rule.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', triggerColors[rule.trigger.type] || 'bg-zinc-500/20 text-zinc-400')}>
                    {rule.trigger.type}
                  </span>
                  {rule.trigger.keywords && rule.trigger.keywords.length > 0 && (
                    <span className="text-xs text-zinc-500">
                      keywords: {rule.trigger.keywords.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">Priority: {rule.priority}</span>
              <button
                onClick={() => handleDelete(rule.id)}
                className="text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && !showCreate && (
          <div className="py-12 text-center text-sm text-zinc-500">
            No automation rules yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  )
}

// --- Create Rule Form ---

const ACTION_TYPES = [
  { value: 'auto_reply', label: 'Auto Reply' },
  { value: 'move_to_stage', label: 'Move to Stage' },
  { value: 'add_label', label: 'Add Label' },
  { value: 'assign_account', label: 'Assign Account' },
  { value: 'notify', label: 'Notify' },
]

function CreateRuleForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('keyword')
  const [keywords, setKeywords] = useState('')
  const [actions, setActions] = useState<RuleAction[]>([{ type: 'auto_reply' }])
  const [priority, setPriority] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [stages, setStages] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    get<TikTokAccount[]>('/accounts').then(setAccounts).catch(() => {})
    get<{ id: string; name: string }[]>('/pipeline-stages').then(setStages).catch(() => {})
  }, [])

  function addAction() {
    setActions((prev) => [...prev, { type: 'auto_reply' }])
  }

  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index))
  }

  function updateAction(index: number, updates: Partial<RuleAction>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...updates } : a))
    )
  }

  async function handleSubmit() {
    if (!name) return
    setSubmitting(true)
    try {
      const payload = {
        name,
        trigger: {
          type: triggerType,
          ...(triggerType === 'keyword' && keywords
            ? { keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) }
            : {}),
        },
        conditions: {},
        actions: actions.map((a) => {
          const action: RuleAction = { type: a.type }
          if (a.type === 'auto_reply' && a.template) action.template = a.template
          if (a.type === 'move_to_stage' && a.stage_id) action.stage_id = a.stage_id
          if (a.type === 'add_label' && a.label) action.label = a.label
          if (a.type === 'assign_account' && a.account_id) action.account_id = a.account_id
          if (a.type === 'notify' && a.message) action.message = a.message
          return action
        }),
        priority,
      }
      await post('/automation-rules', payload)
      onCreated()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create rule')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 rounded border border-zinc-700 bg-zinc-800/50 p-4">
      <h3 className="text-sm font-medium text-white mb-4">New Automation Rule</h3>

      {/* Name */}
      <label className="block mb-3">
        <span className="mb-1 block text-xs text-zinc-400">Rule Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          placeholder="e.g. Auto-reply to pricing questions"
        />
      </label>

      {/* Trigger Type */}
      <label className="block mb-3">
        <span className="mb-1 block text-xs text-zinc-400">Trigger Type</span>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
        >
          <option value="keyword">Keyword</option>
          <option value="any_message">Any Message</option>
          <option value="first_reply">First Reply</option>
        </select>
      </label>

      {/* Keywords (conditional) */}
      {triggerType === 'keyword' && (
        <label className="block mb-3">
          <span className="mb-1 block text-xs text-zinc-400">Keywords (comma-separated)</span>
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            placeholder="price, cost, how much"
          />
        </label>
      )}

      {/* Actions */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-400">Actions</span>
          <button
            onClick={addAction}
            className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            <Plus size={12} /> Add Action
          </button>
        </div>
        <div className="space-y-2">
          {actions.map((action, i) => (
            <div key={i} className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="flex items-center justify-between mb-2">
                <select
                  value={action.type}
                  onChange={(e) => updateAction(i, { type: e.target.value, template: undefined, stage_id: undefined, label: undefined, account_id: undefined, message: undefined })}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
                >
                  {ACTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {actions.length > 1 && (
                  <button
                    onClick={() => removeAction(i)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <ActionFields action={action} onChange={(updates) => updateAction(i, updates)} accounts={accounts} stages={stages} />
            </div>
          ))}
        </div>
      </div>

      {/* Priority */}
      <label className="block mb-4">
        <span className="mb-1 block text-xs text-zinc-400">Priority</span>
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
        />
      </label>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!name || submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Creating...' : 'Create Rule'}
        </button>
        <button
          onClick={onCancel}
          className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// --- Action Fields (type-specific inputs) ---

function ActionFields({
  action,
  onChange,
  accounts,
  stages
}: {
  action: RuleAction
  onChange: (updates: Partial<RuleAction>) => void
  accounts: TikTokAccount[]
  stages: { id: string; name: string }[]
}) {
  switch (action.type) {
    case 'auto_reply':
      return (
        <textarea
          value={action.template || ''}
          onChange={(e) => onChange({ template: e.target.value })}
          placeholder="Reply template..."
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 resize-y min-h-[60px]"
          rows={2}
        />
      )
    case 'move_to_stage':
      return (
        <select
          value={action.stage_id || ''}
          onChange={(e) => onChange({ stage_id: e.target.value })}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
        >
          <option value="">Select a stage...</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )
    case 'add_label':
      return (
        <input
          value={action.label || ''}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label text"
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
        />
      )
    case 'assign_account':
      return (
        <select
          value={action.account_id || ''}
          onChange={(e) => onChange({ account_id: e.target.value })}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
        >
          <option value="">Select an account...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>@{a.username}</option>
          ))}
        </select>
      )
    case 'notify':
      return (
        <textarea
          value={action.message || ''}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="Notification message..."
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 resize-y min-h-[60px]"
          rows={2}
        />
      )
    default:
      return null
  }
}

// --- Log Tab ---

function LogTab() {
  const [entries, setEntries] = useState<AutomationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const limit = 20

  const fetchLog = useCallback(async (p: number) => {
    try {
      const result = await get<{ data: AutomationLogEntry[]; total_pages: number }>(
        `/automation-log?page=${p}&per_page=${limit}`
      )
      setEntries(result.data || [])
      setHasMore(p < result.total_pages)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchLog(page).finally(() => setLoading(false))
  }, [fetchLog, page])

  if (loading && entries.length === 0) {
    return <div className="flex h-64 items-center justify-center text-zinc-400">Loading...</div>
  }

  return (
    <div className="p-6">
      {entries.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          No automation log entries yet.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-400 border-b border-zinc-800">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Trigger</th>
                <th className="py-2 pr-4">Actions</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-4 text-zinc-400">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', triggerColors[entry.trigger_type] || 'bg-zinc-500/20 text-zinc-400')}>
                      {entry.trigger_type}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {(entry.actions_taken || []).map((action: any, i) => (
                        <span
                          key={i}
                          className={cn(
                            'rounded px-2 py-0.5 text-xs font-medium',
                            action.success ? 'bg-zinc-700 text-zinc-300' : 'bg-red-500/20 text-red-400'
                          )}
                          title={action.error}
                        >
                          {action.type || String(action)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2">
                    {entry.success ? (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                        Success
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                        Failed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-zinc-500">Page {page}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
