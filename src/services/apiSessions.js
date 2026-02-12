import { supabase } from './supabaseClient'

export async function listAgentLogins() {
  const { data, error } = await supabase.rpc('list_agent_logins')
  if (error) throw error
  return data
}

export async function listAgentLoginHistory(agentId, { limit = 30, offset = 0 } = {}) {
  if (!agentId) throw new Error('Missing agentId')
  const { data, error } = await supabase.rpc('list_agent_login_history', {
    p_agent_id: agentId,
    p_limit: limit,
    p_offset: offset
  })
  if (error) throw error
  return data
}
