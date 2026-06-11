import { useEffect, useState, useCallback } from 'react'
import { get, post, del } from '../lib/api'
import { connectWs, onWsMessage, disconnectWs } from '../lib/ws'
import { cn } from '../lib/utils'
import {
  Megaphone,
  Plus,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  X,
  Info,
} from 'lucide-react'

// --- Types ---

type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived'

interface CampaignStep {
  step_number: number
  delay_hours: number
  template: string
  skip_if_replied: boolean
}

interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  steps: CampaignStep[]
  target_filters: {
    status?: string
    tags?: string[]
  }
  assigned_account_ids: string[]
  daily_send_limit: number
  total_leads: number
  replied_count: number
  created_at: string
}

interface CampaignStats {
  total_leads: number
  pending: number
  contacted: number
  replied: number
  converted: number
  skipped: number
  by_step: { step_number: number; sent: number; pending: number }[]
}

interface CampaignWithStats extends Campaign {
  stats: CampaignStats
}

interface TikTokAccount {
  id: string
  username: string
}

// --- Status badge config ---

const statusColors: Record<CampaignStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  archived: 'bg-red-500/20 text-red-400',
}

const statusLabels: Record<CampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
}

const LEAD_STATUSES = ['new', 'queued', 'contacted', 'replied', 'converted', 'do_not_contact']

