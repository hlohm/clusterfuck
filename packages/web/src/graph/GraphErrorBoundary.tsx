import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | undefined
}

/**
 * The graph has no runtime validation on cluster data coming over the wire
 * (aggregation is trusted, not schema-checked) — an unrecognized enum value
 * or similarly malformed field throws mid-render, and with no boundary that
 * unmounts the whole app to a blank screen with no visible cause. This turns
 * that into a visible, recoverable error instead of a silent blank canvas.
 */
export class GraphErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[clusterfuck] graph view crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="graph-error">
          <p>The graph failed to render.</p>
          <p className="graph-error__detail">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: undefined })}>Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
