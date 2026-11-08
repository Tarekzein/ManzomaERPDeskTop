import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import './styles/app.css'
import { queryClient } from '@/lib/query'
import { DialogHost } from '@/components/Dialogs'
import { PrintPreviewHost } from '@/features/print/PrintPreviewHost'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <DialogHost />
      <PrintPreviewHost />
      <Toaster position="bottom-left" richColors closeButton dir="auto" toastOptions={{ style: { fontFamily: 'inherit' } }} />
    </QueryClientProvider>
  </StrictMode>,
)
