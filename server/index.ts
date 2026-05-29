import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { asyncH } from './utils/async-handler.js'
import {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
} from './services/account-manager.js'
import {
  listProxies, createProxy, updateProxy, deleteProxy, assignProxyToAccount,
} from './services/proxy-manager.js'
import {
  listLeads, getLead, createLead, updateLead, deleteLead, executeBulkAction, getStats as getLeadStats,
  type LeadFilters, type LeadStatus, type BulkAction,
} from './services/lead-service.js'
import { processImport, type CSVRow, type ImportDefaults } from './services/csv-importer.js'
import {
  listCampaigns, getCampaignWithStats, createCampaign, updateCampaign,
  deleteCampaign, activateCampaign, pauseCampaign, resumeCampaign, getCampaignLeads,
} from './services/campaign-service.js'
import { startCampaignWorker } from './services/campaign-worker.js'
import {
  listStages, createStage, updateStage, deleteStage,
  moveConversationToStage, getConversationsByPipeline, getStats as getPipelineStats, updateLabels,
} from './services/pipeline-service.js'
import { listNotes, createNote, deleteNote } from './services/note-service.js'
import { sendMessage } from './services/message-sender.js'
import { startInboxSync } from './services/inbox-sync.js'
import { getPoolStatus, acquireSession, destroySession, pinSession, getSession } from './transport/session-pool.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

async function getProxyUrl(proxyId: string): Promise<string | null> {
  const { supabase: sb } = await import('./utils/supabase.js')
  const { data } = await sb.from('proxies').select('*').eq('id', proxyId).single()
  if (!data) return null
  const auth = data.username ? `${data.username}:${data.password}@` : ''
  return `http://${auth}${data.host}:${data.port}`
}

const server = http.createServer(app)

// ── WebSocket ───────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

export function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }
}

// ── Auth (simple single-user mode) ─────────────────────────
const DEFAULT_USER = process.env.DEFAULT_USER || 'admin'
const DEFAULT_PASS = process.env.DEFAULT_PASS || 'admin'
const TOKEN = Buffer.from(`${DEFAULT_USER}:${Date.now()}`).toString('base64')

app.post('/api/auth/signin', asyncH(async (req, res) => {
  const { email, password } = req.body
  if (email === DEFAULT_USER && password === DEFAULT_PASS) {
    res.json({ token: TOKEN, user: { email: DEFAULT_USER } })
    return
  }
  res.status(401).json({ error: 'Invalid credentials' })
}))

app.get('/api/auth/me', asyncH(async (req, res) => {
  const auth = req.headers.authorization
  if (auth === `Bearer ${TOKEN}`) {
    res.json({ user: { email: DEFAULT_USER } })
    return
  }
  res.status(401).json({ error: 'Unauthorized' })
}))

// ── Accounts ────────────────────────────────────────────────
app.get('/api/accounts', asyncH(async (_req, res) => {
  const accounts = await listAccounts()
  res.json(accounts)
}))

app.get('/api/accounts/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const account = await getAccount(id)
  if (!account) { res.status(404).json({ error: 'Not found' }); return }
  res.json(account)
}))

app.post('/api/accounts', asyncH(async (req, res) => {
  const account = await createAccount(req.body)
  broadcast('account:created', account)
  res.status(201).json(account)
}))

app.put('/api/accounts/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const account = await updateAccount(id, req.body)
  broadcast('account:updated', account)
  res.json(account)
}))

app.delete('/api/accounts/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteAccount(id)
  broadcast('account:deleted', { id })
  res.json({ ok: true })
}))

// ── Account Connect (manual Playwright session) ────────────
app.post('/api/accounts/:id/connect', asyncH(async (req, res) => {
  const id = req.params.id as string
  const account = await getAccount(id)
  if (!account) { res.status(404).json({ error: 'Account not found' }); return }

  let proxyUrl: string | null = null
  if (account.proxy_id) {
    const { supabase } = await import('./utils/supabase.js')
    const { data: proxy } = await supabase.from('proxies').select('*').eq('id', account.proxy_id).single()
    if (proxy) {
      const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : ''
      proxyUrl = `http://${auth}${proxy.host}:${proxy.port}`
    }
  }

  const session = await acquireSession(id, proxyUrl, account.session_data)
  pinSession(id)
  const page = session.context.pages()[0] || await session.context.newPage()

  // Don't await — return immediately so the UI can show Save Session buttons
  page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    .then(() => console.log(`[connect] browser ready for ${account.username}`))
    .catch((err) => console.log(`[connect] nav warning for ${account.username}: ${err.message}`))

  await updateAccount(id, { status: 'connected' })
  broadcast('account:updated', { ...account, status: 'connected' })
  res.json({ ok: true, message: 'Browser opened — log in to TikTok manually, then click Save Session in the UI' })
}))

