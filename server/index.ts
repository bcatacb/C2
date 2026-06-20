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
import { startCampaignWorker, stopCampaignWorker } from './services/campaign-worker.js'
import {
  listStages, createStage, updateStage, deleteStage,
  moveConversationToStage, getConversationsByPipeline, getStats as getPipelineStats, updateLabels,
} from './services/pipeline-service.js'
import { listNotes, createNote, deleteNote } from './services/note-service.js'
import {
  listRules, createRule, updateRule, deleteRule, toggleRule, getLog as getAutomationLog,
} from './services/automation-engine.js'
import { sendMessage } from './services/message-sender.js'
import { startInboxSync, stopInboxSync } from './services/inbox-sync.js'
import { getPoolStatus, acquireSession, destroySession, pinSession, getSession } from './transport/session-pool.js'
import {
  listLeadLists, createLeadList, deleteLeadList, addLeadsToList, removeLeadsFromList,
} from './services/lead-list-service.js'

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

// ── Account Connect via QR (headless — scan with TikTok app) ─
app.post('/api/accounts/:id/connect-qr', asyncH(async (req, res) => {
  const id = req.params.id as string
  const account = await getAccount(id)
  if (!account) { res.status(404).json({ error: 'Account not found' }); return }

  const proxyUrl = account.proxy_id ? await getProxyUrl(account.proxy_id) : null
  const { startQrLogin } = await import('./transport/qr-login.js')
  await startQrLogin(id, proxyUrl, account.session_data)

  res.json({ ok: true, message: 'QR login started — scan the code with the TikTok app' })
}))

app.post('/api/accounts/:id/cancel-qr', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { stopQrLogin } = await import('./transport/qr-login.js')
  await stopQrLogin(id)
  res.json({ ok: true })
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

  // Read the logged-in handle/avatar from the live page before we destroy the session.
  let profile: { username: string | null; displayName: string | null; photo: string | null } = { username: null, displayName: null, photo: null }
  const live = getSession(id)
  const page = live?.context.pages()[0]
  if (page) {
    const { readOwnProfile } = await import('./transport/playwright.js')
    profile = await readOwnProfile(page)
  }

  const sessionData = await destroySession(id)
  if (!sessionData) { res.status(400).json({ error: 'No active browser session for this account' }); return }

  const fields: Record<string, unknown> = { session_data: sessionData, status: 'connected' }
  if (profile.username) fields.username = profile.username
  if (profile.displayName) fields.display_name = profile.displayName
  if (profile.photo) fields.profile_photo = profile.photo
  await updateAccount(id, fields)

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

app.post('/api/accounts/:id/scrape-followers', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { limit = 50, listId } = req.body
  const account = await getAccount(id)
  if (!account) { res.status(404).json({ error: 'Account not found' }); return }

  const transport = account.transport_type === 'api'
    ? (await import('./transport/api.js')).apiTransport
    : (await import('./transport/playwright.js')).playwrightTransport

  const proxyUrl = account.proxy_id ? await getProxyUrl(account.proxy_id) : null
  
  const followers = await transport.scrapeFollowers(id, limit)
  
  const createdLeads: any[] = []
  const { supabase: sb } = await import('./utils/supabase.js')

  for (const f of followers) {
    const normalized = f.username.trim().toLowerCase()
    const { data: existing } = await sb
      .from('leads')
      .select('*')
      .eq('username', normalized)
      .single()

    let leadId = existing?.id
    if (existing) {
      const tags = [...new Set([...(existing.tags || []), 'scraped_follower', ...(f.isMutual ? ['mutual_follower'] : [])])]
      const { data: updated } = await sb
        .from('leads')
        .update({ tags, display_name: f.displayName || existing.display_name })
        .eq('id', existing.id)
        .select()
        .single()
      if (updated) {
        createdLeads.push(updated)
        leadId = updated.id
      }
    } else {
      const tags = ['scraped_follower']
      if (f.isMutual) tags.push('mutual_follower')
      const { data: created, error: createError } = await sb
        .from('leads')
        .insert({
          username: normalized,
          display_name: f.displayName || null,
          status: 'new',
          tags,
          account_id: id,
          source: 'follower_scrape'
        })
        .select()
        .single()
      if (!createError && created) {
        createdLeads.push(created)
        leadId = created.id
      }
    }

    if (listId && leadId) {
      await sb
        .from('lead_list_members')
        .upsert({ list_id: listId, lead_id: leadId }, { onConflict: 'list_id,lead_id' })
    }
  }

  res.json({ ok: true, count: followers.length, leads: createdLeads })
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
  if (query.list_id) {
    filters.list_id = query.list_id as string
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

// ── Lead Lists / Folders ────────────────────────────────────
app.get('/api/lists', asyncH(async (_req, res) => {
  const lists = await listLeadLists()
  res.json(lists)
}))

app.post('/api/lists', asyncH(async (req, res) => {
  const { name, description } = req.body
  const list = await createLeadList(name, description)
  broadcast('list:created', list)
  res.status(201).json(list)
}))

app.delete('/api/lists/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteLeadList(id)
  broadcast('list:deleted', { id })
  res.json({ ok: true })
}))

app.post('/api/lists/:id/leads', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { leadIds } = req.body
  await addLeadsToList(id, leadIds)
  res.json({ ok: true })
}))

