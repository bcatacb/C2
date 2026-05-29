CREATE TABLE pipeline_stages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text UNIQUE NOT NULL,
  position            integer NOT NULL,
  color               text NOT NULL,
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE conversation_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  body                text NOT NULL,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE conversations
  ADD COLUMN pipeline_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_pipeline_stage ON conversations(pipeline_stage_id);

-- Seed default pipeline stages
INSERT INTO pipeline_stages (name, position, color) VALUES
  ('New',          0, '#6b7280'),
  ('Interested',   1, '#3b82f6'),
  ('Negotiating',  2, '#f59e0b'),
  ('Closed Won',   3, '#10b981'),
  ('Closed Lost',  4, '#ef4444');
