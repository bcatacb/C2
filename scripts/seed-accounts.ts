import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)
const csvPath = process.argv[2]

if (!csvPath) {
  console.error('Usage: tsx scripts/seed-accounts.ts <path-to-csv>')
  console.error('CSV format: username,display_name,transport_type,daily_dm_limit')
  process.exit(1)
}

const lines = readFileSync(csvPath, 'utf-8').trim().split('\n')
const headers = lines[0].split(',').map((h) => h.trim())

for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',').map((v) => v.trim())
  const row: Record<string, string> = {}
  headers.forEach((h, idx) => { row[h] = values[idx] })

  const { error } = await supabase.from('tiktok_accounts').insert({
    username: row.username,
    display_name: row.display_name || null,
    transport_type: row.transport_type || 'playwright',
    daily_dm_limit: parseInt(row.daily_dm_limit) || 50,
  })

  if (error) {
    console.error(`[${i}] Failed to insert ${row.username}:`, error.message)
  } else {
    console.log(`[${i}] Inserted @${row.username}`)
  }
}

console.log('Done.')
