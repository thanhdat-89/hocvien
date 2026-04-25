import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,        // 1 phút: data coi là fresh, không refetch
      gcTime: 5 * 60_000,       // 5 phút: giữ cache sau khi không dùng
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
