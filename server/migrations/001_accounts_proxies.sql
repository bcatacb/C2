CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE proxies (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid,
  type                text CHECK (type IN ('residential', 'mobile', 'datacenter')),
  host                text NOT NULL,
  port                int NOT NULL,
  username            text,
  password            text,
  country             text,
  assigned_account_id uuid,
  status              text DEFAULT 'active' CHECK (status IN ('active', 'dead', 'rotating')),
  last_checked        timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE tiktok_accounts (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid,
  username            text NOT NULL,
  display_name        text,
  profile_photo       text,
  transport_type      text DEFAULT 'playwright' CHECK (transport_type IN ('playwright', 'api')),
  status              text DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'restricted', 'banned')),
  proxy_id            uuid REFERENCES proxies(id) ON DELETE SET NULL,
  session_data        jsonb,
  daily_dm_limit      int DEFAULT 50,
  dms_sent_today      int DEFAULT 0,
  dms_sent_reset      timestamptz,
  cooldown_until      timestamptz,
  cooldown_step       int DEFAULT 0,
  last_health_check   timestamptz,
  last_inbox_sync     timestamptz,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE proxies
  ADD CONSTRAINT fk_proxy_assigned_account
  FOREIGN KEY (assigned_account_id)
  REFERENCES tiktok_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_accounts_user ON tiktok_accounts(user_id);
CREATE INDEX idx_accounts_status ON tiktok_accounts(user_id, status);
CREATE INDEX idx_proxies_user ON proxies(user_id);
