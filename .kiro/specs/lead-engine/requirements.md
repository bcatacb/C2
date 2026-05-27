# Requirements Document

## Introduction

The Lead Engine provides target list management for TikTok outreach campaigns within the TokTik C2 platform. It enables users to import, organize, filter, and manage leads (TikTok usernames) that will be consumed by the Campaign Engine for automated outreach. The system supports CSV bulk import, manual entry, flexible tagging, status tracking, account assignment, and bulk operations.

## Glossary

- **Lead_Service**: The backend service module responsible for lead CRUD operations, filtering, pagination, and bulk actions
- **CSV_Importer**: The backend service module responsible for validating, deduplicating, and bulk-inserting leads from parsed CSV data
- **Leads_Page**: The frontend page component displaying the leads table with filtering, search, and bulk action capabilities
- **CSV_Upload_Modal**: The frontend modal component for drag-and-drop CSV file upload with preview and import execution
- **Lead**: A record representing a TikTok username targeted for outreach, stored in the `leads` database table
- **Username**: A TikTok handle consisting of 1-24 characters matching the pattern `[a-z0-9_.]`
- **LeadStatus**: One of: `new`, `queued`, `contacted`, `replied`, `converted`, `do_not_contact`
- **BulkAction**: An operation applied to multiple selected leads simultaneously (tag, untag, assign, status change, delete)

## Requirements

### Requirement 1: Lead Creation and Storage

**User Story:** As a user, I want to create and store leads with relevant metadata, so that I can build a target list for outreach campaigns.

#### Acceptance Criteria

1. WHEN a user submits a new lead with a valid username, THE Lead_Service SHALL create a lead record with status defaulting to `new` and persist it to the database
2. WHEN a user submits a lead with a username that already exists in the database, THE Lead_Service SHALL reject the creation and return a duplicate error
3. THE Lead_Service SHALL store each lead with: id, username, display_name, source, status, tags, notes, account_id, contacted_at, replied_at, and created_at fields
4. WHEN a lead is created, THE Lead_Service SHALL broadcast a WebSocket event to notify connected clients of the new lead

### Requirement 2: Username Validation and Normalization

**User Story:** As a user, I want usernames to be automatically cleaned and validated, so that I don't store invalid or inconsistent data.

#### Acceptance Criteria

1. WHEN a username is submitted, THE Lead_Service SHALL trim whitespace, convert to lowercase, and remove a leading `@` character if present
2. THE Lead_Service SHALL reject any username that does not match the pattern `^[a-z0-9_.]{1,24}$` after normalization
3. WHEN a username is null, undefined, or empty after trimming, THE Lead_Service SHALL reject it as invalid
4. THE Lead_Service SHALL enforce username uniqueness across all leads in the database

### Requirement 3: CSV Bulk Import

**User Story:** As a user, I want to import leads in bulk from a CSV file, so that I can quickly populate my target list from external sources.

#### Acceptance Criteria

1. WHEN a user uploads a CSV file, THE CSV_Upload_Modal SHALL parse it client-side and send the parsed rows to the API
2. WHEN the CSV_Importer receives an array of rows, THE CSV_Importer SHALL validate each row's username, skip invalid rows, and record errors with row number and reason
3. WHEN the CSV_Importer encounters a username that already exists in the database, THE CSV_Importer SHALL count it as a duplicate and skip insertion
4. WHEN the CSV_Importer encounters duplicate usernames within the same import batch, THE CSV_Importer SHALL count subsequent occurrences as duplicates and skip them
5. WHEN import processing completes, THE CSV_Importer SHALL return a result where `imported + duplicates + errors.length` equals the total number of input rows
6. WHEN the CSV_Importer processes rows, THE CSV_Importer SHALL apply default values for source, tags, and status if provided in the import request
7. THE CSV_Importer SHALL enforce a maximum of 10,000 rows per import request

### Requirement 4: Lead Listing with Pagination and Filtering

**User Story:** As a user, I want to browse, search, and filter my leads with pagination, so that I can efficiently find and manage specific subsets of my target list.

#### Acceptance Criteria

1. WHEN a user requests the leads list, THE Lead_Service SHALL return paginated results with a default of 50 leads per page and a maximum of 100
2. WHEN a user provides a status filter, THE Lead_Service SHALL return only leads matching the specified status or statuses
3. WHEN a user provides a tags filter, THE Lead_Service SHALL return only leads that have at least one of the specified tags
4. WHEN a user provides a search term, THE Lead_Service SHALL return only leads whose username contains the search term (case-insensitive)
5. WHEN a user provides an account_id filter, THE Lead_Service SHALL return only leads assigned to that account; WHEN account_id is explicitly null, THE Lead_Service SHALL return only unassigned leads
6. WHEN a user provides date range filters, THE Lead_Service SHALL return only leads created within the specified range
7. THE Lead_Service SHALL return pagination metadata including: total count, current page, per_page, and total_pages where `total_pages = ceil(total / per_page)`
8. THE Lead_Service SHALL order results by created_at descending by default

