# Requirements Document

## Introduction

The CRM Module extends the TokTik C2 platform with pipeline management, conversation notes, and enhanced label management. It enables operators to track conversations through configurable sales/outreach funnel stages, annotate conversations with timestamped notes, and organize conversations at scale using a kanban-style pipeline view.

## Glossary

- **Pipeline_Service**: The backend service responsible for managing pipeline stages, conversation stage assignments, and pipeline statistics computation.
- **Note_Service**: The backend service responsible for creating, listing, and deleting conversation notes.
- **Pipeline_Page**: The frontend kanban board view displaying conversations grouped by pipeline stage.
- **Unibox_Pane**: The enhanced right pane of the existing Unibox page showing messages, notes, stage selector, and labels.
- **Pipeline_Stage**: A configurable step in the sales/outreach funnel (e.g., "New", "Interested", "Negotiating").
- **Conversation_Note**: A timestamped text annotation attached to a conversation.
- **Kanban_Board**: A visual board with columns representing pipeline stages, where conversation cards can be dragged between columns.
- **WebSocket_Broadcast**: A real-time notification sent to all connected clients when data changes.

## Requirements

### Requirement 1: Pipeline Stage Management

**User Story:** As an operator, I want to manage pipeline stages, so that I can configure the sales funnel to match my outreach workflow.

#### Acceptance Criteria

1. WHEN the operator requests the list of pipeline stages, THE Pipeline_Service SHALL return all stages ordered by position ascending
2. WHEN the operator creates a new stage with a valid name, THE Pipeline_Service SHALL insert the stage with position set to max(existing positions) + 1
3. WHEN the operator creates a stage with a name that already exists, THE Pipeline_Service SHALL return a 409 error with message "Stage name already exists"
4. WHEN the operator updates a stage name, THE Pipeline_Service SHALL validate the new name is non-empty, max 50 characters, and unique
5. WHEN the operator updates a stage position, THE Pipeline_Service SHALL reorder all stages to maintain contiguous positions [0, 1, ..., n-1]
6. WHEN the operator deletes a stage, THE Pipeline_Service SHALL nullify pipeline_stage_id on all conversations referencing that stage and then delete the stage
7. WHEN a stage is deleted, THE Pipeline_Service SHALL reorder remaining stages to maintain contiguous positions with no gaps

### Requirement 2: Conversation Stage Assignment

**User Story:** As an operator, I want to assign conversations to pipeline stages, so that I can track where each conversation is in the outreach funnel.

#### Acceptance Criteria

1. WHEN the operator moves a conversation to a valid stage, THE Pipeline_Service SHALL update the conversation's pipeline_stage_id to the specified stage
2. WHEN the operator moves a conversation to a stage that does not exist, THE Pipeline_Service SHALL return a 404 error with message "Pipeline stage not found"
3. WHEN the operator unassigns a conversation from a stage (stage_id is null), THE Pipeline_Service SHALL set pipeline_stage_id to null
4. WHEN a conversation's stage is updated, THE Pipeline_Service SHALL emit a WebSocket broadcast with the updated conversation
5. WHEN a conversation is moved to a stage, THE Pipeline_Service SHALL not modify any other fields on the conversation

### Requirement 3: Conversation Notes

**User Story:** As an operator, I want to add timestamped notes to conversations, so that I can record context and follow-up reminders.

#### Acceptance Criteria

1. WHEN the operator creates a note with a valid body on an existing conversation, THE Note_Service SHALL insert the note and return it with a generated id and created_at timestamp
2. WHEN the operator creates a note on a conversation that does not exist, THE Note_Service SHALL return a 404 error with message "Conversation not found"
3. WHEN the operator creates a note with an empty body or body exceeding 2000 characters, THE Note_Service SHALL return a 400 validation error
4. WHEN the operator requests notes for a conversation, THE Note_Service SHALL return all notes ordered by created_at ascending
5. WHEN the operator deletes a note, THE Note_Service SHALL remove the note from the database
6. WHEN a note is created, THE Note_Service SHALL emit a WebSocket broadcast with the new note

