import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// AI provider
import { setAiProvider, LocalMockProvider } from './lib/ai/provider'
import { RemoteProvider } from './lib/ai/remoteProvider'

if (import.meta.env.PROD) {
  setAiProvider(new RemoteProvider())
} else {
  // Vite dev: no serverless API -> use local generator
  setAiProvider(new LocalMockProvider())
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
