import { supabase } from '../utils/supabase.js'

// --- Types ---

export interface ConversationNote {
  id: string
  conversation_id: string
  body: string
  created_at: string
}

// --- CRUD Functions ---

export async function listNotes(conversationId: string): Promise<ConversationNote[]> {
  const { data, error } = await supabase
    .from('conversation_notes')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return data as ConversationNote[]
}

export async function createNote(conversationId: string, body: string): Promise<ConversationNote> {
  // Validate body
  if (!body || body.trim().length === 0) {
    throw new Error('Note body cannot be empty')
  }
  if (body.length > 2000) {
    throw new Error('Note body cannot exceed 2000 characters')
  }

  // Validate conversation exists
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .single()

  if (convError || !conversation) {
    throw new Error('Conversation not found')
  }

  // Insert note
  const { data, error } = await supabase
    .from('conversation_notes')
    .insert({
      conversation_id: conversationId,
      body: body.trim(),
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as ConversationNote
}

export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_notes')
    .delete()
    .eq('id', noteId)

  if (error) throw new Error(error.message)
}
