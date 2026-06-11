# Proposed Features Plan — Scrapers, Campaign Folders, Account Rotator, and Unibox Filters

This document outlines the design and implementation plan for the requested C2 feature enhancements.

---

## User Review Required

> [!IMPORTANT]
> **Scraping Rate Limits**: Scraping followers and following lists via Playwright is a high-risk activity on TikTok. We must implement strict delays (e.g., 3-5 seconds per scroll) and random human-like behavior to prevent accounts from getting flagged or restricted during scrapes.

> [!NOTE]
> **Lead Lists vs Database Tags**: To allow adding users or conversations to "folders", we propose creating a `lead_lists` table. This provides a clean interface where leads can be organized into arbitrary custom lists (e.g., "Warm Leads", "Follow-backs", "Wave Target List") and selected for targeted campaigns.

---

## Proposed Changes

### 1. Database Schema Migrations
We will create a new migration SQL file `004_features_expansion.sql` to add the following tables and fields:

```sql
-- Create Lead Lists / Folders
CREATE TABLE lead_lists (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- Join table for Leads and Lists
CREATE TABLE lead_list_members (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id     uuid NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(list_id, lead_id)
);

-- Add read/replied state and tracking to Conversations
ALTER TABLE conversations 
  ADD COLUMN is_read boolean DEFAULT true,
  ADD COLUMN status text DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied'));

-- Indexing for fast Unibox filtering
CREATE INDEX idx_conversations_status ON conversations(account_id, status);
```

---

### 2. Follower & Follow-back Scraper
* **Playwright Scraper Service** (`server/services/scraper-service.ts`):
  * A new Playwright method `scrapeFollowers(accountId, limit)` that navigates to the account's profile, clicks the "Followers" or "Following" tabs, and scrolls down the modal to capture usernames.
  * Filters for Mutual Followers (users who follow us back).
  * Automatically registers them as **Leads** in the database with a tag like `mutual_follower` or `scraped_follower`.
* **API Route** (`server/index.ts`):
  * `POST /api/accounts/:id/scrape-followers`: Triggers the background scraping job for a specific profile.

---

### 3. Folder/Campaign List Management
* **Folders API** (`server/index.ts`):
  * `GET/POST/DELETE /api/lists`: Manage custom lead lists.
  * `POST /api/lists/:id/leads`: Add leads in bulk to a specific list.
* **Unibox Integration** (`frontend/src/pages/Unibox.tsx`):
  * In the message thread pane, add a dropdown button: **"Add to List/Folder"** or **"Enroll in Campaign"**. Clicking this opens a modal to select a list/campaign.

---

### 4. Wave 👋 & Warm-up Campaign Workflows
* **Wave Campaigns**:
  * Implement an option in Campaign Creation to mark a step as a **"Wave (Ice-breaker)"**. When processed, the campaign worker executes a fast, low-footprint send (e.g. sending a single emoji or simple text starter).
* **Warm-up Campaigns**:
  * A dedicated campaign type designed to message high-reply-rate test accounts. 
  * Selects templates from a randomized conversational starter pool to prompt quick responses, raising the sending profile's trust score with TikTok.

---

### 5. Auto-Rotating Accounts & Daily Limit Tracker
* **Round-Robin Rotator Service** (`server/services/message-rotator.ts`):
  * Extracts all currently connected and non-cooldown accounts.
  * Dispatches outgoing messages (such as bulk campaign outreach or manual broadcasts) across these accounts in a round-robin sequence.
  * Enforces individual daily caps to ensure no single account exceeds its safety thresholds.
* **Daily Tracker UI Component** (`frontend/src/pages/Accounts.tsx` & `Settings.tsx`):
  * Displays a progress bar widget for each account showing: `[Messages Sent Today] / [Daily limit] (e.g. 18 / 50 DMs)`.
  * Warns the operator in orange/red if an account is approaching its limit.

---

### 6. Unibox Folders (Unread, Read, Replied)
* **Status Updates**:
  * Set status to `unread` when a new inbound message is synced.
  * Set status to `read` when the operator clicks/opens the conversation in the Unibox.
  * Set status to `replied` when the operator sends a manual message or the automation triggers an auto-reply.
* **Unibox Filter Tabs** (`frontend/src/pages/Unibox.tsx`):
  * Replaces the simple list with segmented filter tabs at the top of the conversation list: **"All"**, **"Unread"**, **"Replied"**, **"Archived"**.

---

## Verification Plan

### Automated Tests
* Run unit tests on the Scraper Service to verify modal scrolling and mutual follower detection.
* Execute `npm run build` in the `frontend/` directory to ensure type safety.

### Manual Verification
1. **Scraper Test**: Trigger a follower scrape on a test account. Confirm that followers are successfully imported into the `leads` table with appropriate tags.
2. **List Test**: Select multiple leads, assign them to a new custom folder ("High Intent"), and verify they appear in the folder list.
3. **Unibox Folders**: Send an inbound message to a profile, verify it appears in the **"Unread"** tab. Click it, verify it moves to the **"All"** tab. Send a reply, verify it moves to the **"Replied"** tab.
4. **Rotator Test**: Trigger a campaign with 3 assigned accounts and verify that outreach DMs are distributed equally among them (e.g. Msg 1 from Acct A, Msg 2 from Acct B, Msg 3 from Acct C).
