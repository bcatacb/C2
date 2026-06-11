export interface AccountStatus {
  connected: boolean
  restricted: boolean
  banned: boolean
}

export interface ConversationData {
  peerUsername: string
  peerDisplayName: string | null
  peerAvatar: string | null
  lastMessageText: string | null
  lastMessageAt: Date | null
  lastMessageDirection: 'inbound' | 'outbound' | null
  unreadCount: number
}

export interface MessageData {
  tiktokMsgId: string
  direction: 'inbound' | 'outbound'
  body: string | null
  mediaUrl: string | null
  sentAt: Date
}

export interface TikTokTransport {
  connect(accountId: string, sessionData: Record<string, unknown> | null, proxyUrl: string | null): Promise<Record<string, unknown>>
  disconnect(accountId: string): Promise<void>
  fetchConversations(accountId: string): Promise<ConversationData[]>
  fetchMessages(accountId: string, peerUsername: string, since?: Date): Promise<MessageData[]>
  sendMessage(accountId: string, peerUsername: string, body: string): Promise<MessageData>
  getAccountStatus(accountId: string): Promise<AccountStatus>
  scrapeFollowers(accountId: string, limit?: number): Promise<Array<{ username: string; displayName: string | null; isMutual: boolean }>>
}

