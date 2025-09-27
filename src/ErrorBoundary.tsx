import React from 'react'

type Props = { children: React.ReactNode }

type State = { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error) {
        // no-op; could log to a service
        console.error('App error:', error)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui', color: '#000', background: '#fff' }}>
                    <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid #000', padding: 12 }}>
                        {String(this.state.error?.message ?? this.state.error)}
                    </pre>
                </div>
            )
        }
        return this.props.children
    }
}
