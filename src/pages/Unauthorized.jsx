import { Link } from 'react-router-dom'

export default function Unauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Acesso negado</p>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mt-2">Sem permissao</h1>
        <p className="text-sm text-slate-600 mt-2">
          Voce nao tem acesso a esta rota. Volte para a sua area principal.
        </p>
        <Link className="btn-primary mt-6 inline-flex" to="/">
          Ir para meu painel
        </Link>
      </div>
    </div>
  )
}