import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables')
}

export const supabase = createClient(url, key)
