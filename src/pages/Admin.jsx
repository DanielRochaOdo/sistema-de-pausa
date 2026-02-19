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

const emptyManagerForm = {
  email: '',
  password: '',
  full_name: '',
  sector_ids: []
}

const emptyAdminForm = {
  email: '',
  password: '',
  full_name: ''
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
  const [managerForm, setManagerForm] = useState(emptyManagerForm)
  const [adminForm, setAdminForm] = useState(emptyAdminForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [userSortDir, setUserSortDir] = useState('asc')
  const [newType, setNewType] = useState({
    code: '',
    label: '',
    limit_time: '',
    tolerance_start_time: '',
    tolerance_end_time: ''
  })
  const [newSector, setNewSector] = useState({ code: '', label: '' })
  const [scheduleForm, setScheduleForm] = useState({
    agent_id: '',
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })
  const [expandedAgentId, setExpandedAgentId] = useState('')
  const [expandedSectorId, setExpandedSectorId] = useState('')
  const [sectorEditManagerId, setSectorEditManagerId] = useState('')
  const [usersView, setUsersView] = useState('sectors')
  const [pauseModalOpen, setPauseModalOpen] = useState(false)
  const [pauseModalAgentId, setPauseModalAgentId] = useState('')
  const [pauseModalAgentName, setPauseModalAgentName] = useState('')
  const [pauseModalForm, setPauseModalForm] = useState({
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })
  const [pauseModalItems, setPauseModalItems] = useState([])
  const [agentEditModalOpen, setAgentEditModalOpen] = useState(false)
  const [agentEditId, setAgentEditId] = useState('')
  const [agentEditForm, setAgentEditForm] = useState({
    full_name: '',
    manager_id: '',
    team_id: '',
    email: ''
  })
  const [agentEditScheduleForm, setAgentEditScheduleForm] = useState({
    pause_type_id: '',
    scheduled_time: '',
    duration_time: ''
  })
  const [managerEditModalOpen, setManagerEditModalOpen] = useState(false)
  const [managerEditId, setManagerEditId] = useState('')
  const [managerEditForm, setManagerEditForm] = useState({
    full_name: '',
    email: '',
    is_admin: false
  })
  const [adminEditModalOpen, setAdminEditModalOpen] = useState(false)
  const [adminEditId, setAdminEditId] = useState('')
  const [adminEditForm, setAdminEditForm] = useState({
    full_name: '',
    email: ''
  })

  const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))
  const isDuplicateEmail = (value, ignoreId = null) => {
    const normalized = normalizeEmail(value)
    if (!normalized) return false
    return profiles.some(
      (profile) =>
        profile.id !== ignoreId &&
        profile.email &&
        normalizeEmail(profile.email) === normalized
    )
  }

  const requiresScheduleTime = (pauseTypeId) => {
    const type = pauseTypes.find((item) => item.id === pauseTypeId)
    return type?.code !== 'BANHEIRO'
  }

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
      if (!isValidEmail(userForm.email)) {
        throw new Error('Email invalido.')
      }
      if (isDuplicateEmail(userForm.email)) {
        throw new Error('Email ja cadastrado.')
      }
      const created = await createUserWithEdgeFunction(userForm)
      setSuccess('Usuario criado com sucesso.')
      if (userForm.role === 'AGENTE' && created?.id) {
        setPauseModalAgentId(created.id)
        setPauseModalAgentName(userForm.full_name)
        setPauseModalForm({
          pause_type_id: pauseTypes?.[0]?.id || '',
          scheduled_time: '',
          duration_time: ''
        })
        setPauseModalItems([])
        setPauseModalOpen(true)
      }
      setUserForm(emptyUserForm)
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar usuario')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateManager = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (!isValidEmail(managerForm.email)) {
        throw new Error('Email invalido.')
      }
      if (isDuplicateEmail(managerForm.email)) {
        throw new Error('Email ja cadastrado.')
      }
      const sectorIds = managerForm.sector_ids || []
      if (!sectorIds.length) {
        throw new Error('Selecione ao menos um setor.')
      }
      await createUserWithEdgeFunction({
        email: managerForm.email,
        password: managerForm.password,
        full_name: managerForm.full_name,
        role: 'GERENTE',
        team_id: sectorIds[0],
        sector_ids: sectorIds
      })
      setSuccess('Gerente criado com sucesso.')
      setManagerForm(emptyManagerForm)
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar gerente')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateAdmin = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (!isValidEmail(adminForm.email)) {
        throw new Error('Email invalido.')
      }
      if (isDuplicateEmail(adminForm.email)) {
        throw new Error('Email ja cadastrado.')
      }
      await createUserWithEdgeFunction({
        email: adminForm.email,
        password: adminForm.password,
        full_name: adminForm.full_name,
        role: 'ADMIN'
      })
      setSuccess('Admin criado com sucesso.')
      setAdminForm(emptyAdminForm)
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar admin')
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
        limit_minutes: type.limit_minutes ?? null,
        tolerance_start_minutes: type.tolerance_start_minutes ?? null,
        tolerance_end_minutes: type.tolerance_end_minutes ?? null
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
      const toleranceStartMinutes = timeToMinutes(newType.tolerance_start_time)
      const toleranceEndMinutes = timeToMinutes(newType.tolerance_end_time)
      await createPauseType({
        code: newType.code,
        label: newType.label,
        limit_minutes: limitMinutes,
        tolerance_start_minutes: toleranceStartMinutes,
        tolerance_end_minutes: toleranceEndMinutes
      })
      setNewType({
        code: '',
        label: '',
        limit_time: '',
        tolerance_start_time: '',
        tolerance_end_time: ''
      })
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
    const needsTime = requiresScheduleTime(scheduleForm.pause_type_id)
    if (!scheduleForm.agent_id || !scheduleForm.pause_type_id || (needsTime && !scheduleForm.scheduled_time)) {
      setError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const scheduledTime = needsTime ? scheduleForm.scheduled_time : scheduleForm.scheduled_time || null
      await upsertPauseSchedule({
        agent_id: scheduleForm.agent_id,
        pause_type_id: scheduleForm.pause_type_id,
        scheduled_time: scheduledTime,
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
    const needsTime = requiresScheduleTime(schedule?.pause_type_id)
    if (!schedule?.agent_id || !schedule?.pause_type_id || (needsTime && !schedule?.scheduled_time)) {
      setError('Preencha agente e tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const scheduledTime = needsTime ? schedule.scheduled_time : schedule.scheduled_time || null
      await upsertPauseSchedule({
        id: schedule.id,
        agent_id: schedule.agent_id,
        pause_type_id: schedule.pause_type_id,
        scheduled_time: scheduledTime,
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

  const sortedProfiles = useMemo(() => {
    const list = profiles.filter((profile) => profile.role !== 'GERENTE' && profile.role !== 'ADMIN')
    list.sort((a, b) => {
      const nameA = a.full_name || ''
      const nameB = b.full_name || ''
      const cmp = nameA.localeCompare(nameB)
      return userSortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [profiles, userSortDir])

  const agentsBySector = useMemo(() => {
    const map = {}
    agents.forEach((agent) => {
      if (!agent.team_id) return
      if (!map[agent.team_id]) map[agent.team_id] = []
      map[agent.team_id].push(agent)
    })
    Object.values(map).forEach((list) => {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    })
    return map
  }, [agents])

  const addPauseModalItem = () => {
    const needsTime = requiresScheduleTime(pauseModalForm.pause_type_id)
    if (!pauseModalForm.pause_type_id || (needsTime && !pauseModalForm.scheduled_time)) {
      setError('Preencha tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setError('')
    const scheduledTime = needsTime ? pauseModalForm.scheduled_time : pauseModalForm.scheduled_time || null
    setPauseModalItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        pause_type_id: pauseModalForm.pause_type_id,
        scheduled_time: scheduledTime,
        duration_time: pauseModalForm.duration_time
      }
    ])
    setPauseModalForm((prev) => ({ ...prev, scheduled_time: '', duration_time: '' }))
  }

  const removePauseModalItem = (id) => {
    setPauseModalItems((prev) => prev.filter((item) => item.id !== id))
  }

  const savePauseModalItems = async () => {
    if (!pauseModalAgentId) return
    if (!pauseModalItems.length) {
      setPauseModalOpen(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      await Promise.all(
        pauseModalItems.map((item) =>
          upsertPauseSchedule({
            agent_id: pauseModalAgentId,
            pause_type_id: item.pause_type_id,
            scheduled_time: item.scheduled_time || null,
            duration_minutes: timeToMinutes(item.duration_time)
          })
        )
      )
      setSuccess('Pausas cadastradas para o agente.')
      setPauseModalOpen(false)
      setPauseModalItems([])
      setPauseModalAgentId('')
      setPauseModalAgentName('')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao cadastrar pausas')
    } finally {
      setBusy(false)
    }
  }

  const openAgentEditModal = (agent) => {
    setAgentEditId(agent.id)
    setAgentEditForm({
      full_name: agent.full_name || '',
      manager_id: agent.manager_id || '',
      team_id: agent.team_id || '',
      email: agent.email || ''
    })
    setAgentEditScheduleForm({
      pause_type_id: pauseTypes?.[0]?.id || '',
      scheduled_time: '',
      duration_time: ''
    })
    setAgentEditModalOpen(true)
  }

  const closeAgentEditModal = () => {
    setAgentEditModalOpen(false)
    setAgentEditId('')
  }

  const handleAgentSave = async () => {
    if (!agentEditId) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (!String(agentEditForm.full_name || '').trim()) {
        throw new Error('Nome completo obrigatorio.')
      }
      if (!agentEditForm.manager_id) {
        throw new Error('Selecione um gerente para o agente.')
      }
      if (!agentEditForm.team_id) {
        throw new Error('Selecione um setor para o agente.')
      }
      if (agentEditForm.email && !isValidEmail(agentEditForm.email)) {
        throw new Error('Email invalido.')
      }
      if (agentEditForm.email && isDuplicateEmail(agentEditForm.email, agentEditId)) {
        throw new Error('Email ja cadastrado.')
      }
      await updateProfile(agentEditId, {
        full_name: agentEditForm.full_name,
        email: agentEditForm.email || null,
        role: 'AGENTE',
        manager_id: agentEditForm.manager_id || null,
        team_id: agentEditForm.team_id || null
      })
      setSuccess('Agente atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar agente')
    } finally {
      setBusy(false)
    }
  }

  const addAgentSchedule = async () => {
    if (!agentEditId) return
    const needsTime = requiresScheduleTime(agentEditScheduleForm.pause_type_id)
    if (!agentEditScheduleForm.pause_type_id || (needsTime && !agentEditScheduleForm.scheduled_time)) {
      setError('Preencha tipo. Horario e obrigatorio exceto Banheiro.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const scheduledTime = needsTime
        ? agentEditScheduleForm.scheduled_time
        : agentEditScheduleForm.scheduled_time || null
      await upsertPauseSchedule({
        agent_id: agentEditId,
        pause_type_id: agentEditScheduleForm.pause_type_id,
        scheduled_time: scheduledTime,
        duration_minutes: timeToMinutes(agentEditScheduleForm.duration_time)
      })
      setAgentEditScheduleForm((prev) => ({ ...prev, scheduled_time: '', duration_time: '' }))
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao adicionar pausa')
    } finally {
      setBusy(false)
    }
  }

  const openManagerEditModal = (manager) => {
    const profileData = profiles.find((profile) => profile.id === manager.id)
    setManagerEditId(manager.id)
    setManagerEditForm({
      full_name: profileData?.full_name || manager.full_name || '',
      email: profileData?.email || manager.email || '',
      is_admin: profileData?.is_admin ?? manager.is_admin ?? false
    })
    setManagerEditModalOpen(true)
  }

  const closeManagerEditModal = () => {
    setManagerEditModalOpen(false)
    setManagerEditId('')
  }

  const handleManagerSave = async () => {
    if (!managerEditId) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (!String(managerEditForm.full_name || '').trim()) {
        throw new Error('Nome completo obrigatorio.')
      }
      if (managerEditForm.email && !isValidEmail(managerEditForm.email)) {
        throw new Error('Email invalido.')
      }
      if (managerEditForm.email && isDuplicateEmail(managerEditForm.email, managerEditId)) {
        throw new Error('Email ja cadastrado.')
      }
      const sectorIds = getManagerSectorIds(
        managerEditId,
        managers.find((item) => item.id === managerEditId)?.team_id
      )
      if (!sectorIds.length) {
        throw new Error('Selecione ao menos um setor.')
      }
      await updateProfile(managerEditId, {
        role: 'GERENTE',
        full_name: managerEditForm.full_name,
        email: managerEditForm.email || null,
        is_admin: !!managerEditForm.is_admin,
        team_id: sectorIds[0],
        manager_id: null
      })
      await setManagerSectors(managerEditId, sectorIds)
      setSuccess('Gerente atualizado.')
      await refreshAll()
      closeManagerEditModal()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar gerente')
    } finally {
      setBusy(false)
    }
  }

  const openAdminEditModal = (admin) => {
    const profileData = profiles.find((profile) => profile.id === admin.id)
    setAdminEditId(admin.id)
    setAdminEditForm({
      full_name: profileData?.full_name || admin.full_name || '',
      email: profileData?.email || admin.email || ''
    })
    setAdminEditModalOpen(true)
  }

  const closeAdminEditModal = () => {
    setAdminEditModalOpen(false)
    setAdminEditId('')
  }

  const handleAdminSave = async () => {
    if (!adminEditId) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (!String(adminEditForm.full_name || '').trim()) {
        throw new Error('Nome completo obrigatorio.')
      }
      if (adminEditForm.email && !isValidEmail(adminEditForm.email)) {
        throw new Error('Email invalido.')
      }
      if (adminEditForm.email && isDuplicateEmail(adminEditForm.email, adminEditId)) {
        throw new Error('Email ja cadastrado.')
      }
      await updateProfile(adminEditId, {
        role: 'ADMIN',
        full_name: adminEditForm.full_name,
        email: adminEditForm.email || null,
        manager_id: null,
        team_id: null
      })
      setSuccess('Admin atualizado.')
      await refreshAll()
      closeAdminEditModal()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar admin')
    } finally {
      setBusy(false)
    }
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
      items.sort((a, b) =>
        String(a.scheduled_time || '99:99:99').localeCompare(String(b.scheduled_time || '99:99:99'))
      )
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
      const withTime = items.find((item) => item.scheduled_time)
      return withTime?.scheduled_time || null
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

  const ManagerSectorModal = ({ managerId, onClose }) => {
    if (!managerId) return null
    const manager = profiles.find((item) => item.id === managerId)
    const selected = getManagerSectorIds(managerId, manager?.team_id)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Editar setores - {manager?.full_name || 'Gerente'}
            </h3>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Fechar
            </button>
          </div>
          <div className="mt-4">
            <label className="label">Setores</label>
            <select
              className="input mt-1"
              multiple
              value={selected}
              onChange={(e) => {
                const next = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                setManagerSectorsMap((current) => ({ ...current, [managerId]: next }))
              }}
            >
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (selected.length) {
                  updateProfileField(managerId, 'team_id', selected[0])
                }
                onClose()
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    )
  }

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
            className={`btn ${tab === 'managers' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('managers')}
          >
            Gerentes
          </button>
          <button
            className={`btn ${tab === 'admins' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('admins')}
          >
            Admins
          </button>
          <button
            className={`btn ${tab === 'sectors' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('sectors')}
          >
            Setores
          </button>
          <button
            className={`btn ${tab === 'pauseTypes' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('pauseTypes')}
          >
            Tipos de pausa
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold text-slate-900">Usuarios cadastrados</h2>
                  {loading ? <span className="text-sm text-slate-500">Carregando...</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`btn ${usersView === 'users' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
                    onClick={() => setUsersView('users')}
                  >
                    Usuarios
                  </button>
                  <button
                    type="button"
                    className={`btn ${usersView === 'sectors' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
                    onClick={() => setUsersView('sectors')}
                  >
                    Setores
                  </button>
                </div>
              </div>
              {usersView === 'users' ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left py-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-left text-slate-500 hover:text-slate-700"
                            onClick={() =>
                              setUserSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                            }
                          >
                            Nome
                            <span className="text-[10px]">{userSortDir === 'asc' ? '▲' : '▼'}</span>
                          </button>
                        </th>
                        <th className="text-left py-2">Role</th>
                        <th className="text-left py-2">Manager</th>
                        <th className="text-left py-2">Setor</th>
                        <th className="text-left py-2">Acoes</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900">
                      {sortedProfiles.map((profile) => (
                        <tr key={profile.id} className="border-t border-slate-100">
                          <td className="py-2">
                            <input
                              className="input"
                              value={profile.full_name}
                              onChange={(e) => updateProfileField(profile.id, 'full_name', e.target.value)}
                              disabled
                            />
                          </td>
                          <td className="py-2">
                            <select className="input" value={profile.role} disabled>
                              <option value="ADMIN">ADMIN</option>
                              <option value="GERENTE">GERENTE</option>
                              <option value="AGENTE">AGENTE</option>
                            </select>
                          </td>
                          <td className="py-2">
                            <select className="input" value={profile.manager_id || ''} disabled>
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
                              <div className="flex items-center gap-2">
                                <select
                                  className="input"
                                  value={
                                    getManagerSectorIds(profile.id, profile.team_id).length > 1
                                      ? '__MULTI__'
                                      : getManagerSectorIds(profile.id, profile.team_id)[0] || ''
                                  }
                                  onChange={(e) => {
                                    const managerSectorIds = getManagerSectorIds(profile.id, profile.team_id)
                                    if (managerSectorIds.length > 1) {
                                      return
                                    }
                                    updateProfileField(profile.id, 'team_id', e.target.value)
                                  }}
                                >
                                  {getManagerSectorIds(profile.id, profile.team_id).length > 1 ? (
                                    <option value="__MULTI__">Varios</option>
                                  ) : null}
                                  {getManagerSectorIds(profile.id, profile.team_id).map((sectorId) => (
                                    <option key={sectorId} value={sectorId}>
                                      {sectorById.get(sectorId) || 'Setor'}
                                    </option>
                                  ))}
                                  {!getManagerSectorIds(profile.id, profile.team_id).length ? (
                                    <option value="">Nenhum</option>
                                  ) : null}
                                </select>
                                <button
                                  type="button"
                                  className="btn-ghost h-9 w-9 p-0"
                                  title="Editar setores"
                                  aria-label="Editar setores"
                                  onClick={() => setSectorEditManagerId(profile.id)}
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                      d="M12 20h9"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4 11.5-11.5z"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <select className="input" value={profile.team_id || ''} disabled>
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
                            <div className="flex items-center gap-2">
                              {profile.role === 'AGENTE' ? (
                                <button
                                  type="button"
                                  className="btn-ghost h-9 w-9 p-0"
                                  title="Editar agente"
                                  aria-label="Editar agente"
                                  onClick={() => openAgentEditModal(profile)}
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                      d="M12 20h9"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4 11.5-11.5z"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              ) : null}
                              {profile.role === 'AGENTE' ? (
                                <button
                                  className="btn-ghost h-9 w-9 p-0 text-red-600"
                                  type="button"
                                  onClick={() => handleDeleteUser(profile)}
                                  disabled={busy}
                                  title="Excluir"
                                  aria-label="Excluir"
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                      d="M4 7h16"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M9 7V5h6v2"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M7 7l1 12h8l1-12"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
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
              ) : (
                <div className="mt-4 space-y-2">
                  {sectors.map((sector) => {
                    const items = agentsBySector[sector.id] || []
                    const isOpen = expandedSectorId === sector.id
                    return (
                      <div key={sector.id} className="rounded-xl border border-slate-200">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                          onClick={() => setExpandedSectorId(isOpen ? '' : sector.id)}
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{sector.label}</p>
                            <p className="text-xs text-slate-500">{items.length} agentes</p>
                          </div>
                          <span className="text-xs text-slate-500">{isOpen ? 'Fechar' : 'Ver agentes'}</span>
                        </button>
                        {isOpen ? (
                          <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                            {items.length ? (
                              <div className="space-y-2">
                                {items.map((agent) => (
                                  <div
                                    key={agent.id}
                                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                                  >
                                    <button
                                      type="button"
                                      className="text-sm font-medium text-emerald-700 hover:underline"
                                      onClick={() => openAgentEditModal(agent)}
                                    >
                                      {agent.full_name}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500">Nenhum agente neste setor.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  {!sectors.length ? <p className="text-sm text-slate-500">Nenhum setor cadastrado.</p> : null}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <ManagerSectorModal
          managerId={sectorEditManagerId}
          onClose={() => setSectorEditManagerId('')}
        />

        {agentEditModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
            <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Editar agente
                </h3>
                <button type="button" className="btn-ghost" onClick={closeAgentEditModal}>
                  Fechar
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div>
                  <label className="label">Nome</label>
                  <input
                    className="input mt-1"
                    value={agentEditForm.full_name}
                    onChange={(e) =>
                      setAgentEditForm((prev) => ({ ...prev, full_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={agentEditForm.email}
                    onChange={(e) =>
                      setAgentEditForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="Opcional"
                  />
                </div>
                <div>
                  <label className="label">Gerente</label>
                  <select
                    className="input mt-1"
                    value={agentEditForm.manager_id}
                    onChange={(e) =>
                      setAgentEditForm((prev) => ({ ...prev, manager_id: e.target.value }))
                    }
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
                  <select
                    className="input mt-1"
                    value={agentEditForm.team_id}
                    onChange={(e) =>
                      setAgentEditForm((prev) => ({ ...prev, team_id: e.target.value }))
                    }
                  >
                    <option value="">Nenhum</option>
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary" onClick={handleAgentSave} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar agente'}
                </button>
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-semibold text-slate-800">Pausas registradas</h4>
                <div className="mt-3 overflow-x-auto">
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
                      {pauseSchedules
                        .filter((schedule) => schedule.agent_id === agentEditId)
                        .map((schedule) => (
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
                                  onClick={() => {
                                    const confirmed = window.confirm('Remover esta pausa?')
                                    if (!confirmed) return
                                    handleScheduleDelete(schedule)
                                  }}
                                  disabled={busy}
                                >
                                  Remover
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      {!pauseSchedules.filter((schedule) => schedule.agent_id === agentEditId).length ? (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan="4">
                            Nenhuma pausa cadastrada.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-800">Adicionar pausa</h4>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="label">Tipo</label>
                    <select
                      className="input mt-1"
                      value={agentEditScheduleForm.pause_type_id}
                      onChange={(e) =>
                        setAgentEditScheduleForm((prev) => ({ ...prev, pause_type_id: e.target.value }))
                      }
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
                    <label className="label">Horario</label>
                    <input
                      className="input mt-1"
                      type="time"
                      step="60"
                      value={agentEditScheduleForm.scheduled_time}
                      onChange={(e) =>
                        setAgentEditScheduleForm((prev) => ({ ...prev, scheduled_time: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Duracao (hh:mm)</label>
                    <input
                      className="input mt-1"
                      type="time"
                      step="60"
                      value={agentEditScheduleForm.duration_time}
                      onChange={(e) =>
                        setAgentEditScheduleForm((prev) => ({ ...prev, duration_time: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" className="btn-ghost" onClick={addAgentSchedule}>
                    Adicionar pausa
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {managerEditModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
            <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Editar gerente
                </h3>
                <button type="button" className="btn-ghost" onClick={closeManagerEditModal}>
                  Fechar
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Nome</label>
                  <input
                    className="input mt-1"
                    value={managerEditForm.full_name}
                    onChange={(e) =>
                      setManagerEditForm((prev) => ({ ...prev, full_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={managerEditForm.email}
                    onChange={(e) =>
                      setManagerEditForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="label">Acesso admin</label>
                <select
                  className="input mt-1"
                  value={managerEditForm.is_admin ? 'true' : 'false'}
                  onChange={(e) =>
                    setManagerEditForm((prev) => ({ ...prev, is_admin: e.target.value === 'true' }))
                  }
                >
                  <option value="false">Nao</option>
                  <option value="true">Sim</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Permite acessar o Painel Admin mantendo o perfil como gerente.
                </p>
              </div>
              <div className="mt-4">
                <label className="label">Setores</label>
                <p className="text-xs text-slate-500">
                  Selecione um ou mais setores (Ctrl/Cmd para varios)
                </p>
                <select
                  className="input mt-2"
                  multiple
                  value={getManagerSectorIds(
                    managerEditId,
                    managers.find((item) => item.id === managerEditId)?.team_id
                  )}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                    setManagerSectorsMap((current) => ({ ...current, [managerEditId]: selected }))
                  }}
                >
                  {sectors.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={closeManagerEditModal}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={handleManagerSave} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar gerente'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {adminEditModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
            <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Editar admin
                </h3>
                <button type="button" className="btn-ghost" onClick={closeAdminEditModal}>
                  Fechar
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Nome</label>
                  <input
                    className="input mt-1"
                    value={adminEditForm.full_name}
                    onChange={(e) =>
                      setAdminEditForm((prev) => ({ ...prev, full_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={adminEditForm.email}
                    onChange={(e) =>
                      setAdminEditForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={closeAdminEditModal}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={handleAdminSave} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar admin'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pauseModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Pausas do agente {pauseModalAgentName || ''}
                </h3>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setPauseModalOpen(false)}
                >
                  Fechar
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Cadastre quantas pausas forem necessarias para este agente.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div>
                  <label className="label">Tipo</label>
                  <select
                    className="input mt-1"
                    value={pauseModalForm.pause_type_id}
                    onChange={(e) =>
                      setPauseModalForm((prev) => ({ ...prev, pause_type_id: e.target.value }))
                    }
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
                  <label className="label">Horario</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={pauseModalForm.scheduled_time}
                    onChange={(e) =>
                      setPauseModalForm((prev) => ({ ...prev, scheduled_time: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Duracao (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={pauseModalForm.duration_time}
                    onChange={(e) =>
                      setPauseModalForm((prev) => ({ ...prev, duration_time: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-ghost" onClick={addPauseModalItem}>
                  Adicionar pausa
                </button>
              </div>

              <div className="mt-4">
                {pauseModalItems.length ? (
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
                        {pauseModalItems.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="py-2">
                              {pauseTypes.find((type) => type.id === item.pause_type_id)?.label || '-'}
                            </td>
                            <td className="py-2">{normalizeTime(item.scheduled_time) || '-'}</td>
                            <td className="py-2">{item.duration_time || '-'}</td>
                            <td className="py-2">
                              <button
                                type="button"
                                className="btn-ghost text-red-600"
                                onClick={() => removePauseModalItem(item.id)}
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Nenhuma pausa adicionada ainda.</p>
                )}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setPauseModalOpen(false)}>
                  Depois
                </button>
                <button type="button" className="btn-primary" onClick={savePauseModalItems} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar pausas'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'managers' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Criar gerente</h2>
              <p className="text-sm text-slate-600 mt-1">Gerentes podem ter multiplos setores.</p>
              <form className="mt-4 space-y-3" onSubmit={handleCreateManager}>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={managerForm.email}
                    onChange={(e) => setManagerForm({ ...managerForm, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Senha provisoria</label>
                  <input
                    className="input mt-1"
                    type="password"
                    value={managerForm.password}
                    onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Nome completo</label>
                  <input
                    className="input mt-1"
                    value={managerForm.full_name}
                    onChange={(e) => setManagerForm({ ...managerForm, full_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Setores</label>
                  <p className="text-xs text-slate-500">Selecione um ou mais setores (Ctrl/Cmd para varios)</p>
                  <select
                    className="input mt-2"
                    multiple
                    value={managerForm.sector_ids}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                      setManagerForm((prev) => ({ ...prev, sector_ids: selected }))
                    }}
                    required
                  >
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn-primary w-full" type="submit" disabled={busy}>
                  {busy ? 'Criando...' : 'Criar gerente'}
                </button>
              </form>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Gerentes cadastrados</h2>
              <div className="mt-4 space-y-3">
                {managers.map((manager) => {
                  const sectorIds = getManagerSectorIds(manager.id, manager.team_id)
                  const managerProfile = profiles.find((profile) => profile.id === manager.id)
                  const isManagerAdmin = managerProfile?.is_admin ?? manager.is_admin
                  return (
                    <button
                      key={manager.id}
                      type="button"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left transition hover:bg-slate-50"
                      onClick={() => openManagerEditModal(manager)}
                    >
                      <p className="text-sm font-semibold text-slate-900">{manager.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {sectorIds.length
                          ? sectorIds.map((id) => sectorById.get(id) || 'Setor').join(', ')
                          : 'Sem setores'}
                        {isManagerAdmin ? ' • Admin' : ''}
                      </p>
                    </button>
                  )
                })}
                {!managers.length ? <p className="text-sm text-slate-500">Nenhum gerente cadastrado.</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'admins' ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Criar admin</h2>
              <p className="text-sm text-slate-600 mt-1">Admins não possuem setor nem gerente.</p>
              <form className="mt-4 space-y-3" onSubmit={handleCreateAdmin}>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    value={adminForm.email}
                    onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Senha provisoria</label>
                  <input
                    className="input mt-1"
                    type="password"
                    value={adminForm.password}
                    onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Nome completo</label>
                  <input
                    className="input mt-1"
                    value={adminForm.full_name}
                    onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })}
                    required
                  />
                </div>
                <button className="btn-primary w-full" type="submit" disabled={busy}>
                  {busy ? 'Criando...' : 'Criar admin'}
                </button>
              </form>
            </div>

            <div className="card">
              <h2 className="font-display text-xl font-semibold text-slate-900">Admins cadastrados</h2>
              <div className="mt-4 space-y-2">
                {profiles
                  .filter((profile) => profile.role === 'ADMIN')
                  .map((admin) => (
                    <button
                      key={admin.id}
                      type="button"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left transition hover:bg-slate-50"
                      onClick={() => openAdminEditModal(admin)}
                    >
                      <p className="text-sm font-semibold text-slate-900">{admin.full_name}</p>
                      <p className="text-xs text-slate-500">{admin.email || '-'}</p>
                    </button>
                  ))}
                {!profiles.filter((profile) => profile.role === 'ADMIN').length ? (
                  <p className="text-sm text-slate-500">Nenhum admin cadastrado.</p>
                ) : null}
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
                <div>
                  <label className="label">Tolerancia inicio (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={newType.tolerance_start_time}
                    onChange={(e) => setNewType({ ...newType, tolerance_start_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Tolerancia fim (hh:mm)</label>
                  <input
                    className="input mt-1"
                    type="time"
                    step="60"
                    value={newType.tolerance_end_time}
                    onChange={(e) => setNewType({ ...newType, tolerance_end_time: e.target.value })}
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
                      <th className="text-left py-2">Tol. inicio</th>
                      <th className="text-left py-2">Tol. fim</th>
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
                          <input
                            className="input"
                            type="time"
                            step="60"
                            value={minutesToTime(type.tolerance_start_minutes)}
                            onChange={(e) =>
                              updateTypeField(
                                type.id,
                                'tolerance_start_minutes',
                                timeToMinutes(e.target.value)
                              )
                            }
                          />
                        </td>
                        <td className="py-2">
                          <input
                            className="input"
                            type="time"
                            step="60"
                            value={minutesToTime(type.tolerance_end_minutes)}
                            onChange={(e) =>
                              updateTypeField(
                                type.id,
                                'tolerance_end_minutes',
                                timeToMinutes(e.target.value)
                              )
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
                        <td className="py-3 text-slate-500" colSpan="7">
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
