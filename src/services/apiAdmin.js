import { supabase } from './supabaseClient'

export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, manager_id, team_id, created_at')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function listAgents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('role', 'AGENTE')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function listManagers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['GERENTE', 'ADMIN'])
    .order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function updateProfile(id, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listPauseTypes() {
  const { data, error } = await supabase
    .from('pause_types')
    .select('*')
    .order('label', { ascending: true })
  if (error) throw error
  return data
}

export async function createPauseType(payload) {
  const { data, error } = await supabase.from('pause_types').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updatePauseType(id, updates) {
  const { data, error } = await supabase
    .from('pause_types')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function createUserWithEdgeFunction(payload, accessToken) {
  if (!accessToken) throw new Error('Sessao invalida. Faça login novamente.')
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.error || 'Falha ao criar usuario')
  }

  return data
}