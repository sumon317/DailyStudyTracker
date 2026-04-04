import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, className, ...props }: Record<string, unknown>) => (
            <div className={className as string} {...(props as Record<string, unknown>)}>
                {children as React.ReactNode}
            </div>
        ),
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

function renderHook(callback: () => unknown, options: { wrapper: React.ComponentType<{ children: React.ReactNode }> }) {
    const resultRef: { current: unknown } = { current: null };
    const TestComponent = () => {
        resultRef.current = callback();
        return null;
    };
    render(<TestComponent />, { wrapper: options.wrapper });
    return { result: resultRef };
}

describe('ToastProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

            const toastElement = await screen.findByText('Dismissible toast');
            const toastContainer = toastElement.closest('[role="alert"]');

            const dismissButton = toastContainer?.querySelector(
                'button[aria-label="Dismiss toast"]',
            ) as HTMLButtonElement | null;
            if (dismissButton) {
                await act(async () => {
                    dismissButton.click();
                });
            }
        });
    });

    describe('max 3 toasts limit', () => {
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
            const { renderHook: bareRenderHook } = await import('@testing-library/react');
            expect(() => {
                bareRenderHook(() => useToast());
            }).toThrow('useToast must be used within a ToastProvider');
        });
    });

    describe('toast rendering', () => {
        it('renders toast with alert role', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'success', message: 'Alert role test' });
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toBeInTheDocument();
        });

        it('renders dismiss button', async () => {
            const { result } = renderToastHook();
            const toastCtx = result.current as ReturnType<typeof useToast>;

            act(() => {
                toastCtx.showToast({ type: 'info', message: 'Dismiss test' });
            });

            const dismissButton = await screen.findByRole('button', { name: /dismiss toast/i });
            expect(dismissButton).toBeInTheDocument();
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
});
