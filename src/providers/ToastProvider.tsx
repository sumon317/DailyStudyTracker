import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, memo, useCallback, useContext, useState } from 'react';
import type { Toast, ToastContextValue, ToastType } from '../types';

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4000;

const toastConfig: Record<
    ToastType,
    {
        icon: typeof CheckCircle;
        bg: string;
        border: string;
        text: string;
        iconColor: string;
        progress: string;
    }
> = {
    success: {
        icon: CheckCircle,
        bg: 'bg-green-50',
        border: 'border-green-200',
        text: 'text-green-800',
        iconColor: 'text-green-500',
        progress: 'bg-green-500',
    },
    error: {
        icon: AlertCircle,
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-800',
        iconColor: 'text-red-500',
        progress: 'bg-red-500',
    },
    warning: {
        icon: AlertTriangle,
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-800',
        iconColor: 'text-amber-500',
        progress: 'bg-amber-500',
    },
    info: {
        icon: Info,
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        text: 'text-blue-800',
        iconColor: 'text-blue-500',
        progress: 'bg-blue-500',
    },
};

const ToastItem = memo(function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
    const config = toastConfig[toast.type];
    const Icon = config.icon;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
            className={`flex items-start gap-3 w-full max-w-sm rounded-xl border shadow-xl p-4 ${config.bg} ${config.border}`}
            role="alert"
        >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
            <p className={`flex-1 text-sm font-medium ${config.text}`}>{toast.message}</p>
            <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className={`flex-shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors ${config.text}`}
                aria-label="Dismiss toast"
            >
                <X className="w-4 h-4" />
            </button>
            <motion.div
                className={`absolute bottom-0 left-0 h-1 rounded-b-xl ${config.progress}`}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: toast.duration / 1000, ease: 'linear' }}
                onAnimationComplete={() => onDismiss(toast.id)}
            />
        </motion.div>
    );
});

interface ToastProviderProps {
    children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback(
        ({ type, message, duration = DEFAULT_DURATION }: { type: ToastType; message: string; duration?: number }) => {
            setToasts((prev) => {
                const trimmed = prev.length >= MAX_TOASTS ? prev.slice(prev.length - MAX_TOASTS + 1) : prev;
                return [
                    ...trimmed,
                    {
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                        type,
                        message,
                        duration,
                    },
                ];
            });
        },
        [],
    );

    const dismissToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast, dismissToast }}>
            {children}
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-3" aria-live="polite">
                <AnimatePresence mode="popLayout">
                    {toasts.map((toast) => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
                    ))}
                </AnimatePresence>
            </div>
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
