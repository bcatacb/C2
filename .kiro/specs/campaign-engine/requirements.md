# Requirements Document

## Introduction

The Campaign Engine enables automated outreach campaigns on the TokTik C2 platform. Users create multi-step drip campaigns that target leads based on filters, distribute sends across assigned TikTok accounts via round-robin, personalize messages with template variables, and automatically stop sequences when leads reply. The system provides full lifecycle management (draft → active → paused → completed → archived) with real-time progress tracking.

## Glossary

- **Campaign_Service**: The backend service module (`campaign-service.ts`) responsible for campaign CRUD, status transitions, lead enrollment, and statistics aggregation.
- **Campaign_Worker**: The background worker (`campaign-worker.ts`) that processes active campaigns on a configurable interval, sending messages and advancing leads through drip steps.
- **Template_Renderer**: The service module (`template-renderer.ts`) responsible for replacing `{{variable}}` placeholders in message templates with actual lead data.
- **Campaign_API**: The Express route handlers in `server/index.ts` that expose campaign operations as REST endpoints.
- **Campaigns_Page**: The React frontend page (`Campaigns.tsx`) for listing, creating, and managing campaigns.
- **Campaign**: A named outreach sequence with ordered steps, target filters, assigned accounts, and a daily send limit.
- **Campaign_Step**: A single message in a drip sequence, with a delay, template, and skip-if-replied flag.
- **Campaign_Lead**: A junction record tracking a specific lead's progress through a campaign.
- **Template_Variable**: A `{{name}}` placeholder in a message template that gets replaced with lead-specific data at send time.
- **Round_Robin**: A distribution strategy that cycles through available accounts sequentially to balance send load.

## Requirements

### Requirement 1: Campaign CRUD Operations

**User Story:** As an operator, I want to create, read, update, and delete campaigns, so that I can manage my outreach sequences.

#### Acceptance Criteria

1. WHEN an operator submits a valid campaign creation request, THE Campaign_Service SHALL create a new campaign with status 'draft' and return the created record.
2. WHEN an operator requests a campaign by ID, THE Campaign_Service SHALL return the campaign data including steps, target filters, and assigned account IDs.
3. WHEN an operator updates a campaign in 'draft' or 'paused' status, THE Campaign_Service SHALL apply the changes and return the updated record.
4. WHEN an operator attempts to update an 'active' campaign's steps or target filters, THE Campaign_Service SHALL reject the update with an error.
5. WHEN an operator deletes a campaign, THE Campaign_Service SHALL set its status to 'archived' and preserve campaign_lead records.
6. WHEN an operator requests the campaign list, THE Campaign_Service SHALL return all non-archived campaigns ordered by creation date descending.

### Requirement 2: Campaign Validation

**User Story:** As an operator, I want the system to validate campaign data, so that I cannot create malformed campaigns.

#### Acceptance Criteria

1. WHEN a campaign name is empty or exceeds 100 characters, THE Campaign_Service SHALL reject the request with a validation error.
2. WHEN campaign steps have non-sequential step_number values, THE Campaign_Service SHALL reject the request with a validation error.
3. WHEN a campaign step has an empty template, THE Campaign_Service SHALL reject the request with a validation error.
4. WHEN a campaign step has a negative delay_hours value, THE Campaign_Service SHALL reject the request with a validation error.
5. THE Campaign_Service SHALL default `daily_send_limit` to 100 and `skip_if_replied` to true when not provided.

### Requirement 3: Campaign Status Transitions

**User Story:** As an operator, I want to control campaign lifecycle through status transitions, so that I can activate, pause, and resume outreach.

#### Acceptance Criteria

1. WHEN an operator activates a draft campaign with at least one step and one assigned account, THE Campaign_Service SHALL transition the status to 'active'.
2. WHEN an operator attempts to activate a campaign with no steps defined, THE Campaign_Service SHALL reject with a 400 error indicating steps are required.
3. WHEN an operator attempts to activate a campaign with no assigned accounts, THE Campaign_Service SHALL reject with a 400 error indicating accounts are required.
4. WHEN an operator pauses an active campaign, THE Campaign_Service SHALL transition the status to 'paused' and the worker SHALL stop processing it.
5. WHEN an operator resumes a paused campaign, THE Campaign_Service SHALL transition the status back to 'active'.
6. WHEN an operator attempts an invalid status transition (e.g., draft→paused, completed→active), THE Campaign_Service SHALL reject with an error.
7. THE Campaign_Service SHALL only allow these transitions: draft→active, active→paused, paused→active, active→completed, any→archived.

