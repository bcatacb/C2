-- Create Lead Lists / Folders
CREATE TABLE IF NOT EXISTS lead_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- Join table for Leads and Lists
CREATE TABLE IF NOT EXISTS lead_list_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(list_id, lead_id)
);

-- Add status column to Conversations if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='conversations' AND column_name='status') THEN
        ALTER TABLE conversations ADD COLUMN status text DEFAULT 'read' CHECK (status IN ('unread', 'read', 'replied'));
    END IF;
END $$;

-- Create index for fast status filtering
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(account_id, status);
