import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Gift } from 'lucide-react';

const UpdateModal = memo(({ updateInfo, onClose }) => {
    if (!updateInfo || !updateInfo.available) return null;

    const handleDownload = () => {
        // Open the download URL in the system browser
        window.open(updateInfo.url, '_system');
        onClose();
    };

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
                    <div className="bg-gradient-to-r from-app-primary to-app-accent-purple p-6 text-white text-center">
                        <div className="mx-auto w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3 backdrop-blur-md">
                            <Gift size={24} className="text-white" />
                        </div>
                        <h3 className="text-xl font-bold">New Update Available!</h3>
                        <p className="text-white/80 text-sm mt-1">Version {updateInfo.tag}</p>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        <div className="bg-app-bg rounded-xl p-4 mb-6 max-h-32 overflow-y-auto text-sm text-app-text-muted border border-app-border">
                            <p className="font-semibold text-app-text-main mb-1">What's New:</p>
                            <div className="whitespace-pre-line">{updateInfo.notes}</div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 py-3 px-4 rounded-xl border border-app-border text-app-text-muted font-medium hover:bg-app-bg transition-colors"
                            >
                                Later
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex-[2] py-3 px-4 rounded-xl bg-app-primary text-app-primary-fg font-bold shadow-lg hover:shadow-app-primary/25 hover:bg-app-primary-hover transition-all flex items-center justify-center gap-2"
                            >
                                <Download size={18} />
                                Update Now
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
});

UpdateModal.displayName = 'UpdateModal';

export default UpdateModal;
