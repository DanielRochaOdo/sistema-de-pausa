(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch (_) {
    // ignore cleanup failures on legacy bootstrap
  }

  const next = new URL(window.location.href)
  next.pathname = '/'
  next.searchParams.set('legacy_sw_reset', String(Date.now()))
  window.location.replace(next.toString())
})()
