import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Settings, X } from 'lucide-react';
import { memo, useEffect, useId, useRef } from 'react';
import type { AlarmPermissionModalProps } from '../../types';
import { getFocusableElements } from '../shared/focusOrder';
import { useModalLayer } from './useModalLayer';

const AlarmPermissionModal = memo(({ isOpen, onClose, onOpenSettings }: AlarmPermissionModalProps) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();
    const descriptionId = useId();
    onCloseRef.current = onClose;

    // The shell can raise this dialog underneath the update dialog, and two
    // `aria-modal` layers each containing focus are a deadlock: neither keeps the
    // caret. Only the top layer takes the keyboard.
    const layer = useModalLayer(isOpen);

    useEffect(() => {
        if (!isOpen || !layer.isTop) {
            return;
        }

        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusTimer = window.setTimeout(() => {
            const firstFocusable = getFocusableElements(dialogRef.current ?? document)[0];
            (firstFocusable ?? dialogRef.current)?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) {
                return;
            }

            const focusable = getFocusableElements(dialogRef.current);
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };

        // A full-screen blocking dialog that advertises `aria-modal` has to keep
        // focus inside it, including when something moves it there (a restored
        // scroll position, a browser finding, an assistive tool). Trapping Tab
        // alone does not cover that.
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target;
            if (target instanceof Node && dialogRef.current && !dialogRef.current.contains(target)) {
                dialogRef.current.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', handleFocusIn);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('focusin', handleFocusIn);
            // The opener may have unmounted with the dialog (a route change, a
            // deleted item). Focusing a detached node is a silent no-op that leaves
            // the caret on `<body`, restarting the tab sequence from the top.
            const target = previousFocusRef.current;
            previousFocusRef.current = null;
            if (target?.isConnected) {
                target.focus();
            }
        };
    }, [isOpen, layer.isTop]);

    return (
        <AnimatePresence>
            {isOpen && (
                // Painted from the stack depth rather than a fixed `z-50`: both
                // dialogs used the same class, so the one on top was whichever the
                // tree happened to render last, not the one raised last.
                <div
                    className="fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                    style={{ zIndex: layer.zIndex }}
                >
                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        aria-describedby={descriptionId}
                        tabIndex={-1}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="w-full max-w-sm overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl"
                    >
                        <div className="relative bg-app-warning-container p-6 text-center text-app-warning-container-text">
                            <button
                                type="button"
                                onClick={onClose}
                                className="absolute right-3 top-3 rounded-full bg-black/10 p-1 transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="Close alarm permission dialog"
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/10 backdrop-blur-md">
                                <AlertTriangle size={24} aria-hidden="true" />
                            </div>
                            <h2 id={titleId} className="text-xl font-bold">
                                Alarm Permission Needed
                            </h2>
                        </div>

                        <div className="p-6">
                            <div
                                id={descriptionId}
                                className="mb-6 rounded-xl border border-app-border bg-app-bg p-4 text-sm text-app-text-main"
                            >
                                <p className="mb-3">
                                    <strong>Your alarms may not work</strong> when the app is closed because Android
                                    requires a special permission.
                                </p>
                                <p className="text-app-text-muted">
                                    Please enable <strong>“Alarms &amp; Reminders”</strong> in Settings to ensure your
                                    study reminders work reliably.
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 rounded-xl border border-app-border px-4 py-3 font-medium text-app-text-muted transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                >
                                    Later
                                </button>
                                <button
                                    type="button"
                                    onClick={onOpenSettings}
                                    className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-app-warning-container px-4 py-3 font-bold text-app-warning-container-text shadow-lg transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                >
                                    <Settings size={18} aria-hidden="true" />
                                    Open Settings
                                </button>
                            </div>

                            <p className="mt-4 text-center text-xs text-app-text-muted">
                                Go to: Settings → Apps → Daily Study Tracker → Alarms &amp; Reminders
                            </p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
});

AlarmPermissionModal.displayName = 'AlarmPermissionModal';

export default AlarmPermissionModal;
