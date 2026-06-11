import type { TikTokTransport, ConversationData, MessageData, AccountStatus } from './interface.js'

export const apiTransport: TikTokTransport = {
  async connect(_accountId, _sessionData, _proxyUrl) {
    throw new Error('TikTok Business API transport not yet implemented — requires non-US account registration')
  },

  async disconnect(_accountId) {
    throw new Error('TikTok Business API transport not yet implemented')
  },

  async fetchConversations(_accountId): Promise<ConversationData[]> {
    throw new Error('TikTok Business API transport not yet implemented')
  },

  async fetchMessages(_accountId, _peerUsername, _since): Promise<MessageData[]> {
    throw new Error('TikTok Business API transport not yet implemented')
  },

  async sendMessage(_accountId, _peerUsername, _body): Promise<MessageData> {
    throw new Error('TikTok Business API transport not yet implemented')
  },

  async getAccountStatus(_accountId): Promise<AccountStatus> {
    throw new Error('TikTok Business API transport not yet implemented')
  },
  
  async scrapeFollowers(_accountId, _limit): Promise<Array<{ username: string; displayName: string | null; isMutual: boolean }>> {
    throw new Error('TikTok Business API transport not yet implemented')
  },
}

