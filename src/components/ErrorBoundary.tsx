import type { ErrorInfo, ReactNode } from 'react';
import { Component as ReactComponent } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends ReactComponent<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // biome-ignore lint/suspicious/noConsole: Error boundaries must log errors for production debugging
        console.error('ErrorBoundary caught an error:', error, errorInfo.componentStack);
    }

    handleTryAgain = (): void => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-app-border bg-app-surface p-8 text-center">
                    <div className="rounded-full bg-app-accent-error/10 p-3 text-app-accent-error">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Error icon"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" x2="12" y1="8" y2="12" />
                            <line x1="12" x2="12.01" y1="16" y2="16" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-app-text-main">Something went wrong</h2>
                    <p className="max-w-sm text-sm text-app-text-muted">
                        An unexpected error occurred. Please try reloading the page.
                    </p>
                    {this.state.error && (
                        <details className="w-full max-w-md rounded-lg bg-app-bg p-3 text-left">
                            <summary className="cursor-pointer text-xs font-medium text-app-text-muted">
                                Error details
                            </summary>
                            <pre className="mt-2 overflow-x-auto text-xs text-app-accent-error">
                                {this.state.error.message}
                            </pre>
                        </details>
                    )}
                    <button
                        type="button"
                        onClick={this.handleTryAgain}
                        className="rounded-lg bg-app-primary px-6 py-2 text-sm font-medium text-app-primary-fg transition-colors hover:bg-app-primary-hover"
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
