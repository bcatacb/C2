import { normalizeUsername, isValidUsername, LeadStatus } from './lead-service.js'
import { supabase } from '../utils/supabase.js'

// --- Types ---

export interface CSVRow {
  username: string
  tags?: string
  notes?: string
}

export interface ImportDefaults {
  source?: string
  tags?: string[]
  status?: LeadStatus
}

export interface ImportResult {
  imported: number
  duplicates: number
  errors: ImportError[]
  total: number
}

export interface ImportError {
  row: number
  username: string
  reason: string
}

// --- Constants ---

const MAX_IMPORT_ROWS = 10_000
const SUPABASE_IN_CHUNK_SIZE = 1000

// --- Helper Functions ---

function parseTags(csvTags: string | undefined, defaultTags: string[] | undefined): string[] {
  const rowTags = csvTags
    ? csvTags.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : []
  const defaults = defaultTags || []
  return [...new Set([...rowTags, ...defaults])]
}

async function queryExistingUsernames(usernames: string[]): Promise<Set<string>> {
  if (usernames.length === 0) return new Set()

  const existing = new Set<string>()

  // Chunk queries to stay within Supabase .in() limits
  for (let i = 0; i < usernames.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const chunk = usernames.slice(i, i + SUPABASE_IN_CHUNK_SIZE)
    const { data, error } = await supabase
      .from('leads')
      .select('username')
      .in('username', chunk)

    if (error) throw new Error(error.message)
    if (data) {
      for (const row of data) {
        existing.add(row.username)
      }
    }
  }

  return existing
}

// --- Main Import Function ---

export async function processImport(rows: CSVRow[], defaults?: ImportDefaults): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, duplicates: 0, errors: [], total: rows.length }

  // Enforce row limit
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import exceeds maximum of ${MAX_IMPORT_ROWS} rows`)
  }

  // Step 1: Validate and normalize each row
  const validLeads: Array<{
    username: string
    tags: string[]
    notes: string | null
    source: string
    status: LeadStatus
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const normalized = normalizeUsername(row.username)

    if (!normalized || !isValidUsername(normalized)) {
      result.errors.push({
        row: i + 1,
        username: row.username || '',
        reason: 'Invalid username format',
      })
      continue
    }

    validLeads.push({
      username: normalized,
      tags: parseTags(row.tags, defaults?.tags),
      notes: row.notes || null,
      source: defaults?.source || 'csv',
      status: defaults?.status || 'new',
    })
  }

  // Step 2: Deduplicate against existing leads in the database
  const usernames = validLeads.map(l => l.username)
  const existingSet = await queryExistingUsernames(usernames)

  const newLeads = validLeads.filter(l => {
    if (existingSet.has(l.username)) {
      result.duplicates++
      return false
    }
    return true
  })

  // Step 3: Deduplicate within the batch itself
  const seenInBatch = new Set<string>()
  const uniqueNewLeads = newLeads.filter(l => {
    if (seenInBatch.has(l.username)) {
      result.duplicates++
      return false
    }
    seenInBatch.add(l.username)
    return true
  })

  // Step 4: Bulk insert
  if (uniqueNewLeads.length > 0) {
    const insertPayload = uniqueNewLeads.map(l => ({
      username: l.username,
      tags: l.tags,
      notes: l.notes,
      source: l.source,
      status: l.status,
    }))

    const { error } = await supabase.from('leads').insert(insertPayload)
    if (error) throw new Error(error.message)

    result.imported = uniqueNewLeads.length
  }

  // Postcondition: imported + duplicates + errors.length === total
  return result
}