### Requirement 4: Label Management

**User Story:** As an operator, I want to manage labels on conversations, so that I can categorize and filter conversations by custom tags.

#### Acceptance Criteria

1. WHEN the operator updates labels on a conversation, THE Pipeline_Service SHALL replace the labels array with the provided values
2. WHEN the operator provides duplicate labels, THE Pipeline_Service SHALL deduplicate them preserving first-occurrence order
3. WHEN the operator provides a label that is empty or exceeds 50 characters, THE Pipeline_Service SHALL return a 400 error with message "Each label must be 1-50 characters"
4. WHEN labels are updated, THE Pipeline_Service SHALL emit a WebSocket broadcast with the updated conversation

### Requirement 5: Pipeline Statistics

**User Story:** As an operator, I want to view pipeline statistics, so that I can understand conversion rates and identify bottlenecks in my outreach funnel.

#### Acceptance Criteria

1. WHEN the operator requests pipeline stats, THE Pipeline_Service SHALL return total_conversations equal to the count of all non-archived conversations
2. WHEN computing stats, THE Pipeline_Service SHALL ensure unassigned_count plus the sum of all per_stage counts equals total_conversations
3. WHEN computing per-stage stats, THE Pipeline_Service SHALL include avg_time_in_stage_hours as null if no conversations have transitioned out of that stage
4. WHEN computing conversion rates, THE Pipeline_Service SHALL return a rate between 0 and 1 inclusive for each pair of adjacent stages

### Requirement 6: Pipeline Kanban View

**User Story:** As an operator, I want a kanban board view of my pipeline, so that I can visually manage conversations across funnel stages.

#### Acceptance Criteria

1. WHEN the Pipeline_Page loads, THE Pipeline_Page SHALL fetch all stages and display one column per stage plus an "Unassigned" column
2. WHEN displaying conversation cards, THE Pipeline_Page SHALL show peer name, account badge, last message preview, labels, and time since last message
3. WHEN the operator drags a conversation card to a different column, THE Pipeline_Page SHALL call the stage move API and update the UI optimistically
4. WHEN a WebSocket broadcast indicates a conversation stage change, THE Pipeline_Page SHALL move the conversation card to the correct column in real-time
5. WHEN the Pipeline_Page is accessed, THE Sidebar SHALL include a "Pipeline" navigation item between "Campaigns" and "Settings"

### Requirement 7: Enhanced Unibox Integration

**User Story:** As an operator, I want to see notes, stage, and labels in the conversation view, so that I can manage CRM context without leaving the inbox.

#### Acceptance Criteria

1. WHEN a conversation is selected in the Unibox, THE Unibox_Pane SHALL display a pipeline stage dropdown selector showing all available stages
2. WHEN the operator selects a stage from the dropdown, THE Unibox_Pane SHALL call the stage move API and update the display
3. WHEN a conversation is selected, THE Unibox_Pane SHALL display all notes for that conversation below the messages area
4. WHEN the operator submits a new note, THE Unibox_Pane SHALL call the note creation API and append the note to the display
5. WHEN a conversation is selected, THE Unibox_Pane SHALL display label chips with the ability to add and remove labels

### Requirement 8: Database Schema

**User Story:** As a developer, I want the database schema to support pipeline stages and notes, so that the CRM data is properly structured and queryable.

#### Acceptance Criteria

1. THE migration SHALL create a pipeline_stages table with columns: id (uuid PK), name (text unique not null), position (integer not null), color (text not null), created_at (timestamptz)
2. THE migration SHALL create a conversation_notes table with columns: id (uuid PK), conversation_id (uuid FK to conversations ON DELETE CASCADE), body (text not null), created_at (timestamptz)
3. THE migration SHALL add a pipeline_stage_id column (uuid, nullable, FK to pipeline_stages ON DELETE SET NULL) to the conversations table
4. THE migration SHALL seed default pipeline stages: "New", "Interested", "Negotiating", "Closed Won", "Closed Lost"
