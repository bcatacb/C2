# TokTik C2 — Setup & Installation Guide

## Prerequisites

- **Node.js** v20 or newer — https://nodejs.org
- **Supabase account** (free tier works) — https://supabase.com
- **Proxies** (optional for testing, required for production) — residential or mobile proxies recommended

---

## Step 1: Create the Database

1. Go to https://supabase.com and sign in
2. Click **New Project** — name it `toktik-c2`, set a database password, pick a region
3. Wait for provisioning (~2 minutes)
4. Go to **SQL Editor** in the left sidebar
5. Click **New Query** and execute all migration scripts found in the [server/migrations/](file:///c:/Users/ogt/c2/C2/server/migrations/) directory in sequential order:
   * **`001_accounts_proxies.sql`**: Configures proxies and TikTok account tables with health status and daily limits.
   * **`002_conversations_messages.sql`**: Configures conversations and messages tables with indexes.
   * **`003_leads.sql`**: Configures the leads table for CRM targeting.
   * **`004_campaigns.sql`**: Configures campaigns, steps, templates, and campaign lead records.
   * **`005_crm_pipeline.sql`**: Configures CRM pipeline stages and lead status transitions.
   * **`006_sync_enabled.sql`**: Adds a sync enabled flag to TikTok accounts.
   * **`007_automation.sql`**: Configures incoming keyword trigger automation rules.
   * **`008_features_expansion.sql`**: Configures lead folders/lists, member mapping, and inbox conversation filters.

Make sure to run these migrations in order. All tables and constraints should be created.

---


## Step 2: Get Your Supabase Credentials

1. In the Supabase dashboard, go to **Project Settings** (gear icon, bottom-left)
2. Click **API**
3. Copy:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **service_role key** — click "Reveal" on the second key under "Project API keys"

---

## Step 3: Install Dependencies

### Windows (CMD)

```
cd C:\path\to\toktikc2

cd server
npm install
npx playwright install chromium
cd ..

cd frontend
npm install
cd ..
```

### Linux / macOS

```
cd /path/to/toktikc2

cd server && npm install && npx playwright install chromium && cd ..
cd frontend && npm install && cd ..
```

---

## Step 4: Configure Environment

### Windows (CMD)

Create the `.env` file in the `server` folder:

```
cd server
echo SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co> .env
echo SUPABASE_KEY=your-service-role-key-here>> .env
echo PORT=4000>> .env
echo ENABLE_INBOX_SYNC=false>> .env
echo ENABLE_CAMPAIGN_WORKER=true>> .env
echo DEFAULT_USER=admin>> .env
echo DEFAULT_PASS=admin>> .env
```

Replace `YOUR-PROJECT-ID` and `your-service-role-key-here` with your actual values from Step 2.

### Linux / macOS

```
cd server
cp ../.env.example .env
```

Then edit `.env` with your Supabase credentials.

### Full Configuration Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | — | Your Supabase project URL (required) |
| `SUPABASE_KEY` | — | Supabase service_role key (required) |
| `PORT` | 4000 | Backend server port |
| `MAX_CONCURRENT_BROWSERS` | 5 | How many Playwright browsers run at once |
| `BROWSER_IDLE_TIMEOUT_MS` | 60000 | Close idle browsers after 60s |
| `INBOX_SYNC_INTERVAL_MS` | 30000 | Background sync every 30s |
| `HEADED_MODE` | false | Set to true to see browser windows (debugging) |
| `ENABLE_INBOX_SYNC` | false | Set to true to start syncing DMs on boot |
| `ENABLE_CAMPAIGN_WORKER` | false | Set to true to enable automated campaign workers on boot |
| `DEFAULT_USER` | admin | Login username |
| `DEFAULT_PASS` | admin | Login password |


---

## Step 5: Start the Backend

### Windows (CMD)

```
cd server
npx tsx index.ts
```

### Linux / macOS

```
cd server && npm run dev
```

You should see:

```
[server] listening on :4000
```

---

## Step 6: Start the Frontend

Open a **second terminal window**:

### Windows (CMD)

```
cd frontend
npx vite
```

### Linux / macOS

```
cd frontend && npm run dev
```

You should see:

```
VITE v8.x.x  ready

  Local:   http://localhost:5173/
```

---

## Step 7: Log In

1. Open **http://localhost:5173** in your browser
2. Username: `admin`
3. Password: `admin`

You should see the TokTik C2 dashboard with three sidebar tabs: Inbox, Accounts, Settings.

---

## Step 8: Verify Everything Works

| Check | How | Expected |
|-------|-----|----------|
| Backend alive | Visit http://localhost:4000/api/health | JSON with `"status": "ok"` |
| Database connected | Go to Accounts page, click "Add Account", enter a test username | Account appears in the list |
| Frontend routing | Click Inbox, Accounts, Settings in sidebar | Each page loads without errors |
| Settings health | Go to Settings page | Shows system status, uptime, browser pool stats |

---

## Adding TikTok Accounts

### Via the UI

1. Go to the **Accounts** page
2. Click **Add Account**
3. Enter the TikTok username (without the @)
4. Set the daily DM limit
5. Optionally assign a proxy (add proxies first via **Settings**)

### Bulk Import via CSV

Create a CSV file with columns: `username,display_name,transport_type,daily_dm_limit`

```
username,display_name,transport_type,daily_dm_limit
brand_account_1,Brand One,playwright,50
brand_account_2,Brand Two,playwright,30
```

Run from the server directory:

```
npx tsx ../scripts/seed-accounts.ts path/to/accounts.csv
```

---

## Adding Proxies

1. Go to **Settings**
2. Click **Add Proxy**
3. Enter: host, port, username (optional), password (optional), type, country
4. After adding, go to **Accounts** and edit each account to assign its proxy

Each account should have its own dedicated proxy. Sharing proxies across accounts increases detection risk.

---

## Enabling Live Inbox Sync

Once accounts and proxies are configured:

1. Stop the backend (Ctrl+C)
2. Update `.env`:
   ```
   ENABLE_INBOX_SYNC=true
   ```
3. Restart the backend:
   ```
   npx tsx index.ts
   ```

The sync ticker will begin rotating through connected accounts every 30 seconds, pulling new DMs and pushing them to the inbox in real-time.

---

## Docker Deployment

For production deployment with Docker:

```
docker compose up -d
```

Requires a `.env` file in the project root. The backend container includes Chromium for Playwright. Frontend is served as a static build on port 5173, backend on port 4000.

---

## Static Web Hosting Deployment

C2's frontend can be hosted independently of the backend as a static webpage on Vercel, Netlify, or GitHub Pages:

1. Build the frontend locally:
   ```bash
   cd frontend
   npm run build
   ```
2. Upload/deploy the output `frontend/dist/` directory to Vercel, Netlify, or AWS S3.
3. Open the hosted URL in your browser. On the Login screen, enter your remote C2 Backend Server URL (e.g. `http://12.34.56.78:4000`).
4. Sign in with your credentials. The frontend will dynamically query your remote C2 backend.

---

## Remote Headless Account Connection

When running C2 on a remote VPS without a graphical environment, use the `remote-login.js` utility to connect accounts:

1. Copy `server/scripts/remote-login.js` to your local computer.
2. Run `npm install playwright` locally.
3. Execute the script:
   ```bash
   node remote-login.js <YOUR_REMOTE_C2_URL> <ACCOUNT_ID>
   ```
4. Log in to TikTok in the browser window that opens. The script will automatically capture and upload the session state to your remote C2 server, setting the status to "connected".

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Missing SUPABASE_URL or SUPABASE_KEY` | Make sure `.env` is in the `server` directory and contains both values. Make sure `import 'dotenv/config'` is the first line of `server/utils/supabase.ts` |
| Login fails silently | Check the browser console for errors. Verify the backend is running on port 4000 |
| `ECONNREFUSED` on frontend | The backend isn't running. Start it first with `npx tsx index.ts` in the server directory |
| Playwright browser fails to launch | Run `npx playwright install chromium` in the server directory |
| Accounts stuck as "disconnected" | The account needs a valid TikTok session. Log in manually via headed mode (`HEADED_MODE=true`) or use the `remote-login.js` script to capture cookies |
| Rate limit / cooldown | The account entered exponential backoff. Wait for `cooldown_until` to expire, or reset it in Supabase |

