# C2 Messaging System Walkthrough

All core issues and Phase 2 feature requirements have been successfully implemented, compiled, and verified.

## Phase 2 Features Implemented

### 1. See Follow-backs & Followers
- **Scraper Transport**: Implemented `scrapeFollowers` in Playwright transport [playwright.ts](file:///c:/Users/ogt/c2/C2/server/transport/playwright.ts). It logs into TikTok, navigates to the account profile, opens the followers modal, scrolls down to load up to `limit` profiles, and detects mutual followers (friends).
- **Background Imports**: Created `POST /api/accounts/:id/scrape-followers` in [index.ts](file:///c:/Users/ogt/c2/C2/server/index.ts) to run scraping, import handles as leads (tagged as `scraped_follower` and `mutual_follower`), and optionally enroll them directly into a lead list.
- **Accounts UI Controls**: Added a "Scrape" button to connected accounts in [Accounts.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Accounts.tsx) which opens a modal to choose the scraper limits and destination list.

### 2. Folders & Lists (Organizing Leads)
- **Database Schema**: Created [008_features_expansion.sql](file:///c:/Users/ogt/c2/C2/server/migrations/008_features_expansion.sql) introducing `lead_lists` and `lead_list_members` tables.
- **Service Layer**: Created [lead-list-service.ts](file:///c:/Users/ogt/c2/C2/server/services/lead-list-service.ts) to manage CRUD list actions and lead list membership.
- **Filtering Logic**: Extended [lead-service.ts](file:///c:/Users/ogt/c2/C2/server/services/lead-service.ts) to allow filtering and paging leads by a specific `list_id`.
- **API Endpoints**: Registered CRUD routes in [index.ts](file:///c:/Users/ogt/c2/C2/server/index.ts):
  - `GET /api/lists` - fetch folders with lead counts.
  - `POST /api/lists` - create a new folder.
  - `DELETE /api/lists/:id` - delete a folder.
  - `POST /api/lists/:id/leads` - bulk add leads to a folder.
  - `POST /api/lists/:id/leads/delete` - bulk remove leads from a folder.
- **UI Integration**: Integrated a clean left sidebar in [Leads.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Leads.tsx) to browse custom folders, delete folders, and trigger bulk "Add to Folder" or "Remove from Folder" actions from the main table.

### 3. Click Users/Messages to Add to Folders
- **Leads page**: Select leads and click the bulk action toolbar **"Add to Folder"** button to choose the folder list.
- **Inbox thread view**: Added a **Folder** icon button in the header of the chat panel in [Unibox.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Unibox.tsx) to quickly enroll a conversation thread's sender as a lead and assign them to a folder on-demand.

### 4. Bulk Outreach & Auto-Rotating Sender Accounts
- **Campaign Rotation**: Modified [campaign-worker.ts](file:///c:/Users/ogt/c2/C2/server/services/campaign-worker.ts) and [campaign-service.ts](file:///c:/Users/ogt/c2/C2/server/services/campaign-service.ts) to allow campaigns to run without assigned accounts (defaults to auto-rotating across all connected accounts).
- **Load Balancing**: Sorted available accounts by daily message sent count ascending before round-robin distribution, ensuring message load is distributed equally to keep sending accounts at their lowest limits.

### 5. Daily DM Limit Tracking Progress Bars
- **Accounts UI Status Indicators**: Added inline visual progress bars for each account in [Accounts.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Accounts.tsx), color-coded based on limits reached (orange for warnings at 80%+, red for limit reached).

### 6. Unread/Read/Replied Inbox filtering
- **Conversation State Transitions**:
  - Synced conversations in [inbox-sync.ts](file:///c:/Users/ogt/c2/C2/server/services/inbox-sync.ts) transition to `'unread'` on new messages.
  - Manual or automation outbound replies in [message-sender.ts](file:///c:/Users/ogt/c2/C2/server/services/message-sender.ts) transition to `'replied'`.
  - Viewing conversations in [Unibox.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Unibox.tsx) automatically resets unread count and marks status as `'read'`.
- **Inbox UI Segmented Tabs**: Added `All`, `Unread`, and `Replied` filter tabs at the top of the conversation list pane in [Unibox.tsx](file:///c:/Users/ogt/c2/C2/frontend/src/pages/Unibox.tsx).

---

## Validation Results

- Both `server` and `frontend` source directories compile cleanly with no TypeScript compiler errors.
- Built the production frontend package via `npm run build` inside `frontend/` successfully.
