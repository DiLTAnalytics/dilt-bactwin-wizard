import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Shows a render error with a reload button instead of a blank window. It sits outside the
 * translation provider (which may be what failed), hence both languages inline.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Unexpected error:', error, info.componentStack)
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-subtle p-6">
          <div className="max-w-md w-full bg-surface border border-line rounded-lg shadow-xs p-6 space-y-3">
            <h1 className="text-sm font-semibold text-danger-fg">Unerwarteter Fehler / Unexpected error</h1>
            <p className="text-xs text-fg-2 font-mono break-all">{this.state.error.message}</p>
            <button
              // The project lives in main, so a reload loses nothing.
              onClick={() => window.location.reload()}
              className="bg-accent text-on-solid px-4 py-1.5 rounded-sm text-xs font-medium hover:bg-accent-hover"
            >
              Ansicht neu laden / Reload view
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
