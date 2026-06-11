import { supabase } from './utils/supabase.js'

async function run() {
  console.log('--- CONVERSATIONS ---')
  const { data: convs } = await supabase.from('conversations').select('peer_username, unread_count, last_message_text, last_message_direction')
  console.log(JSON.stringify(convs, null, 2))
}

run().catch(console.error)
