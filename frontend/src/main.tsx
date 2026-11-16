import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './services/queryClient'
import App from './App.tsx'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import './index.css'
import './responsive.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