app.get('/api/accounts/:id/debug-page', asyncH(async (req, res) => {
  const id = req.params.id as string
  const session = getSession(id)
  if (!session) { res.status(400).json({ error: 'No active browser session for this account' }); return }

  const page = session.context.pages()[0]
  if (!page) { res.status(400).json({ error: 'No open page in browser' }); return }

  const debug = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText?.substring(0, 2000) || '',
    hasChatList: !!document.querySelector('[data-e2e="chat-list"]'),
    allDataE2E: Array.from(document.querySelectorAll('[data-e2e]')).map(el => el.getAttribute('data-e2e')).slice(0, 50),
    divCount: document.querySelectorAll('div').length,
  }))

  res.json(debug)
}))

app.post('/api/accounts/:id/save-session', asyncH(async (req, res) => {
  const id = req.params.id as string
  const sessionData = await destroySession(id)
  if (!sessionData) { res.status(400).json({ error: 'No active browser session for this account' }); return }

  await updateAccount(id, { session_data: sessionData, status: 'connected' })
  const account = await getAccount(id)
  broadcast('account:updated', account)
  res.json({ ok: true, message: 'Session cookies saved. Account is now connected.' })
}))

app.post('/api/accounts/:id/disconnect', asyncH(async (req, res) => {
  const id = req.params.id as string
  const sessionData = await destroySession(id)
  if (sessionData) {
    await updateAccount(id, { session_data: sessionData, status: 'disconnected' })
  } else {
    await updateAccount(id, { status: 'disconnected' })
  }
  const account = await getAccount(id)
  broadcast('account:updated', account)
  res.json({ ok: true })
}))

// ── Proxies ─────────────────────────────────────────────────
app.get('/api/proxies', asyncH(async (_req, res) => {
  const proxies = await listProxies()
  res.json(proxies)
}))

app.post('/api/proxies', asyncH(async (req, res) => {
  const proxy = await createProxy(req.body)
  res.status(201).json(proxy)
}))

app.put('/api/proxies/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const proxy = await updateProxy(id, req.body)
  res.json(proxy)
}))

app.delete('/api/proxies/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteProxy(id)
  res.json({ ok: true })
}))

app.post('/api/proxies/:proxyId/assign/:accountId', asyncH(async (req, res) => {
  const proxyId = req.params.proxyId as string
  const accountId = req.params.accountId as string
  await assignProxyToAccount(proxyId, accountId)
  res.json({ ok: true })
}))

// ── Conversations ───────────────────────────────────────────
app.get('/api/conversations', asyncH(async (req, res) => {
  const { supabase } = await import('./utils/supabase.js')
  let query = supabase
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })

  const accountId = req.query.account_id as string | undefined
  if (accountId) query = query.eq('account_id', accountId)

  const archived = req.query.archived === 'true'
  query = query.eq('archived', archived)

  const limit = parseInt(req.query.limit as string) || 50
  query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  res.json(data)
}))

app.put('/api/conversations/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { supabase } = await import('./utils/supabase.js')
  const { data, error } = await supabase
    .from('conversations')
    .update(req.body)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  broadcast('conversation:updated', data)
  res.json(data)
}))

// ── Fetch messages on demand ────────────────────────────────
app.post('/api/conversations/:id/fetch-messages', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { supabase: sb } = await import('./utils/supabase.js')

  const { data: conv } = await sb.from('conversations').select('*').eq('id', id).single()
  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  const account = await getAccount(conv.account_id)
  if (!account) { res.status(404).json({ error: 'Account not found' }); return }

  const transport = account.transport_type === 'api'
    ? (await import('./transport/api.js')).apiTransport
    : (await import('./transport/playwright.js')).playwrightTransport

  const proxyUrl = account.proxy_id ? await getProxyUrl(account.proxy_id) : null
  await transport.connect(account.id, account.session_data, proxyUrl)

  const rawMessages = await transport.fetchMessages(account.id, conv.peer_username)

  const inserted: unknown[] = []
  for (const msg of rawMessages) {
    const { data, error } = await sb
      .from('messages')
      .upsert({
        conversation_id: id,
        account_id: conv.account_id,
        direction: msg.direction,
        body: msg.body,
        media_url: msg.mediaUrl,
        tiktok_msg_id: msg.tiktokMsgId,
        status: 'delivered',
        sent_at: msg.sentAt.toISOString(),
      }, { onConflict: 'account_id,tiktok_msg_id' })
      .select()
      .single()
    if (!error && data) inserted.push(data)
  }

  res.json(inserted)
}))

