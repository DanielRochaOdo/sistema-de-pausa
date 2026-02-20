import { supabase } from './supabaseClient'

export async function savePushSubscription(subscription) {
  if (!subscription) return
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user?.id) {
    throw new Error('Usuario nao autenticado')
  }

  const endpoint = subscription.endpoint
  const keys = subscription.toJSON ? subscription.toJSON().keys : subscription.keys
  const p256dh = keys?.p256dh
  const auth = keys?.auth

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Subscription invalida')
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: authData.user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null
    },
    { onConflict: 'user_id,endpoint' }
  )

  if (error) throw error
}

export async function removePushSubscription(endpoint) {
  if (!endpoint) return
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user?.id) return
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', authData.user.id)
    .eq('endpoint', endpoint)
}
