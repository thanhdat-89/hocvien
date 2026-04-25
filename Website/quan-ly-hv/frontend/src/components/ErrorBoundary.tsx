import React, { Component, ReactNode } from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-lg w-full bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-error/20">
            <div className="w-12 h-12 rounded-xl bg-error/10 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-error">error</span>
            </div>
            <h2 className="text-xl font-headline font-bold text-on-surface mb-2">Có lỗi xảy ra</h2>
            <p className="text-sm text-outline mb-4">{this.state.error.message}</p>
            <pre className="text-[10px] bg-surface-container-low p-4 rounded-xl overflow-auto max-h-40 text-outline mb-6">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload() }}
              className="btn-primary"
            >
              <span className="material-symbols-outlined">refresh</span>
              Tải lại trang
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
