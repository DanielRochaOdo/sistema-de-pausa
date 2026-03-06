import { supabase } from './supabaseClient'

async function parseFunctionError(error, fallbackMessage) {
  let message = error?.message || fallbackMessage
  const response = error?.context

  if (!response) return message

  try {
    if (typeof response.clone === 'function') {
      const cloned = response.clone()
      try {
        const parsed = await cloned.json()
        if (parsed?.error) return String(parsed.error)
        if (parsed?.message) return String(parsed.message)
      } catch (_) {
        // ignore json parse
      }
      try {
        const text = await cloned.text()
        if (text && text.trim()) return text.trim()
      } catch (_) {
        // ignore text parse
      }
    }
  } catch (_) {
    // ignore clone errors
  }

  try {
    if (typeof response.json === 'function') {
      const parsed = await response.json()
      if (parsed?.error) return String(parsed.error)
      if (parsed?.message) return String(parsed.message)
    }
  } catch (_) {
    // ignore json parse
  }

  if (response?.status) {
    message = `${message} (HTTP ${response.status})`
  }

  return message
}

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
    .select('id, full_name, role, team_id, manager_id, email, is_admin')
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
  if (!id) throw new Error('Missing user id')
  const { data, error } = await supabase.functions.invoke('admin-update-user', {
    body: { user_id: id, ...updates }
  })
  if (error) {
    const message = await parseFunctionError(error, 'Falha ao atualizar usuario')
    throw new Error(message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data?.profile || data
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
    const message = await parseFunctionError(error, 'Falha ao criar usuario')
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
    const message = await parseFunctionError(error, 'Falha ao excluir usuario')
    throw new Error(message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data
}
