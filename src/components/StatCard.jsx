export default function StatCard({ label, value, sub, onClick }) {
  const isInteractive = typeof onClick === 'function'

  return (
    <div
      className={`card animate-fade-in ${isInteractive ? 'cursor-pointer transition hover:shadow-lg' : ''}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!isInteractive) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-sm text-slate-600">{sub}</p> : null}
    </div>
  )
}
