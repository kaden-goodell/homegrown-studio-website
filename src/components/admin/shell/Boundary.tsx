import { Component, type ReactNode } from 'react'

/**
 * One part of /admin that failed to draw (a bad stored record, a bug) says so
 * with Try again, and the rest keeps working. One per tab and one per sheet.
 */
export class Boundary extends Component<{ children: ReactNode; fallback?: (retry: () => void) => ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(`[admin] ${this.props.name} failed to draw`, error)
  }
  retry = () => this.setState({ failed: false })
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.retry)
    return <Crashed onRetry={this.retry} />
  }
}

export function Crashed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="adm-fail adm-crash" role="alert">
      <p>Something went wrong showing this.</p>
      <button type="button" className="adm-btn is-ghost is-sm" onClick={onRetry}>Try again</button>
    </div>
  )
}
