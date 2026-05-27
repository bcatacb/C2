CREATE TABLE campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  steps                 jsonb DEFAULT '[]',
  target_filters        jsonb DEFAULT '{}',
  assigned_account_ids  text[] DEFAULT '{}',
  daily_send_limit      integer DEFAULT 100,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE campaign_leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id               uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  account_id            uuid REFERENCES tiktok_accounts(id),
  current_step          integer DEFAULT 0,
  status                text DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'replied', 'converted', 'skipped')),
  last_sent_at          timestamptz,
  next_send_at          timestamptz,
  created_at            timestamptz DEFAULT now(),
  CONSTRAINT uq_campaign_leads_campaign_lead UNIQUE (campaign_id, lead_id)
);

CREATE INDEX idx_campaign_leads_next_send ON campaign_leads(next_send_at);
CREATE INDEX idx_campaign_leads_campaign_status ON campaign_leads(campaign_id, status);
