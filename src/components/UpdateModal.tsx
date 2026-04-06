import { Browser } from '@capacitor/browser';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Gift, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { downloadAndInstallUpdate, getCurrentVersion } from '../utils/checkForUpdate';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    version: string;
    url: string;
    notes: string;
    onRemindLater: () => void;
}

const UpdateModal = memo(({ isOpen, onClose, version, url, notes, onRemindLater }: UpdateModalProps) => {
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const handleUpdate = useCallback(async () => {
        setDownloading(true);
        setProgress(0);
        setError(null);

        const result = await downloadAndInstallUpdate(url, setProgress);

        if (!result.success) {
            setError(result.error ?? 'Download failed');
            setDownloading(false);
        }
    }, [url]);

    const handleClose = useCallback(() => {
        if (!downloading) {
            onClose();
        }
    }, [downloading, onClose]);

    const handleRemindLater = useCallback(() => {
        onRemindLater();
        onClose();
    }, [onRemindLater, onClose]);

    const handleOpenInBrowser = useCallback(async () => {
        if (url) {
            await Browser.open({ url });
        }
        onClose();
    }, [url, onClose]);

    if (!isOpen) {
        return null;
    }

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="w-full max-w-md rounded-2xl bg-app-surface shadow-xl border border-app-border overflow-hidden"
                >
                    <div className="flex items-center justify-between border-b border-app-border p-4">
                        <h2 className="text-lg font-bold text-app-text-main">Update Available</h2>
                        {!downloading && (
                            <button
                                type="button"
                                onClick={handleClose}
                                className="rounded-lg p-1 text-app-text-muted hover:bg-app-border"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>

                    <div className="p-4 space-y-4">
                        <div className="flex items-center gap-3 rounded-lg bg-app-bg p-3 border border-app-border">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-app-accent-success/20">
                                <Gift size={20} className="text-app-accent-success" />
                            </div>
                            <div>
                                <p className="text-xs text-app-text-muted">Current version</p>
                                <p className="font-mono text-sm font-semibold text-app-text-main">
                                    v{getCurrentVersion()}
                                </p>
                            </div>
                            <div className="ml-auto text-right">
                                <p className="text-xs text-app-text-muted">New version</p>
                                <p className="font-mono text-sm font-semibold text-app-accent-success">{version}</p>
                            </div>
                        </div>

                        {notes && (
                            <div className="max-h-40 overflow-y-auto rounded-lg bg-app-bg p-3 border border-app-border">
                                <p className="mb-2 text-xs font-medium text-app-text-muted">Release Notes</p>
                                <pre className="whitespace-pre-wrap text-xs text-app-text-main">{notes}</pre>
                            </div>
                        )}

                        {downloading && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-app-text-main">Downloading...</span>
                                    <span className="text-sm font-mono text-app-text-muted">{progress}%</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-app-border">
                                    <div
                                        className="h-full bg-app-accent-success transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="rounded-lg bg-app-accent-error/10 p-3">
                                <p className="text-xs text-app-accent-error">{error}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2 border-t border-app-border p-4">
                        {downloading ? (
                            <div className="flex items-center justify-center gap-2 text-sm text-app-text-muted">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-app-primary border-t-transparent" />
                                <span>Installing...</span>
                            </div>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={handleUpdate}
                                    className="w-full rounded-lg bg-app-accent-success py-3 font-semibold text-white transition-colors hover:bg-app-accent-success/90 flex items-center justify-center gap-2"
                                >
                                    <Download size={18} />
                                    Update Now
                                </button>
                                <button
                                    type="button"
                                    onClick={handleOpenInBrowser}
                                    className="w-full rounded-lg bg-app-bg py-3 font-medium text-app-text-muted transition-colors hover:bg-app-border text-xs"
                                >
                                    Open in Browser (Manual Install)
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRemindLater}
                                    className="w-full rounded-lg py-2 font-medium text-app-text-muted transition-colors hover:text-app-text-main text-sm"
                                >
                                    Remind Me Later
                                </button>
                            </>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
});

UpdateModal.displayName = 'UpdateModal';

export default UpdateModal;
