import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Settings, X } from 'lucide-react';
import { memo } from 'react';
import type { AlarmPermissionModalProps } from '../types';

const AlarmPermissionModal = memo(({ isOpen, onClose, onOpenSettings }: AlarmPermissionModalProps) => {
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="w-full max-w-sm bg-app-surface border border-app-border rounded-2xl shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white text-center relative">
                        <button
                            type="button"
                            onClick={onClose}
                            className="absolute top-3 right-3 p-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                        >
                            <X size={16} />
                        </button>
                        <div className="mx-auto w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3 backdrop-blur-md">
                            <AlertTriangle size={24} className="text-white" />
                        </div>
                        <h3 className="text-xl font-bold">Alarm Permission Needed</h3>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        <div className="bg-app-bg rounded-xl p-4 mb-6 text-sm text-app-text-main border border-app-border">
                            <p className="mb-3">
                                <strong>Your alarms may not work</strong> when the app is closed because Android
                                requires a special permission.
                            </p>
                            <p className="text-app-text-muted">
                                Please enable <strong>"Alarms & Reminders"</strong> in Settings to ensure your study
                                reminders work reliably.
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 px-4 rounded-xl border border-app-border text-app-text-muted font-medium hover:bg-app-bg transition-colors"
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                onClick={onOpenSettings}
                                className="flex-[2] py-3 px-4 rounded-xl bg-amber-500 text-white font-bold shadow-lg hover:bg-amber-600 transition-all flex items-center justify-center gap-2"
                            >
                                <Settings size={18} />
                                Open Settings
                            </button>
                        </div>

                        <p className="text-xs text-app-text-muted text-center mt-4">
                            Go to: Settings → Apps → Daily Study Tracker → Alarms & Reminders
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
});

AlarmPermissionModal.displayName = 'AlarmPermissionModal';

export default AlarmPermissionModal;
