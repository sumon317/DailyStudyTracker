import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

const Boom = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Kaboom while rendering');
    }
    return <p>All good</p>;
};

/** Throws whatever it is handed, which is not always an `Error`. */
const Thrower = ({ value }: { value: unknown }) => {
    throw value;
};

const silenceReactErrorLog = () => {
    // React logs every caught render error, and jsdom re-reports the same failure as
    // an uncaught `error` event on `window`. Both are expected for these tests.
    //
    // The window listener covers *every* event for the length of the test, not just
    // the one whose `error` is an `Error` with a known message. The suite also throws a
    // string, a plain object and a circular value, and jsdom prints an `ErrorEvent`
    // carrying a non-`Error` as the bare text `undefined` - twelve stray lines that
    // say nothing and bury the one real failure a run is meant to surface. Swallowing
    // only the `Error` cases left those behind.
    //
    // It stays local and is undone in a `finally` by every caller: nothing here is
    // silenced outside the scope of a test that throws on purpose.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const swallow = (event: ErrorEvent) => {
        event.preventDefault();
    };
    window.addEventListener('error', swallow);
    return () => {
        window.removeEventListener('error', swallow);
        consoleSpy.mockRestore();
    };
};

describe('ErrorBoundary', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...originalLocation, reload: vi.fn() },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
    });

    it('renders its children while nothing throws', () => {
        render(
            <ErrorBoundary>
                <Boom shouldThrow={false} />
            </ErrorBoundary>,
        );

        expect(screen.getByText('All good')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('announces a render failure assertively and exposes the message on demand', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary>
                    <Boom shouldThrow />
                </ErrorBoundary>,
            );

            const alert = screen.getByRole('alert');
            expect(alert).toHaveAttribute('aria-live', 'assertive');
            expect(alert).toHaveAccessibleName('Something went wrong');
            expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
            expect(screen.getByText('An unexpected error occurred. Please try reloading the page.')).toBeVisible();
            expect(screen.getByText('Kaboom while rendering')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('reloads the page and recovers when Try Again is used', async () => {
        const user = userEvent.setup();
        const restore = silenceReactErrorLog();
        try {
            const { rerender } = render(
                <ErrorBoundary>
                    <Boom shouldThrow />
                </ErrorBoundary>,
            );
            expect(screen.getByRole('alert')).toBeInTheDocument();

            // Swap in a healthy subtree first: retrying with the same throwing
            // child would simply raise the boundary again.
            rerender(
                <ErrorBoundary>
                    <Boom shouldThrow={false} />
                </ErrorBoundary>,
            );
            await user.click(screen.getByRole('button', { name: 'Try Again' }));

            expect(window.location.reload).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByText('All good')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('renders a caller supplied fallback instead of the default panel', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary fallback={<p>Custom recovery</p>}>
                    <Boom shouldThrow />
                </ErrorBoundary>,
            );

            expect(screen.getByText('Custom recovery')).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('stays in the failed state until it is explicitly reset', () => {
        const restore = silenceReactErrorLog();
        try {
            const { rerender } = render(
                <ErrorBoundary>
                    <Boom shouldThrow />
                </ErrorBoundary>,
            );
            expect(screen.getByRole('alert')).toBeInTheDocument();

            // An error boundary deliberately latches: new children alone must
            // not silently paper over the failure.
            act(() => {
                rerender(
                    <ErrorBoundary>
                        <p>Recovered content</p>
                    </ErrorBoundary>,
                );
            });

            expect(screen.queryByText('Recovered content')).not.toBeInTheDocument();
            expect(screen.getByRole('alert')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('moves focus onto the alert so the failure is not silent', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary>
                    <Boom shouldThrow />
                </ErrorBoundary>,
            );

            // The subtree that failed is gone; without this, focus would drop
            // onto <body> and nothing would indicate anything went wrong.
            expect(screen.getByRole('alert')).toHaveFocus();
        } finally {
            restore();
        }
    });

    it('reports a thrown string instead of rendering nothing useful', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary>
                    <Thrower value="plain string failure" />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('plain string failure')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('deserialises a thrown object into something readable', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary>
                    <Thrower value={{ code: 'E_NO_DATA', subject: 'Physics' }} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert')).toBeInTheDocument();
            // No `_suppressLogging`: React stamps that onto a thrown object when a
            // `window` `error` handler prevents the default, which is exactly what
            // `silenceReactErrorLog` does. It is React's bookkeeping, and putting it
            // in the one message the user is meant to act on would be noise.
            expect(screen.getByText('{"code":"E_NO_DATA","subject":"Physics"}')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('keeps a thrown key that merely starts with an underscore', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary>
                    <Thrower value={{ _id: 'row-7' }} />
                </ErrorBoundary>,
            );

            expect(screen.getByText('{"_id":"row-7"}')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('falls back to a printable message for a value that cannot be serialised', () => {
        const restore = silenceReactErrorLog();
        try {
            // A circular structure makes JSON.stringify throw, which is the one
            // case that leaves the fallback with nothing to show.
            const circular: Record<string, unknown> = {};
            circular.self = circular;

            render(
                <ErrorBoundary>
                    <Thrower value={circular} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('Unknown error')).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('gives each boundary in the document its own heading id', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <div>
                    <ErrorBoundary>
                        <Thrower value="first failure" />
                    </ErrorBoundary>
                    <ErrorBoundary>
                        <Thrower value="second failure" />
                    </ErrorBoundary>
                </div>,
            );

            const alerts = screen.getAllByRole('alert');
            expect(alerts).toHaveLength(2);
            // A shared hard-coded id would leave both alerts labelled by
            // whichever one mounted first.
            expect(alerts[0]).toHaveAccessibleName('Something went wrong');
            expect(alerts[1]).toHaveAccessibleName('Something went wrong');
            expect(alerts[0]?.getAttribute('aria-labelledby')).not.toBe(alerts[1]?.getAttribute('aria-labelledby'));
        } finally {
            restore();
        }
    });

    it('keeps a caller supplied fallback out of the alert role', () => {
        const restore = silenceReactErrorLog();
        try {
            render(
                <ErrorBoundary fallback={<p>Custom recovery</p>}>
                    <Thrower value="boom" />
                </ErrorBoundary>,
            );

            // The caller's node replaces the panel wholesale, so the boundary
            // must not bolt its own live-region semantics onto it.
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByText('Custom recovery')).toBeInTheDocument();
        } finally {
            restore();
        }
    });
});
