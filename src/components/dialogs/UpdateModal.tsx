import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { motion } from 'framer-motion';
import { Download, Gift, Settings, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import NativeAppUpdate, {
    INSTALL_PERMISSION_ERROR,
    isAndroidInstallTarget,
    isInstallPermissionGranted,
} from '../../native/NativeAppUpdate';
import { downloadAndInstallUpdate, getCurrentVersion, isAllowedReleaseUrl } from '../../services/updateService';
import type { UpdateModalProps } from '../../types';
import { getFocusableElements } from '../shared/focusOrder';
import { useModalLayer } from './useModalLayer';

export type { UpdateModalProps } from '../../types';

type UpdateStatus = 'checking' | 'idle' | 'downloading' | 'installing' | 'success' | 'error';

const INSTALL_PERMISSION_PROBE_ERROR =
    'Could not read the Android install permission. Update this app manually, then try again.';
const DOWNLOAD_FAILED_ERROR = 'The update could not be downloaded.';

// The bridge is imported statically, exactly as `updateService` does. The earlier
// `await import()` here was not lazy in any real sense: the module was already
// in the main chunk because the three named helpers above come from it, so
// Rollup emitted `INEFFECTIVE_DYNAMIC_IMPORT` and the extra `await` bought
// nothing but a failure point. `registerPlugin` is a no-op on a platform with no
// implementation, so importing it early costs nothing either.

const formatBytes = (size: number | undefined): string => {
    if (size === undefined || !Number.isFinite(size)) {
        return '';
    }
    if (size < 1024 * 1024) {
        return `${Math.max(1, Math.round(size / 1024))} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const UpdateModal = memo(({ isOpen, onClose, updateInfo, onRemindLater }: UpdateModalProps) => {
    const activeUpdate = updateInfo ?? null;
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const visible = isOpen ?? Boolean(activeUpdate);
    const busy = status === 'checking' || status === 'downloading' || status === 'installing';
    const busyRef = useRef(busy);
    busyRef.current = busy;
    const [needsInstallPermission, setNeedsInstallPermission] = useState(false);
    // The re-probe runs from a listener registered once when the dialog opens, so
    // it cannot close over the value that listener was created with. The ref is
    // what lets it tell "a refusal is on screen" from "an unrelated failure is".
    const needsInstallPermissionRef = useRef(needsInstallPermission);
    needsInstallPermissionRef.current = needsInstallPermission;
    const settingsBusyRef = useRef(false);
    const manualUrl = activeUpdate?.url;
    const canOpenManually = Boolean(manualUrl && isAllowedReleaseUrl(manualUrl));
    const versionLabel = activeUpdate?.tag ?? '';
    const resetKey = `${activeUpdate?.tag ?? ''}:${isOpen ? 'open' : 'closed'}`;

    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // The alarm-permission dialog can be raised underneath this one, and two
    // `aria-modal` layers each containing focus are a deadlock: neither keeps the
    // caret, and one Escape press would dismiss both. Only the top layer takes
    // the keyboard, and it is the one that paints on top.
    const layer = useModalLayer(visible);

    // A new release (or a reopen) restarts the flow, but never mid-transfer:
    // wiping the progress of a running install would leave the dialog claiming
    // "idle" while bytes are still on the wire.
    //
    // `resetKey` identifies *which* flow the dialog is showing rather than
    // feeding the reset itself, so the reset is modelled as a transition between
    // two flows: the effect compares the key it last applied against the current
    // one and only rewrites state when they differ. That is what makes the
    // dependency real rather than decorative, and it keeps the `busyRef` guard
    // able to skip the rewrite - the key is still recorded, so a later change is
    // still noticed.
    const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
    useEffect(() => {
        if (appliedResetKey === resetKey) {
            return;
        }
        setAppliedResetKey(resetKey);
        if (busyRef.current) {
            return;
        }
        setStatus('idle');
        setProgress(0);
        setError(null);
        setNeedsInstallPermission(false);
    }, [appliedResetKey, resetKey]);

    useEffect(() => {
        if (!visible || !layer.isTop) {
            return;
        }
        // The dialog claims `aria-modal`, so focus moves into it, is contained
        // while it is up, and is handed back to the trigger on close.
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusTimer = window.setTimeout(() => {
            const target = getFocusableElements(dialogRef.current ?? document)[0] ?? dialogRef.current;
            target?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!dialogRef.current) {
                return;
            }
            if (event.key === 'Escape' && !busyRef.current) {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') {
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
            // The trigger may have unmounted with the dialog (a route change, a
            // deleted item). Focusing a detached node is a silent no-op that leaves
            // the caret on `<body`, restarting the tab sequence from the top.
            const target = previousFocusRef.current;
            previousFocusRef.current = null;
            if (target?.isConnected) {
                target.focus();
            }
        };
    }, [visible, layer.isTop]);

    const assetDetails = [
        activeUpdate?.assetName,
        formatBytes(activeUpdate?.size),
        activeUpdate?.sha256 ? `SHA-256 ${activeUpdate.sha256.slice(0, 12)}…` : 'SHA-256 unavailable',
    ]
        .filter(Boolean)
        .join(' · ');

    const handleUpdate = useCallback(async () => {
        if (!activeUpdate || busyRef.current) {
            return;
        }
        // Closed synchronously, before the first `await`: a second click in the
        // same tick would otherwise still see the pre-click status.
        busyRef.current = true;
        setProgress(0);
        setError(null);
        setNeedsInstallPermission(false);
        try {
            // The install permission is checked before the download so a missing grant
            // cannot waste a full APK transfer before failing. The status stays
            // `checking` until the probe resolves, so a refusal is never reported
            // behind a download progress bar that never moved.
            if (isAndroidInstallTarget()) {
                setStatus('checking');
                let granted: boolean;
                try {
                    granted = isInstallPermissionGranted(await NativeAppUpdate.checkInstallPermission());
                } catch {
                    setError(INSTALL_PERMISSION_PROBE_ERROR);
                    setStatus('error');
                    return;
                }
                if (!granted) {
                    setError(INSTALL_PERMISSION_ERROR);
                    setNeedsInstallPermission(true);
                    setStatus('error');
                    return;
                }
            }
            setStatus('downloading');
            const result = await downloadAndInstallUpdate(activeUpdate, {
                onProgress: setProgress,
                onPhase: (phase) => {
                    if (phase === 'installing') {
                        setStatus('installing');
                    }
                },
            });
            if (!result.success) {
                setError(result.error ?? DOWNLOAD_FAILED_ERROR);
                setStatus('error');
                return;
            }
            setProgress(100);
            setStatus('success');
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : DOWNLOAD_FAILED_ERROR);
            setStatus('error');
        } finally {
            // `busyRef` is also recomputed on every render, but the render that
            // clears `busy` is not guaranteed (an unmounted dialog renders nothing),
            // and a ref stuck at `true` would make every later request a no-op.
            busyRef.current = false;
        }
    }, [activeUpdate]);

    /**
     * Re-reads the install permission and turns a stale refusal into a retry.
     *
     * The user leaves for the system settings screen and comes back through the
     * app's own resume event, not through a button this dialog controls, so the
     * probe has to run again on every foreground. Android can also drop the grant
     * while the app is backgrounded, and a refusal recorded before that would
     * block an install the device would now allow. A read that fails leaves the
     * existing state alone: an unreadable answer is neither a grant nor a
     * revocation.
     */
    const recheckInstallPermission = useCallback(async () => {
        if (!isAndroidInstallTarget()) {
            return;
        }
        try {
            if (!isInstallPermissionGranted(await NativeAppUpdate.checkInstallPermission())) {
                return;
            }
            // Only a *recorded refusal* is cleared. The probe runs on every
            // foreground, so clearing unconditionally wiped an unrelated failure
            // too - a download that failed, or a bridge that could not be opened -
            // the moment the user switched away and back, leaving a dialog that
            // claimed to be idle with no explanation of what went wrong.
            if (!needsInstallPermissionRef.current) {
                return;
            }
            setNeedsInstallPermission(false);
            setError(null);
        } catch {
            // Still unreadable: leave the refusal in place.
        }
    }, []);

    useEffect(() => {
        if (!visible) {
            return;
        }
        let active = true;
        const onForeground = () => {
            if (document.visibilityState === 'visible') {
                void recheckInstallPermission();
            }
        };
        /**
         * Exactly one foreground signal, chosen by the platform.
         *
         * Both were registered before, and they are not independent: on the web
         * `@capacitor/app`'s `AppWeb` *is* a `visibilitychange` listener that
         * re-publishes it as `resume`, so a single tab switch ran the re-probe
         * twice - and in the Capacitor WebView, where the pause also reaches the
         * document, the same thing happened on every resume. A dialog that has to
         * re-read a permission should do that once per foreground, not twice.
         *
         * Native keeps the plugin's `resume`, which is the signal that survives a
         * backgrounded WebView; everything else uses the DOM event, which is the
         * only one a browser actually emits.
         */
        if (!Capacitor.isNativePlatform()) {
            document.addEventListener('visibilitychange', onForeground);
            return () => {
                active = false;
                document.removeEventListener('visibilitychange', onForeground);
            };
        }
        let resumeHandle: { remove: () => Promise<void> } | undefined;
        void import('@capacitor/app')
            .then(({ App }) => App.addListener('resume', onForeground))
            .then(
                (handle) => {
                    if (active) {
                        resumeHandle = handle;
                    } else {
                        void handle.remove();
                    }
                },
                () => undefined,
            );
        return () => {
            active = false;
            void resumeHandle?.remove();
        };
    }, [recheckInstallPermission, visible]);

    const handleOpenInstallSettings = useCallback(async () => {
        // Closed synchronously so a second click in the same tick cannot launch the
        // settings screen twice on top of itself.
        if (settingsBusyRef.current) {
            return;
        }
        settingsBusyRef.current = true;
        try {
            await NativeAppUpdate.openInstallPermissionSettings();
        } catch {
            setError('Install permission settings are unavailable on this device.');
            setNeedsInstallPermission(false);
            return;
        } finally {
            settingsBusyRef.current = false;
        }
        // The user just came back from the settings screen, so the answer is
        // already known and re-reading it turns a stale refusal into a retry.
        await recheckInstallPermission();
    }, [recheckInstallPermission]);

    const handleClose = useCallback(() => {
        if (!busy) {
            onClose();
        }
    }, [busy, onClose]);

    const handleRemindLater = useCallback(() => {
        // Guarded rather than relying on the button's `disabled`: the transfer it
        // would abandon is the only copy of the APK in flight, and a dismissal
        // during it leaves the install to finish invisibly with no way to retry.
        if (busy) {
            return;
        }
        onRemindLater?.();
        onClose();
    }, [busy, onClose, onRemindLater]);

    const handleOpenInBrowser = useCallback(async () => {
        if (!manualUrl || !isAllowedReleaseUrl(manualUrl)) {
            setError('The manual update URL is not approved.');
            setStatus('error');
            return;
        }
        try {
            await Browser.open({ url: manualUrl });
            onClose();
        } catch {
            setError('The browser could not open the update page.');
            setStatus('error');
        }
    }, [manualUrl, onClose]);

    if (!visible) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
            // Painted from the stack depth rather than a fixed `z-50`: both
            // dialogs used the same class, so the one on top was whichever the
            // tree happened to render last, not the one raised last.
            style={{ zIndex: layer.zIndex }}
        >
            <motion.div
                ref={dialogRef}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="update-modal-title"
                tabIndex={-1}
                className="w-full max-w-md rounded-2xl bg-app-surface shadow-xl border border-app-border overflow-hidden"
            >
                <div className="flex items-center justify-between border-b border-app-border p-4">
                    <h2 id="update-modal-title" className="text-lg font-bold text-app-text-main">
                        Update Available
                    </h2>
                    {!busy && (
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label="Close update dialog"
                            className="rounded-lg p-1 text-app-text-muted hover:bg-app-border"
                        >
                            <X size={20} aria-hidden="true" />
                        </button>
                    )}
                </div>

                <div className="p-4 space-y-4">
                    <div className="flex items-center gap-3 rounded-lg bg-app-bg p-3 border border-app-border">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-app-accent-success/20">
                            <Gift size={20} className="text-app-accent-success" aria-hidden="true" />
                        </div>
                        <div>
                            <p className="text-xs text-app-text-muted">Current version</p>
                            <p className="font-mono text-sm font-semibold text-app-text-main">v{getCurrentVersion()}</p>
                        </div>
                        <div className="ml-auto text-right">
                            <p className="text-xs text-app-text-muted">New version</p>
                            <p className="font-mono text-sm font-semibold text-app-accent-success">
                                {versionLabel || '—'}
                            </p>
                        </div>
                    </div>

                    {activeUpdate?.notes && (
                        <div className="max-h-40 overflow-y-auto rounded-lg bg-app-bg p-3 border border-app-border">
                            <p className="mb-2 text-xs font-medium text-app-text-muted">Release Notes</p>
                            <pre className="whitespace-pre-wrap text-xs text-app-text-main">{activeUpdate.notes}</pre>
                        </div>
                    )}

                    {assetDetails && (
                        <div className="rounded-lg bg-app-bg p-3 text-xs text-app-text-muted">
                            <p className="font-medium text-app-text-main">Asset</p>
                            <p className="mt-1 break-all">{assetDetails}</p>
                        </div>
                    )}

                    {status === 'checking' && (
                        <div className="flex items-center justify-center gap-2 rounded-lg bg-app-bg p-3 text-sm text-app-text-muted">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-app-primary border-t-transparent" />
                            <span>Checking install permission...</span>
                        </div>
                    )}

                    {status === 'downloading' && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-app-text-main">Downloading...</span>
                                <span className="text-sm font-mono text-app-text-muted">{progress}%</span>
                            </div>
                            <div
                                className="h-2 w-full overflow-hidden rounded-full bg-app-border"
                                role="progressbar"
                                aria-label="Update download progress"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={progress}
                            >
                                <div
                                    className="h-full bg-app-accent-success transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {status === 'installing' && (
                        <div className="flex items-center justify-center gap-2 rounded-lg bg-app-bg p-3 text-sm text-app-text-muted">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-app-primary border-t-transparent" />
                            <span>Opening Android installer...</span>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="rounded-lg bg-app-accent-success/10 p-3 text-sm text-app-accent-success">
                            The verified APK was handed to the Android package installer.
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg bg-app-accent-error/10 p-3" role="alert">
                            <p className="text-xs text-app-accent-error">{error}</p>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2 border-t border-app-border p-4">
                    {status === 'installing' ? (
                        <div className="flex items-center justify-center gap-2 py-2 text-sm text-app-text-muted">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-app-primary border-t-transparent" />
                            <span>Installing...</span>
                        </div>
                    ) : status === 'success' ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full rounded-lg bg-app-primary py-3 font-semibold text-white transition-colors hover:bg-app-primary-hover"
                        >
                            Close
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => void handleUpdate()}
                                disabled={busy || !activeUpdate?.assetName || !activeUpdate?.sha256}
                                className="w-full rounded-lg bg-app-accent-success py-3 font-semibold text-white transition-colors hover:bg-app-accent-success/90 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <Download size={18} aria-hidden="true" />
                                Update Now
                            </button>
                            {canOpenManually && (
                                <button
                                    type="button"
                                    onClick={() => void handleOpenInBrowser()}
                                    disabled={busy}
                                    className="w-full rounded-lg bg-app-bg py-3 font-medium text-app-text-muted transition-colors hover:bg-app-border text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Manual browser installation
                                    {activeUpdate?.sha256 ? '' : ' (digest unavailable)'}
                                </button>
                            )}
                            {needsInstallPermission && (
                                <button
                                    type="button"
                                    onClick={() => void handleOpenInstallSettings()}
                                    className="w-full rounded-lg bg-app-warning-container py-3 font-semibold text-app-warning-container-text transition-colors hover:brightness-95 flex items-center justify-center gap-2"
                                >
                                    <Settings size={18} aria-hidden="true" />
                                    Grant install permission
                                </button>
                            )}
                            {/*
                             * The transfer is the only copy of the APK in flight, so
                             * dismissing the dialog while it runs would leave the
                             * install to finish invisibly with no way to retry it.
                             */}
                            <button
                                type="button"
                                onClick={handleRemindLater}
                                disabled={busy}
                                className="w-full rounded-lg py-2 font-medium text-app-text-muted transition-colors hover:text-app-text-main text-sm disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Remind Me Later
                            </button>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
});

UpdateModal.displayName = 'UpdateModal';

export default UpdateModal;
