import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info)
  }
  reset = () => this.setState({ error: null })
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg py-20 text-center">
          <div className="card p-8">
            <div className="font-display text-2xl text-white">Something hiccuped.</div>
            <p className="mt-2 text-sm text-slate-400">This view hit an error — the rest of the app is fine.</p>
            <p className="mt-3 font-mono text-xs text-slate-600">{String(this.state.error?.message || this.state.error)}</p>
            <button onClick={this.reset} className="btn-ghost mt-5">Try again</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
