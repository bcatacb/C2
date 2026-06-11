process.env.ENABLE_INBOX_SYNC = 'false'
process.env.ENABLE_CAMPAIGN_WORKER = 'false'

import { sendMessage } from './services/message-sender.js'
import { createNote, listNotes } from './services/note-service.js'
import { evaluateRules } from './services/automation-engine.js'
import { processCampaign } from './services/campaign-worker.js'
import { getCampaign, getStats } from './services/campaign-service.js'
import { supabase } from './utils/supabase.js'
import { shutdownPool } from './transport/session-pool.js'

const ACCOUNT_ID = '81181010-7ed7-46f3-a86a-c266c8c0d6f8'
const LEAD_ID = '9f05f7e7-a21b-47d8-b817-d5b80c8fef5a'
const CONVERSATION_ID = '0317a80c-0274-4b46-8cff-5f85823fa5ae'
const CAMPAIGN_ID = '4c4322d5-5480-4bae-818a-bdd27b4fb4c9'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runLiveTests() {
  console.log('=== STARTING LIVE FUNCTIONAL TESTS ===\n')

  try {
    // --- PART 1: SEND MANUAL DM ---
    console.log('1. Testing manual message sending via Playwright...')
    try {
      const text = `Live DM test. Timestamp: ${new Date().toLocaleTimeString()}`
      const msg = await sendMessage(ACCOUNT_ID, 'ogtommyp', text)
      console.log(`✅ Message sent & recorded. DB message ID: ${msg.id}, tiktok_msg_id: ${msg.tiktok_msg_id}`)
    } catch (err: any) {
      console.error(`❌ Message send failed:`, err.message)
    }

    await sleep(3000)

    // --- PART 2: CONVERSATION NOTES ---
    console.log('\n2. Testing conversation notes creation and listing...')
    try {
      const noteText = `Live functional test note at ${new Date().toLocaleTimeString()}`
      const note = await createNote(CONVERSATION_ID, noteText)
      console.log(`✅ Note created: "${note.body}"`)
      const notes = await listNotes(CONVERSATION_ID)
      const found = notes.some(n => n.id === note.id)
      console.log(`✅ List notes verified. Found newly created note: ${found}`)
    } catch (err: any) {
      console.error(`❌ Notes test failed:`, err.message)
    }

    await sleep(3000)

    // --- PART 3: AUTOMATION AUTO-REPLY ---
    console.log('\n3. Testing automation auto-reply trigger...')
    try {
      // We mock the context of an inbound message coming in
      const context = {
        account_id: ACCOUNT_ID,
        conversation_id: CONVERSATION_ID,
        peer_username: 'ogtommyp',
        peer_display_name: 'ogtommyp',
        message_text: 'Hello, testing auto-reply keyword trigger',
        is_new_sender: false,
        is_first_campaign_reply: false,
        conversation_labels: [],
      }

      console.log('Evaluating automation rules for mock context...')
      const results = await evaluateRules(context)
      console.log(`Results:`, results)
      
      // Check if the log was inserted
      const { data: logs } = await supabase
        .from('automation_log')
        .select('*')
        .eq('conversation_id', CONVERSATION_ID)
        .order('created_at', { ascending: false })
        .limit(1)

      if (logs && logs.length > 0) {
        console.log(`✅ Automation log verified. Last run: Rule "${logs[0].rule_id}" triggered. Actions:`, logs[0].actions_taken)
      } else {
        console.log(`❌ No automation log entries found.`)
      }
    } catch (err: any) {
      console.error(`❌ Automation test failed:`, err.message)
    }

    await sleep(3000)

    // --- PART 4: CAMPAIGN WORKER OUTREACH ---
    console.log('\n4. Testing Campaign Worker outreach flow...')
    try {
      // Set lead status to new so it isn't skipped
      await supabase.from('leads').update({ status: 'new' }).eq('id', LEAD_ID)
      console.log('Reset lead status of ogtommyp to "new".')

      // Clean up any existing campaign leads for this campaign/lead
      await supabase.from('campaign_leads').delete().eq('campaign_id', CAMPAIGN_ID).eq('lead_id', LEAD_ID)

      // Assign the account and activate the campaign if draft
      await supabase.from('campaigns')
        .update({
          assigned_account_ids: [ACCOUNT_ID],
          status: 'active'
        })
        .eq('id', CAMPAIGN_ID)
      console.log('Updated campaign to active with deadbread101 assigned.')

      // Enroll lead in campaign
      const { data: campaignLead, error: enrollError } = await supabase
        .from('campaign_leads')
        .insert({
          campaign_id: CAMPAIGN_ID,
          lead_id: LEAD_ID,
          current_step: 0,
          status: 'pending',
          next_send_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (enrollError) throw enrollError
      console.log(`Enrolled lead ogtommyp in campaign_leads: ${campaignLead.id}`)

      // Get active campaign details and run it
      const campaignObj = await getCampaign(CAMPAIGN_ID)
      if (!campaignObj) throw new Error('Campaign not found')

      console.log('Running campaign processor for "test campaign"...')
      await processCampaign(campaignObj)
      console.log('Campaign processor execution complete.')

      // Verify campaign_lead status was updated to contacted or completed
      const { data: updatedCampaignLead } = await supabase
        .from('campaign_leads')
        .select('*')
        .eq('id', campaignLead.id)
        .single()

      console.log(`Campaign lead status in DB is now: "${updatedCampaignLead?.status}", current_step: ${updatedCampaignLead?.current_step}`)
      if (updatedCampaignLead && (updatedCampaignLead.status === 'contacted' || updatedCampaignLead.current_step > 0)) {
        console.log('✅ Campaign worker successfully sent outreach and updated progress!')
      } else {
        console.log('❌ Campaign worker did not update lead step/status.')
      }

    } catch (err: any) {
      console.error(`❌ Campaign test failed:`, err.message)
    }

  } finally {
    console.log('Shutting down session pool...')
    await shutdownPool()
    console.log('\n=== LIVE TESTS COMPLETE ===')
    process.exit(0)
  }
}

runLiveTests().catch(console.error)
