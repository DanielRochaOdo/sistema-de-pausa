export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-brand-500 animate-pulse" />
          <p className="text-sm font-medium text-slate-700">Carregando...</p>
        </div>
      </div>
    </div>
  )
}