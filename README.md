# TokTik C2 — Unified Messaging, Campaigns & CRM Orchestrator

Unified inbox, CRM, and automated campaign manager for managing DMs across multiple TikTok profiles. Uses Playwright browser automation as the transport layer (TikTok Business Messaging API is unavailable for US accounts) combined with automated account rotation, lead scraper crawler, folders, and keyword auto-replies.

## Quick Start

### Prerequisites
- Node.js 20+
- A Supabase project with the schema applied (see `server/migrations/`)

### 1. Install dependencies

```bash
cd frontend && npm install && cd ..
cd server && npm install && npx playwright install chromium && cd ..
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your Supabase credentials
```

### 3. Run database migrations

Execute all SQL files inside [server/migrations/](file:///c:/Users/ogt/c2/C2/server/migrations/) in sequential order (from `001` to `008`) against your Supabase SQL editor:
- `001_accounts_proxies.sql`
- `002_conversations_messages.sql`
- `003_leads.sql`
- `004_campaigns.sql`
- `005_crm_pipeline.sql`
- `006_sync_enabled.sql`
- `007_automation.sql`
- `008_features_expansion.sql`


### 4. Start the servers

**Terminal 1 — Backend:**
```bash
cd server && npx tsx index.ts
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npx vite --host
```

### 5. Access the app

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Login: `admin` / `admin` (configurable via `DEFAULT_USER` / `DEFAULT_PASS` in `.env`)

## Adding a TikTok Account

### Method A: Local Setup (Headed)
1. Go to **Accounts** page → **Add Account** → enter the TikTok username.
2. Click **Connect** — this opens a headed Playwright browser to TikTok's login page (if `HEADED_MODE=true` in `.env`).
3. Complete login + 2FA on TikTok.
4. Click **Save Session** — cookies are saved to the database.

### Method B: Remote Setup (Headless VPS)
If the C2 server is running headlessly on a remote VPS:
1. Copy `server/scripts/remote-login.js` ([remote-login.js](file:///c:/Users/ogt/c2/C2/server/scripts/remote-login.js)) to your local computer.
2. Run `npm install playwright` locally.
3. Run the script:
   ```bash
   node remote-login.js <YOUR_REMOTE_C2_URL> <ACCOUNT_ID>
   ```
4. Log in manually in the local browser that pops up. The script will automatically capture the logged-in cookies and upload them directly to your remote C2 server.

---

## Static Web Page Hosting
The React frontend can be hosted independently as a static web application (e.g., on Vercel, Netlify, or GitHub Pages) and pointed to any remote C2 backend. 
* Simply open your deployed static webpage, enter your C2 backend's remote URL in the Login or Settings screen, and log in. The UI will dynamically route all API/WebSocket requests to your VPS backend.

---

### Architecture
```
React Frontend (Vite + Tailwind)
  ↕ REST + WebSocket (proxied via Vite)
Express Backend (TypeScript)
  ├── Account Manager (CRUD, health, cooldown)
  ├── Inbox Sync (30s ticker, conversation list and status scraping)
  ├── Campaign Worker (automated outreach, round-robin rotating accounts)
  ├── Automation Engine (keyword trigger evaluations, auto-replies)
  ├── Lead List Service (folders and membership mapping)
  └── Transport Layer (pluggable)
       └── Playwright Transport
            ├── Session Pool (max 5 browsers, mutex locking)
            ├── Cookie Banner Dismissal
            ├── TikTok Business Suite iframe targeting
            └── Follower and Follow-back profile crawler scraper
  ↕
Supabase (PostgreSQL)
```

### Sync Flow
- Every 30s, the sync ticker rotates through connected accounts
- For each account: acquires a Playwright session, navigates to TikTok DMs, finds the Business Suite iframe, scrapes the conversation list
- Conversations are upserted to the database with display names, avatars, last message preview, unread counts, and status (unread/read/replied)
- Messages are fetched **on-demand** when you click a conversation in the inbox (not during automated sync — too fragile with TikTok's iframe lifecycle)

### Key Technical Details
- TikTok Business Suite renders messages inside an **iframe** (`/messages?scene=business`), not the main frame
- A `tiktok-cookie-banner` web component overlays the page and blocks all clicks — it's removed from the DOM before any interaction
- Session pool uses per-session mutex locking to prevent sync and on-demand fetch from using the same browser simultaneously
- Sessions are pinned during manual login to prevent the idle reaper from closing the browser during 2FA
- Message outreach template supports spin-tax curly braces `{phrase1|phrase2}` patterns to avoid TikTok spam detection filters.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_KEY` | — | Supabase service role key |
| `PORT` | `4000` | Backend port |
| `MAX_CONCURRENT_BROWSERS` | `5` | Max Playwright sessions |
| `BROWSER_IDLE_TIMEOUT_MS` | `60000` | Close idle browsers after this |
| `INBOX_SYNC_INTERVAL_MS` | `30000` | Sync ticker interval |
| `HEADED_MODE` | `false` | Set `true` if you have a display server |
| `ENABLE_INBOX_SYNC` | `true` | Set `false` to disable auto-sync |
| `ENABLE_CAMPAIGN_WORKER` | `true` | Set `false` to disable auto campaign outreach |
| `DEFAULT_USER` | `admin` | Login username |
| `DEFAULT_PASS` | `admin` | Login password |

## Project Structure

```
frontend/          React + Vite + Tailwind
  src/
    pages/         Accounts, Unibox (inbox), Settings, Login, Leads (folders/sidebar), Campaigns, Pipelines, Automations
    components/    AppLayout, Sidebar, RequireAuth
    lib/           api.ts (auth-aware fetch), ws.ts, utils.ts

server/            Express + TypeScript
  index.ts         Routes, WebSocket, auth
  transport/
    interface.ts   Pluggable transport interface
    playwright.ts  Playwright transport (iframe, message scraping, follower scraper crawler)
    session-pool.ts Session pool with mutex locking
    api.ts         TikTok API transport stub (future)
  services/
    inbox-sync.ts  Background sync ticker and unread/read tracker
    account-manager.ts  Account CRUD and limit resets
    message-sender.ts   Send messages via transport
    proxy-manager.ts    Proxy CRUD + assignment
    campaign-service.ts Campaign management
    campaign-worker.ts  Outreach crawler agent scheduler (load-balanced rotating accounts)
    lead-service.ts     CRM lead matching and filtering
    lead-list-service.ts Lead CRM folder/list categorization
    template-renderer.ts Spin-tax parser and warm-up starter selector
    automation-service.ts Keyword triggers auto-responder
  utils/
    fingerprint.ts  Browser fingerprint randomization
    cooldown.ts     Exponential backoff
    supabase.ts     Supabase client
  migrations/      SQL schema files
```
