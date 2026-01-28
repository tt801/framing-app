import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

console.log('Main.tsx loading...');

// AI provider
import { setAiProvider, LocalMockProvider } from './lib/ai/provider'
import { RemoteProvider } from './lib/ai/remoteProvider'

if (import.meta.env.PROD) {
  console.log('Production mode - using RemoteProvider');
  setAiProvider(new RemoteProvider())
} else {
  // Vite dev: no serverless API -> use local generator
  console.log('Dev mode - using LocalMockProvider');
  setAiProvider(new LocalMockProvider())
}

console.log('Rendering React app...');

const root = document.getElementById('root');
if (!root) {
  console.error('Root element not found!');
} else {
  console.log('Root element found, creating React root...');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
  console.log('React app rendered!');
};
