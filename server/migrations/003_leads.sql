CREATE TABLE leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid REFERENCES tiktok_accounts(id) ON DELETE SET NULL,
  username            text UNIQUE NOT NULL,
  display_name        text,
  source              text,
  status              text DEFAULT 'new' CHECK (status IN ('new', 'queued', 'contacted', 'replied', 'converted', 'do_not_contact')),
  tags                text[] DEFAULT '{}',
  notes               text,
  contacted_at        timestamptz,
  replied_at          timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_account ON leads(account_id);
CREATE INDEX idx_leads_tags ON leads USING GIN (tags);
