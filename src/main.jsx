import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const applyInitialTheme = () => {
  if (typeof window === 'undefined') return
  let storedTheme = null
  try {
    storedTheme = localStorage.getItem('theme')
  } catch (err) {
    storedTheme = null
  }
  const prefersDark = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
  const useDark = storedTheme ? storedTheme === 'dark' : prefersDark
  document.documentElement.classList.toggle('theme-dark', useDark)
}

applyInitialTheme()

const cleanupLegacyServiceWorkers = async () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const removals = registrations
      .filter((registration) => {
        const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || ''
        return scriptUrl && !scriptUrl.endsWith('/push-sw.js')
      })
      .map((registration) => registration.unregister())
    if (removals.length) {
      await Promise.all(removals)
    }
  } catch (err) {
    console.warn('[sw] failed to cleanup legacy service workers', err)
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await caches.keys()
      const legacyKeys = keys.filter((key) => /workbox|vite-pwa|precache/i.test(key))
      if (legacyKeys.length) {
        await Promise.all(legacyKeys.map((key) => caches.delete(key)))
      }
    } catch (err) {
      console.warn('[sw] failed to cleanup legacy cache storage', err)
    }
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    await cleanupLegacyServiceWorkers()
    navigator.serviceWorker.register('/push-sw.js').catch((err) => {
      console.warn('[push] failed to register service worker', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
