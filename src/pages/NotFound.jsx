import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">404</p>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mt-2">Pagina nao encontrada</h1>
        <p className="text-sm text-slate-600 mt-2">A pagina que voce tentou acessar nao existe.</p>
        <Link className="btn-primary mt-6 inline-flex" to="/">
          Voltar
        </Link>
      </div>
    </div>
  )
}