import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

// App-wide render-error catch. Without it any exception thrown in a route's render is an
// unrecoverable blank page. Error boundaries must be class components (no hook equivalent).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const home = import.meta.env.BASE_URL || '/'
    return (
      <div className="wrap" style={{ maxWidth: 520, margin: '12vh auto', padding: '0 20px' }}>
        <h1>Something went wrong</h1>
        <p className="subtitle">
          The page hit an unexpected error and couldn’t finish loading. Reloading usually
          clears it.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: '1.25rem' }}>
          <button onClick={() => window.location.reload()}>Reload</button>
          <a href={home}>
            <button className="secondary">Go to the library</button>
          </a>
        </div>
      </div>
    )
  }
}