app.post('/api/lists/:id/leads/delete', asyncH(async (req, res) => {
  const id = req.params.id as string
  const { leadIds } = req.body
  await removeLeadsFromList(id, leadIds)
  res.json({ ok: true })
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

// ── Automation ──────────────────────────────────────────────
app.get('/api/automation-rules', asyncH(async (_req, res) => {
  const rules = await listRules()
  res.json(rules)
}))

app.post('/api/automation-rules', asyncH(async (req, res) => {
  const rule = await createRule(req.body)
  broadcast('automation-rule:created', rule)
  res.status(201).json(rule)
}))

app.put('/api/automation-rules/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  const rule = await updateRule(id, req.body)
  broadcast('automation-rule:updated', rule)
  res.json(rule)
}))

app.delete('/api/automation-rules/:id', asyncH(async (req, res) => {
  const id = req.params.id as string
  await deleteRule(id)
  broadcast('automation-rule:deleted', { id })
  res.json({ ok: true })
}))

app.post('/api/automation-rules/:id/toggle', asyncH(async (req, res) => {
  const id = req.params.id as string
  const rule = await toggleRule(id)
  broadcast('automation-rule:updated', rule)
  res.json(rule)
}))

app.get('/api/automation-log', asyncH(async (req, res) => {
  const query = req.query
  const page = parseInt(query.page as string) || 1
  const per_page = parseInt(query.per_page as string) || 20
  const result = await getAutomationLog({
    page,
    per_page,
  })
  res.json(result)
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
    .limit(1000)
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

// ── Runtime Controls ────────────────────────────────────────
let inboxSyncRunning = process.env.ENABLE_INBOX_SYNC !== 'false'
let campaignWorkerRunning = process.env.ENABLE_CAMPAIGN_WORKER === 'true'

app.get('/api/controls', (_req, res) => {
  res.json({ inbox_sync: inboxSyncRunning, campaign_worker: campaignWorkerRunning })
})

app.post('/api/controls/inbox-sync', asyncH(async (req, res) => {
  const { enabled } = req.body
  if (enabled && !inboxSyncRunning) {
    startInboxSync()
    inboxSyncRunning = true
  } else if (!enabled && inboxSyncRunning) {
    stopInboxSync()
    inboxSyncRunning = false
  }
  res.json({ inbox_sync: inboxSyncRunning })
}))

app.post('/api/controls/campaign-worker', asyncH(async (req, res) => {
  const { enabled } = req.body
  if (enabled && !campaignWorkerRunning) {
    startCampaignWorker()
    campaignWorkerRunning = true
  } else if (!enabled && campaignWorkerRunning) {
    stopCampaignWorker()
    campaignWorkerRunning = false
  }
  res.json({ campaign_worker: campaignWorkerRunning })
}))

// ── Static Frontend (production) ────────────────────────────
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist')
app.use(express.static(frontendDist))
app.get('*splat', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

import { resetDailyCounts } from './services/account-manager.js'

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

  // ── Daily DM counter reset ──────────────────────────────
  // Reset dms_sent_today for all accounts every day at midnight.
  // Without this the daily limit counter grows forever and blocks campaigns.
  function scheduleDailyReset() {
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0) // next midnight
    const msUntilMidnight = midnight.getTime() - now.getTime()
    setTimeout(async () => {
      try {
        await resetDailyCounts()
        console.log('[server] daily DM counts reset')
      } catch (err) {
        console.error('[server] failed to reset daily DM counts:', err)
      }
      setInterval(async () => {
        try {
          await resetDailyCounts()
          console.log('[server] daily DM counts reset')
        } catch (err) {
          console.error('[server] failed to reset daily DM counts:', err)
        }
      }, 24 * 60 * 60 * 1000)
    }, msUntilMidnight)
    console.log(`[server] daily DM reset scheduled in ${Math.round(msUntilMidnight / 60000)}m`)
  }
  scheduleDailyReset()
})
