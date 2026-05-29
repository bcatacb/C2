# Implementation Plan: CRM Module

## Overview

Implement a CRM pipeline module for TokTik C2 that adds pipeline stages, conversation notes, and enhanced label management. The implementation proceeds bottom-up: database migration → backend services → API routes → frontend pages, with each step building on the previous.

## Tasks

- [x] 1. Create database migration
  - [x] 1.1 Create `server/migrations/005_crm_pipeline.sql`
    - Create `pipeline_stages` table (id uuid PK, name text unique not null, position integer not null, color text not null, created_at timestamptz default now())
    - Create `conversation_notes` table (id uuid PK, conversation_id uuid FK to conversations ON DELETE CASCADE, body text not null, created_at timestamptz default now())
    - Add `pipeline_stage_id` column (uuid, nullable, FK to pipeline_stages ON DELETE SET NULL) to `conversations` table
    - Create index on `conversations(pipeline_stage_id)`
    - Seed default stages: "New" (position 0, #6b7280), "Interested" (position 1, #3b82f6), "Negotiating" (position 2, #f59e0b), "Closed Won" (position 3, #10b981), "Closed Lost" (position 4, #ef4444)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 2. Implement Pipeline Service
  - [x] 2.1 Create `server/services/pipeline-service.ts`
    - Implement `listStages()` — returns all stages ordered by position ascending
    - Implement `createStage(input)` — validates name (non-empty, max 50 chars, unique), assigns position = max + 1, defaults color
    - Implement `updateStage(id, input)` — validates name uniqueness, handles position reordering to maintain contiguous [0..n-1]
    - Implement `deleteStage(id)` — nullifies pipeline_stage_id on affected conversations, deletes stage, reorders remaining
    - Implement `moveConversationToStage(conversationId, stageId)` — validates stage exists (or null for unassign), updates conversation, broadcasts via WebSocket
    - Implement `getConversationsByPipeline(filters?)` — returns conversations grouped by stage (with "unassigned" group)
    - Implement `getStats()` — computes total_conversations, unassigned_count, per_stage counts, avg_time_in_stage, conversion_rates
    - Implement `updateLabels(conversationId, labels)` — deduplicates labels preserving first-occurrence order, validates each label 1-50 chars, updates and broadcasts
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 2.2 Write property test: Stage Position Contiguity
    - **Property 1: Stage Position Contiguity**
    - Generate random sequences of create/update-position/delete operations on stages
    - After each operation, verify positions form contiguous [0, 1, ..., n-1]
    - **Validates: Requirements 1.5, 1.7**

  - [ ]* 2.3 Write property test: Label Set Semantics
    - **Property 2: Label Set Semantics**
    - Generate random arrays of labels (with duplicates, varying lengths)
    - Verify stored labels have no duplicates and preserve first-occurrence order
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 2.4 Write property test: Stats Count Consistency
    - **Property 3: Stats Count Consistency**
    - Generate random distributions of conversations across stages (including unassigned)
    - Verify unassigned_count + sum(per_stage.count) === total_conversations
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 2.5 Write property test: Stage Deletion Nullifies References
    - **Property 4: Stage Deletion Nullifies References**
    - Create stages, assign conversations to them, delete a stage
    - Verify all previously-referencing conversations now have pipeline_stage_id = null
    - **Validates: Requirements 1.6**

  - [ ]* 2.6 Write property test: Move Stage Idempotence
    - **Property 6: Move Stage Idempotence**
    - For random conversations and stages, call moveConversationToStage twice
    - Verify result is same as calling once, and no other fields changed
    - **Validates: Requirements 2.1, 2.3, 2.5**

  - [ ]* 2.7 Write property test: Conversion Rate Bounds
    - **Property 7: Conversion Rate Bounds**
    - Generate random pipeline data and compute stats
    - Verify all conversion_rates are between 0 and 1 inclusive
    - **Validates: Requirements 5.4**

- [x] 3. Implement Note Service
  - [x] 3.1 Create `server/services/note-service.ts`
    - Implement `listNotes(conversationId)` — returns notes ordered by created_at ascending
    - Implement `createNote(conversationId, body)` — validates conversation exists, body non-empty and max 2000 chars, inserts and broadcasts
    - Implement `deleteNote(noteId)` — deletes the note
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 3.2 Write property test: Note Chronological Ordering
    - **Property 5: Note Chronological Ordering**
    - Create multiple notes with varying timestamps
    - Verify listNotes always returns them in created_at ascending order
    - **Validates: Requirements 3.4**

- [x] 4. Checkpoint
  - Ensure all backend services compile and tests pass, ask the user if questions arise.

- [x] 5. Add API routes to server
  - [x] 5.1 Add pipeline stage routes to `server/index.ts`
    - GET `/api/pipeline-stages` — list stages
    - POST `/api/pipeline-stages` — create stage
    - PUT `/api/pipeline-stages/:id` — update stage
    - DELETE `/api/pipeline-stages/:id` — delete stage
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 5.2 Add conversation pipeline routes to `server/index.ts`
    - PUT `/api/conversations/:id/stage` — move conversation to stage
    - GET `/api/conversations/pipeline` — get conversations grouped by pipeline
    - PUT `/api/conversations/:id/labels` — update labels
    - GET `/api/pipeline-stats` — get pipeline statistics
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4_

  - [x] 5.3 Add note routes to `server/index.ts`
    - GET `/api/conversations/:id/notes` — list notes for conversation
    - POST `/api/conversations/:id/notes` — create note
    - DELETE `/api/notes/:id` — delete note
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Build Pipeline page (frontend)
  - [x] 6.1 Create `frontend/src/pages/Pipeline.tsx`
    - Fetch stages and pipeline-grouped conversations on mount
    - Render kanban board with one column per stage + "Unassigned" column
    - Each column shows conversation cards with: peer name, account badge, last message preview, labels, time since last message
    - Implement native HTML5 drag-and-drop (dragstart, dragover, drop) to move cards between columns
    - On drop: call PUT `/api/conversations/:id/stage` and update state optimistically
    - Subscribe to WebSocket `conversation:updated` events to move cards in real-time
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Add Pipeline route and sidebar navigation
    - Add route `<Route path="pipeline" element={<Pipeline />} />` in `App.tsx`
    - Add "Pipeline" nav item in `Sidebar.tsx` between "Campaigns" and "Settings" using `Kanban` icon from lucide-react
    - _Requirements: 6.5_

- [x] 7. Enhance Unibox with CRM features
  - [x] 7.1 Add notes section to `frontend/src/pages/Unibox.tsx`
    - Below the messages area, add a "Notes" section
    - Fetch notes for selected conversation via GET `/api/conversations/:id/notes`
    - Display notes chronologically with timestamp and body
    - Add a text input + button to create new notes via POST `/api/conversations/:id/notes`
    - _Requirements: 7.3, 7.4_

  - [x] 7.2 Add pipeline stage selector to Unibox
    - In the conversation header area, add a dropdown showing all pipeline stages (fetched from GET `/api/pipeline-stages`)
    - Show current stage as selected; allow changing via PUT `/api/conversations/:id/stage`
    - _Requirements: 7.1, 7.2_

  - [x] 7.3 Add label management to Unibox
    - Display current labels as chips below the conversation header
    - Add input to type and add new labels (Enter to add)
    - Click X on chip to remove label
    - On change, call PUT `/api/conversations/:id/labels` with updated array
    - _Requirements: 7.5_

- [x] 8. Final checkpoint
  - Ensure all code compiles, frontend renders correctly, and tests pass. Ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1: Database & Backend Services",
      "tasks": ["1", "2", "3"]
    },
    {
      "name": "Wave 2: API Routes",
      "tasks": ["4", "5"]
    },
    {
      "name": "Wave 3: Frontend",
      "tasks": ["6", "7", "8"]
    }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Native HTML5 drag-and-drop is used for the kanban board (no @dnd-kit dependency)
- No new npm dependencies are introduced
- All real-time updates use the existing `broadcast()` WebSocket function from `server/index.ts`
- Property tests validate universal correctness properties from the design document
