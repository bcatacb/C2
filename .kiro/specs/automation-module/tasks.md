# Implementation Plan: Automation Module

## Overview

Implement the Automation Module (Phase 5) for TokTik C2. This adds a rule engine that evaluates inbound messages against configurable automation rules and executes actions (auto-reply, move to stage, add label, assign account, notify). Implementation uses TypeScript throughout, integrates with existing services, and requires no new npm dependencies.

## Tasks

- [x] 1. Database migration and core types
  - [x] 1.1 Create migration file `server/migrations/007_automation.sql`
    - Create `automation_rules` table with columns: id (uuid PK), name (text NOT NULL), enabled (boolean DEFAULT true), trigger (jsonb NOT NULL), conditions (jsonb DEFAULT '{}'), actions (jsonb NOT NULL), priority (integer NOT NULL), created_at (timestamptz DEFAULT now()), updated_at (timestamptz DEFAULT now())
    - Create `automation_log` table with columns: id (uuid PK), rule_id (uuid FK → automation_rules ON DELETE SET NULL), conversation_id (uuid FK → conversations ON DELETE CASCADE), trigger_type (text NOT NULL), actions_taken (jsonb NOT NULL), created_at (timestamptz DEFAULT now())
    - Add index on automation_log(created_at DESC) for pagination
    - Add index on automation_rules(priority ASC, enabled) for evaluation queries
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 2. Implement automation engine service
  - [x] 2.1 Create `server/services/automation-engine.ts` with types and validation
    - Define all TypeScript interfaces: AutomationTrigger, AutomationConditions, AutomationAction, AutomationRule, AutomationLogEntry, ExecutionResult, InboundMessageContext, CreateRuleInput, UpdateRuleInput
    - Implement `validateRule()` function that checks: name non-empty and ≤100 chars, trigger type is valid, keyword triggers have ≥1 non-empty keyword, actions array is non-empty with valid type-specific fields
    - _Requirements: 6.5, 6.6, 6.7_

  - [x] 2.2 Implement trigger matching logic
    - Implement `matchesTrigger(trigger, context)`: keyword (case-insensitive substring OR match), any_message (is_new_sender), first_reply (is_first_campaign_reply)
    - Implement `matchesConditions(conditions, context)`: accounts filter (account_id in list), labels filter (intersection non-empty), AND logic when both specified, empty = always true
    - Implement `matchesRule(rule, context)`: combines trigger + conditions + enabled check
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.3 Write property tests for trigger matching
    - **Property 3: Keyword Matching is Case-Insensitive**
    - **Validates: Requirements 1.1, 1.4, 1.5**

  - [ ]* 2.4 Write property tests for condition filtering
    - **Property 4: Empty Conditions Always Match**
    - **Property 5: Condition Conjunction**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [x] 2.5 Implement rule evaluation engine
    - Implement `evaluateRules(context)`: load enabled rules by priority, iterate and match, execute actions, enforce single auto_reply constraint, log executions
    - Implement `executeAction(action, context, options)`: dispatch to message-sender, pipeline-service, updateLabels, DB update, or WebSocket broadcast depending on action type
    - Use template-renderer for auto_reply and notify actions
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3_

  - [ ]* 2.6 Write property tests for rule evaluation
    - **Property 1: Single Auto-Reply Constraint**
    - **Property 2: Priority Ordering**
    - **Property 6: Disabled Rules Never Fire**
    - **Property 7: Action Resilience**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.1**

  - [x] 2.7 Implement rule CRUD functions
    - Implement `listRules()`: SELECT * FROM automation_rules ORDER BY priority ASC
    - Implement `createRule(input)`: validate, insert with next available priority, return record
    - Implement `updateRule(id, input)`: validate changed fields, update, return record
    - Implement `deleteRule(id)`: DELETE FROM automation_rules WHERE id = :id
    - Implement `toggleRule(id)`: flip enabled boolean, update updated_at
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8_

  - [ ]* 2.8 Write property tests for rule validation and CRUD
    - **Property 8: Rule Validation Round-Trip**
    - **Property 10: Rule Validation Rejects Invalid Input**
    - **Validates: Requirements 6.1, 6.5, 6.6, 6.7**

  - [x] 2.9 Implement automation log functions
    - Implement `logExecution(ruleId, conversationId, triggerType, actionResults)`: INSERT into automation_log
    - Implement `getLog(options)`: paginated SELECT with created_at DESC ordering
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 2.10 Write property tests for log completeness
    - **Property 9: Log Completeness**
    - **Validates: Requirements 7.1, 7.2**

