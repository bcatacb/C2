# Requirements Document

## Introduction

The Automation Module provides an "if this, then that" rule engine for inbound TikTok DMs within the TokTik C2 platform. Users configure automation rules with trigger conditions, optional filters, and one or more actions. When an inbound message arrives, the automation engine evaluates all enabled rules and executes matching actions. This enables automated responses, pipeline management, labeling, account assignment, and real-time notifications without manual intervention.

## Glossary

- **Automation_Engine**: The backend service that evaluates automation rules against inbound messages and executes matching actions
- **Rule**: A configurable automation rule consisting of a trigger, optional conditions, and one or more actions
- **Trigger**: The condition that initiates rule evaluation (keyword match, any new message, or first campaign reply)
- **Condition**: Optional filters that narrow when a rule fires (account filter, label filter)
- **Action**: An operation performed when a rule matches (auto_reply, move_to_stage, add_label, assign_account, notify)
- **Priority**: A numeric value determining rule evaluation order (lower number = higher priority)
- **Automation_Log**: A record of rule executions for debugging and auditing
- **Template**: A message string with {{variable}} placeholders that get replaced with actual values

## Requirements

### Requirement 1: Trigger Matching

**User Story:** As a user, I want to define trigger conditions for my automation rules, so that rules fire only when specific message patterns are detected.

#### Acceptance Criteria

1. WHEN an inbound message contains at least one of the rule's configured keywords (case-insensitive substring match), THE Automation_Engine SHALL consider the keyword trigger as matched
2. WHEN an inbound message arrives from a sender with no prior conversation history, THE Automation_Engine SHALL consider the any_message trigger as matched
3. WHEN an inbound message is the first reply from a lead enrolled in an active campaign, THE Automation_Engine SHALL consider the first_reply trigger as matched
4. WHEN a keyword trigger is configured with multiple keywords, THE Automation_Engine SHALL use OR logic (any single keyword match is sufficient)
5. WHEN matching keywords, THE Automation_Engine SHALL perform case-insensitive comparison

### Requirement 2: Condition Filtering

**User Story:** As a user, I want to add optional filters to my rules, so that they only fire for specific accounts or labeled conversations.

#### Acceptance Criteria

1. WHERE an accounts condition is specified, THE Automation_Engine SHALL only fire the rule if the inbound message's account_id is in the specified accounts list
2. WHERE a labels condition is specified, THE Automation_Engine SHALL only fire the rule if the conversation has at least one label matching the specified labels list
3. WHEN both accounts and labels conditions are specified, THE Automation_Engine SHALL require both conditions to be satisfied (AND logic)
4. WHEN no conditions are specified on a rule, THE Automation_Engine SHALL treat the conditions as always satisfied

### Requirement 3: Action Execution

**User Story:** As a user, I want rules to perform actions automatically when triggered, so that I can automate repetitive DM management tasks.

#### Acceptance Criteria

1. WHEN an auto_reply action is executed, THE Automation_Engine SHALL render the template with available variables ({{username}}, {{display_name}}) and send the message via message-sender
2. WHEN a move_to_stage action is executed, THE Automation_Engine SHALL move the conversation to the specified pipeline stage
3. WHEN an add_label action is executed, THE Automation_Engine SHALL append the specified label to the conversation's existing labels
4. WHEN an assign_account action is executed, THE Automation_Engine SHALL assign the specified account to the conversation for future outreach
5. WHEN a notify action is executed, THE Automation_Engine SHALL broadcast a WebSocket notification with the rule name and rendered message
6. WHEN a rule has multiple actions, THE Automation_Engine SHALL execute all actions in the order they are defined

### Requirement 4: Rule Evaluation Order and Constraints

**User Story:** As a user, I want rules evaluated in priority order with spam prevention, so that the most important rules fire first and contacts aren't spammed.

#### Acceptance Criteria

1. THE Automation_Engine SHALL evaluate rules in ascending priority order (lower number = higher priority)
2. THE Automation_Engine SHALL skip rules where enabled is false
3. WHEN multiple rules match the same inbound message, THE Automation_Engine SHALL execute all matching rules' actions
4. WHEN multiple rules contain auto_reply actions, THE Automation_Engine SHALL execute only the first matching auto_reply (from the highest-priority rule) and skip subsequent auto_reply actions

### Requirement 5: Execution Resilience

**User Story:** As a user, I want automation to be resilient to individual action failures, so that one broken action doesn't prevent other actions from executing.

#### Acceptance Criteria

