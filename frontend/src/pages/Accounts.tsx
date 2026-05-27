import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import { cn } from '../lib/utils'
import { Plus, Trash2, Pencil, Wifi, WifiOff, ShieldAlert, Ban, RefreshCw, Play, Save, Square } from 'lucide-react'

interface TikTokAccount {
  id: string
  username: string
  display_name: string | null
  profile_photo: string | null
  transport_type: 'playwright' | 'api'
  status: 'connected' | 'disconnected' | 'restricted' | 'banned'
  proxy_id: string | null
  daily_dm_limit: number
  dms_sent_today: number
  cooldown_until: string | null
  cooldown_step: number
  last_inbox_sync: string | null
  created_at: string
}

interface Proxy {
  id: string
  type: string | null
  host: string
  port: number
  username: string | null
  country: string | null
  assigned_account_id: string | null
  status: string
}

const statusConfig = {
  connected: { icon: Wifi, color: 'text-green-400', bg: 'bg-green-400' },
  disconnected: { icon: WifiOff, color: 'text-zinc-500', bg: 'bg-zinc-500' },
  restricted: { icon: ShieldAlert, color: 'text-yellow-400', bg: 'bg-yellow-400' },
  banned: { icon: Ban, color: 'text-red-400', bg: 'bg-red-400' },
}

export function Accounts() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', display_name: '', transport_type: 'playwright', daily_dm_limit: 50, proxy_id: '' })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<Set<string>>(new Set())
  const [liveSessions, setLiveSessions] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([
      get<TikTokAccount[]>('/accounts'),
      get<Proxy[]>('/proxies'),
    ]).then(([a, p]) => {
      setAccounts(a)
      setProxies(p)
      setLoading(false)
    })
  }, [])

  async function handleConnect(id: string) {
    setConnecting((prev) => new Set(prev).add(id))
    try {
      await post(`/accounts/${id}/connect`, {})
      setLiveSessions((prev) => new Set(prev).add(id))
      setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, status: 'connected' as const } : a))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setConnecting((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function handleSaveSession(id: string) {
    try {
      await post(`/accounts/${id}/save-session`, {})
      setLiveSessions((prev) => { const s = new Set(prev); s.delete(id); return s })
      alert('Session saved! Cookies stored for future reconnection.')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save session')
    }
  }

  async function handleDisconnect(id: string) {
    try {
      await post(`/accounts/${id}/disconnect`, {})
      setLiveSessions((prev) => { const s = new Set(prev); s.delete(id); return s })
      setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, status: 'disconnected' as const } : a))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect')
    }
  }

  async function handleSave() {
    const payload = {
      ...form,
      daily_dm_limit: Number(form.daily_dm_limit),
      proxy_id: form.proxy_id || null,
    }

    if (editId) {
      const updated = await put<TikTokAccount>(`/accounts/${editId}`, payload)
      setAccounts((prev) => prev.map((a) => (a.id === editId ? updated : a)))
    } else {
      const created = await post<TikTokAccount>('/accounts', payload)
      setAccounts((prev) => [...prev, created])
    }
    resetForm()
  }

  async function handleDelete(id: string) {
    await del(`/accounts/${id}`)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  function startEdit(account: TikTokAccount) {
    setEditId(account.id)
    setForm({
      username: account.username,
      display_name: account.display_name || '',
      transport_type: account.transport_type,
      daily_dm_limit: account.daily_dm_limit,
      proxy_id: account.proxy_id || '',
    })
    setShowAdd(true)
  }

  function resetForm() {
    setShowAdd(false)
    setEditId(null)
    setForm({ username: '', display_name: '', transport_type: 'playwright', daily_dm_limit: 50, proxy_id: '' })
  }

  if (loading) return <div className="flex h-full items-center justify-center text-zinc-400">Loading...</div>

  const inCooldown = (a: TikTokAccount) => a.cooldown_until && new Date(a.cooldown_until) > new Date()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Accounts</h1>
          <p className="text-sm text-zinc-400">{accounts.length} TikTok profiles managed</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true) }}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} /> Add Account
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {showAdd && (
          <div className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-3 text-sm font-medium text-white">
              {editId ? 'Edit Account' : 'Add Account'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Username</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                  placeholder="@handle"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Display Name</span>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Transport</span>
                <select
                  value={form.transport_type}
                  onChange={(e) => setForm({ ...form, transport_type: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                >
                  <option value="playwright">Playwright (Browser)</option>
                  <option value="api">TikTok API</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Daily DM Limit</span>
                <input
                  type="number"
                  value={form.daily_dm_limit}
                  onChange={(e) => setForm({ ...form, daily_dm_limit: parseInt(e.target.value) || 50 })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block col-span-2">
                <span className="mb-1 block text-xs text-zinc-400">Proxy</span>
                <select
                  value={form.proxy_id}
                  onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                >
                  <option value="">No proxy</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.host}:{p.port} ({p.type || 'unknown'}{p.country ? `, ${p.country}` : ''})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={handleSave} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                {editId ? 'Save' : 'Add'}
              </button>
              <button onClick={resetForm} className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3">
          {accounts.map((account) => {
            const cfg = statusConfig[account.status]
            const StatusIcon = cfg.icon
            return (
              <div
                key={account.id}
                className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className={cn('h-2.5 w-2.5 rounded-full', cfg.bg)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">@{account.username}</span>
                    {account.display_name && (
                      <span className="text-sm text-zinc-400">{account.display_name}</span>
                    )}
                    <span className={cn('text-xs', cfg.color)}>
                      <StatusIcon size={14} className="inline" /> {account.status}
                    </span>
                    {inCooldown(account) && (
                      <span className="text-xs text-yellow-500">cooldown</span>
                    )}
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-zinc-500">
                    <span>DMs: {account.dms_sent_today}/{account.daily_dm_limit}</span>
                    <span>Transport: {account.transport_type}</span>
                    {account.last_inbox_sync && (
                      <span>Last sync: {new Date(account.last_inbox_sync).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {liveSessions.has(account.id) ? (
                    <>
                      <button
                        onClick={() => handleSaveSession(account.id)}
                        className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
                        title="Save session cookies and close browser"
                      >
                        <Save size={12} /> Save Session
                      </button>
                      <button
                        onClick={() => handleDisconnect(account.id)}
                        className="flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 text-xs text-red-400 hover:bg-red-600/30"
                        title="Close browser without saving"
                      >
                        <Square size={12} /> Close
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleConnect(account.id)}
                      disabled={connecting.has(account.id)}
                      className="flex items-center gap-1 rounded bg-blue-600/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
                      title="Open browser to log in to TikTok"
                    >
                      {connecting.has(account.id) ? (
                        <><RefreshCw size={12} className="animate-spin" /> Connecting...</>
                      ) : (
                        <><Play size={12} /> Connect</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(account)}
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
          {accounts.length === 0 && (
            <div className="py-12 text-center text-zinc-500">
              No accounts yet. Click "Add Account" to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