### Requirement 4: Template Rendering

**User Story:** As an operator, I want to use personalization variables in message templates, so that outreach messages feel personal to each lead.

#### Acceptance Criteria

1. WHEN a template contains `{{username}}`, THE Template_Renderer SHALL replace it with the lead's username.
2. WHEN a template contains `{{display_name}}`, THE Template_Renderer SHALL replace it with the lead's display name.
3. WHEN a template contains an unknown variable placeholder, THE Template_Renderer SHALL leave the placeholder text unchanged in the output.
4. WHEN a known variable has an empty or null value, THE Template_Renderer SHALL leave the placeholder text unchanged.
5. THE Template_Renderer SHALL not modify any text in the template that is not part of a `{{variable}}` placeholder.
6. WHEN validating a template, THE Template_Renderer SHALL return `valid: false` with a list of unknown variable names if any placeholders reference variables outside the known set.
7. WHEN validating a template where all placeholders use known variables, THE Template_Renderer SHALL return `valid: true` with an empty unknownVariables list.

### Requirement 5: Campaign Worker Processing

**User Story:** As an operator, I want the system to automatically process active campaigns, so that leads receive messages without manual intervention.

#### Acceptance Criteria

1. THE Campaign_Worker SHALL run on a configurable interval (default 60 seconds) using setInterval.
2. WHEN the worker ticks, THE Campaign_Worker SHALL query all campaigns with status 'active' and process each one.
3. WHEN processing a campaign, THE Campaign_Worker SHALL find leads matching the campaign's target_filters that are not yet enrolled.
4. WHEN processing a campaign, THE Campaign_Worker SHALL find enrolled leads whose `next_send_at` is in the past.
5. WHEN distributing leads to accounts, THE Campaign_Worker SHALL use round-robin assignment across accounts with remaining daily capacity.
6. WHEN sending a message, THE Campaign_Worker SHALL insert a randomized delay between 60 and 300 seconds before each send.
7. WHEN a message is sent successfully, THE Campaign_Worker SHALL advance the lead's `current_step` and calculate `next_send_at` based on the next step's `delay_hours`.
8. WHEN all leads in a campaign have completed all steps or are in terminal status (replied, converted, skipped), THE Campaign_Worker SHALL transition the campaign to 'completed'.

### Requirement 6: Daily Send Limit Enforcement

**User Story:** As an operator, I want the system to respect daily send limits, so that accounts are not flagged for spam.

#### Acceptance Criteria

1. WHILE processing a campaign, THE Campaign_Worker SHALL never send more messages than the campaign's `daily_send_limit` in a single tick.
2. WHILE processing a campaign, THE Campaign_Worker SHALL never send messages through an account that has reached its per-account `daily_dm_limit`.
3. WHEN an account has zero remaining capacity, THE Campaign_Worker SHALL skip that account and distribute to others.
4. WHEN all assigned accounts have zero remaining capacity, THE Campaign_Worker SHALL stop processing that campaign for the current tick.

### Requirement 7: Reply Detection and Drip Stopping

**User Story:** As an operator, I want the drip sequence to stop automatically when a lead replies, so that I can have a real conversation.

#### Acceptance Criteria

1. WHEN an inbound message is received from a lead enrolled in an active campaign, THE Inbox_Sync service SHALL detect the match and notify the Campaign_Service.
2. WHEN a campaign lead is marked as replied, THE Campaign_Service SHALL set the campaign_lead status to 'replied' and clear `next_send_at`.
3. WHEN a campaign lead is marked as replied, THE Campaign_Service SHALL update the lead's status to 'replied' in the leads table.
4. WHEN the worker encounters a lead with status 'replied', THE Campaign_Worker SHALL not send any further messages to that lead.
5. WHEN a step has `skip_if_replied` set to true and the lead has replied, THE Campaign_Worker SHALL skip that step.

### Requirement 8: Account Capacity and Health

**User Story:** As an operator, I want the system to only send through healthy accounts, so that messages are delivered reliably.

#### Acceptance Criteria

1. WHEN calculating account capacity, THE Campaign_Worker SHALL compute remaining as `daily_dm_limit - dms_sent_today`.
2. WHEN an account is in cooldown, THE Campaign_Worker SHALL exclude it from the available accounts pool.
3. WHEN an account is disconnected, THE Campaign_Worker SHALL exclude it from the available accounts pool.
4. IF a message send fails due to a transport error, THEN THE Campaign_Worker SHALL log the error, not advance the lead's step, and leave `next_send_at` unchanged for retry on the next tick.