1. IF an individual action fails during execution, THEN THE Automation_Engine SHALL log the error and continue executing remaining actions for that rule
2. IF the database is unavailable when loading rules, THEN THE Automation_Engine SHALL return empty results and allow inbox-sync to continue normally
3. IF a rule contains malformed trigger or action data, THEN THE Automation_Engine SHALL skip that rule and continue evaluating remaining rules

### Requirement 6: Rule CRUD Operations

**User Story:** As a user, I want to create, update, delete, enable/disable, and reorder automation rules, so that I can manage my automation configuration.

#### Acceptance Criteria

1. WHEN a user creates a rule with valid data, THE System SHALL persist the rule and return the created record
2. WHEN a user updates a rule, THE System SHALL validate the updated fields and persist changes
3. WHEN a user deletes a rule, THE System SHALL remove the rule from the database
4. WHEN a user toggles a rule's enabled state, THE System SHALL flip the enabled boolean and persist the change
5. THE System SHALL validate that rule name is non-empty and at most 100 characters
6. THE System SHALL validate that keyword triggers have at least one non-empty keyword
7. THE System SHALL validate that rules have at least one action with valid type-specific fields
8. THE System SHALL enforce unique priority values or handle priority conflicts during reordering

### Requirement 7: Automation Logging

**User Story:** As a user, I want to see which rules fired and what actions were taken, so that I can debug and audit automation behavior.

#### Acceptance Criteria

1. WHEN a rule fires, THE Automation_Engine SHALL create a log entry with rule_id, conversation_id, trigger_type, and actions_taken
2. THE actions_taken field SHALL include each action's type, success status, and error message if failed
3. WHEN a user requests the automation log, THE System SHALL return entries ordered by created_at descending with pagination support

### Requirement 8: REST API Endpoints

**User Story:** As a frontend developer, I want REST endpoints for automation rule management and log viewing, so that the UI can interact with the automation system.

#### Acceptance Criteria

1. WHEN a GET request is made to /api/automation-rules, THE System SHALL return all rules ordered by priority ascending
2. WHEN a POST request is made to /api/automation-rules with valid data, THE System SHALL create and return the new rule
3. WHEN a PUT request is made to /api/automation-rules/:id with valid data, THE System SHALL update and return the modified rule
4. WHEN a DELETE request is made to /api/automation-rules/:id, THE System SHALL delete the rule and return success
5. WHEN a POST request is made to /api/automation-rules/:id/toggle, THE System SHALL toggle the rule's enabled state and return the updated rule
6. WHEN a GET request is made to /api/automation-log, THE System SHALL return paginated log entries ordered by most recent first

### Requirement 9: Integration with Inbox Sync

**User Story:** As a system operator, I want automation rules evaluated automatically on every inbound message, so that automation works without manual intervention.

#### Acceptance Criteria

1. WHEN inbox-sync upserts a conversation with unread_count > 0, THE System SHALL call the automation engine with the inbound message context
2. THE inbound message context SHALL include account_id, conversation_id, peer_username, peer_display_name, message_text, is_new_sender flag, is_first_campaign_reply flag, and conversation_labels
3. WHEN automation evaluation completes, THE System SHALL not block or delay the inbox-sync process for subsequent accounts

### Requirement 10: Frontend Automation Page

**User Story:** As a user, I want a dedicated Automation page in the UI, so that I can manage rules and view execution logs visually.

#### Acceptance Criteria

1. THE System SHALL add an "Automation" navigation item in the sidebar between Pipeline and Settings using the Zap icon
2. THE Automation page SHALL display a list of rules with name, trigger type, enabled toggle, and priority
3. THE Automation page SHALL provide a form to create and edit rules with trigger type selector, keyword input, action builder, and condition filters
4. THE Automation page SHALL include a log viewer showing recent rule executions with rule name, conversation, trigger type, actions taken, and timestamp
5. WHEN a rule is created, updated, or deleted via the UI, THE System SHALL broadcast a WebSocket event to update other connected clients in real-time

### Requirement 11: Database Schema

**User Story:** As a developer, I want properly structured database tables for automation rules and logs, so that data is stored reliably with referential integrity.

#### Acceptance Criteria

1. THE System SHALL create an automation_rules table with columns: id (uuid PK), name (text), enabled (boolean), trigger (jsonb), conditions (jsonb), actions (jsonb), priority (integer), created_at (timestamptz), updated_at (timestamptz)
2. THE System SHALL create an automation_log table with columns: id (uuid PK), rule_id (uuid FK), conversation_id (uuid FK), trigger_type (text), actions_taken (jsonb), created_at (timestamptz)
3. THE automation_log.rule_id SHALL reference automation_rules(id) with ON DELETE SET NULL
4. THE automation_log.conversation_id SHALL reference conversations(id) with ON DELETE CASCADE
