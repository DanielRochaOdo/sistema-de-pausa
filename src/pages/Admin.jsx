import { useEffect, useMemo, useState } from 'react'
import TopNav from '../components/TopNav'
import { useAuth } from '../contexts/useAuth'
import {
  createPauseType,
  createSector,
  createUserWithEdgeFunction,
  deleteUserWithEdgeFunction,
  deletePauseType,
  deleteSector,
  listManagerSectors,
  listManagers,
  listPauseTypes,
  listProfiles,
  listSectors,
  setManagerSectors,
  updatePauseType,
  updateProfile,
  updateSector
} from '../services/apiAdmin'
import { listPauseSchedules, upsertPauseSchedule, deletePauseSchedule } from '../services/apiPauses'

const emptyUserForm = {
  email: '',
  password: '',
  full_name: '',
  role: 'AGENTE',
  manager_id: '',
  team_id: '',
  sector_ids: []
}

const minutesToTime = (minutes) => {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return ''
  const safeMinutes = Math.max(0, Number(minutes))
  const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0')
  const mins = String(safeMinutes % 60).padStart(2, '0')
  return `${hours}:${mins}`
}

const timeToMinutes = (value) => {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

const normalizeTime = (value) => {
  if (!value) return ''
  return value.slice(0, 5)
}

export default function Admin() {
  const { profile: currentProfile } = useAuth()
  const [tab, setTab] = useState('users')
  const [profiles, setProfiles] = useState([])
  const [managers, setManagers] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [sectors, setSectors] = useState([])
  const [pauseSchedules, setPauseSchedules] = useState([])
  const [managerSectorsMap, setManagerSectorsMap] = useState({})
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [newType, setNewType] = useState({ code: '', label: '', limit_time: '' })
  const [newSector, setNewSector] = useState({ code: '', label: '' })
  const [scheduleForm, setScheduleForm] = useState({
    agent_id: '',
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })
  const [expandedAgentId, setExpandedAgentId] = useState('')

  const refreshAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [profilesData, typesData, managersData, sectorsData, schedulesData] = await Promise.all([
        listProfiles(),
        listPauseTypes(),
        listManagers(),
        listSectors(),
        listPauseSchedules()
      ])
      const managerSectorsData = await listManagerSectors()
      setProfiles(profilesData)
      setPauseTypes(typesData)
      setManagers(managersData)
      setSectors(sectorsData)
      setPauseSchedules(schedulesData)
      const nextMap = {}
      ;(managerSectorsData || []).forEach((row) => {
        if (!nextMap[row.manager_id]) nextMap[row.manager_id] = []
        nextMap[row.manager_id].push(row.sector_id)
      })
      setManagerSectorsMap(nextMap)
    } catch (err) {
      setError(err.message || 'Falha ao carregar dados')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshAll()
  }, [])

  const handleCreateUser = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await createUserWithEdgeFunction(userForm)
      setSuccess('Usuario criado com sucesso.')
      setUserForm(emptyUserForm)
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar usuario')
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (profile) => {
    if (!profile?.id) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (profile.role === 'GERENTE') {
        const sectorIds = managerSectorsMap[profile.id] || (profile.team_id ? [profile.team_id] : [])
        if (!sectorIds.length) {
          throw new Error('Gerente precisa de pelo menos um setor.')
        }
      }
      const payload = {
        full_name: profile.full_name,
        role: profile.role,
        manager_id: profile.manager_id || null,
        team_id: profile.team_id || null
      }
      await updateProfile(profile.id, payload)
      if (profile.role === 'GERENTE') {
        const sectorIds = managerSectorsMap[profile.id] || (profile.team_id ? [profile.team_id] : [])
        await setManagerSectors(profile.id, sectorIds)
      }
      setSuccess('Perfil atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteUser = async (profile) => {
    if (!profile?.id) return
    if (profile.role !== 'AGENTE') {
      setError('Somente agentes podem ser excluidos.')
      return
    }
    if (currentProfile?.id && profile.id === currentProfile.id) {
      setError('Nao e possivel excluir o usuario logado.')
      return
    }
    const confirmed = window.confirm(`Excluir agente ${profile.full_name}? Essa acao e definitiva.`)
    if (!confirmed) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await deleteUserWithEdgeFunction(profile.id)
      setSuccess('Agente excluido.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao excluir agente')
    } finally {
      setBusy(false)
    }
  }

  const handleTypeUpdate = async (type) => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await updatePauseType(type.id, {
        label: type.label,
        is_active: type.is_active,
        limit_minutes: type.limit_minutes ?? null
      })
      setSuccess('Tipo atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar tipo')
    } finally {
      setBusy(false)
    }
  }

  const handleTypeDelete = async (type) => {
    if (!type?.id) return
    const confirmed = window.confirm(`Excluir o tipo de pausa ${type.label}?`)
    if (!confirmed) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await deletePauseType(type.id)
      setSuccess('Tipo removido.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao remover tipo')
    } finally {
      setBusy(false)
    }
  }

  const handleTypeCreate = async () => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const limitMinutes = timeToMinutes(newType.limit_time)
      await createPauseType({
        code: newType.code,
        label: newType.label,
        limit_minutes: limitMinutes
      })
      setNewType({ code: '', label: '', limit_time: '' })
      setSuccess('Tipo criado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar tipo')
    } finally {
      setBusy(false)
    }
  }

  const handleSectorUpdate = async (sector) => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await updateSector(sector.id, { label: sector.label, is_active: sector.is_active })
      setSuccess('Setor atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar setor')
    } finally {
      setBusy(false)
    }
  }

  const handleSectorDelete = async (sector) => {
    if (!sector?.id) return
    const confirmed = window.confirm(`Excluir o setor ${sector.label}?`)
    if (!confirmed) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await deleteSector(sector.id)
      setSuccess('Setor removido.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao remover setor')
    } finally {
      setBusy(false)
    }
  }

  const handleSectorCreate = async () => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await createSector({ code: newSector.code, label: newSector.label })
      setNewSector({ code: '', label: '' })
      setSuccess('Setor criado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar setor')
    } finally {
      setBusy(false)
    }
  }

  const handleScheduleCreate = async () => {
    if (!scheduleForm.agent_id || !scheduleForm.pause_type_id || !scheduleForm.scheduled_time) {
      setError('Preencha agente, tipo e horario da pausa.')
      return
    }
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await upsertPauseSchedule({
        agent_id: scheduleForm.agent_id,
        pause_type_id: scheduleForm.pause_type_id,
        scheduled_time: scheduleForm.scheduled_time,
        duration_minutes: timeToMinutes(scheduleForm.duration_time)
      })
      setScheduleForm({ agent_id: '', pause_type_id: '', scheduled_time: '', duration_time: '' })
      setSuccess('Pausa programada salva.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao salvar pausa programada')
    } finally {
      setBusy(false)
    }
  }

  const handleScheduleUpdate = async (schedule) => {
    if (!schedule?.agent_id || !schedule?.pause_type_id || !schedule?.scheduled_time) {
      setError('Preencha agente, tipo e horario da pausa.')
      return
    }
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await upsertPauseSchedule({
        id: schedule.id,
        agent_id: schedule.agent_id,
        pause_type_id: schedule.pause_type_id,
        scheduled_time: schedule.scheduled_time,
        duration_minutes: schedule.duration_minutes ?? null
      })
      setSuccess('Pausa programada atualizada.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar pausa programada')
    } finally {
      setBusy(false)
    }
  }

  const handleScheduleDelete = async (schedule) => {
    if (!schedule?.id) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await deletePauseSchedule(schedule.id)
      setSuccess('Pausa programada removida.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao remover pausa programada')
    } finally {
      setBusy(false)
    }
  }

  const updateProfileField = (id, field, value) => {
    setProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== id) return profile
        const next = { ...profile, [field]: value }
        if (field === 'role') {
          if (value === 'ADMIN') {
            next.manager_id = ''
            next.team_id = ''
            setManagerSectorsMap((current) => ({ ...current, [id]: [] }))
          }
          if (value === 'GERENTE') {
            next.manager_id = ''
          }
          if (value !== 'GERENTE') {
            setManagerSectorsMap((current) => ({ ...current, [id]: [] }))
          }
        }
        return next
      })
    )
  }

  const updateTypeField = (id, field, value) => {
    setPauseTypes((prev) => prev.map((type) => (type.id === id ? { ...type, [field]: value } : type)))
  }

  const updateSectorField = (id, field, value) => {
    setSectors((prev) => prev.map((sector) => (sector.id === id ? { ...sector, [field]: value } : sector)))
  }

  const updateScheduleField = (id, field, value) => {
    setPauseSchedules((prev) =>
      prev.map((schedule) => (schedule.id === id ? { ...schedule, [field]: value } : schedule))
    )
  }

  const agents = useMemo(() => profiles.filter((profile) => profile.role === 'AGENTE'), [profiles])
  const getManagerSectorIds = (managerId, fallbackTeamId) => {
    const ids = managerSectorsMap[managerId]
    if (ids && ids.length) return ids
    return fallbackTeamId ? [fallbackTeamId] : []
  }

  const schedulesByAgent = useMemo(() => {
    const map = new Map()
    pauseSchedules.forEach((schedule) => {
      const key = schedule.agent_id || schedule.profiles?.id
      if (!key) return
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(schedule)
    })
    map.forEach((items) => {
      items.sort((a, b) => String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')))
    })
    return map
  }, [pauseSchedules])

  const sectorById = useMemo(() => {
    const map = new Map()
    sectors.forEach((sector) => {
      map.set(sector.id, sector.label)
    })
    return map
  }, [sectors])

  const sortedAgents = useMemo(() => {
    const list = [...agents]
    const nextTime = (agentId) => {
      const items = schedulesByAgent.get(agentId) || []
      if (!items.length) return null
      return items[0]?.scheduled_time || null
    }
    return list.sort((a, b) => {
      const aTime = nextTime(a.id)
      const bTime = nextTime(b.id)
      if (aTime && bTime) return String(aTime).localeCompare(String(bTime))
      if (aTime) return -1
      if (bTime) return 1
      return a.full_name.localeCompare(b.full_name)
    })
  }, [agents, schedulesByAgent])

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="px-6 pb-10 space-y-6">
        {error ? (
          <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : null}
        {success ? (
          <div className="card border-emerald-200 bg-emerald-50 text-emerald-700">{success}</div>
        ) : null}

        <div className="flex gap-2">
          <button
            className={`btn ${tab === 'users' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('users')}
          >
            Usuarios
          </button>
          <button
            className={`btn ${tab === 'pauseTypes' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('pauseTypes')}
          >
            Tipos de pausa
          </button>
          <button
            className={`btn ${tab === 'sectors' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('sectors')}
          >
            Setores
          </button>
          <button
            className={`btn ${tab === 'pauseSchedules' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('pauseSchedules')}
          >
            Pausas programadas
          </button>
        </div>

        {tab === 'users' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Criar usuario</h2>
              <p className="text-sm text-slate-600 mt-1">Requer Edge Function com service role.</p>
              <form className="mt-4 space-y-3" onSubmit={handleCreateUser}>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Senha provisoria</label>
                  <input
                    className="input mt-1"
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Nome completo</label>
                  <input
                    className="input mt-1"
                    value={userForm.full_name}
                    onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <select
                    className="input mt-1"
                    value={userForm.role}
                    onChange={(e) => {
                      const nextRole = e.target.value
                      setUserForm((prev) => ({
                        ...prev,
                        role: nextRole,
                        manager_id: nextRole === 'AGENTE' ? prev.manager_id : '',
                        team_id: nextRole === 'ADMIN' ? '' : prev.team_id,
                        sector_ids:
                          nextRole === 'GERENTE'
                            ? prev.sector_ids?.length
                              ? prev.sector_ids
                              : prev.team_id
                                ? [prev.team_id]
                                : []
                            : []
                      }))
                    }}
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="GERENTE">GERENTE</option>
                    <option value="AGENTE">AGENTE</option>
                  </select>
                </div>
                <div>
                  <label className="label">Gerente responsavel</label>
                  <select
                    className="input mt-1"
                    value={userForm.manager_id}
                    onChange={(e) => {
                      const nextManagerId = e.target.value
                      const manager = managers.find((item) => item.id === nextManagerId)
                      setUserForm((prev) => ({
                        ...prev,
                        manager_id: nextManagerId,
                        team_id: manager?.team_id || prev.team_id || ''
                      }))
                    }}
                    disabled={userForm.role !== 'AGENTE'}
                    required={userForm.role === 'AGENTE'}
                  >
                    <option value="">Nenhum</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Setor</label>
                  {userForm.role === 'GERENTE' ? (
                    <select
                      className="input mt-1"
                      multiple
                      value={userForm.sector_ids}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                        setUserForm((prev) => ({
                          ...prev,
                          sector_ids: selected,
                          team_id: selected[0] || ''
                        }))
                      }}
                      required={userForm.role === 'GERENTE'}
                    >
                      {sectors.map((sector) => (
                        <option key={sector.id} value={sector.id}>
                          {sector.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="input mt-1"
                      value={userForm.team_id}
                      onChange={(e) => setUserForm({ ...userForm, team_id: e.target.value })}
                      disabled={userForm.role === 'ADMIN'}
                      required={userForm.role === 'GERENTE'}
                    >
                      <option value="">Nenhum</option>
                      {sectors.map((sector) => (
                        <option key={sector.id} value={sector.id}>
                          {sector.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <button className="btn-primary w-full" type="submit" disabled={busy}>
                  {busy ? 'Criando...' : 'Criar usuario'}
                </button>
              </form>
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold text-slate-900">Usuarios cadastrados</h2>
                {loading ? <span className="text-sm text-slate-500">Carregando...</span> : null}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-2">Nome</th>
                      <th className="text-left py-2">Role</th>
                      <th className="text-left py-2">Manager</th>
                      <th className="text-left py-2">Setor</th>
                      <th className="text-left py-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-900">
                    {profiles.map((profile) => (
                      <tr key={profile.id} className="border-t border-slate-100">
                        <td className="py-2">
                          <input
                            className="input"
                            value={profile.full_name}
                            onChange={(e) => updateProfileField(profile.id, 'full_name', e.target.value)}
                          />
                        </td>
                        <td className="py-2">
                          <select
                            className="input"
                            value={profile.role}
                            onChange={(e) => updateProfileField(profile.id, 'role', e.target.value)}
                          >
                            <option value="ADMIN">ADMIN</option>
                            <option value="GERENTE">GERENTE</option>
                            <option value="AGENTE">AGENTE</option>
                          </select>
                        </td>
                        <td className="py-2">
                          <select
                            className="input"
                            value={profile.manager_id || ''}
                            onChange={(e) => updateProfileField(profile.id, 'manager_id', e.target.value)}
                            disabled={profile.role !== 'AGENTE'}
                          >
                            <option value="">Nenhum</option>
                            {managers.map((manager) => (
                              <option key={manager.id} value={manager.id}>
                                {manager.full_name}
                              </option>
                            ))}
                          </select>
                        </td>
                      <td className="py-2">
                          {profile.role === 'GERENTE' ? (
                            <select
                              className="input"
                              multiple
                              value={getManagerSectorIds(profile.id, profile.team_id)}
                              onChange={(e) => {
                                const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                                setManagerSectorsMap((current) => ({
                                  ...current,
                                  [profile.id]: selected
                                }))
                                updateProfileField(profile.id, 'team_id', selected[0] || '')
                              }}
                            >
                              {sectors.map((sector) => (
                                <option key={sector.id} value={sector.id}>
                                  {sector.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              className="input"
                              value={profile.team_id || ''}
                              onChange={(e) => updateProfileField(profile.id, 'team_id', e.target.value)}
                              disabled={profile.role === 'ADMIN'}
                            >
                              <option value="">Nenhum</option>
                              {sectors.map((sector) => (
                                <option key={sector.id} value={sector.id}>
                                  {sector.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="py-2">
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => handleUpdate(profile)}
                            disabled={busy}
                          >
                            Salvar
                          </button>
                          {profile.role === 'AGENTE' ? (
                            <button
                              className="btn-ghost text-red-600"
                              type="button"
                              onClick={() => handleDeleteUser(profile)}
                              disabled={busy}
                            >
                              Excluir
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {!profiles.length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="5">
                          Nenhum usuario encontrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'pauseTypes' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Criar tipo de pausa</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="label">Codigo</label>
                  <input
                    className="input mt-1"
                    value={newType.code}
                    onChange={(e) => setNewType({ ...newType, code: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="label">Label</label>
                  <input
                    className="input mt-1"
                    value={newType.label}
                    onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Tempo limite (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={newType.limit_time}
                    onChange={(e) => setNewType({ ...newType, limit_time: e.target.value })}
                  />
                </div>
                <button className="btn-primary w-full" type="button" onClick={handleTypeCreate} disabled={busy}>
                  {busy ? 'Salvando...' : 'Criar tipo'}
                </button>
              </div>
            </div>
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Tipos cadastrados</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-2">Codigo</th>
                      <th className="text-left py-2">Label</th>
                      <th className="text-left py-2">Tempo limite</th>
                      <th className="text-left py-2">Ativo</th>
                      <th className="text-left py-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-900">
                    {pauseTypes.map((type) => (
                      <tr key={type.id} className="border-t border-slate-100">
                        <td className="py-2">{type.code}</td>
                        <td className="py-2">
                          <input
                            className="input"
                            value={type.label}
                            onChange={(e) => updateTypeField(type.id, 'label', e.target.value)}
                          />
                        </td>
                        <td className="py-2">
                          <input
                            className="input"
                            type="time"
                            step="60"
                            value={minutesToTime(type.limit_minutes)}
                            onChange={(e) =>
                              updateTypeField(type.id, 'limit_minutes', timeToMinutes(e.target.value))
                            }
                          />
                        </td>
                        <td className="py-2">
                          <select
                            className="input"
                            value={type.is_active ? 'true' : 'false'}
                            onChange={(e) => updateTypeField(type.id, 'is_active', e.target.value === 'true')}
                          >
                            <option value="true">Ativo</option>
                            <option value="false">Inativo</option>
                          </select>
                        </td>
                        <td className="py-2">
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => handleTypeUpdate(type)}
                            disabled={busy}
                          >
                            Salvar
                          </button>
                          <button
                            className="btn-ghost text-red-600"
                            type="button"
                            onClick={() => handleTypeDelete(type)}
                            disabled={busy}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!pauseTypes.length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="5">
                          Nenhum tipo cadastrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'sectors' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Criar setor</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="label">Codigo</label>
                  <input
                    className="input mt-1"
                    value={newSector.code}
                    onChange={(e) => setNewSector({ ...newSector, code: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="label">Label</label>
                  <input
                    className="input mt-1"
                    value={newSector.label}
                    onChange={(e) => setNewSector({ ...newSector, label: e.target.value })}
                  />
                </div>
                <button className="btn-primary w-full" type="button" onClick={handleSectorCreate} disabled={busy}>
                  {busy ? 'Salvando...' : 'Criar setor'}
                </button>
              </div>
            </div>
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Setores cadastrados</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-2">Codigo</th>
                      <th className="text-left py-2">Label</th>
                      <th className="text-left py-2">Ativo</th>
                      <th className="text-left py-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-900">
                    {sectors.map((sector) => (
                      <tr key={sector.id} className="border-t border-slate-100">
                        <td className="py-2">{sector.code}</td>
                        <td className="py-2">
                          <input
                            className="input"
                            value={sector.label}
                            onChange={(e) => updateSectorField(sector.id, 'label', e.target.value)}
                          />
                        </td>
                        <td className="py-2">
                          <select
                            className="input"
                            value={sector.is_active ? 'true' : 'false'}
                            onChange={(e) => updateSectorField(sector.id, 'is_active', e.target.value === 'true')}
                          >
                            <option value="true">Ativo</option>
                            <option value="false">Inativo</option>
                          </select>
                        </td>
                        <td className="py-2">
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => handleSectorUpdate(sector)}
                            disabled={busy}
                          >
                            Salvar
                          </button>
                          <button
                            className="btn-ghost text-red-600"
                            type="button"
                            onClick={() => handleSectorDelete(sector)}
                            disabled={busy}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!sectors.length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="4">
                          Nenhum setor cadastrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'pauseSchedules' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Programar pausa</h2>
              <p className="text-sm text-slate-600 mt-1">
                Se o tempo nao for definido, usa o limite configurado no tipo de pausa.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="label">Agente</label>
                  <select
                    className="input mt-1"
                    value={scheduleForm.agent_id}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, agent_id: e.target.value }))}
                  >
                    <option value="">Selecione</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Tipo de pausa</label>
                  <select
                    className="input mt-1"
                    value={scheduleForm.pause_type_id}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, pause_type_id: e.target.value }))}
                  >
                    <option value="">Selecione</option>
                    {pauseTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Horario da pausa</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={scheduleForm.scheduled_time}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, scheduled_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Duracao (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={scheduleForm.duration_time}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_time: e.target.value }))}
                  />
                </div>
                <button className="btn-primary w-full" type="button" onClick={handleScheduleCreate} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar pausa'}
                </button>
              </div>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Pausas programadas</h2>
              <div className="mt-4 space-y-3">
                {sortedAgents.map((agent) => {
                  const items = schedulesByAgent.get(agent.id) || []
                  const isOpen = expandedAgentId === agent.id
                  const sectorLabel = sectorById.get(agent.team_id) || 'Sem setor'
                  return (
                    <div key={agent.id} className="rounded-xl border border-slate-200">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        onClick={() => setExpandedAgentId(isOpen ? '' : agent.id)}
                      >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{agent.full_name}</p>
                        <p className="text-xs text-slate-500">
                          {sectorLabel} • {items.length} pausas registradas
                        </p>
                      </div>
                        <span className="text-xs text-slate-500">{isOpen ? 'Fechar' : 'Ver pausas'}</span>
                      </button>
                      {isOpen ? (
                        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                          {items.length ? (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead className="text-slate-500">
                                  <tr>
                                    <th className="text-left py-2">Tipo</th>
                                    <th className="text-left py-2">Horario</th>
                                    <th className="text-left py-2">Duracao</th>
                                    <th className="text-left py-2">Acoes</th>
                                  </tr>
                                </thead>
                                <tbody className="text-slate-900">
                                  {items.map((schedule) => (
                                    <tr key={schedule.id} className="border-t border-slate-100">
                                      <td className="py-2">{schedule.pause_types?.label || '-'}</td>
                                      <td className="py-2">
                                        <input
                                          className="input"
                                          type="time"
                                          step="60"
                                          value={normalizeTime(schedule.scheduled_time)}
                                          onChange={(e) =>
                                            updateScheduleField(schedule.id, 'scheduled_time', e.target.value)
                                          }
                                        />
                                      </td>
                                      <td className="py-2">
                                        <input
                                          className="input"
                                          type="time"
                                          step="60"
                                          value={minutesToTime(schedule.duration_minutes)}
                                          onChange={(e) =>
                                            updateScheduleField(
                                              schedule.id,
                                              'duration_minutes',
                                              timeToMinutes(e.target.value)
                                            )
                                          }
                                        />
                                      </td>
                                      <td className="py-2">
                                        <div className="flex gap-2">
                                          <button
                                            className="btn-ghost"
                                            type="button"
                                            onClick={() => handleScheduleUpdate(schedule)}
                                            disabled={busy}
                                          >
                                            Salvar
                                          </button>
                                          <button
                                            className="btn-ghost text-red-600"
                                            type="button"
                                            onClick={() => handleScheduleDelete(schedule)}
                                            disabled={busy}
                                          >
                                            Remover
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">Nenhuma pausa programada.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {!agents.length ? <p className="text-sm text-slate-500">Nenhum agente encontrado.</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