export function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignWithStats | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Create form state
  const [formName, setFormName] = useState('')
  const [formSteps, setFormSteps] = useState<CampaignStep[]>([
    { step_number: 1, delay_hours: 0, template: '', skip_if_replied: true },
  ])
  const [formFilterStatus, setFormFilterStatus] = useState('')
  const [formFilterTags, setFormFilterTags] = useState('')
  const [formAccountIds, setFormAccountIds] = useState<string[]>([])
  const [formDailyLimit, setFormDailyLimit] = useState(50)

  // --- Data fetching ---

  const fetchCampaigns = useCallback(async () => {
    const result = await get<Campaign[]>('/campaigns')
    setCampaigns(result)
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    const result = await get<CampaignWithStats>(`/campaigns/${id}`)
    setDetail(result)
  }, [])

  useEffect(() => {
    get<TikTokAccount[]>('/accounts').then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchCampaigns().finally(() => setLoading(false))
  }, [fetchCampaigns])

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId)
    } else {
      setDetail(null)
    }
  }, [selectedId, fetchDetail])

  // WebSocket subscription
  useEffect(() => {
    connectWs()
    const unsub = onWsMessage((data: unknown) => {
      const msg = data as { event?: string }
      if (msg.event?.startsWith('campaigns:')) {
        fetchCampaigns()
        if (selectedId) fetchDetail(selectedId)
      }
    })
    return () => {
      unsub()
      disconnectWs()
    }
  }, [fetchCampaigns, fetchDetail, selectedId])

  // --- Step builder ---

  function addStep() {
    setFormSteps((prev) => [
      ...prev,
      { step_number: prev.length + 1, delay_hours: 24, template: '', skip_if_replied: true },
    ])
  }

  function removeStep(index: number) {
    setFormSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_number: i + 1 }))
    )
  }

  function updateStep(index: number, field: keyof CampaignStep, value: unknown) {
    setFormSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    )
  }

  // --- Actions ---

  async function handleCreate() {
    const payload = {
      name: formName,
      steps: formSteps,
      target_filters: {
        status: formFilterStatus || undefined,
        tags: formFilterTags ? formFilterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      },
      assigned_account_ids: formAccountIds,
      daily_send_limit: formDailyLimit,
    }
    try {
      await post('/campaigns', payload)
      setShowCreate(false)
      resetForm()
      fetchCampaigns()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create campaign')
    }
  }

  function resetForm() {
    setFormName('')
    setFormSteps([{ step_number: 1, delay_hours: 0, template: '', skip_if_replied: true }])
    setFormFilterStatus('')
    setFormFilterTags('')
    setFormAccountIds([])
    setFormDailyLimit(50)
  }

  async function handleActivate(id: string) {
    try {
      await post(`/campaigns/${id}/activate`, {})
      fetchCampaigns()
      if (selectedId === id) fetchDetail(id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to activate')
    }
  }

  async function handlePause(id: string) {
    try {
      await post(`/campaigns/${id}/pause`, {})
      fetchCampaigns()
      if (selectedId === id) fetchDetail(id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to pause')
    }
  }

  async function handleResume(id: string) {
    try {
      await post(`/campaigns/${id}/resume`, {})
      fetchCampaigns()
      if (selectedId === id) fetchDetail(id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resume')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Archive this campaign?')) return
    try {
      await del(`/campaigns/${id}`)
      if (selectedId === id) setSelectedId(null)
      fetchCampaigns()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive')
    }
  }

  function toggleAccountId(id: string) {
    setFormAccountIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  // --- Render ---

  if (loading && campaigns.length === 0) {
    return <div className="flex h-full items-center justify-center text-zinc-400">Loading...</div>
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: Campaign list */}
      <div className="flex w-80 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-4">
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Megaphone size={18} /> Campaigns
          </h1>
          <button
            onClick={() => { setShowCreate(true); setSelectedId(null) }}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={14} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {campaigns.map((c) => (
            <div
              key={c.id}
              onClick={() => { setSelectedId(c.id); setShowCreate(false) }}
              className={cn(
                'cursor-pointer border-b border-zinc-800 px-4 py-3 hover:bg-zinc-800/50',
                selectedId === c.id && 'bg-zinc-800'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-white text-sm">{c.name}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColors[c.status])}>
                  {statusLabels[c.status]}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-xs text-zinc-400">
                <span>{(c.total_leads ?? 0)} leads</span>
                <span>{(c.replied_count ?? 0)} replied</span>
              </div>
            </div>
          ))}
          {campaigns.length === 0 && !showCreate && (
            <div className="py-12 text-center text-sm text-zinc-500">
              No campaigns yet. Create one to get started.
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Detail or Create form */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <CreateForm
            formName={formName}
            setFormName={setFormName}
            formSteps={formSteps}
            addStep={addStep}
            removeStep={removeStep}
            updateStep={updateStep}
            formFilterStatus={formFilterStatus}
            setFormFilterStatus={setFormFilterStatus}
            formFilterTags={formFilterTags}
            setFormFilterTags={setFormFilterTags}
            formAccountIds={formAccountIds}
            toggleAccountId={toggleAccountId}
            formDailyLimit={formDailyLimit}
            setFormDailyLimit={setFormDailyLimit}
            accounts={accounts}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); resetForm() }}
          />
        ) : detail ? (
          <DetailView
            detail={detail}
            accounts={accounts}
            onActivate={() => handleActivate(detail.id)}
            onPause={() => handlePause(detail.id)}
            onResume={() => handleResume(detail.id)}
            onDelete={() => handleDelete(detail.id)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
            Select a campaign or create a new one
          </div>
        )}
      </div>
    </div>
  )
}

// --- Create Form Component ---

interface CreateFormProps {
  formName: string
  setFormName: (v: string) => void
  formSteps: CampaignStep[]
  addStep: () => void
  removeStep: (i: number) => void
  updateStep: (i: number, field: keyof CampaignStep, value: unknown) => void
  formFilterStatus: string
  setFormFilterStatus: (v: string) => void
  formFilterTags: string
  setFormFilterTags: (v: string) => void
  formAccountIds: string[]
  toggleAccountId: (id: string) => void
  formDailyLimit: number
  setFormDailyLimit: (v: number) => void
  accounts: TikTokAccount[]
  onSubmit: () => void
  onCancel: () => void
}

function CreateForm({
  formName, setFormName,
  formSteps, addStep, removeStep, updateStep,
  formFilterStatus, setFormFilterStatus,
  formFilterTags, setFormFilterTags,
  formAccountIds, toggleAccountId,
  formDailyLimit, setFormDailyLimit,
  accounts, onSubmit, onCancel,
}: CreateFormProps) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Create Campaign</h2>
        <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-200">
          <X size={18} />
        </button>
      </div>

      {/* Name */}
      <label className="block mb-4">
        <span className="mb-1 block text-sm text-zinc-400">Campaign Name</span>
        <input
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          placeholder="My Campaign"
        />
      </label>

      {/* Steps */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-zinc-400">Steps</span>
          <button
            onClick={addStep}
            className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            <Plus size={12} /> Add Step
          </button>
        </div>
        <div className="space-y-3">
          {formSteps.map((step, i) => (
            <div key={i} className="rounded border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-300">Step {step.step_number}</span>
                {formSteps.length > 1 && (
                  <button
                    onClick={() => removeStep(i)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <textarea
                value={step.template}
                onChange={(e) => updateStep(i, 'template', e.target.value)}
                placeholder="Message template... Use {{username}} and {{display_name}}"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 resize-y min-h-[60px]"
                rows={3}
              />
              <div className="mt-2 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Delay (hours):
                  <input
                    type="number"
                    min={0}
                    value={step.delay_hours}
                    onChange={(e) => updateStep(i, 'delay_hours', Number(e.target.value))}
                    className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-white"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={step.skip_if_replied}
                    onChange={(e) => updateStep(i, 'skip_if_replied', e.target.checked)}
                    className="rounded border-zinc-600"
                  />
                  Skip if replied
                </label>
              </div>
            </div>
          ))}
        </div>
        {/* Template variable helper */}
        <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
          <Info size={12} />
          <span>Available variables: <code className="text-zinc-400">{'{{username}}'}</code>, <code className="text-zinc-400">{'{{display_name}}'}</code></span>
        </div>
      </div>

      {/* Target Filters */}
      <div className="mb-4">
        <span className="mb-2 block text-sm text-zinc-400">Target Filters</span>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Lead Status</span>
            <select
              value={formFilterStatus}
              onChange={(e) => setFormFilterStatus(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
            >
              <option value="">Any</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Tags (comma-separated)</span>
            <input
              value={formFilterTags}
              onChange={(e) => setFormFilterTags(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
              placeholder="tag1, tag2"
            />
          </label>
        </div>
      </div>

      {/* Account Selection */}
      <div className="mb-4">
        <span className="mb-2 block text-sm text-zinc-400">Accounts</span>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => toggleAccountId(a.id)}
              className={cn(
                'rounded border px-3 py-1 text-xs transition-colors',
                formAccountIds.includes(a.id)
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
              )}
            >
              @{a.username}
            </button>
          ))}
          {accounts.length === 0 && (
            <span className="text-xs text-zinc-500">No accounts available</span>
          )}
        </div>
      </div>

      {/* Daily Send Limit */}
      <label className="block mb-6">
        <span className="mb-1 block text-sm text-zinc-400">Daily Send Limit</span>
        <input
          type="number"
          min={1}
          value={formDailyLimit}
          onChange={(e) => setFormDailyLimit(Number(e.target.value))}
          className="w-32 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
        />
      </label>

      {/* Submit */}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!formName || formSteps.some((s) => !s.template)}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Campaign
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

// --- Detail View Component ---

interface DetailViewProps {
  detail: CampaignWithStats
  accounts: TikTokAccount[]
  onActivate: () => void
  onPause: () => void
  onResume: () => void
  onDelete: () => void
}

function DetailView({ detail, accounts, onActivate, onPause, onResume, onDelete }: DetailViewProps) {
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">{detail.name}</h2>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColors[detail.status])}>
            {statusLabels[detail.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {detail.status === 'draft' && (
            <button
              onClick={onActivate}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
            >
              <Play size={14} /> Activate
            </button>
          )}
          {detail.status === 'active' && (
            <button
              onClick={onPause}
              className="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1.5 text-sm text-white hover:bg-yellow-700"
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {detail.status === 'paused' && (
            <button
              onClick={onResume}
              className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              <RotateCcw size={14} /> Resume
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1 rounded bg-red-600/20 px-3 py-1.5 text-sm text-red-400 hover:bg-red-600/30"
          >
            <Trash2 size={14} /> Archive
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatCard label="Total" value={detail.stats?.total_leads ?? 0} color="text-zinc-300" />
        <StatCard label="Contacted" value={detail.stats?.contacted ?? 0} color="text-purple-400" />
        <StatCard label="Replied" value={detail.stats?.replied ?? 0} color="text-green-400" />
        <StatCard label="Converted" value={detail.stats?.converted ?? 0} color="text-emerald-400" />
        <StatCard label="Skipped" value={detail.stats?.skipped ?? 0} color="text-yellow-400" />
      </div>

      {/* Per-step breakdown */}
      {(detail.stats?.by_step?.length ?? 0) > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Per-Step Breakdown</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-400 border-b border-zinc-800">
                <th className="py-2 pr-4">Step</th>
                <th className="py-2 pr-4">Sent</th>
                <th className="py-2">Pending</th>
              </tr>
            </thead>
            <tbody>
              {detail.stats.by_step.map((s) => (
                <tr key={s.step_number} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-4 text-zinc-300">Step {s.step_number}</td>
                  <td className="py-2 pr-4 text-zinc-400">{s.sent}</td>
                  <td className="py-2 text-yellow-400">{s.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Campaign Config */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-zinc-300 mb-2">Configuration</h3>
        <div className="rounded border border-zinc-800 bg-zinc-800/30 p-4 text-sm space-y-2">
          <div className="flex gap-2">
            <span className="text-zinc-500">Daily limit:</span>
            <span className="text-zinc-300">{detail.daily_send_limit}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500">Accounts:</span>
            <span className="text-zinc-300">
              {(detail.assigned_account_ids?.length ?? 0) > 0
                ? (detail.assigned_account_ids || []).map((id) => `@${accounts.find((a) => a.id === id)?.username || 'unknown'}`).join(', ')
                : 'None assigned'}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500">Target filters:</span>
            <span className="text-zinc-300">
              {(detail.target_filters || {}).status || 'any status'}
              {(detail.target_filters || {}).tags?.length ? `, tags: ${(detail.target_filters || {}).tags?.join(', ')}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-2">Steps ({(detail.steps || []).length})</h3>
        <div className="space-y-2">
          {(detail.steps || []).map((step) => (
            <div key={step.step_number} className="rounded border border-zinc-800 bg-zinc-800/30 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-zinc-400">Step {step.step_number}</span>
                <div className="flex gap-3 text-xs text-zinc-500">
                  <span>Delay: {step.delay_hours}h</span>
                  {step.skip_if_replied && <span className="text-yellow-500">Skip if replied</span>}
                </div>
              </div>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{step.template}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Stat Card ---

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-800/30 p-3 text-center">
      <div className={cn('text-xl font-semibold', color)}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  )
}
