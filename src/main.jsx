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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
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
