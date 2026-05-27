# Implementation Plan: Lead Engine

## Overview

Implement the Lead Engine feature following existing project patterns: Supabase migration for the `leads` table, a backend service module with CRUD/bulk/import logic, Express routes wired into `server/index.ts`, and a React frontend page with CSV upload modal. TypeScript throughout, no new dependencies.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1 - Database & Backend Services",
      "tasks": ["1", "2", "3"]
    },
    {
      "name": "Wave 2 - API Layer",
      "tasks": ["4", "5"]
    },
    {
      "name": "Wave 3 - Frontend",
      "tasks": ["6", "7"]
    },
    {
      "name": "Wave 4 - Verification",
      "tasks": ["8"]
    }
  ]
}
```

## Tasks

- [x] 1. Create database migration for leads table
  - Create `server/migrations/003_leads.sql`
  - Define `leads` table with: `id` (uuid PK, default gen_random_uuid()), `account_id` (FK to tiktok_accounts, nullable), `username` (text, unique, not null), `display_name` (text, nullable), `source` (text, nullable), `status` (text, default 'new'), `tags` (text[], default '{}'), `notes` (text, nullable), `contacted_at` (timestamptz, nullable), `replied_at` (timestamptz, nullable), `created_at` (timestamptz, default now())
  - Add indexes: B-tree on `status`, B-tree on `account_id`, GIN on `tags`
  - Add CHECK constraint on status enum values
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 2. Implement Lead Service
  - [x] 2.1 Create `server/services/lead-service.ts` with types and CRUD functions
    - Define `Lead`, `LeadStatus`, `LeadFilters`, `CreateLeadInput`, `UpdateLeadInput`, `BulkAction`, `BulkResult`, `PaginatedResult`, `LeadStats` interfaces
    - Implement `normalizeUsername()` and `isValidUsername()` helper functions
    - Implement `createLead()` with validation, normalization, and duplicate checking
    - Implement `getLead()`, `updateLead()`, `deleteLead()`
    - Implement `listLeads()` with pagination, filtering (status, tags, account_id, search, date range), and ordering
    - Implement `executeBulkAction()` for tag, untag, assign, status, delete operations
    - Implement `getStats()` for status breakdown
    - Follow patterns from `account-manager.ts` (import supabase, export async functions)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 7.1_

  - [ ]* 2.2 Write property tests for username normalization and validation
    - **Property 1: Username normalization idempotence**
    - **Property 6: Username validation rejects invalid characters**
    - **Validates: Requirements 2.1, 2.2**

- [x] 3. Implement CSV Importer
  - [x] 3.1 Create `server/services/csv-importer.ts`
    - Define `CSVRow`, `ImportDefaults`, `ImportResult`, `ImportError` interfaces
    - Implement `processImport(rows, defaults)` function
    - Validate each row's username using `normalizeUsername` and `isValidUsername` from lead-service
    - Query existing usernames in batch for deduplication
    - Deduplicate within the import batch itself
    - Bulk insert valid, unique leads
    - Apply default source, tags, status from `ImportDefaults`
    - Enforce 10,000 row maximum
    - Return `ImportResult` with accounting invariant: imported + duplicates + errors.length === total
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 3.2 Write property tests for CSV import
    - **Property 2: Import accounting invariant**
    - **Property 3: Deduplication correctness**
    - **Validates: Requirements 3.3, 3.4, 3.5**

- [x] 4. Checkpoint - Verify backend services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add Lead API routes to server
  - [x] 5.1 Wire lead routes into `server/index.ts`
    - Import lead-service and csv-importer functions
    - Add `GET /api/leads` — list with query params for filters and pagination
    - Add `GET /api/leads/stats` — return stats
    - Add `GET /api/leads/:id` — get single lead
    - Add `POST /api/leads` — create single lead, broadcast `leads:created`
    - Add `PUT /api/leads/:id` — update lead, broadcast `leads:updated`
    - Add `DELETE /api/leads/:id` — delete lead, broadcast `leads:deleted`
    - Add `POST /api/leads/import` — bulk CSV import
    - Add `POST /api/leads/bulk` — bulk actions (validate max 500 IDs), broadcast `leads:bulk-updated`
    - Follow existing route patterns (asyncH wrapper, broadcast calls, error responses)
    - _Requirements: 1.4, 3.1, 5.1, 5.2, 6.6, 6.7_

- [x] 6. Implement frontend Leads page
  - [x] 6.1 Create `frontend/src/pages/Leads.tsx`
    - Build leads table with columns: checkbox, username, status (badge), tags (chips), assigned account, source, created date
    - Implement filter bar with dropdowns for status, tag, account
    - Implement search input with debounced username search
    - Implement pagination controls (prev/next, page indicator)
    - Implement row selection with select-all checkbox
    - Show bulk action toolbar when rows selected (tag, assign, status, delete actions)
    - Add "Import CSV" button to trigger modal
    - Add "Add Lead" button for manual single-lead creation
    - Subscribe to WebSocket events (`leads:created`, `leads:updated`, `leads:deleted`, `leads:bulk-updated`) to refresh data
    - Follow patterns from `Accounts.tsx` (useState, useEffect, get/post/put/del from api.ts)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 6.2 Create `frontend/src/components/CSVUploadModal.tsx`
    - Build modal overlay with drag-and-drop zone
    - Accept `.csv` files via drop or file input click
    - Parse CSV client-side: split by newlines, split by comma, handle quoted fields
    - Display preview table of first 5-10 rows
    - Validate row count (max 10,000), show error if exceeded
    - On confirm: POST parsed rows to `/api/leads/import`, display result summary (imported, duplicates, errors)
    - Close modal on success or cancel
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 7. Integrate navigation and routing
  - [x] 7.1 Add Leads nav item to Sidebar
    - Add `{ to: '/app/leads', label: 'Leads', icon: Target }` to the links array in `frontend/src/components/Sidebar.tsx`
    - Position between Accounts and Settings
    - Import `Target` icon from lucide-react
    - _Requirements: 10.1_

  - [x] 7.2 Add Leads route to App.tsx
    - Import `Leads` page component
    - Add route for `/app/leads` rendering the Leads page within the authenticated layout
    - _Requirements: 10.2_

- [x] 8. Final checkpoint - End-to-end verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: migration runs, CRUD endpoints work, CSV import handles valid/invalid/duplicate rows, bulk operations function, frontend renders and filters correctly, WebSocket updates propagate.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The project uses TypeScript throughout with `tsx` runner for the server
- No new npm dependencies needed — CSV parsing uses native string splitting
- Follow existing patterns: `asyncH` wrapper for routes, `broadcast()` for WebSocket, Supabase client from `utils/supabase.ts`
- Property tests validate universal correctness properties using fast-check
