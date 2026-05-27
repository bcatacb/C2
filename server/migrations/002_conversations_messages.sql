CREATE TABLE conversations (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id              uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  peer_username           text NOT NULL,
  peer_display_name       text,
  peer_avatar             text,
  last_message_text       text,
  last_message_at         timestamptz,
  last_message_direction  text CHECK (last_message_direction IN ('inbound', 'outbound')),
  unread_count            int DEFAULT 0,
  archived                boolean DEFAULT false,
  labels                  text[] DEFAULT '{}',
  created_at              timestamptz DEFAULT now(),
  UNIQUE(account_id, peer_username)
);

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  direction         text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body              text,
  media_url         text,
  tiktok_msg_id     text,
  status            text DEFAULT 'delivered' CHECK (status IN ('delivered', 'failed', 'pending')),
  sent_at           timestamptz NOT NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE(account_id, tiktok_msg_id)
);

CREATE INDEX idx_conversations_account ON conversations(account_id);
CREATE INDEX idx_conversations_last_msg ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_unread ON conversations(account_id) WHERE unread_count > 0;
CREATE INDEX idx_messages_conversation ON messages(conversation_id, sent_at DESC);
CREATE INDEX idx_messages_account ON messages(account_id);
