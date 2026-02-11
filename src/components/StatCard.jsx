export default function StatCard({ label, value, sub }) {
  return (
    <div className="card animate-fade-in">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-sm text-slate-600">{sub}</p> : null}
    </div>
  )
}