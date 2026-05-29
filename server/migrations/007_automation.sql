CREATE TABLE automation_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  enabled             boolean DEFAULT true,
  trigger             jsonb NOT NULL,
  conditions          jsonb DEFAULT '{}',
  actions             jsonb NOT NULL,
  priority            integer NOT NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE automation_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             uuid REFERENCES automation_rules(id) ON DELETE SET NULL,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  trigger_type        text NOT NULL,
  actions_taken       jsonb NOT NULL,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_automation_log_created ON automation_log(created_at DESC);
CREATE INDEX idx_automation_rules_priority ON automation_rules(priority ASC, enabled);
