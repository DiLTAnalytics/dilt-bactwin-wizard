import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { I18nProvider } from './i18n'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { TooltipProvider } from './ui/Tooltip'
import './index.css'

// Main checks for this in development, see window.ts.
document.documentElement.dataset['started'] = ''

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
