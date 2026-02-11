export function formatDuration(totalSeconds = 0) {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const hours = String(Math.floor(sec / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const seconds = String(sec % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR')
}

export function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('pt-BR')
}

export function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function startOfWeek() {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const start = new Date(now)
  start.setDate(now.getDate() - day)
  start.setHours(0, 0, 0, 0)
  return start
}

export function startOfMonth() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export function formatInputDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}