### Requirement 5: Lead Update and Deletion

**User Story:** As a user, I want to update lead details and delete leads I no longer need, so that I can keep my target list accurate and current.

#### Acceptance Criteria

1. WHEN a user updates a lead's fields, THE Lead_Service SHALL persist the changes and broadcast a WebSocket update event
2. WHEN a user deletes a lead, THE Lead_Service SHALL remove it from the database and broadcast a WebSocket delete event
3. WHEN a user sets account_id to null on a lead, THE Lead_Service SHALL unassign the lead from any account

### Requirement 6: Bulk Operations

**User Story:** As a user, I want to perform actions on multiple leads at once, so that I can efficiently manage large target lists.

#### Acceptance Criteria

1. WHEN a user submits a bulk tag action with a set of lead IDs and tags, THE Lead_Service SHALL append the specified tags to each lead without creating duplicate tag entries
2. WHEN a user submits a bulk untag action, THE Lead_Service SHALL remove the specified tags from each selected lead
3. WHEN a user submits a bulk assign action, THE Lead_Service SHALL set the account_id on all selected leads to the specified value
4. WHEN a user submits a bulk status change action, THE Lead_Service SHALL update the status of all selected leads to the specified value
5. WHEN a user submits a bulk delete action, THE Lead_Service SHALL remove all selected leads from the database
6. WHEN a bulk operation completes, THE Lead_Service SHALL broadcast a WebSocket event and return the count of affected leads
7. THE Lead_Service SHALL enforce a maximum of 500 lead IDs per bulk operation request

### Requirement 7: Lead Statistics

**User Story:** As a user, I want to see a summary of my leads by status, so that I can understand the state of my outreach pipeline at a glance.

#### Acceptance Criteria

1. WHEN a user requests lead statistics, THE Lead_Service SHALL return the total lead count and a breakdown of counts by each status value

### Requirement 8: Frontend Leads Page

**User Story:** As a user, I want a dedicated page to view and manage my leads, so that I can interact with my target list through a visual interface.

#### Acceptance Criteria

1. THE Leads_Page SHALL display leads in a table with columns for: username, status, tags, assigned account, source, and created date
2. THE Leads_Page SHALL provide a filter bar for filtering by status, tag, and assigned account
3. THE Leads_Page SHALL provide a search input for filtering leads by username
4. THE Leads_Page SHALL provide pagination controls for navigating through results
5. THE Leads_Page SHALL allow row selection with a checkbox and display a bulk action toolbar when leads are selected
6. THE Leads_Page SHALL include a button to open the CSV Upload Modal
7. WHEN a WebSocket event for leads is received, THE Leads_Page SHALL refresh the displayed data to reflect the change

### Requirement 9: CSV Upload Modal

**User Story:** As a user, I want a drag-and-drop interface for uploading CSV files, so that I can easily import leads without manual data entry.

#### Acceptance Criteria

1. THE CSV_Upload_Modal SHALL provide a drag-and-drop zone that accepts `.csv` files
2. WHEN a CSV file is dropped or selected, THE CSV_Upload_Modal SHALL parse it using native string splitting and display a preview of the first rows
3. WHEN the user confirms the import, THE CSV_Upload_Modal SHALL send the parsed rows to the import API endpoint and display the result summary (imported, duplicates, errors)
4. IF the CSV file exceeds 10,000 rows, THEN THE CSV_Upload_Modal SHALL display an error and prevent submission

### Requirement 10: Navigation Integration

**User Story:** As a user, I want to access the Leads page from the sidebar navigation, so that I can easily switch between platform features.

#### Acceptance Criteria

1. THE Sidebar SHALL include a "Leads" navigation item with an appropriate icon, positioned between "Accounts" and "Settings"
2. WHEN the user navigates to the Leads route, THE application SHALL render the Leads_Page component

### Requirement 11: Database Schema

**User Story:** As a developer, I want a properly structured database table for leads, so that queries are performant and data integrity is maintained.

#### Acceptance Criteria

1. THE database migration SHALL create a `leads` table with a UUID primary key, unique constraint on `username`, foreign key on `account_id` referencing `tiktok_accounts`, and a `tags` column of type `text[]`
2. THE database migration SHALL create indexes on: `status`, `account_id`, and a GIN index on `tags` for array overlap queries
3. THE database migration SHALL set default values: `status` defaults to `new`, `tags` defaults to empty array, `created_at` defaults to `now()`