### Requirement 9: Round-Robin Distribution Fairness

**User Story:** As an operator, I want sends distributed evenly across accounts, so that no single account bears disproportionate load.

#### Acceptance Criteria

1. WHEN distributing leads across N accounts with equal remaining capacity and M leads (M >= N), THE Campaign_Worker SHALL assign leads such that the difference in assignments between any two accounts is at most 1.
2. WHEN an account's remaining capacity is exhausted during distribution, THE Campaign_Worker SHALL skip it and continue with the next account in rotation.

### Requirement 10: Campaign Statistics

**User Story:** As an operator, I want to see campaign progress statistics, so that I can monitor outreach effectiveness.

#### Acceptance Criteria

1. WHEN an operator requests campaign stats, THE Campaign_Service SHALL return counts for total_leads, pending, contacted, replied, converted, and skipped.
2. WHEN an operator requests campaign stats, THE Campaign_Service SHALL return per-step breakdown showing sent and pending counts for each step.
3. THE Campaign_API SHALL broadcast WebSocket events on campaign mutations (created, updated, activated, paused, lead-replied) for real-time UI updates.

### Requirement 11: Campaign API Endpoints

**User Story:** As a frontend developer, I want RESTful API endpoints for campaigns, so that the UI can manage campaigns.

#### Acceptance Criteria

1. THE Campaign_API SHALL expose GET `/api/campaigns` returning the list of campaigns.
2. THE Campaign_API SHALL expose GET `/api/campaigns/:id` returning a single campaign with stats.
3. THE Campaign_API SHALL expose POST `/api/campaigns` for creating a new campaign.
4. THE Campaign_API SHALL expose PUT `/api/campaigns/:id` for updating a campaign.
5. THE Campaign_API SHALL expose DELETE `/api/campaigns/:id` for archiving a campaign.
6. THE Campaign_API SHALL expose POST `/api/campaigns/:id/activate` for activating a campaign.
7. THE Campaign_API SHALL expose POST `/api/campaigns/:id/pause` for pausing a campaign.
8. THE Campaign_API SHALL expose POST `/api/campaigns/:id/resume` for resuming a campaign.
9. THE Campaign_API SHALL expose GET `/api/campaigns/:id/leads` returning paginated campaign leads with progress.

### Requirement 12: Database Schema

**User Story:** As a developer, I want a well-structured database schema, so that campaign data is stored reliably with proper relationships.

#### Acceptance Criteria

1. THE migration SHALL create a `campaigns` table with columns: id (uuid PK), name (text), status (text), steps (jsonb), target_filters (jsonb), assigned_account_ids (text[]), daily_send_limit (integer), created_at, updated_at.
2. THE migration SHALL create a `campaign_leads` table with columns: id (uuid PK), campaign_id (FK), lead_id (FK), account_id (FK nullable), current_step (integer), status (text), last_sent_at (timestamptz nullable), next_send_at (timestamptz nullable), created_at.
3. THE migration SHALL create an index on `campaign_leads.next_send_at` for efficient worker queries.
4. THE migration SHALL create a unique constraint on `campaign_leads(campaign_id, lead_id)` to prevent duplicate enrollment.

### Requirement 13: Frontend Campaigns Page

**User Story:** As an operator, I want a Campaigns page in the UI, so that I can visually manage my outreach campaigns.

#### Acceptance Criteria

1. THE Campaigns_Page SHALL display a list of campaigns with name, status badge, and summary stats (total leads, replied count).
2. THE Campaigns_Page SHALL provide a form to create and edit campaigns with a step builder for defining drip sequences.
3. THE Campaigns_Page SHALL provide activate, pause, and resume buttons that call the corresponding API endpoints.
4. THE Campaigns_Page SHALL display campaign detail view showing lead progress and per-step statistics.
5. THE Sidebar SHALL include a "Campaigns" navigation item between "Leads" and "Settings" using the `Megaphone` icon from lucide-react.

### Requirement 14: Do-Not-Contact Exclusion

**User Story:** As an operator, I want leads marked as 'do_not_contact' to be excluded from campaigns, so that I respect opt-out preferences.

#### Acceptance Criteria

1. WHEN enrolling leads into a campaign, THE Campaign_Worker SHALL exclude leads with status 'do_not_contact'.
2. WHEN a lead's status changes to 'do_not_contact' after enrollment, THE Campaign_Worker SHALL skip that lead on subsequent ticks and mark the campaign_lead as 'skipped'.
