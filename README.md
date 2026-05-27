# TokTik C2 — Unified Messaging Orchestrator

Unified inbox for managing DMs across multiple TikTok profiles. Phase 1 uses Playwright browser automation as the transport layer (TikTok Business Messaging API is unavailable for US accounts).

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

Execute the SQL files in `server/migrations/` against your Supabase project in order:
- `001_accounts_proxies.sql`
- `002_conversations_messages.sql`
- `003_indexes.sql`

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

1. Go to **Accounts** page → **Add Account** → enter the TikTok username
2. Click **Connect** — this opens a headless Playwright browser to TikTok's login page
3. Complete login + 2FA on TikTok (the browser session is pinned so it won't timeout)
4. Click **Save Session** — cookies are saved to the database
5. The account will now sync DMs automatically every 30 seconds

## How It Works

### Architecture
```
React Frontend (Vite + Tailwind)
  ↕ REST + WebSocket (proxied via Vite)
Express Backend (TypeScript)
  ├── Account Manager (CRUD, health, cooldown)
  ├── Inbox Sync (30s ticker, conversation list scraping)
  └── Transport Layer (pluggable)
       └── Playwright Transport
            ├── Session Pool (max 5 browsers, mutex locking)
            ├── Cookie Banner Dismissal
            └── TikTok Business Suite iframe targeting
  ↕
Supabase (PostgreSQL)
```

### Sync Flow
- Every 30s, the sync ticker rotates through connected accounts
- For each account: acquires a Playwright session, navigates to TikTok DMs, finds the Business Suite iframe, scrapes the conversation list
- Conversations are upserted to the database with display names, avatars, last message preview, and unread counts
- Messages are fetched **on-demand** when you click a conversation in the inbox (not during automated sync — too fragile with TikTok's iframe lifecycle)

### Key Technical Details
- TikTok Business Suite renders messages inside an **iframe** (`/messages?scene=business`), not the main frame
- A `tiktok-cookie-banner` web component overlays the page and blocks all clicks — it's removed from the DOM before any interaction
- Session pool uses per-session mutex locking to prevent sync and on-demand fetch from using the same browser simultaneously
- Sessions are pinned during manual login to prevent the idle reaper from closing the browser during 2FA

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
| `DEFAULT_USER` | `admin` | Login username |
| `DEFAULT_PASS` | `admin` | Login password |

## Project Structure

```
frontend/          React + Vite + Tailwind
  src/
    pages/         Accounts, Unibox (inbox), Settings, Login
    components/    AppLayout, Sidebar, RequireAuth
    lib/           api.ts (auth-aware fetch), ws.ts, utils.ts

server/            Express + TypeScript
  index.ts         Routes, WebSocket, auth
  transport/
    interface.ts   Pluggable transport interface
    playwright.ts  Playwright transport (iframe targeting, cookie banner, message scraping)
    session-pool.ts Session pool with mutex locking
    api.ts         TikTok API transport stub (future)
  services/
    inbox-sync.ts  Background sync ticker
    account-manager.ts  Account CRUD
    message-sender.ts   Send messages via transport
    proxy-manager.ts    Proxy CRUD + assignment
  utils/
    fingerprint.ts  Browser fingerprint randomization
    cooldown.ts     Exponential backoff
    supabase.ts     Supabase client
  migrations/      SQL schema files
```