// ── Leads ───────────────────────────────────────────────────
app.get('/api/leads', asyncH(async (_req, res) => {
  const query = _req.query
  const filters: LeadFilters = {}

  if (query.status) {
    const statuses = (query.status as string).split(',') as LeadStatus[]
    filters.status = statuses.length === 1 ? statuses[0] : statuses
  }
  if (query.tags) {
    filters.tags = (query.tags as string).split(',')
  }
  if (query.account_id) {
    filters.account_id = query.account_id as string
  }
  if (query.search) {
    filters.search = query.search as string
  }
  if (query.created_after) {
    filters.created_after = query.created_after as string
  }
  if (query.created_before) {
    filters.created_before = query.created_before as string
  }
  if (query.page) {
    filters.page = parseInt(query.page as string)
  }
  if (query.per_page) {
    filters.per_page = parseInt(query.per_page as string)
  }

  const result = await listLeads(filters)
  res.json(result)
}))

app.get('/api/leads/stats', asyncH(async (_req, res) => {
  const stats = await getLeadStats()
  res.json(stats)
}))

app.get('/api/leads/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const lead = await getLead(id)
  if (!lead) { res.status(404).json({ error: 'Not found' }); return }
  res.json(lead)
}))

app.post('/api/leads', asyncH(async (req, res) => {
  try {
    const lead = await createLead(req.body)
    broadcast('leads:created', lead)
    res.status(201).json(lead)
  } catch (err: any) {
    if (err.message === 'Duplicate username') {
      res.status(409).json({ error: 'Duplicate username' })
      return
    }
    throw err
  }
}))

app.put('/api/leads/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const lead = await updateLead(id, req.body)
  broadcast('leads:updated', lead)
  res.json(lead)
}))

app.delete('/api/leads/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteLead(id)
  broadcast('leads:deleted', { id })
  res.json({ ok: true })
}))

app.post('/api/leads/import', asyncH(async (req, res) => {
  const { rows, defaults } = req.body as { rows: CSVRow[]; defaults?: ImportDefaults }
  const result = await processImport(rows, defaults)
  res.json(result)
}))

app.post('/api/leads/bulk', asyncH(async (req, res) => {
  const { ids, action } = req.body as { ids: string[]; action: BulkAction }
  if (!ids || ids.length > 500) {
    res.status(400).json({ error: 'Maximum 500 IDs per bulk operation' })
    return
  }
  const result = await executeBulkAction(ids, action)
  broadcast('leads:bulk-updated', result)
  res.json(result)
}))

// ── Campaigns ───────────────────────────────────────────────
app.get('/api/campaigns', asyncH(async (_req, res) => {
  const campaigns = await listCampaigns()
  res.json(campaigns)
}))

app.get('/api/campaigns/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const campaign = await getCampaignWithStats(id)
  if (!campaign) { res.status(404).json({ error: 'Not found' }); return }
  res.json(campaign)
}))

app.post('/api/campaigns', asyncH(async (req, res) => {
  const campaign = await createCampaign(req.body)
  broadcast('campaign:created', campaign)
  res.status(201).json(campaign)
}))

app.put('/api/campaigns/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const campaign = await updateCampaign(id, req.body)
  broadcast('campaign:updated', campaign)
  res.json(campaign)
}))

app.delete('/api/campaigns/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteCampaign(id)
  broadcast('campaign:deleted', { id })
  res.json({ ok: true })
}))

app.post('/api/campaigns/:id/activate', asyncH(async (req, res) => {
  const id = req.params.id as string
  const campaign = await activateCampaign(id)
  broadcast('campaign:activated', campaign)
  res.json(campaign)
}))

app.post('/api/campaigns/:id/pause', asyncH(async (req, res) => {
  const id = req.params.id as string
  const campaign = await pauseCampaign(id)
  broadcast('campaign:paused', campaign)
  res.json(campaign)
}))

app.post('/api/campaigns/:id/resume', asyncH(async (req, res) => {
  const id = req.params.id as string
  const campaign = await resumeCampaign(id)
  broadcast('campaign:resumed', campaign)
  res.json(campaign)
}))

