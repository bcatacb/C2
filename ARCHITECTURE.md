# TokTik C2 — Architecture & Design Decisions

## What This Is

A unified messaging orchestrator for managing 50 TikTok profiles from a single dashboard. Supports both cold DM outreach and inbound inbox management. Built as Phase 1 of a larger multi-platform messaging hub.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + TypeScript + Vite | Fast dev server, HMR, mirrors existing WhatsApp Account Manager stack |
| Styling | Tailwind CSS 4 + Radix UI | Utility-first CSS with accessible component primitives — no custom CSS needed |
| Backend | Express + TypeScript (tsx) | Lightweight, familiar, single-language stack with the frontend |
| Database | Supabase (PostgreSQL) | Managed Postgres with instant REST API, auth, and real-time subscriptions |
| Browser Automation | Playwright (Chromium) | Best anti-detection support among Node.js automation libraries |
| Real-time | Native WebSocket (ws) | Lightweight push for live inbox updates without Socket.io overhead |
| Deployment | Docker + Docker Compose | Containerized for Coolify/Traefik self-hosting |

---

## Why Browser Automation Instead of an API

TikTok's official Business Messaging API is **not available for US-registered accounts** (blocked in US, EU, UK). Since all 50 profiles are US-based, we use Playwright to control browser sessions that interact with TikTok's web interface directly.

The architecture includes a **pluggable transport interface** so a TikTok API transport can be added later if accounts are registered in supported regions (e.g., Turkey, Southeast Asia). Both transports implement the same contract — the rest of the system doesn't care which one is active.

---

## Architecture Overview

```
React Frontend (port 5173)
  |
  | REST API + WebSocket (proxied via Vite in dev)
  v
Express Backend (port 4000)
  |
  |-- Account Manager ---- CRUD, health checks, cooldown tracking
  |-- Inbox Aggregator --- background sync ticker, message upsert, read/reply state sync
  |-- Campaign Worker ---- automated outreach campaigns, drip sequences
  |-- Lead List Service -- CRUD lists/folders, member mapping, lead engine filtering
  |-- Message Sender ----- send via transport, enforce daily limits, spin-tax template renderer
  |-- Automation Engine -- keyword trigger evaluations, auto-replies
  |-- Transport Orchestrator
  |     |-- Playwright Transport (active: sending, sync, profile follower scraper)
  |     |-- API Transport (stub)
  |     '-- Session Pool Manager
  |
  v
Supabase PostgreSQL
```

---

## Key Design Decisions

### 1. Session Pooling (max 5 concurrent browsers)

Running 50 Playwright browsers simultaneously would consume 25-50GB of RAM. Instead, a **session pool** manages a configurable number of concurrent browser instances (default: 5).

- Accounts queue for access via a FIFO task queue
- Sessions are reused if the browser is already logged into the needed account
- Browser cookies are persisted to the database on disconnect and restored on reconnect — no re-login needed unless the session expires
- Idle browsers are automatically closed after 60 seconds
- Full rotation of all 50 accounts takes approximately 5-8 minutes

### 2. Sticky Proxy Assignment

Each TikTok account is assigned a **single, dedicated proxy** (1:1 mapping). This prevents TikTok from seeing the same account log in from different IP addresses, which is a primary detection signal. The proxy table stores credentials and tracks health status independently.

### 3. Account Longevity Over Volume

The system prioritizes keeping accounts alive over maximizing message throughput:

- **Exponential backoff cooldowns**: 6h → 12h → 24h progression when rate limits are hit
- **Daily DM limits**: configurable per account (default 50/day), enforced server-side
- **Human-like behavior**: randomized delays between actions (2-5s), typing speed variation (50-150ms per character), no headless mode
- **Seeded fingerprints**: each account gets a deterministic but unique browser fingerprint (user-agent, viewport, timezone, locale) derived from its account ID — consistent across sessions

### 4. Pluggable Transport Interface

Every transport implements the same TypeScript interface:

```typescript
interface TikTokTransport {
  connect(accountId, sessionData, proxyUrl): Promise<sessionData>
  disconnect(accountId): Promise<void>
  fetchConversations(accountId): Promise<ConversationData[]>
  fetchMessages(accountId, peerUsername, since?): Promise<MessageData[]>
  sendMessage(accountId, peerUsername, body): Promise<MessageData>
  getAccountStatus(accountId): Promise<AccountStatus>
}
```

