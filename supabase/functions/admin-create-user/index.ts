import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500 })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing auth token' }), { status: 401 })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
  }

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('role')
    .single()

  if (profileError || profile?.role !== 'ADMIN') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { email, password, full_name, role, manager_id, team_id } = body

  if (!email || !password || !full_name || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
  }

  const allowedRoles = ['ADMIN', 'GERENTE', 'AGENTE']
  if (!allowedRoles.includes(role)) {
    return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400 })
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { role }
  })

  if (createError || !created?.user) {
    return new Response(JSON.stringify({ error: createError?.message || 'Failed to create user' }), { status: 400 })
  }

  const { error: insertError } = await adminClient.from('profiles').upsert(
    {
      id: created.user.id,
      full_name,
      role,
      manager_id: manager_id || null,
      team_id: team_id || null
    },
    { onConflict: 'id' }
  )

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message || 'Failed to create profile' }), { status: 400 })
  }

  return new Response(JSON.stringify({ id: created.user.id }), { status: 200 })
})