- [x] 3. Checkpoint - Core engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. REST API routes and inbox-sync integration
  - [x] 4.1 Add automation routes to `server/index.ts`
    - Import automation-engine functions
    - GET /api/automation-rules → listRules()
    - POST /api/automation-rules → createRule(req.body) with validation error handling
    - PUT /api/automation-rules/:id → updateRule(id, req.body)
    - DELETE /api/automation-rules/:id → deleteRule(id)
    - POST /api/automation-rules/:id/toggle → toggleRule(id)
    - GET /api/automation-log → getLog({ page, per_page from query params })
    - Broadcast WebSocket events on rule create/update/delete
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.5_

  - [x] 4.2 Hook automation engine into `server/services/inbox-sync.ts`
    - After `upsertConversation()` when unreadCount > 0, build InboundMessageContext
    - Determine `is_new_sender` (conversation was just created vs updated)
    - Determine `is_first_campaign_reply` (reuse existing detectCampaignReplies logic)
    - Call `evaluateRules(context)` — fire-and-forget (don't await, or await with try/catch to not block sync)
    - Log results count to console
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 5. Checkpoint - API and integration working
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend implementation
  - [x] 6.1 Add Automation route and sidebar navigation
    - Add `{ to: '/app/automation', label: 'Automation', icon: Zap }` to Sidebar.tsx links array (between Pipeline and Settings)
    - Import `Zap` from lucide-react
    - Add route in App.tsx: `<Route path="automation" element={<Automation />} />`
    - Import the Automation page component
    - _Requirements: 10.1_

  - [x] 6.2 Create `frontend/src/pages/Automation.tsx` — Rule list view
    - Fetch rules from GET /api/automation-rules on mount
    - Display rules in a table/list with columns: name, trigger type, enabled toggle, priority
    - Enable/disable toggle calls POST /api/automation-rules/:id/toggle
    - Delete button calls DELETE /api/automation-rules/:id
    - "Create Rule" button opens the create/edit form
    - Listen for WebSocket events (automation-rule:created, updated, deleted) to refresh list
    - _Requirements: 10.2, 10.5_

  - [x] 6.3 Implement rule create/edit form
    - Form fields: name (text input), trigger type (select: keyword/any_message/first_reply), keywords (tag input, shown when trigger=keyword), actions builder (add multiple actions with type-specific fields), conditions (optional account selector, label input), priority (number input)
    - Action builder: select action type, show relevant fields (template textarea for auto_reply, stage selector for move_to_stage, label input for add_label, account selector for assign_account, message input for notify)
    - Submit calls POST (create) or PUT (update) /api/automation-rules
    - Validate locally before submit (name required, at least one action)
    - _Requirements: 10.3_

  - [x] 6.4 Implement automation log viewer
    - Fetch log from GET /api/automation-log with pagination
    - Display entries: rule name (from rule_id lookup or denormalized), conversation peer, trigger type, actions taken (with success/failure indicators), timestamp
    - Pagination controls (next/prev page)
    - _Requirements: 10.4_

- [x] 7. Final checkpoint - Full feature working end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The automation engine uses existing services (message-sender, pipeline-service, template-renderer) — no new dependencies
- Migration file is 007_automation.sql (following existing 006_sync_enabled.sql)
- Property tests use fast-check library for TypeScript property-based testing
- The frontend follows existing patterns from Pipeline.tsx and Campaigns.tsx pages
