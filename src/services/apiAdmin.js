import { supabase } from './supabaseClient'

export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, manager_id, team_id, created_at, email, is_admin')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function listAgents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, team_id, email, is_admin')
    .eq('role', 'AGENTE')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function listManagers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, team_id')
    .in('role', ['GERENTE'])
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

export async function listSectors() {
  const { data, error } = await supabase
    .from('sectors')
    .select('id, code, label, is_active')
    .order('label', { ascending: true })
  if (error) throw error
  return data
}

export async function listManagerSectors() {
  const { data, error } = await supabase
    .from('manager_sectors')
    .select('manager_id, sector_id')
  if (error) throw error
  return data
}

export async function setManagerSectors(managerId, sectorIds) {
  if (!managerId) throw new Error('Missing manager id')
  const ids = (sectorIds || []).filter(Boolean)
  const { error: deleteError } = await supabase
    .from('manager_sectors')
    .delete()
    .eq('manager_id', managerId)
  if (deleteError) throw deleteError
  if (!ids.length) return
  const rows = ids.map((sectorId) => ({ manager_id: managerId, sector_id: sectorId }))
  const { error: insertError } = await supabase.from('manager_sectors').insert(rows)
  if (insertError) throw insertError
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

export async function deletePauseType(id) {
  const { error } = await supabase.from('pause_types').delete().eq('id', id)
  if (error) throw error
}

export async function createSector(payload) {
  const { data, error } = await supabase.from('sectors').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateSector(id, updates) {
  const { data, error } = await supabase
    .from('sectors')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteSector(id) {
  const { error } = await supabase.from('sectors').delete().eq('id', id)
  if (error) throw error
}

export async function createUserWithEdgeFunction(payload) {
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body: payload
  })
  if (error) {
    let message = error.message || 'Falha ao criar usuario'
    try {
      const response = error.context
      if (response?.json) {
        const parsed = await response.json()
        if (parsed?.error) message = parsed.error
      }
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data
}

export async function deleteUserWithEdgeFunction(userId) {
  if (!userId) throw new Error('Missing user id')
  const { data, error } = await supabase.functions.invoke('admin-delete-user', {
    body: { user_id: userId }
  })
  if (error) {
    let message = error.message || 'Falha ao excluir usuario'
    try {
      const response = error.context
      if (response?.json) {
        const parsed = await response.json()
        if (parsed?.error) message = parsed.error
      }
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data
}
