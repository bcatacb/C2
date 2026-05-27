# Implementation Plan: Campaign Engine

## Overview

Implement the Campaign Engine as Phase 3 of TokTik C2. The implementation follows the existing patterns: Supabase migration for schema, Express service modules for business logic, REST routes in `server/index.ts`, a background worker using `setInterval`, and a React page for the frontend. TypeScript throughout.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1 - Database, Template Renderer & Campaign Service",
      "tasks": ["1", "2"]
    },
    {
      "name": "Wave 2 - Campaign Worker & Reply Detection",
      "tasks": ["3", "4", "5"]
    },
    {
      "name": "Wave 3 - API Routes & Frontend",
      "tasks": ["6", "7"]
    },
    {
      "name": "Wave 4 - Final Verification",
      "tasks": ["8"]
    }
  ]
}
```

## Tasks

- [x] 1. Create database migration and template renderer
  - [x] 1.1 Create `server/migrations/004_campaigns.sql` with campaigns and campaign_leads tables
    - campaigns table: id (uuid PK default gen_random_uuid()), name (text not null), status (text not null default 'draft'), steps (jsonb default '[]'), target_filters (jsonb default '{}'), assigned_account_ids (text[] default '{}'), daily_send_limit (integer default 100), created_at (timestamptz default now()), updated_at (timestamptz default now())
    - campaign_leads table: id (uuid PK default gen_random_uuid()), campaign_id (uuid FK references campaigns on delete cascade), lead_id (uuid FK references leads on delete cascade), account_id (uuid FK references tiktok_accounts nullable), current_step (integer default 0), status (text default 'pending'), last_sent_at (timestamptz nullable), next_send_at (timestamptz nullable), created_at (timestamptz default now())
    - Index on campaign_leads(next_send_at) for worker queries
    - Unique constraint on campaign_leads(campaign_id, lead_id)
    - Index on campaign_leads(campaign_id, status) for stats queries
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 1.2 Create `server/services/template-renderer.ts`
    - Export `renderTemplate(template: string, variables: TemplateVariables): string` — replaces `{{username}}` and `{{display_name}}` placeholders, leaves unknown/empty variables unchanged
    - Export `validateTemplate(template: string): TemplateValidationResult` — returns valid:false with unknownVariables list if any placeholder is not in known set
    - Export `getAvailableVariables(): string[]` — returns ['username', 'display_name']
    - Export types: TemplateVariables, TemplateValidationResult
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 1.3 Write property tests for template renderer
    - **Property 1: Template rendering preserves non-variable text**
    - **Property 2: Template rendering idempotence for resolved variables**
    - **Property 3: Template validation detects all unknown variables**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7**

- [x] 2. Implement campaign service
  - [x] 2.1 Create `server/services/campaign-service.ts` with campaign CRUD
    - Export types: Campaign, CampaignStatus, CampaignStep, CampaignLead, CampaignLeadStatus, CampaignStats, StepStats, CreateCampaignInput, UpdateCampaignInput, CampaignLeadFilters, CampaignWithStats
    - Implement `createCampaign(input)` — validates name (non-empty, <=100 chars), validates steps if provided (sequential step_number, non-empty template, delay_hours >= 0), creates with status 'draft'
    - Implement `getCampaign(id)`, `listCampaigns()` (non-archived, ordered by created_at desc)
    - Implement `updateCampaign(id, fields)` — rejects updates to steps/target_filters on active campaigns
    - Implement `deleteCampaign(id)` — sets status to 'archived'
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Implement campaign status transitions in campaign-service.ts
    - Implement `activateCampaign(id)` — validates at least 1 step and 1 assigned account, transitions draft→active
    - Implement `pauseCampaign(id)` — transitions active→paused
    - Implement `resumeCampaign(id)` — transitions paused→active
    - Internal helper for valid transitions: draft→active, active→paused, paused→active, active→completed, any→archived
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 2.3 Write property test for campaign status transitions
    - **Property 6: Campaign status transitions are valid**
    - **Validates: Requirements 3.6, 3.7**

  - [x] 2.4 Implement campaign leads and stats in campaign-service.ts
    - Implement `getCampaignLeads(campaignId, filters)` — paginated query with status filter
    - Implement `getCampaignWithStats(id)` — returns campaign with aggregated stats
    - Implement `getStats(campaignId)` — returns total_leads, pending, contacted, replied, converted, skipped, and by_step breakdown
    - Implement `markLeadReplied(campaignLeadId)` — sets campaign_lead status to 'replied', clears next_send_at, updates lead status
    - _Requirements: 7.2, 7.3, 10.1, 10.2_

- [x] 3. Implement campaign worker
  - [x] 3.1 Create `server/services/campaign-worker.ts`
    - Export `startCampaignWorker()` and `stopCampaignWorker()` following inbox-sync.ts pattern
    - Implement `tick()` — fetches active campaigns, calls processCampaign for each
    - Implement `processCampaign(campaign)` — finds uncontacted leads matching target_filters, finds leads due for next step, gets account capacities, distributes via round-robin, renders templates, sends messages with randomized delay, advances lead progress
    - Implement `getAccountCapacities(accountIds)` — returns remaining = max(0, daily_dm_limit - dms_sent_today) for connected, non-cooldown accounts
    - Implement `randomDelay(minMs, maxMs)` — returns random integer in [minMs, maxMs]
    - Implement campaign completion detection — marks campaign 'completed' when all leads are terminal
    - Handle transport errors: log error, don't advance step, leave next_send_at for retry
    - Check lead status before each send: skip 'do_not_contact' leads, skip 'replied' leads
    - Default interval: 60s via CAMPAIGN_WORKER_INTERVAL_MS env var
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 14.1, 14.2_

  - [ ]* 3.2 Write property test for randomized delay bounds
    - **Property 4: Randomized delay is within bounds**
    - **Validates: Requirements 5.6**

  - [ ]* 3.3 Write property test for round-robin distribution fairness
    - **Property 5: Round-robin distribution fairness**
    - **Validates: Requirements 9.1**

  - [ ]* 3.4 Write property tests for worker invariants
    - **Property 7: Daily send limit is never exceeded**
    - **Property 8: Replied leads are never advanced**
    - **Property 9: Do-not-contact leads are never enrolled or messaged**
    - **Property 10: Per-account daily limit is never exceeded**
    - **Validates: Requirements 6.1, 6.2, 7.4, 7.5, 14.1, 14.2**

- [x] 4. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add reply detection hook in inbox-sync
  - [x] 5.1 Modify `server/services/inbox-sync.ts` to detect campaign replies
    - After upserting an inbound message, query campaign_leads for the lead (by peer_username → leads.username → campaign_leads.lead_id) where campaign status is 'active' and campaign_lead status is 'pending' or 'contacted'
    - If match found, call `markLeadReplied(campaignLeadId)` from campaign-service
    - Broadcast 'campaign:lead-replied' WebSocket event
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 6. Add campaign API routes
  - [x] 6.1 Add campaign routes to `server/index.ts`
    - GET /api/campaigns — listCampaigns()
    - GET /api/campaigns/:id — getCampaignWithStats(id)
    - POST /api/campaigns — createCampaign(req.body), broadcast 'campaign:created'
    - PUT /api/campaigns/:id — updateCampaign(id, req.body), broadcast 'campaign:updated'
    - DELETE /api/campaigns/:id — deleteCampaign(id), broadcast 'campaign:deleted'
    - POST /api/campaigns/:id/activate — activateCampaign(id), broadcast 'campaign:activated'
    - POST /api/campaigns/:id/pause — pauseCampaign(id), broadcast 'campaign:paused'
    - POST /api/campaigns/:id/resume — resumeCampaign(id), broadcast 'campaign:resumed'
    - GET /api/campaigns/:id/leads — getCampaignLeads(id, query params)
    - Import and call startCampaignWorker() at server startup (similar to startInboxSync)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 10.3_

- [x] 7. Implement frontend Campaigns page
  - [x] 7.1 Create `frontend/src/pages/Campaigns.tsx`
    - Campaign list view with name, status badge (color-coded), total leads count, replied count
    - Create campaign form: name input, step builder (add/remove steps with template textarea, delay_hours input, skip_if_replied toggle), target filters (status multi-select, tags input), account multi-select, daily_send_limit input
    - Campaign detail view: progress bar, stats cards (pending/contacted/replied/converted/skipped), per-step breakdown table
    - Activate/Pause/Resume buttons with confirmation
    - Template variable helper showing available {{username}} and {{display_name}} variables
    - WebSocket subscription for real-time updates (campaign:created, campaign:updated, campaign:activated, campaign:paused, campaign:lead-replied)
    - Follow existing patterns from Leads.tsx (same styling, layout, state management approach)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 7.2 Add Campaigns route and sidebar navigation
    - Add route in `frontend/src/App.tsx`: `<Route path="campaigns" element={<Campaigns />} />`
    - Add "Campaigns" nav item in `frontend/src/components/Sidebar.tsx` between "Leads" and "Settings" using `Megaphone` icon from lucide-react
    - _Requirements: 13.5_

- [x] 8. Final checkpoint - Ensure all tests pass and integration works
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The worker follows the same `setInterval` pattern as `inbox-sync.ts`
- No new npm dependencies needed — uses existing fast-check (if installed) or can add for property tests
- Reply detection hooks into the existing inbox-sync flow
- Campaign deletion is soft-delete (sets status to 'archived')
