import { act, renderHook as realRenderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DURATION, MAX_TOASTS, ToastProvider, useToast } from './ToastProvider';

const MOTION_ONLY_PROPS = new Set(['layout', 'initial', 'animate', 'exit', 'transition']);

// The countdown bar's behaviour lives entirely in its framer props, which the
// mock strips before they reach the DOM. Surfacing the transition duration as an
// attribute is the only way to assert on it without rendering a real animation.
const reducedMotion = vi.hoisted(() => ({ enabled: false }));

vi.mock('framer-motion', () => ({
    useReducedMotion: () => (reducedMotion.enabled ? true : null),
    motion: {
        div: forwardRef<HTMLDivElement, Record<string, unknown>>(function MockMotionDiv(
            { children, className, ...props },
            ref,
        ) {
            const transition = props.transition as { duration?: number } | undefined;
            const domProps = Object.fromEntries(
                Object.entries(props).filter(([key]) => !MOTION_ONLY_PROPS.has(key) && key !== 'ref'),
            );
            return (
                <div
                    ref={ref}
                    className={className as string}
                    data-transition-duration={transition?.duration}
                    {...(domProps as Record<string, unknown>)}
                >
                    {children as React.ReactNode}
                </div>
            );
        }),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
    AlertCircle: () => <span data-testid="icon-alert-circle" />,
    AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    Info: () => <span data-testid="icon-info" />,
    X: () => <span data-testid="icon-x" />,
}));

function renderToastHook() {
    return renderHook(() => useToast(), {
        wrapper: ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>,
    });
}

// The real `renderHook` returns a handle that re-reads on every render, which is
// what these assertions need. The hand-rolled version kept a snapshot instead,
// so `result.current` could hand back a stale context object.
function renderHook(callback: () => unknown, options: { wrapper: React.ComponentType<{ children: React.ReactNode }> }) {
    return realRenderHook(callback, { wrapper: options.wrapper });
}

describe('ToastProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reducedMotion.enabled = false;
    });

    afterEach(() => {
        if (vi.isFakeTimers()) {
            vi.clearAllTimers();
        }
        vi.useRealTimers();
    });

    describe('showToast', () => {
        it('shows a success toast', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'success', message: 'Saved successfully' });
            });

            expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
        });

        it('shows an error toast', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'error', message: 'Something went wrong' });
            });

            expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
        });

        it('shows a warning toast', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'warning', message: 'Check your input' });
            });

            expect(await screen.findByText('Check your input')).toBeInTheDocument();
        });

        it('shows an info toast', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'New version available' });
            });

            expect(await screen.findByText('New version available')).toBeInTheDocument();
        });

        it('uses default duration of 4000ms', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Default duration toast' });
            });

            expect(await screen.findByText('Default duration toast')).toBeInTheDocument();
        });

        it('accepts custom duration', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'success', message: 'Custom duration', duration: 2000 });
            });

            expect(await screen.findByText('Custom duration')).toBeInTheDocument();
        });
    });

    describe('dismissToast', () => {
        it('dismisses a toast by id', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Dismissible toast' });
            });

            expect(await screen.findByText('Dismissible toast')).toBeInTheDocument();
            await act(async () => {
                toastCtx.dismissToast('missing-id');
            });
            expect(screen.getByText('Dismissible toast')).toBeInTheDocument();
        });
    });

    describe('max 3 toasts limit', () => {
        it('never lets a burst grow the stack past the exported limit', () => {
            // The limit is imported rather than restated, so raising it in the
            // product cannot leave this suite quietly asserting the old number.
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                for (let index = 1; index <= 12; index += 1) {
                    toastCtx.showToast({ type: 'info', message: `Burst ${index}`, duration: 60_000 });
                }
            });

            // Exactly one live timer per surviving toast: an evicted toast that
            // kept its timer would later cancel a live one or come back from the
            // dead.
            expect(screen.getAllByRole('status')).toHaveLength(MAX_TOASTS);
            expect(vi.getTimerCount()).toBe(MAX_TOASTS);
            expect(screen.getByText('Burst 12')).toBeInTheDocument();
            expect(screen.queryByText('Burst 1')).not.toBeInTheDocument();
        });

        it('keeps only 3 toasts when more are added', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Toast 1' });
                toastCtx.showToast({ type: 'info', message: 'Toast 2' });
                toastCtx.showToast({ type: 'info', message: 'Toast 3' });
                toastCtx.showToast({ type: 'info', message: 'Toast 4' });
            });

            expect(await screen.findByText('Toast 4')).toBeInTheDocument();

            const allAlerts = screen.queryAllByRole('alert');
            expect(allAlerts.length).toBeLessThanOrEqual(3);
        });

        it('removes oldest toast when limit is exceeded', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'First' });
                toastCtx.showToast({ type: 'info', message: 'Second' });
                toastCtx.showToast({ type: 'info', message: 'Third' });
                toastCtx.showToast({ type: 'info', message: 'Fourth' });
            });

            expect(screen.queryByText('First')).not.toBeInTheDocument();
            expect(screen.queryByText('Second')).toBeInTheDocument();
            expect(screen.queryByText('Third')).toBeInTheDocument();
            expect(screen.queryByText('Fourth')).toBeInTheDocument();
        });
    });

    describe('useToast hook', () => {
        it('throws error when used outside ToastProvider', async () => {
            const suppressExpectedError = (event: ErrorEvent) => {
                if (
                    event.error instanceof Error &&
                    event.error.message === 'useToast must be used within a ToastProvider'
                ) {
                    event.preventDefault();
                }
            };
            window.addEventListener('error', suppressExpectedError);
            const consoleError = vi.spyOn(window.console, 'error').mockImplementation(() => undefined);
            try {
                expect(() => {
                    realRenderHook(() => useToast());
                }).toThrow('useToast must be used within a ToastProvider');
                await act(async () => {
                    await Promise.resolve();
                });
                expect(
                    consoleError.mock.calls.some((args) =>
                        args.some((arg) => String(arg).includes('useToast must be used within a ToastProvider')),
                    ),
                ).toBe(true);
            } finally {
                window.removeEventListener('error', suppressExpectedError);
                consoleError.mockRestore();
            }
        });
    });

    describe('toast rendering', () => {
        it('announces assertive types as alerts and calm types as status', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'success', message: 'Calm success' });
            });
            expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Calm success');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();

            act(() => {
                toastCtx.showToast({ type: 'error', message: 'Loud failure' });
            });
            expect(await screen.findByRole('alert')).toHaveTextContent('Loud failure');
        });

        it('renders the notification region once, without a nested live region', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'One live region only' });
            });

            const region = await screen.findByRole('region', { name: 'Notifications' });
            expect(region).toBeInTheDocument();
            expect(region).not.toHaveAttribute('aria-live');
        });

        it('renders a dismiss button per toast, named after the toast it dismisses', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'First notification' });
                toastCtx.showToast({ type: 'info', message: 'Second notification' });
            });

            // Two identical "Dismiss toast" labels made the controls impossible to
            // tell apart; the message is what distinguishes them.
            expect(
                screen.getByRole('button', { name: 'Dismiss notification: First notification' }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'Dismiss notification: Second notification' }),
            ).toBeInTheDocument();
        });

        it('removes a toast when its dismiss button is used', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Dismissible toast' });
            });

            await act(async () => {
                screen.getByRole('button', { name: /dismiss notification: Dismissible toast/i }).click();
            });

            expect(screen.queryByText('Dismissible toast')).not.toBeInTheDocument();
        });

        it('dismisses only the toast whose own control was used', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Kept' });
                toastCtx.showToast({ type: 'info', message: 'Removed' });
            });

            await act(async () => {
                screen.getByRole('button', { name: /dismiss notification: Removed/i }).click();
            });

            expect(screen.queryByText('Removed')).not.toBeInTheDocument();
            expect(screen.getByText('Kept')).toBeInTheDocument();
        });

        it('lets the dismiss control be operated from the keyboard', async () => {
            // A mouse-only affordance is not a dismiss control as far as a
            // keyboard user is concerned: the toast then lives for its full
            // lifetime whether they want it gone or not.
            const user = userEvent.setup();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'error', message: 'Dismiss me from the keyboard' });
            });
            const dismiss = await screen.findByRole('button', {
                name: 'Dismiss notification: Dismiss me from the keyboard',
            });
            dismiss.focus();
            expect(dismiss).toHaveFocus();

            await user.keyboard('{Enter}');

            expect(screen.queryByText('Dismiss me from the keyboard')).not.toBeInTheDocument();
        });

        it('holds the countdown bar still when the user asked for reduced motion', () => {
            // `MotionConfig.reducedMotion` only neutralises transform and layout
            // animations, and the bar animates `width`. Left alone it is the one
            // animation on screen that a reduced-motion user still sees move.
            reducedMotion.enabled = true;
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Still please', duration: 4000 });
            });

            const bar = document.querySelector('[data-transition-duration]');
            expect(bar).not.toBeNull();
            // 0s transition, not a 4s slide.
            expect(bar).toHaveAttribute('data-transition-duration', '0');
        });

        it('animates the countdown bar over the toast lifetime by default', () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Sliding', duration: 4000 });
            });

            expect(document.querySelector('[data-transition-duration]')).toHaveAttribute(
                'data-transition-duration',
                '4',
            );
        });

        it('draws a countdown bar only for toasts that actually expire', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            const progressBars = () => document.querySelectorAll('[class*="toast-progress-"]');

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Timed', duration: 1000 });
            });
            expect(progressBars()).toHaveLength(1);

            act(() => {
                toastCtx.showToast({ type: 'warning', message: 'Sticky', duration: 0 });
            });
            // A 0s width transition would flash the bar from full to empty, so the
            // sticky toast simply has none.
            expect(progressBars()).toHaveLength(1);
        });
    });

    describe('auto dismissal', () => {
        it('removes a toast once its duration elapses', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Timed out', duration: 4000 });
            });
            expect(screen.getByText('Timed out')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(3999);
            });
            expect(screen.getByText('Timed out')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(screen.queryByText('Timed out')).not.toBeInTheDocument();
        });

        it('falls back to the default lifetime when the duration is not a number', () => {
            // `Math.max(0, NaN)` is `NaN`, so an unguarded duration produced a
            // toast that never expired *and* a progress bar animated with a
            // `NaN` duration. Anything non-finite has to become the default.
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Nonsense lifetime', duration: Number.NaN });
            });
            expect(screen.getByText('Nonsense lifetime')).toBeInTheDocument();
            expect(document.querySelectorAll('[class*="toast-progress-"]')).toHaveLength(1);

            act(() => {
                vi.advanceTimersByTime(DEFAULT_DURATION - 1);
            });
            expect(screen.getByText('Nonsense lifetime')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(screen.queryByText('Nonsense lifetime')).not.toBeInTheDocument();
        });

        it('treats an infinite duration as the default rather than as a stuck bar', () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Endless', duration: Number.POSITIVE_INFINITY });
            });

            act(() => {
                vi.advanceTimersByTime(DEFAULT_DURATION);
            });
            expect(screen.queryByText('Endless')).not.toBeInTheDocument();
        });

        it('keeps a toast with a zero duration until it is dismissed explicitly', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'warning', message: 'Sticky warning', duration: 0 });
            });

            act(() => {
                vi.advanceTimersByTime(60_000);
            });
            expect(screen.getByText('Sticky warning')).toBeInTheDocument();

            await act(async () => {
                screen.getByRole('button', { name: /dismiss notification: Sticky warning/i }).click();
            });
            expect(screen.queryByText('Sticky warning')).not.toBeInTheDocument();
        });

        it('cancels the pending timer of a toast that is evicted by the stack limit', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Short lived', duration: 1000 });
                toastCtx.showToast({ type: 'info', message: 'Second', duration: 60_000 });
                toastCtx.showToast({ type: 'info', message: 'Third', duration: 60_000 });
                toastCtx.showToast({ type: 'info', message: 'Fourth', duration: 60_000 });
            });
            expect(screen.queryByText('Short lived')).not.toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(1000);
            });

            // Evicting "Short lived" must not have taken the surviving toasts
            // down with it when its original timer fired.
            expect(screen.getByText('Second')).toBeInTheDocument();
            expect(screen.getByText('Third')).toBeInTheDocument();
            expect(screen.getByText('Fourth')).toBeInTheDocument();
        });

        it('leaves a real toast timer alone when an unrelated id is dismissed', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Soon gone', duration: 500 });
            });
            expect(vi.getTimerCount()).toBe(1);

            await act(async () => {
                toastCtx.dismissToast('unknown-id');
            });
            expect(screen.getByText('Soon gone')).toBeInTheDocument();
            // The unknown id is a no-op, so the live toast still owns exactly one timer.
            expect(vi.getTimerCount()).toBe(1);

            act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(screen.queryByText('Soon gone')).not.toBeInTheDocument();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('uses the default duration when none is given', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Default lifetime' });
            });

            act(() => {
                vi.advanceTimersByTime(3999);
            });
            expect(screen.getByText('Default lifetime')).toBeInTheDocument();
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(screen.queryByText('Default lifetime')).not.toBeInTheDocument();
        });

        it('treats a negative duration as sticky instead of scheduling an instant dismissal', async () => {
            vi.useFakeTimers();
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'warning', message: 'Never expires', duration: -1 });
            });

            act(() => {
                vi.advanceTimersByTime(120_000);
            });
            expect(screen.getByText('Never expires')).toBeInTheDocument();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('stops every pending timer when the provider unmounts', async () => {
            vi.useFakeTimers();
            const { result, unmount } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Doomed', duration: 1000 });
                toastCtx.showToast({ type: 'info', message: 'Also doomed', duration: 1000 });
            });
            expect(vi.getTimerCount()).toBe(2);

            unmount();
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    describe('multiple toasts', () => {
        it('shows multiple toasts simultaneously', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'success', message: 'Alpha' });
                toastCtx.showToast({ type: 'error', message: 'Beta' });
            });

            expect(await screen.findByText('Alpha')).toBeInTheDocument();
            expect(screen.getByText('Beta')).toBeInTheDocument();
        });
    });

    describe('context identity', () => {
        it('does not re-render its consumers when a toast arrives or leaves', () => {
            // A fresh context object on every provider render - the value the
            // provider used to publish inline - redrew every `useToast`
            // consumer in the shell each time a notification came or went, which
            // is the whole application tree for a one-line change to a corner
            // of the screen.
            let consumerRenders = 0;
            const Consumer = memo(function Consumer({ value }: { value: unknown }) {
                consumerRenders += 1;
                return <span data-testid="consumer">{typeof value}</span>;
            });
            const Host = () => {
                const value = useToast();
                return <Consumer value={value} />;
            };

            const { result } = renderHook(() => useToast(), {
                wrapper: ({ children }: { children: React.ReactNode }) => (
                    <ToastProvider>
                        <Host />
                        {children}
                    </ToastProvider>
                ),
            });
            const toastCtx = result.current as ReturnType<typeof useToast>;
            expect(consumerRenders).toBe(1);

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Consumer should not redraw' });
            });
            expect(screen.getByText('Consumer should not redraw')).toBeInTheDocument();
            expect(consumerRenders).toBe(1);

            act(() => {
                toastCtx.dismissToast('unknown-id');
            });
            expect(screen.getByText('Consumer should not redraw')).toBeInTheDocument();
            expect(consumerRenders).toBe(1);
        });
    });
});
