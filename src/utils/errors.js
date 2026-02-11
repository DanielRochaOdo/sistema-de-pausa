export function friendlyError(err, fallback = 'Ocorreu um erro. Tente novamente.') {
  const message = String(err?.message || '').toLowerCase()

  if (message.includes('pause_already_active')) return 'Ja existe uma pausa ativa.'
  if (message.includes('no_active_pause')) return 'Nao ha pausa ativa para encerrar.'
  if (message.includes('invalid_pause_type')) return 'Tipo de pausa invalido.'
  if (message.includes('not_allowed')) return 'Voce nao tem permissao para esta acao.'
  if (message.includes('duplicate key')) return 'Ja existe uma pausa ativa.'

  return err?.message || fallback
}