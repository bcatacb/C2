import { useEffect, useState } from 'react'
import { get, post, del } from '../lib/api'
import { Plus, Trash2 } from 'lucide-react'

interface Proxy {
  id: string
  type: string | null
  host: string
  port: number
  username: string | null
  password: string | null
  country: string | null
  assigned_account_id: string | null
  status: string
}

export function Settings() {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ host: '', port: '', username: '', password: '', type: 'residential', country: '' })
  const [health, setHealth] = useState<{ status: string; uptime: number; pool?: { active: number; maxConcurrent: number; queued: number } } | null>(null)
  const [controls, setControls] = useState<{ inbox_sync: boolean; campaign_worker: boolean } | null>(null)
  const [backendUrl, setBackendUrl] = useState(localStorage.getItem('c2_backend_url') || '')

  useEffect(() => {
    get<Proxy[]>('/proxies').then(setProxies).catch(() => {})
    get<typeof health>('/health').then(setHealth).catch(() => {})
    get<{ inbox_sync: boolean; campaign_worker: boolean }>('/controls').then(setControls).catch(() => {})
  }, [])

  function handleSaveBackendUrl() {
    if (backendUrl.trim()) {
      localStorage.setItem('c2_backend_url', backendUrl.trim())
    } else {
      localStorage.removeItem('c2_backend_url')
    }
    alert('Backend URL updated! Refreshing the page to apply changes.')
    window.location.reload()
  }


  async function handleAddProxy() {
    const proxy = await post<Proxy>('/proxies', {
      ...form,
      port: parseInt(form.port) || 0,
      username: form.username || null,
      password: form.password || null,
      country: form.country || null,
    })
    setProxies((prev) => [...prev, proxy])
    setShowAdd(false)
    setForm({ host: '', port: '', username: '', password: '', type: 'residential', country: '' })
  }

  async function handleDeleteProxy(id: string) {
    await del(`/proxies/${id}`)
    setProxies((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </div>

      <div className="space-y-6 p-6">
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Server Connection</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <label className="block">
              <span className="mb-2 block text-xs text-zinc-500">Backend Server URL</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="Relative path (e.g. default /api) or http://<ip>:4000"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={handleSaveBackendUrl}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Save URL
                </button>
              </div>
            </label>
          </div>
        </section>

        {health && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-zinc-300">System Status</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <div className="text-xs text-zinc-500">Status</div>
                <div className="text-sm font-medium text-green-400">{health.status}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <div className="text-xs text-zinc-500">Uptime</div>
                <div className="text-sm font-medium text-white">{Math.floor(health.uptime / 60)}m</div>
              </div>
              {health.pool && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="text-xs text-zinc-500">Browser Pool</div>
                  <div className="text-sm font-medium text-white">
                    {health.pool.active}/{health.pool.maxConcurrent} active, {health.pool.queued} queued
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {controls && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Services</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                <div>
                  <div className="text-sm text-white">Inbox Sync</div>
                  <div className="text-xs text-zinc-500">Scrapes DMs from connected accounts every 30s</div>
                </div>
                <button
                  onClick={async () => {
                    const res = await post<{ inbox_sync: boolean }>('/controls/inbox-sync', { enabled: !controls.inbox_sync })
                    setControls(prev => prev ? { ...prev, inbox_sync: res.inbox_sync } : prev)
                  }}
                  className={`rounded px-3 py-1.5 text-xs font-medium ${controls.inbox_sync ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                >
                  {controls.inbox_sync ? 'Running' : 'Stopped'}
                </button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                <div>
                  <div className="text-sm text-white">Campaign Worker</div>
                  <div className="text-xs text-zinc-500">Processes active campaigns and sends DMs</div>
                </div>
                <button
                  onClick={async () => {
                    const res = await post<{ campaign_worker: boolean }>('/controls/campaign-worker', { enabled: !controls.campaign_worker })
                    setControls(prev => prev ? { ...prev, campaign_worker: res.campaign_worker } : prev)
                  }}
                  className={`rounded px-3 py-1.5 text-xs font-medium ${controls.campaign_worker ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                >
                  {controls.campaign_worker ? 'Running' : 'Stopped'}
                </button>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Proxies</h2>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            >
              <Plus size={14} /> Add Proxy
            </button>
          </div>

          {showAdd && (
            <div className="mb-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="Host"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                />
                <input
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  placeholder="Port"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                />
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="Username (optional)"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                />
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Password (optional)"
                  type="password"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                />
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                >
                  <option value="residential">Residential</option>
                  <option value="mobile">Mobile</option>
                  <option value="datacenter">Datacenter</option>
                </select>
                <input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="Country (e.g., US)"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={handleAddProxy} className="rounded bg-blue-600 px-3 py-1 text-xs text-white">Add</button>
                <button onClick={() => setShowAdd(false)} className="rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-300">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {proxies.map((proxy) => (
              <div key={proxy.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div>
                  <span className="text-sm text-white">{proxy.host}:{proxy.port}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {proxy.type}{proxy.country ? ` / ${proxy.country}` : ''}
                  </span>
                  <span className={`ml-2 text-xs ${proxy.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
                    {proxy.status}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteProxy(proxy.id)}
                  className="rounded p-1 text-zinc-400 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {proxies.length === 0 && (
              <div className="py-6 text-center text-sm text-zinc-500">
                No proxies configured. Add proxies to enable anti-detection.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
