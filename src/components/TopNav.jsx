import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'

export default function TopNav() {
  const { profile, signOut } = useAuth()

  const links = []
  if (profile?.role === 'AGENTE') links.push({ to: '/agent', label: 'Minha pausa' })
  if (profile?.role === 'GERENTE' || profile?.role === 'ADMIN') {
    links.push({ to: '/manager', label: 'Dashboard' })
    links.push({ to: '/reports', label: 'Relatorios' })
  }
  if (profile?.role === 'ADMIN') links.push({ to: '/admin', label: 'Admin' })

  return (
    <div className="px-6 py-5">
      <div className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Controle de Pausas</p>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Olá, {profile?.full_name || '...'}</h1>
          <span className="chip mt-2">{profile?.role || 'Sem role'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `btn ${isActive ? 'bg-brand-600 text-white' : 'btn-ghost text-slate-700'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <button type="button" onClick={signOut} className="btn-secondary">
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}