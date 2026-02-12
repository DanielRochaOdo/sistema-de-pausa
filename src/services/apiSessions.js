import { supabase } from './supabaseClient'

export async function listAgentLogins() {
  const { data, error } = await supabase.rpc('list_agent_logins')
  if (error) throw error
  return data
}

