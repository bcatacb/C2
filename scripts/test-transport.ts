import { playwrightTransport } from '../server/transport/playwright.js'
import { getPoolStatus, shutdownPool } from '../server/transport/session-pool.js'

const accountId = process.argv[2] || 'test-account'

console.log('--- Transport Smoke Test ---')
console.log(`Account ID: ${accountId}`)
console.log(`Pool status:`, getPoolStatus())

try {
  console.log('\n1. Connecting...')
  const sessionData = await playwrightTransport.connect(accountId, null, null)
  console.log('   Connected. Session keys:', Object.keys(sessionData))

  console.log('\n2. Checking status...')
  const status = await playwrightTransport.getAccountStatus(accountId)
  console.log('   Status:', status)

  console.log('\n3. Fetching conversations...')
  const convos = await playwrightTransport.fetchConversations(accountId)
  console.log(`   Found ${convos.length} conversations`)

  if (convos.length > 0) {
    const first = convos[0]
    console.log(`\n4. Fetching messages for @${first.peerUsername}...`)
    const msgs = await playwrightTransport.fetchMessages(accountId, first.peerUsername)
    console.log(`   Found ${msgs.length} messages`)
  }

  console.log('\n5. Disconnecting...')
  await playwrightTransport.disconnect(accountId)
  console.log('   Disconnected.')

} catch (err) {
  console.error('Error:', err)
} finally {
  await shutdownPool()
  console.log('\nPool shut down. Done.')
}
