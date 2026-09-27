import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Toast, ToastContextValue, ToastType } from '../types';

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Exported so the tests assert the real limits instead of restating them. A
 * test that hard-codes `3` and `4000` keeps passing after the product changes
 * the contract, which is the opposite of what a test is for.
 */
export const MAX_TOASTS = 3;
export const DEFAULT_DURATION = 4000;

/**
 * Coerces a caller-supplied lifetime to a usable one.
 *
 * `Math.max(0, NaN)` is `NaN`, which is neither "no timeout" nor a number of
 * milliseconds: the toast would be treated as sticky while its progress bar was
 * handed a `NaN` duration. Anything that is not a finite number falls back to
 * the default rather than silently becoming a toast that never leaves.
 */
const normalizeDuration = (duration: number | undefined): number => {
    if (duration === undefined) {
        return DEFAULT_DURATION;
    }
    return Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_DURATION;
};

const toastConfig: Record<
    ToastType,
    {
        icon: typeof CheckCircle;
        surface: string;
        text: string;
        iconColor: string;
        progress: string;
    }
> = {
    success: {
        icon: CheckCircle,
        surface: 'toast-success',
        text: 'toast-success-text',
        iconColor: 'toast-success-icon',
        progress: 'toast-progress-success',
    },
    error: {
        icon: AlertCircle,
        surface: 'toast-error',
        text: 'toast-error-text',
        iconColor: 'toast-error-icon',
        progress: 'toast-progress-error',
    },
    warning: {
        icon: AlertTriangle,
        surface: 'toast-warning',
        text: 'toast-warning-text',
        iconColor: 'toast-warning-icon',
        progress: 'toast-progress-warning',
    },
    info: {
        icon: Info,
        surface: 'toast-info',
        text: 'toast-info-text',
        iconColor: 'toast-info-icon',
        progress: 'toast-progress-info',
    },
};

// `AnimatePresence mode="popLayout"` measures its children, which means the
// child has to forward the ref it is cloned with down to the DOM node.
const ToastItem = memo(
    forwardRef<HTMLDivElement, { toast: Toast; onDismiss: (id: string) => void }>(function ToastItem(
        { toast, onDismiss },
        ref,
    ) {
        const config = toastConfig[toast.type];
        const Icon = config.icon;
        // `MotionConfig.reducedMotion` only neutralises transform and layout
        // animations, and this bar animates `width`. Reading the preference here
        // is what keeps the one animation the user explicitly asked to be rid of
        // from still sliding across their screen.
        const prefersReducedMotion = useReducedMotion() === true;

        return (
            <motion.div
                ref={ref}
                layout
                initial={{ opacity: 0, x: 100, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.8 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                className={`relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border p-4 shadow-xl ${config.surface}`}
                role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
                aria-live={toast.type === 'error' || toast.type === 'warning' ? 'assertive' : 'polite'}
                aria-atomic="true"
            >
                <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${config.iconColor}`} aria-hidden="true" />
                <p className={`flex-1 text-sm font-medium ${config.text}`}>{toast.message}</p>
                <button
                    type="button"
                    onClick={() => onDismiss(toast.id)}
                    className={`flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current ${config.text}`}
                    // Every toast has a dismiss control, so the bare label made
                    // them indistinguishable once more than one was on screen.
                    aria-label={`Dismiss notification: ${toast.message}`}
                >
                    <X size={16} aria-hidden="true" />
                </button>
                {/* A sticky toast has no countdown, and a 0s width transition would
                    flash the bar from full to empty instead of not drawing it. */}
                {toast.duration > 0 && (
                    <motion.div
                        className={`absolute bottom-0 left-0 h-1 rounded-b-xl ${config.progress}`}
                        initial={{ width: '100%' }}
                        // Under reduced motion the bar stays put: it still says
                        // "this is temporary", without animating to say it.
                        animate={{ width: prefersReducedMotion ? '100%' : '0%' }}
                        transition={
                            prefersReducedMotion ? { duration: 0 } : { duration: toast.duration / 1000, ease: 'linear' }
                        }
                        aria-hidden="true"
                    />
                )}
            </motion.div>
        );
    }),
);

interface ToastProviderProps {
    children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const clearTimer = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    }, []);

    const dismissToast = useCallback(
        (id: string) => {
            clearTimer(id);
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        },
        [clearTimer],
    );

    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            timers.clear();
        };
    }, []);

    // Timers are pruned from the committed list rather than from inside the
    // `setToasts` updater. A state updater must be pure - React replays it in
    // StrictMode and again whenever a render is thrown away - and mutating the
    // timer map from inside one meant each eviction cleared the timer twice.
    // Deriving it from the rendered list also covers every other way a toast can
    // leave the stack.
    useEffect(() => {
        const live = new Set(toasts.map((toast) => toast.id));
        for (const id of [...timersRef.current.keys()]) {
            if (!live.has(id)) {
                clearTimer(id);
            }
        }
    }, [clearTimer, toasts]);

    const showToast = useCallback(
        ({ type, message, duration }: { type: ToastType; message: string; duration?: number }) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const safeDuration = normalizeDuration(duration);

            setToasts((prev) => {
                // Trimming a toast also has to drop its pending dismissal timer,
                // otherwise a later id reuse could cancel the wrong toast. The
                // pruning effect above owns that now.
                const overflow = Math.max(0, prev.length + 1 - MAX_TOASTS);
                return [...prev.slice(overflow), { id, type, message, duration: safeDuration }];
            });

            if (safeDuration > 0) {
                timersRef.current.set(
                    id,
                    setTimeout(() => {
                        timersRef.current.delete(id);
                        setToasts((prev) => prev.filter((toast) => toast.id !== id));
                    }, safeDuration),
                );
            }
        },
        [],
    );

    // The context object has to keep its identity across renders. A fresh
    // literal on every render - which is what this provider used to publish -
    // made every `useToast` consumer in the tree re-render each time a toast
    // came or went, so the shell redrew in full to move one notification.
    const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <section className="fixed right-4 top-4 z-50 flex flex-col gap-3" aria-label="Notifications">
                <AnimatePresence mode="popLayout">
                    {toasts.map((toast) => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
                    ))}
                </AnimatePresence>
            </section>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

export default ToastProvider;
