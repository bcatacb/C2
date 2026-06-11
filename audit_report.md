# C2 System Audit — Full Troubleshooting Report

## ✅ What's Working

| Check | Status | Detail |
|---|---|---|
| Server startup | ✅ OK | Running on port 4000 |
| Supabase connection | ✅ OK | Accounts, conversations, and messages all returned correctly |
| Playwright / Chromium | ✅ OK | 1 active browser session detected (`deadbread101`) |
| Frontend dev server | ✅ OK | Running on port 5173, proxying `/api` and `/ws` to port 4000 |
| Inbox sync | ✅ Running | `inbox_sync: true` in controls |
| Campaign worker | ✅ Running | `campaign_worker: true` in controls |
| TikTok accounts | ✅ 2 accounts | `deadbread101` (active sync), `parfenov.fm510` (sync disabled) |
| Conversations syncing | ✅ Working | 2 conversations pulled from `deadbread101` |

---

## 🐛 Bugs & Issues Found

### 1. `last_message_text` is corrupted with timestamp appended
**Location:** [`server/transport/playwright.ts`](file:///c:/Users/ogt/c2/C2/server/transport/playwright.ts)

The conversation scraper picks up the message preview from the `[class*="InfoExtract"]` element. Looking at the synced data:
```
last_message_text: "Youo21:37"
last_message_text: "ogtommyp: Yo21:38"
```
The timestamp from the `[class*="InfoTime"]` element is being concatenated into the message text. The DOM structure likely places them in a shared container. The `lastMessageAt` is stored separately but the text itself is dirty.

**Fix needed:** Parse the InfoExtract text separately from InfoTime, and strip any time-like suffix.

---

### 2. `last_message_direction` is always `null`
**Location:** [`server/transport/playwright.ts` line 136](file:///c:/Users/ogt/c2/C2/server/transport/playwright.ts#L136)

In `fetchConversations`, `lastMessageDirection` is hardcoded to `null`. The Playwright scraper never determines if the last message was inbound or outbound. This means the Unibox UI can't show directional indicators correctly.

---

### 3. `parfenov.fm510` account has `sync_enabled: false`
**Location:** Supabase DB / `server/services/account-manager.ts`

The account `parfenov.fm510` will never be synced because `sync_enabled = false`. This is probably intentional if that account's session is stale, but worth knowing.

---

### 4. `dms_sent_today` is never reset automatically
**Location:** [`server/services/account-manager.ts` line 82](file:///c:/Users/ogt/c2/C2/server/services/account-manager.ts#L82-L90)

`resetDailyCounts()` is defined but **never called** anywhere in the codebase — not on a timer, not in `index.ts`, not in the campaign worker. This means `dms_sent_today` will grow indefinitely and eventually block the campaign worker from sending any messages.

**Fix needed:** Call `resetDailyCounts()` on a daily interval in `index.ts`.

---

### 5. Campaign worker enabled but `ENABLE_CAMPAIGN_WORKER` env var is missing from `.env`
**Location:** [`server/.env`](file:///c:/Users/ogt/c2/C2/server/.env) / [`server/index.ts` line 655](file:///c:/Users/ogt/c2/C2/server/index.ts#L655)

```
let campaignWorkerRunning = process.env.ENABLE_CAMPAIGN_WORKER === 'true'
```
Your `.env` does **not** have `ENABLE_CAMPAIGN_WORKER=true`, but `/api/controls` reports `campaign_worker: true`. This means the worker was enabled via the runtime toggle API (POST `/api/controls/campaign-worker`) after startup — but on server restart it will default to **off** again. Add it to `.env` to persist it:
```
ENABLE_CAMPAIGN_WORKER=true
```

---

### 6. Potential: `sendMessage` focuses keyboard on page, not iframe
**Location:** [`server/transport/playwright.ts` lines 329-334](file:///c:/Users/ogt/c2/C2/server/transport/playwright.ts#L329-L334)

```typescript
await frame.waitForSelector(inputSelector, { timeout: 10_000 })
for (const char of body) {
  await page.keyboard.type(char, ...)  // typing on PAGE, not frame
}
await page.keyboard.press('Enter')
```
The `waitForSelector` finds the input inside the **iframe frame**, but `page.keyboard.type()` sends keystrokes to the top-level **page** — not the iframe. This can cause messages to fail silently or type into the wrong element.

**Fix needed:** Use `frame.locator(inputSelector).click()` to focus the element, then type via `page.keyboard`.

---

### 7. Auth middleware is missing on most API routes
**Location:** [`server/index.ts`](file:///c:/Users/ogt/c2/C2/server/index.ts)

The `/api/auth/me` endpoint validates the Bearer token, but virtually **every other API route** (`/api/accounts`, `/api/conversations`, `/api/campaigns`, etc.) has **no auth check** at all. Anyone who can reach port 4000 can read/write all data.

---

## 🔧 Priority Fix Recommendations

| Priority | Issue | Effort |
|---|---|---|
| 🔴 High | `dms_sent_today` never resets (blocks campaigns) | Small — add one `setInterval` call |
| 🔴 High | `ENABLE_CAMPAIGN_WORKER` not in `.env` (resets to off on restart) | Trivial |
| 🟡 Medium | `sendMessage` types on page instead of iframe | Small fix |
| 🟡 Medium | `last_message_text` has timestamp appended | Medium — tweak DOM scraping |
| 🟢 Low | `last_message_direction` always null | Medium |
| 🟢 Low | No auth on API routes | Large |

---

## 📋 Next Steps

Would you like me to fix any of these? I recommend starting with:
1. **Fix #4** (daily DM reset) — without this, campaigns will silently stop working
2. **Fix #5** (add `ENABLE_CAMPAIGN_WORKER=true` to `.env`)
3. **Fix #6** (sendMessage iframe keyboard focus)
