import { useEffect, useState } from 'react'
import TopNav from '../components/TopNav'
import { useAuth } from '../contexts/AuthContext'
import {
  createPauseType,
  createUserWithEdgeFunction,
  listManagers,
  listPauseTypes,
  listProfiles,
  updatePauseType,
  updateProfile
} from '../services/apiAdmin'

const emptyUserForm = {
  email: '',
  password: '',
  full_name: '',
  role: 'AGENTE',
  manager_id: '',
  team_id: ''
}

export default function Admin() {
  const { session } = useAuth()
  const [tab, setTab] = useState('users')
  const [profiles, setProfiles] = useState([])
  const [managers, setManagers] = useState([])
  const [pauseTypes, setPauseTypes] = useState([])
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [newType, setNewType] = useState({ code: '', label: '' })

  const refreshAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [profilesData, typesData, managersData] = await Promise.all([
        listProfiles(),
        listPauseTypes(),
        listManagers()
      ])
      setProfiles(profilesData)
      setPauseTypes(typesData)
      setManagers(managersData)
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
      await createUserWithEdgeFunction(userForm, session?.access_token)
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
      const payload = {
        full_name: profile.full_name,
        role: profile.role,
        manager_id: profile.manager_id || null,
        team_id: profile.team_id || null
      }
      await updateProfile(profile.id, payload)
      setSuccess('Perfil atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar')
    } finally {
      setBusy(false)
    }
  }

  const handleTypeUpdate = async (type) => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await updatePauseType(type.id, { label: type.label, is_active: type.is_active })
      setSuccess('Tipo atualizado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao atualizar tipo')
    } finally {
      setBusy(false)
    }
  }

  const handleTypeCreate = async () => {
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await createPauseType({ code: newType.code, label: newType.label })
      setNewType({ code: '', label: '' })
      setSuccess('Tipo criado.')
      await refreshAll()
    } catch (err) {
      setError(err.message || 'Falha ao criar tipo')
    } finally {
      setBusy(false)
    }
  }

  const updateProfileField = (id, field, value) => {
    setProfiles((prev) =>
      prev.map((profile) => (profile.id === id ? { ...profile, [field]: value } : profile))
    )
  }

  const updateTypeField = (id, field, value) => {
    setPauseTypes((prev) => prev.map((type) => (type.id === id ? { ...type, [field]: value } : type)))
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
          <button className={`btn ${tab === 'users' ? 'bg-brand-600 text-white' : 'btn-ghost'}`} onClick={() => setTab('users')}>
            Usuarios
          </button>
          <button
            className={`btn ${tab === 'pauseTypes' ? 'bg-brand-600 text-white' : 'btn-ghost'}`}
            onClick={() => setTab('pauseTypes')}
          >
            Tipos de pausa
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
                  <input className="input mt-1" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
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
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
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
                    onChange={(e) => setUserForm({ ...userForm, manager_id: e.target.value })}
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
                  <label className="label">Team ID</label>
                  <input
                    className="input mt-1"
                    value={userForm.team_id}
                    onChange={(e) => setUserForm({ ...userForm, team_id: e.target.value })}
                    placeholder="Opcional"
                  />
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
                      <th className="text-left py-2">Team</th>
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
                          <input
                            className="input"
                            value={profile.team_id || ''}
                            onChange={(e) => updateProfileField(profile.id, 'team_id', e.target.value)}
                            placeholder="Opcional"
                          />
                        </td>
                        <td className="py-2">
                          <button className="btn-ghost" type="button" onClick={() => handleUpdate(profile)} disabled={busy}>
                            Salvar
                          </button>
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
                          <button className="btn-ghost" type="button" onClick={() => handleTypeUpdate(type)} disabled={busy}>
                            Salvar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!pauseTypes.length ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan="4">
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
      </div>
    </div>
  )
}