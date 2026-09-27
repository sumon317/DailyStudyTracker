import type { ReactNode } from 'react';
import { Component as ReactComponent, useEffect, useId, useRef } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Expando React adds to a thrown object in development mode, when some `window`
 * `error` handler called `preventDefault()` on the event React dispatched.
 *
 * It is React's own bookkeeping - "this render error was already reported, do
 * not log it again" - and not part of what the component threw. Serialising it
 * would put `_suppressLogging: true` in the middle of the message shown to the
 * user, which is the one piece of the failure that must be readable. Only this
 * exact key is dropped: a component that throws `_id` still means it.
 */
const REACT_LOGGING_EXPANDO = '_suppressLogging';

const withoutReactBookkeeping = (value: object): Record<string, unknown> => {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key !== REACT_LOGGING_EXPANDO) {
            copy[key] = entry;
        }
    }
    return copy;
};

/**
 * Anything can be thrown, not just an `Error`. Without this the fallback would
 * render `undefined` for `throw 'boom'` and give the user nothing to act on.
 */
const toError = (value: unknown): Error => {
    if (value instanceof Error) {
        return value;
    }
    if (typeof value === 'string') {
        return new Error(value.length > 0 ? value : 'Unknown error');
    }
    try {
        const serialized =
            typeof value === 'object' && value !== null
                ? JSON.stringify(withoutReactBookkeeping(value))
                : JSON.stringify(value);
        return new Error(serialized === undefined ? String(value) : serialized);
    } catch {
        return new Error('Unknown error');
    }
};

/**
 * The default recovery panel.
 *
 * It lives in its own component so the heading id comes from `useId`: a
 * hard-coded id collides as soon as a second boundary falls back in the same
 * document, and both alerts would then be labelled by whichever mounted first.
 */
const ErrorFallback = ({ error, onTryAgain }: { error: Error | null; onTryAgain: () => void }) => {
    const titleId = useId();
    const alertRef = useRef<HTMLElement>(null);

    useEffect(() => {
        // The subtree that failed is gone, so focus would otherwise be dropped
        // on <body> with no indication that anything went wrong.
        alertRef.current?.focus();
    }, []);

    return (
        <section
            ref={alertRef}
            role="alert"
            aria-live="assertive"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-app-border bg-app-surface p-8 text-center focus:outline-none"
        >
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
            <h2 id={titleId} className="text-lg font-semibold text-app-text-main">
                Something went wrong
            </h2>
            <p className="max-w-sm text-sm text-app-text-muted">
                An unexpected error occurred. Please try reloading the page.
            </p>
            <details className="w-full max-w-md rounded-lg bg-app-bg p-3 text-left">
                <summary className="cursor-pointer text-xs font-medium text-app-text-muted">Error details</summary>
                <pre className="mt-2 overflow-x-auto text-xs text-app-accent-error">{error?.message}</pre>
            </details>
            <button
                type="button"
                onClick={onTryAgain}
                className="rounded-lg bg-app-primary px-6 py-2 text-sm font-medium text-app-primary-fg transition-colors hover:bg-app-primary-hover focus:outline-none focus:ring-2 focus:ring-app-primary"
            >
                Try Again
            </button>
        </section>
    );
};

class ErrorBoundary extends ReactComponent<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
        return { hasError: true, error: toError(error) };
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

            return <ErrorFallback error={this.state.error} onTryAgain={this.handleTryAgain} />;
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
