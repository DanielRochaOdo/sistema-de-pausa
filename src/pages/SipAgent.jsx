import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TopNav from '../components/TopNav'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/useAuth'
import { getSipAgentStatus, listSipCalls } from '../services/apiSip'
import { supabase } from '../services/supabaseClient'
import { formatDateTime, formatDuration } from '../utils/format'

const STATUS_META = {
  LIVRE: { label: 'Livre', tone: 'text-emerald-700' },
  OCUPADO: { label: 'Em ligacao', tone: 'text-red-700' },
  PAUSA: { label: 'Em pausa', tone: 'text-amber-700' },
  NAO_LOGADO: { label: 'Nao logado no SIP', tone: 'text-slate-600' }
}

const formatStatus = (status) => STATUS_META[status] || STATUS_META.NAO_LOGADO
const getCallKey = (row) => row?.call_id || row?.id || ''
const NEW_CALL_BADGE_TTL_MS = 15000

export default function SipAgent() {
  const { profile } = useAuth()
  const [statusData, setStatusData] = useState(null)
  const [calls, setCalls] = useState([])
  const [newCallKeys, setNewCallKeys] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const newCallTimeoutsRef = useRef(new Map())

  const reload = async ({ silent = false } = {}) => {
    if (!profile?.id) return
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const [status, callRows] = await Promise.all([
        getSipAgentStatus(profile.id),
        listSipCalls({ agentId: profile.id, limit: 100 })
      ])
      setStatusData(status)
      setCalls(callRows || [])
    } catch (err) {
      setError(err.message || 'Falha ao carregar operacao SIP')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [profile?.id])

  const markCallAsNew = (row) => {
    const key = getCallKey(row)
    if (!key) return

    setNewCallKeys((prev) => ({ ...prev, [key]: true }))

    const existingTimeout = newCallTimeoutsRef.current.get(key)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeoutId = setTimeout(() => {
      setNewCallKeys((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      newCallTimeoutsRef.current.delete(key)
    }, NEW_CALL_BADGE_TTL_MS)

    newCallTimeoutsRef.current.set(key, timeoutId)
  }

  useEffect(() => {
    return () => {
      newCallTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
      newCallTimeoutsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!profile?.id) return

    const callsChannel = supabase
      .channel(`sip-agent-calls-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sip_calls',
          filter: `agent_id=eq.${profile.id}`
        },
        (payload) => {
          if (payload?.eventType === 'INSERT' && payload?.new) {
            markCallAsNew(payload.new)
          }
          reload({ silent: true })
        }
      )
      .subscribe()

    const extensionChannel =
      statusData?.sip_extension
        ? supabase
            .channel(`sip-agent-extension-calls-${statusData.sip_extension}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'sip_calls',
                filter: `sip_extension=eq.${statusData.sip_extension}`
              },
              (payload) => {
                if (payload?.eventType === 'INSERT' && payload?.new) {
                  markCallAsNew(payload.new)
                }
                reload({ silent: true })
              }
            )
            .subscribe()
        : null

    const sessionsChannel = supabase
      .channel(`sip-agent-sessions-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sip_sessions',
          filter: `agent_id=eq.${profile.id}`
        },
        () => {
          reload({ silent: true })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(callsChannel)
      if (extensionChannel) supabase.removeChannel(extensionChannel)
      supabase.removeChannel(sessionsChannel)
    }
  }, [profile?.id, statusData?.sip_extension])

  useEffect(() => {
    const interval = setInterval(() => {
      reload({ silent: true })
    }, 10000)
    return () => clearInterval(interval)
  }, [profile?.id])

  const currentStatus = useMemo(() => formatStatus(statusData?.status), [statusData?.status])

  return (
    <div className="min-h-screen pb-10">
      <TopNav />
      <div className="max-w-6xl mx-auto px-6 space-y-6">
        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Status SIP" value={loading ? '...' : currentStatus.label} sub={loading ? '' : statusData?.queue_names || '-'} />
          <StatCard label="Ramal ativo" value={loading ? '...' : statusData?.sip_extension || '-'} sub={statusData?.login_at ? `Desde ${formatDateTime(statusData.login_at)}` : ''} />
          <StatCard label="Ligacoes recentes" value={loading ? '...' : calls.length} sub="Ultimas 100" />
        </div>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-slate-900">Ligacoes registradas</h2>
          <p className="text-sm text-slate-600 mt-1">
            Historico da sua operacao SIP por numero e horario.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-2">Data/Hora</th>
                  <th className="text-left py-2">Origem</th>
                  <th className="text-left py-2">Destino</th>
                  <th className="text-left py-2">Fila</th>
                  <th className="text-left py-2">Duracao</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-900">
                {calls.map((call) => (
                  <tr key={getCallKey(call)} className="border-t border-slate-100">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span>{formatDateTime(call.started_at || call.answered_at || call.ended_at)}</span>
                        {newCallKeys[getCallKey(call)] ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            Novo
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2">{call.caller_number || '-'}</td>
                    <td className="py-2">{call.callee_number || '-'}</td>
                    <td className="py-2">{call.queue_label || '-'}</td>
                    <td className="py-2">{call.duration_seconds ? formatDuration(call.duration_seconds) : '-'}</td>
                    <td className="py-2">{call.status || '-'}</td>
                  </tr>
                ))}
                {!calls.length ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan="6">
                      Nenhuma ligacao SIP registrada para este agente.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-slate-900">Pausas do sistema</h2>
          <p className="text-sm text-slate-600 mt-1">
            O agente SIP mantem as mesmas caracteristicas de pausa do agente comum.
          </p>
          <Link className="btn-primary mt-4 inline-flex" to="/agent">
            Abrir painel de pausas
          </Link>
        </div>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-slate-900">Integracao MicroSIP</h2>
          <p className="text-sm text-slate-600 mt-1">
            Esta tela identifica ligacoes em tempo real quando o MicroSIP envia eventos para o webhook SIP.
          </p>
          <p className="text-sm text-slate-600 mt-2">
            Configure o bridge local em <code>scripts/microsip-bridge</code> na maquina do agente.
          </p>
        </div>
      </div>
    </div>
  )
}