The Playwright transport is the active implementation. The API transport is a stub that throws "not yet implemented" — ready to be filled in when non-US accounts become available. The account's `transport_type` field determines which transport is used, switchable per-account via the UI.

### 5. Three-Pane Unified Inbox

The inbox UI mirrors the pattern from the WhatsApp Account Manager:

- **Left pane**: Account selector with health indicators and filters (unread, archived)
- **Center pane**: Conversation list aggregated across all selected accounts, sorted by most recent message, with account badges showing which profile each conversation belongs to
- **Right pane**: Message thread with chat bubbles, reply input, and archive controls

WebSocket pushes keep everything in sync — new messages appear in real-time without polling.

### 6. Simple Auth (Single-User Mode)

Phase 1 uses a hardcoded username/password (`DEFAULT_USER` / `DEFAULT_PASS` env vars) with a bearer token. No Supabase Auth, no sessions table, no OAuth. This is a self-hosted tool for one operator, not a multi-tenant SaaS. Auth can be upgraded in a future phase if needed.

### 7. Background Inbox Sync

A `setInterval` ticker runs every 30 seconds (configurable). Each tick:

1. Queries accounts sorted by `last_inbox_sync ASC` (stalest first)
2. Picks up to `MAX_CONCURRENT_BROWSERS` accounts
3. For each: acquires a browser session, scrapes the DM inbox, upserts conversations and messages, pushes updates via WebSocket
4. On rate-limit errors: triggers exponential backoff cooldown
5. On session errors: marks the account as disconnected

The sync is disabled by default (`ENABLE_INBOX_SYNC=false`) so the server can start without immediately launching browsers.

### 8. Dynamic Backend Server Routing & Remote Logins

To support flexible deployments (such as hosting the frontend as a static web application on Vercel/Netlify while the backend runs on a remote headless VPS), the system incorporates:
- **Local Storage Base Routing**: The frontend `api.ts` and `ws.ts` look for `c2_backend_url` in the browser's `localStorage`. If present, all HTTP REST APIs and WebSocket connections are routed directly to the custom remote IP/domain, enabling the webpage to operate independently of backend server co-location.
- **Headed Remote Session Capturing (`remote-login.js`)**: Since headless servers cannot display the TikTok QR/captcha login screen, a standalone local login script executes a headed browser locally. Once login is completed by the user, the script exports the storage state (cookies) and uploads them directly to the remote server's database via the `PUT /api/accounts/:id` endpoint.

---

## Database Schema

Four tables, two migration files:

### tiktok_accounts
Core account registry. Stores TikTok credentials (as session cookies in `session_data` JSONB), proxy assignment, transport type, daily limits, cooldown state, and sync timestamps.

### proxies
Proxy pool with sticky 1:1 assignment to accounts. Stores connection details, type (residential/mobile/datacenter), country, and health status.

### conversations
One row per (account, peer) pair. Denormalized with `last_message_text`, `last_message_at`, and `unread_count` for fast inbox list rendering without joins.

### messages
Individual messages within conversations. Deduplicated by `(account_id, tiktok_msg_id)` unique constraint to prevent duplicates during re-syncs.

---

## Project Structure

```
toktikc2/
├── docker-compose.yml          # Frontend + backend services
├── .env.example                # All configuration variables
├── frontend/
│   ├── src/
│   │   ├── components/         # AppLayout, Sidebar, RequireAuth
│   │   ├── pages/              # Login, Accounts, Unibox, Settings
│   │   ├── lib/                # api.ts, ws.ts, utils.ts
│   │   └── main.tsx            # Entry point with auth fetch interceptor
│   └── vite.config.ts          # Dev proxy to backend
├── server/
│   ├── index.ts                # Express app, routes, WebSocket server
│   ├── transport/
│   │   ├── interface.ts        # TikTokTransport contract
│   │   ├── playwright.ts       # Browser automation implementation
│   │   ├── api.ts              # TikTok API stub
│   │   └── session-pool.ts     # Concurrent browser pool manager
│   ├── services/
│   │   ├── account-manager.ts  # Account CRUD + sync queries
│   │   ├── inbox-sync.ts       # Background sync ticker
│   │   ├── message-sender.ts   # Send + save + broadcast
│   │   └── proxy-manager.ts    # Proxy CRUD + assignment
│   ├── utils/
│   │   ├── supabase.ts         # DB client
│   │   ├── cooldown.ts         # Exponential backoff logic
│   │   ├── fingerprint.ts      # Browser fingerprint generation
│   │   └── async-handler.ts    # Express error wrapper
│   └── migrations/             # SQL schema files
└── scripts/
    ├── seed-accounts.ts        # Bulk import from CSV
    └── test-transport.ts       # Smoke test for Playwright transport
```

