import { useEffect, useState } from 'react'
import { get, post, put, del } from '../lib/api'
import { connectWs, onWsMessage } from '../lib/ws'
import { cn } from '../lib/utils'
import { Plus, Trash2, Pencil, Wifi, WifiOff, ShieldAlert, Ban, RefreshCw, Play, Save, Square, Users, QrCode } from 'lucide-react'

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
  sync_enabled: boolean
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
  const [scrapeAccountId, setScrapeAccountId] = useState<string | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeForm, setScrapeForm] = useState({ limit: 50, listId: '' })
  const [lists, setLists] = useState<any[]>([])
  const [qrAccountId, setQrAccountId] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<'waiting' | 'success' | 'expired'>('waiting')

  useEffect(() => {
    Promise.all([
      get<TikTokAccount[]>('/accounts'),
      get<Proxy[]>('/proxies'),
      get<any[]>('/lists').catch(() => []),
    ]).then(([a, p, l]) => {
      setAccounts(a)
      setProxies(p)
      setLists(l)
      setLoading(false)
    })
  }, [])

  // QR login: receive streamed QR frames and login result over the WebSocket.
  useEffect(() => {
    connectWs()
    const off = onWsMessage((data) => {
      const { type, payload } = data as { type: string; payload: any }
      if (!payload) return
      if (type === 'account:qr') {
        setQrAccountId((current) => {
          if (current === payload.accountId) {
            setQrImage(`data:image/png;base64,${payload.image}`)
            setQrStatus('waiting')
          }
          return current
        })
      } else if (type === 'account:qr-success') {
        setQrAccountId((current) => {
          if (current === payload.accountId) {
            setQrStatus('success')
            setTimeout(() => { setQrAccountId(null); setQrImage(null) }, 1500)
          }
          return current
        })
        setAccounts((prev) => prev.map((a) => a.id === payload.accountId ? { ...a, status: 'connected' as const } : a))
      } else if (type === 'account:qr-expired') {
        setQrAccountId((current) => {
          if (current === payload.accountId) { setQrStatus('expired'); setQrImage(null) }
          return current
        })
      } else if (type === 'account:updated' && payload.id) {
        // Swap the placeholder handle/avatar for the real one once backfill lands.
        setAccounts((prev) => prev.map((a) => a.id === payload.id ? { ...a, ...payload } : a))
      }
    })
    return off
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

  async function handleConnectQr(id: string) {
    setQrAccountId(id)
    setQrImage(null)
    setQrStatus('waiting')
    try {
      await post(`/accounts/${id}/connect-qr`, {})
    } catch (err) {
      setQrAccountId(null)
      alert(err instanceof Error ? err.message : 'Failed to start QR login')
    }
  }

  async function handleCancelQr() {
    const id = qrAccountId
    setQrAccountId(null)
    setQrImage(null)
    if (id) await post(`/accounts/${id}/cancel-qr`, {}).catch(() => {})
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

  // Edit-only save (username/display_name/daily_dm_limit/proxy for an existing account).
  async function handleSave() {
    if (!editId) return
    const payload = {
      ...form,
      daily_dm_limit: Number(form.daily_dm_limit),
      proxy_id: form.proxy_id || null,
    }
    const updated = await put<TikTokAccount>(`/accounts/${editId}`, payload)
    setAccounts((prev) => prev.map((a) => (a.id === editId ? updated : a)))
    resetForm()
  }

  // Add flow: create a bare account (placeholder username, backfilled after login),
  // then immediately launch the chosen connection method.
  async function handleAddConnect(method: 'qr' | 'manual') {
    try {
      const created = await post<TikTokAccount>('/accounts', {
        transport_type: form.transport_type,
        proxy_id: form.proxy_id || null,
      })
      setAccounts((prev) => [...prev, created])
      resetForm()
      if (method === 'qr') await handleConnectQr(created.id)
      else await handleConnect(created.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create account')
    }
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

  async function handleScrape() {
    if (!scrapeAccountId) return
    setScraping(true)
    try {
      const res = await post<{ ok: boolean, count: number }>(`/accounts/${scrapeAccountId}/scrape-followers`, {
        limit: scrapeForm.limit,
        listId: scrapeForm.listId || undefined
      })
      alert(`Successfully scraped ${res.count} followers!`)
      setScrapeAccountId(null)
      // Reload lists to get updated lead counts
      get<any[]>('/lists').then(setLists).catch(() => {})
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Scraping failed')
    } finally {
      setScraping(false)
    }
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
        {showAdd && !editId && (
          <div className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-1 text-sm font-medium text-white">Add Account</h2>
            <p className="mb-3 text-xs text-zinc-500">
              Pick how to log in — the @handle and avatar are pulled from TikTok automatically.
            </p>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => handleAddConnect('qr')}
                className="flex items-center gap-2 rounded bg-purple-600 px-4 py-1.5 text-sm text-white hover:bg-purple-700"
              >
                <QrCode size={14} /> Scan QR code
              </button>
              <button
                onClick={() => handleAddConnect('manual')}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                <Play size={14} /> Manual login
              </button>
              <button onClick={resetForm} className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600">
                Cancel
              </button>
            </div>
          </div>
        )}

        {showAdd && editId && (
          <div className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-3 text-sm font-medium text-white">Edit Account</h2>
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
                <span className="mb-1 block text-xs text-zinc-400">Daily DM Limit</span>
                <input
                  type="number"
                  value={form.daily_dm_limit}
                  onChange={(e) => setForm({ ...form, daily_dm_limit: parseInt(e.target.value) || 50 })}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block">
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
                Save
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
                  <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-zinc-500">
                    <div className="flex items-center gap-2">
                      <span>DMs: {account.dms_sent_today}/{account.daily_dm_limit}</span>
                      <div className="w-24 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            account.dms_sent_today >= account.daily_dm_limit ? 'bg-red-500' :
                            account.dms_sent_today >= account.daily_dm_limit * 0.8 ? 'bg-orange-500' :
                            'bg-blue-500'
                          )}
                          style={{ width: `${Math.min(100, (account.dms_sent_today / (account.daily_dm_limit || 50)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span>Transport: {account.transport_type}</span>
                    {account.last_inbox_sync && (
                      <span>Last sync: {new Date(account.last_inbox_sync).toLocaleTimeString()}</span>
                    )}
                    <button
                      onClick={async () => {
                        const updated = await put<TikTokAccount>(`/accounts/${account.id}`, { sync_enabled: !account.sync_enabled })
                        setAccounts((prev) => prev.map((a) => a.id === account.id ? updated : a))
                      }}
                      className={cn('rounded px-1.5 py-0.5', account.sync_enabled ? 'text-green-400 hover:text-green-300' : 'text-zinc-600 hover:text-zinc-400')}
                    >
                      Sync: {account.sync_enabled ? 'ON' : 'OFF'}
                    </button>
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
                    <>
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
                      <button
                        onClick={() => handleConnectQr(account.id)}
                        className="flex items-center gap-1 rounded bg-purple-600/20 px-2 py-1 text-xs text-purple-400 hover:bg-purple-600/30"
                        title="Log in by scanning a QR code with the TikTok app"
                      >
                        <QrCode size={12} /> QR
                      </button>
                    </>
                  )}
                  {account.status === 'connected' && !liveSessions.has(account.id) && (
                    <button
                      onClick={() => {
                        setScrapeAccountId(account.id)
                        setScrapeForm({ limit: 50, listId: '' })
                      }}
                      className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors"
                      title="Scrape followers"
                    >
                      <Users size={12} /> Scrape
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

      {qrAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl text-center">
            <h2 className="text-lg font-semibold text-white mb-1">Log in with QR code</h2>
            <p className="text-xs text-zinc-400 mb-4">
              Open the TikTok app → Profile → menu → <span className="text-zinc-300">Scan QR</span>
            </p>

            <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-lg bg-white">
              {qrStatus === 'success' ? (
                <div className="flex flex-col items-center gap-2 text-green-600">
                  <Wifi size={40} />
                  <span className="text-sm font-medium">Connected!</span>
                </div>
              ) : qrStatus === 'expired' ? (
                <div className="flex flex-col items-center gap-2 text-zinc-500">
                  <RefreshCw size={32} />
                  <span className="text-sm">QR code expired</span>
                </div>
              ) : qrImage ? (
                <img src={qrImage} alt="TikTok login QR code" className="h-52 w-52 object-contain" />
              ) : (
                <RefreshCw size={32} className="animate-spin text-zinc-400" />
              )}
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              {qrStatus === 'waiting' && (qrImage ? 'Waiting for you to scan…' : 'Generating QR code…')}
            </p>

            <div className="mt-5 flex justify-center gap-3">
              {qrStatus === 'expired' && (
                <button
                  onClick={() => handleConnectQr(qrAccountId)}
                  className="flex items-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
                >
                  <RefreshCw size={14} /> Regenerate
                </button>
              )}
              <button
                onClick={handleCancelQr}
                className="rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                {qrStatus === 'success' ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scrapeAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-zinc-850 bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4">Scrape Followers</h2>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Scrape Limit (Max 200)</span>
                <input
                  type="number"
                  value={scrapeForm.limit}
                  min={1}
                  max={200}
                  onChange={(e) => setScrapeForm({ ...scrapeForm, limit: Math.min(200, Math.max(1, parseInt(e.target.value) || 50)) })}
                  className="w-full rounded border border-zinc-750 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Add Scraped Leads to List/Folder (Optional)</span>
                <select
                  value={scrapeForm.listId}
                  onChange={(e) => setScrapeForm({ ...scrapeForm, listId: e.target.value })}
                  className="w-full rounded border border-zinc-750 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Do not add to any list</option>
                  {lists.map((l: any) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.lead_count || 0} leads)</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setScrapeAccountId(null)}
                disabled={scraping}
                className="rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-350 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleScrape}
                disabled={scraping}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {scraping ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Scraping...
                  </>
                ) : (
                  'Start Scrape'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
