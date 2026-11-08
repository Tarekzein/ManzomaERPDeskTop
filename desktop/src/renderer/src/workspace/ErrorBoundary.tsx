import { Component, type ReactNode } from 'react'
import { ErrorBox } from '@/components/ui'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) return <ErrorBox error={this.state.error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