---

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_KEY` | — | Supabase service role key |
| `PORT` | 4000 | Backend server port |
| `MAX_CONCURRENT_BROWSERS` | 5 | Session pool size |
| `BROWSER_IDLE_TIMEOUT_MS` | 60000 | Close idle browsers after this |
| `INBOX_SYNC_INTERVAL_MS` | 30000 | How often to sync inboxes |
| `HEADED_MODE` | false | Run browsers with visible UI (for debugging) |
| `ENABLE_INBOX_SYNC` | false | Start background sync on boot |
| `DEFAULT_USER` | admin | Login username |
| `DEFAULT_PASS` | admin | Login password |

---

## Completed Phase 2 - 5 Features Architecture

The system has been updated from a pure messaging orchestrator to a complete campaign and CRM system. The following modules have been integrated:

### 1. Scraper & Lead Engine (Profile Crawler)
- **Playwright Crawler**: Implemented directly in [playwright.ts](file:///c:/Users/ogt/c2/C2/server/transport/playwright.ts). It logs into TikTok, navigates to target profiles, opens the followers modal, scrolls down to load up to the specified limit, and filters out mutual followers (friends).
- **Background Scrape Endpoint**: The endpoint `POST /api/accounts/:id/scrape-followers` receives crawler instructions, imports the TikTok usernames as Leads (flagged as `scraped_follower` or `mutual_follower`), and optionally registers them into a specific Lead List.

### 2. CRM Folders & Lists
- **Relational Mapping Schema**: Added `lead_lists` and `lead_list_members` tables to support multi-list lead enrollment.
- **Service Layer & API**: Created [lead-list-service.ts](file:///c:/Users/ogt/c2/C2/server/services/lead-list-service.ts) to manage CRUD list operations, list assignments, and membership lookup.
- **UI Workspace Sidebar**: Added a left-hand folders sidebar on the Leads page to organize contacts on the fly. Users can select leads and trigger bulk addition or removal from custom lists.
- **Unibox Integration**: Added a Folder button in the Unibox thread view so that active conversation threads can be enrolled into custom CRM folders instantly.

### 3. Campaigns & Auto-Rotating Sender Accounts
- **Load-Balanced Account Rotation**: Campaigns can run without a hardcoded sending account. The [campaign-worker.ts](file:///c:/Users/ogt/c2/C2/server/services/campaign-worker.ts) automatically distributes outreach steps across all connected profiles.
- **Rotator Algorithm**: Before picking an account, active accounts are sorted ascending by their `dms_sent_today` count, ensuring load is balanced equally.
- **Daily DM Limits**: Accounts have strict daily limits. Visual progress indicators (color-coded progress bars) on the Accounts page show the percentage of limits reached (orange warning at 80%, red warning at 100%).

### 4. Unread/Read/Replied Status Transitions
- **State Engine**: Conversation rows maintain a `status` string representing state transitions:
  - Synchronizing new messages transitions status to `'unread'`.
  - Manual/campaign outbound replies transition status to `'replied'`.
  - Opening a conversation in the Unibox transitions status to `'read'`.
- **Inbox UI Tabs**: Segmented tabs (`All`, `Unread`, `Replied`) filter conversations locally based on these states.

### 5. Warm-up Starter Pools & Spin-tax Templates
- **Template Personalization**: The template engine supports recursive spin-tax patterns `{phrase1|phrase2|phrase3}` to randomize cold outreach text.
- **Warm-up Icebreakers**: Auto-sends lightweight starter messages (like waves/handshakes) to build trust scores.

---

## Future Phases

The architecture supports the following planned future additions:

| Phase | Module | Description |
|-------|--------|-------------|
| 6 | WhatsApp Integration | Bridge to existing WhatsApp Account Manager for cross-platform messaging |

