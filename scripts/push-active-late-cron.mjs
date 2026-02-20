import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  const vars = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) vars[key] = value
  }
  return vars
}

const rootDir = path.resolve(__dirname, '..')
const fileEnv = readEnvFile(path.join(rootDir, '.env'))
const env = { ...fileEnv, ...process.env }

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const serviceRoleKey = env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[cron] missing SUPABASE_URL/VITE_SUPABASE_URL or SERVICE_ROLE_KEY')
  process.exit(1)
}

const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/push-active-late`

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  },
  body: '{}'
})

const text = await res.text()
if (!res.ok) {
  console.error('[cron] request failed', res.status, text)
  process.exit(1)
}

console.log('[cron] ok', text || '')
