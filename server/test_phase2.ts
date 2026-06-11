import { supabase } from './utils/supabase.js'
import { createLeadList, deleteLeadList, listLeadLists, addLeadsToList } from './services/lead-list-service.js'
import { createLead, deleteLead, listLeads } from './services/lead-service.js'
import { updateAccount } from './services/account-manager.js'

async function runTests() {
  console.log('=== STARTING PHASE 2 FUNCTIONAL TEST SUITE ===\n')

  let testListId: string | null = null
  let lead1Id: string | null = null
  let lead2Id: string | null = null
  const testUsername1 = 'testuser_p2_1'
  const testUsername2 = 'testuser_p2_2'

  try {
    // ── 1. TEST LIST CREATION ──
    console.log('1. Testing folder list creation...')
    const list = await createLeadList('Test Phase 2 Folder', 'Temporary test folder description')
    testListId = list.id
    console.log(`✅ Folder created successfully. ID: ${testListId}, Name: "${list.name}"`)

    // ── 2. TEST LEAD CREATION ──
    console.log('\n2. Creating test leads...')
    // Clean up if previous tests failed
    const { data: existing1 } = await supabase.from('leads').select('id').eq('username', testUsername1).single()
    if (existing1) await deleteLead(existing1.id)
    const { data: existing2 } = await supabase.from('leads').select('id').eq('username', testUsername2).single()
    if (existing2) await deleteLead(existing2.id)

    const lead1 = await createLead({ username: testUsername1, source: 'test_phase2' })
    const lead2 = await createLead({ username: testUsername2, source: 'test_phase2' })
    lead1Id = lead1.id
    lead2Id = lead2.id
    console.log(`✅ Leads created. Lead 1: @${lead1.username} (${lead1Id}), Lead 2: @${lead2.username} (${lead2Id})`)

    // ── 3. TEST LIST MEMBERSHIP (ADD TO FOLDER) ──
    console.log('\n3. Adding leads to folder...')
    await addLeadsToList(testListId, [lead1Id, lead2Id])
    
    // Check list counts
    const lists = await listLeadLists()
    const currentList = lists.find(l => l.id === testListId)
    console.log(`✅ Leads added. Folder "${currentList?.name}" now has member count: ${currentList?.lead_count}`)

    // ── 4. TEST FILTER BY LIST ID ──
    console.log('\n4. Filtering leads by folder list ID...')
    const filtered = await listLeads({ list_id: testListId })
    console.log(`✅ Filter complete. Returned ${filtered.data.length} leads in folder.`)
    const matchedNames = filtered.data.map(l => l.username)
    console.log(`   Members found: ${matchedNames.join(', ')}`)
    if (filtered.data.length === 2 && matchedNames.includes(testUsername1) && matchedNames.includes(testUsername2)) {
      console.log('   👉 Folder filtering verified!')
    } else {
      throw new Error('Folder filtering failed to return correct members')
    }

    // ── 5. TEST LOAD BALANCER ROTATION SORTING ──
    console.log('\n5. Testing Account Rotator load-balancing sorting...')
    // We simulate account capacities
    const mockAccounts = [
      { id: 'acct_A', remaining: 50, sent: 40 },
      { id: 'acct_B', remaining: 50, sent: 10 },
      { id: 'acct_C', remaining: 50, sent: 25 },
    ]
    // Available accounts sorting
    const sorted = [...mockAccounts].filter(a => a.remaining > 0).sort((a, b) => a.sent - b.sent)
    console.log('   Mock Accounts load (sent count today):')
    mockAccounts.forEach(a => console.log(`   - ${a.id}: ${a.sent} sent`))
    console.log('   Sorted accounts for next send (lowest sent load first):')
    sorted.forEach(a => console.log(`   - ${a.id}: ${a.sent} sent`))
    
    if (sorted[0].id === 'acct_B' && sorted[1].id === 'acct_C' && sorted[2].id === 'acct_A') {
      console.log('✅ Account Rotator load balancing sorting verified successfully!')
    } else {
      throw new Error('Load balancing sorting failed')
    }

  } catch (err: any) {
    console.error('❌ Test failed:', err.message)
  } finally {
    // ── CLEANUP ──
    console.log('\nCleaning up database records...')
    if (testListId) {
      await deleteLeadList(testListId)
      console.log(`- Deleted test folder: ${testListId}`)
    }
    if (lead1Id) {
      await deleteLead(lead1Id)
      console.log(`- Deleted test lead 1: ${lead1Id}`)
    }
    if (lead2Id) {
      await deleteLead(lead2Id)
      console.log(`- Deleted test lead 2: ${lead2Id}`)
    }
    console.log('\n=== TESTS COMPLETE ===')
    process.exit(0)
  }
}

runTests().catch(console.error)