app.get('/api/campaigns/:id/leads', asyncH(async (req, res) => {
  const id = req.params.id as string
  const query = req.query
  const leads = await getCampaignLeads(id, {
    status: query.status as any,
    page: query.page ? parseInt(query.page as string) : undefined,
    per_page: query.per_page ? parseInt(query.per_page as string) : undefined,
  })
  res.json(leads)
}))

// ── Pipeline Stages ─────────────────────────────────────────
app.get('/api/pipeline-stages', asyncH(async (_req, res) => {
  const stages = await listStages()
  res.json(stages)
}))

app.post('/api/pipeline-stages', asyncH(async (req, res) => {
  try {
    const stage = await createStage(req.body)
    broadcast('pipeline-stage:created', stage)
    res.status(201).json(stage)
  } catch (err: any) {
    if (err.message === 'Stage name already exists') {
      res.status(409).json({ error: 'Stage name already exists' })
      return
    }
    throw err
  }
}))

app.put('/api/pipeline-stages/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  try {
    const stage = await updateStage(id, req.body)
    broadcast('pipeline-stage:updated', stage)
    res.json(stage)
  } catch (err: any) {
    if (err.message === 'Stage name already exists') {
      res.status(409).json({ error: 'Stage name already exists' })
      return
    }
    throw err
  }
}))

app.delete('/api/pipeline-stages/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteStage(id)
  broadcast('pipeline-stage:deleted', { id })
  res.json({ ok: true })
}))

// ── Conversation Pipeline ───────────────────────────────────
app.put('/api/conversations/:id/stage', asyncH(async (req, res) => {
  const id = req.params.id as string
  try {
    const conversation = await moveConversationToStage(id, req.body.stage_id)
    broadcast('conversation:updated', conversation)
    res.json(conversation)
  } catch (err: any) {
    if (err.message === 'Pipeline stage not found') {
      res.status(404).json({ error: 'Pipeline stage not found' })
      return
    }
    throw err
  }
}))

app.get('/api/conversations/pipeline', asyncH(async (req, res) => {
  const filters: { account_id?: string; labels?: string[] } = {}
  if (req.query.account_id) filters.account_id = req.query.account_id as string
  if (req.query.labels) filters.labels = (req.query.labels as string).split(',')
  const result = await getConversationsByPipeline(filters)
  res.json(result)
}))

app.put('/api/conversations/:id/labels', asyncH(async (req, res) => {
  const id = req.params.id as string
  try {
    const conversation = await updateLabels(id, req.body.labels)
    broadcast('conversation:updated', conversation)
    res.json(conversation)
  } catch (err: any) {
    if (err.message.startsWith('Each label must be')) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }
}))

app.get('/api/pipeline-stats', asyncH(async (_req, res) => {
  const stats = await getPipelineStats()
  res.json(stats)
}))

// ── Notes ───────────────────────────────────────────────────
app.get('/api/conversations/:id/notes', asyncH(async (req, res) => {
  const id = req.params.id as string
  const notes = await listNotes(id)
  res.json(notes)
}))

app.post('/api/conversations/:id/notes', asyncH(async (req, res) => {
  const id = req.params.id as string
  try {
    const note = await createNote(id, req.body.body)
    broadcast('note:created', note)
    res.status(201).json(note)
  } catch (err: any) {
    if (err.message === 'Conversation not found') {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (err.message.startsWith('Note body')) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }
}))

app.delete('/api/notes/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteNote(id)
  broadcast('note:deleted', { id })
  res.json({ ok: true })
}))

// ── Messages ────────────────────────────────────────────────
app.get('/api/messages', asyncH(async (req, res) => {
  const { supabase } = await import('./utils/supabase.js')
  const conversationId = req.query.conversation_id as string
  if (!conversationId) { res.status(400).json({ error: 'conversation_id required' }); return }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  res.json(data)
}))

// ── Send Message ────────────────────────────────────────────
app.post('/api/messages/send', asyncH(async (req, res) => {
  const { accountId, peerUsername, body } = req.body
  if (!accountId || !peerUsername || !body) {
    res.status(400).json({ error: 'accountId, peerUsername, and body are required' })
    return
  }
  const message = await sendMessage(accountId, peerUsername, body)
  res.status(201).json(message)
}))

// ── Health ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), pool: getPoolStatus() })
})

// ── Start ───────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000')
server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
  if (process.env.ENABLE_INBOX_SYNC !== 'false') {
    startInboxSync()
  }
  if (process.env.ENABLE_CAMPAIGN_WORKER === 'true') {
    startCampaignWorker()
  }
})
