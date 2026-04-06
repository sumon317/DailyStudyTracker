import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, FileText, MoreVertical, RefreshCw, Save, Timer, Upload, X } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import AlarmPermissionModal from './components/AlarmPermissionModal';
import DatePicker from './components/DatePicker';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import { SkeletonCard } from './components/SkeletonLoader';
import ThemeSelector from './components/ThemeSelector';
import UpdateModal from './components/UpdateModal';
import { useData } from './providers/DataProvider';
import { useTheme } from './providers/ThemeProvider';
import { useToast } from './providers/ToastProvider';
import type { HeaderProps, UpdateResult } from './types';
import { checkForUpdate } from './utils/checkForUpdate';
import { NotificationService } from './utils/notificationService';

const TrackerPage = lazy(() => import('./pages/TrackerPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const TodoPage = lazy(() => import('./pages/TodoPage'));
const FocusPage = lazy(() => import('./pages/FocusPage'));

const headerAnimation = { opacity: 0, y: -20 };
const headerAnimateIn = { opacity: 1, y: 0 };

const Header = memo(
    ({
        hasUnsavedChanges,
        isSaving,
        lastSaved,
        onSave,
        onDownloadPDF,
        onDownloadMD,
        onExport,
        onImportClick,
        onCheckForUpdates,
        isCheckingUpdate,
    }: HeaderProps) => {
        const { date, setDate, subjects } = useData();
        const { theme, setTheme } = useTheme();
        const [menuOpen, setMenuOpen] = useState(false);
        const menuRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            const handleClickOutside = (e: MouseEvent) => {
                if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                    setMenuOpen(false);
                }
            };
            if (menuOpen) {
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }
            return;
        }, [menuOpen]);

        return (
            <div className="sticky top-0 z-50 bg-app-bg/80 backdrop-blur-md w-full border-b border-app-border mb-2 sm:mb-6">
                <motion.div
                    initial={headerAnimation}
                    animate={headerAnimateIn}
                    transition={{ duration: 0.5 }}
                    className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-4"
                >
                    {/* Desktop: Title + Save */}
                    <div className="hidden sm:block min-w-0">
                        <h1 className="text-3xl font-bold tracking-tight text-app-primary truncate">
                            Daily Study Tracker
                        </h1>
                        <div className="flex items-center gap-2 text-app-text-muted text-sm">
                            <span>
                                Target:{' '}
                                {subjects.reduce((acc, s) => acc + (Number.parseInt(s.planned, 10) || 0), 0) / 60}h
                            </span>
                            <span>•</span>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={isSaving || !hasUnsavedChanges}
                                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all
                                ${
                                    hasUnsavedChanges
                                        ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                                        : 'bg-app-surface text-app-text-muted border border-app-border'
                                }
                                ${isSaving ? 'opacity-70 cursor-wait' : ''}
                            `}
                            >
                                {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
                            </button>
                            {lastSaved && !hasUnsavedChanges && (
                                <span className="text-xs text-app-text-muted/70">
                                    {new Date(lastSaved).toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Mobile: Date + Save */}
                    <div className="flex sm:hidden items-center gap-2 flex-1 min-w-0">
                        <div className="shrink-0">
                            <DatePicker date={date} setDate={setDate} compact />
                        </div>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={isSaving || !hasUnsavedChanges}
                            className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all
                            ${
                                hasUnsavedChanges
                                    ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                                    : 'bg-app-surface text-app-text-muted border border-app-border'
                            }
                            ${isSaving ? 'opacity-70 cursor-wait' : ''}
                        `}
                        >
                            <Save size={11} />
                            {isSaving ? '...' : hasUnsavedChanges ? 'Save' : 'Saved'}
                        </button>
                    </div>

                    {/* Right: Theme + Actions */}
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <ThemeSelector theme={theme} setTheme={setTheme} />

                        {/* Desktop: show all buttons */}
                        <div className="hidden sm:flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onExport}
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover"
                                title="Backup"
                            >
                                <Save size={16} />
                                <span className="hidden md:inline">Backup</span>
                            </button>
                            <button
                                type="button"
                                onClick={onImportClick}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg"
                                title="Restore"
                            >
                                <Upload size={16} />
                                <span className="hidden md:inline">Restore</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadPDF}
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover"
                            >
                                <Download size={16} />
                                <span className="hidden md:inline">PDF</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadMD}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg"
                            >
                                <FileText size={16} />
                                <span className="hidden md:inline">Markdown</span>
                            </button>
                        </div>

                        {/* Mobile: overflow menu */}
                        <div className="relative sm:hidden" ref={menuRef}>
                            <button
                                type="button"
                                onClick={() => setMenuOpen((prev) => !prev)}
                                className="p-2 rounded-lg border border-app-border bg-app-surface text-app-text-muted hover:text-app-text-main transition-colors"
                                aria-label="More options"
                            >
                                <MoreVertical size={18} />
                            </button>
                            <AnimatePresence>
                                {menuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                        transition={{ duration: 0.12 }}
                                        className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-app-border bg-app-surface shadow-xl overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onExport();
                                                setMenuOpen(false);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                        >
                                            <Save size={16} className="text-app-primary" /> Backup
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onImportClick();
                                                setMenuOpen(false);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border"
                                        >
                                            <Upload size={16} className="text-app-primary" /> Restore
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onDownloadPDF();
                                                setMenuOpen(false);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border"
                                        >
                                            <Download size={16} className="text-app-primary" /> Export PDF
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onDownloadMD();
                                                setMenuOpen(false);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border"
                                        >
                                            <FileText size={16} className="text-app-primary" /> Export MD
                                        </button>
                                        {onCheckForUpdates && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onCheckForUpdates();
                                                    setMenuOpen(false);
                                                }}
                                                disabled={isCheckingUpdate}
                                                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border disabled:opacity-50"
                                            >
                                                {isCheckingUpdate ? (
                                                    <>
                                                        <RefreshCw
                                                            size={16}
                                                            className="animate-spin text-app-primary"
                                                        />{' '}
                                                        Checking...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw size={16} className="text-app-primary" /> Check
                                                        Updates
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            </div>
        );
    },
);

Header.displayName = 'Header';

function App() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const {
        date,
        subjects,
        checklistItems,
        qualityChecks,
        dayRating,
        errors,
        todos,
        setTodos,
        setSubjects,
        setChecklistItems,
        setQualityChecks,
        setDayRating,
        setErrors,
        hasUnsavedChanges,
        isSaving,
        lastSaved,
        saveData,
        exportData,
        importData,
        downloadPDF,
        downloadMD,
        setDate,
        loadDataForDate,
    } = useData();
    const { showToast } = useToast();
    const [globalAlarmSource, setGlobalAlarmSource] = useState<string | null>(null);
    const globalAudioRef = useRef<HTMLAudioElement | null>(null);
    const globalAudioCtxRef = useRef<AudioContext | null>(null);
    const globalGainNodeRef = useRef<GainNode | null>(null);
    const globalSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const [showAlarmPermissionModal, setShowAlarmPermissionModal] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateResult | null>(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    useEffect(() => {
        const audio = new Audio('/alarm_loop_small.mp3');
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        globalAudioRef.current = audio;

        return () => {
            if (globalAudioRef.current) {
                globalAudioRef.current.pause();
                globalAudioRef.current = null;
            }
            if (globalAudioCtxRef.current) {
                globalAudioCtxRef.current.close().catch(() => {
                    // Audio context may already be closed
                });
                globalAudioCtxRef.current = null;
            }
        };
    }, []);

    const playGlobalAlarm = useCallback(async (actionType = 'SYSTEM') => {
        setGlobalAlarmSource(actionType);

        if (navigator.vibrate) {
            navigator.vibrate([1000, 500, 1000, 500, 1000, 500, 1000]);
        }

        if (Capacitor.getPlatform() === 'android') {
            try {
                KeepAwake.keepAwake();
                await ForegroundService.startForegroundService({
                    id: 999,
                    title: 'Alarm Active',
                    body: 'Tap to dismiss...',
                    smallIcon: 'ic_stat_icon_config_sample',
                    serviceType: 1073741824 as never,
                    silent: true,
                });
            } catch (_e) {
                // Foreground service may not be available on all devices
            }
        }

        if (globalAudioRef.current) {
            try {
                if (!globalAudioCtxRef.current) {
                    const CtxClass =
                        window.AudioContext ||
                        (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
                    globalAudioCtxRef.current = new CtxClass();
                    globalGainNodeRef.current = globalAudioCtxRef.current.createGain();
                    globalGainNodeRef.current.gain.value = 1.5;
                    globalGainNodeRef.current.connect(globalAudioCtxRef.current.destination);

                    globalSourceNodeRef.current = globalAudioCtxRef.current.createMediaElementSource(
                        globalAudioRef.current,
                    );
                    globalSourceNodeRef.current.connect(globalGainNodeRef.current);
                }

                if (globalAudioCtxRef.current.state === 'suspended') {
                    await globalAudioCtxRef.current.resume();
                }

                globalAudioRef.current.currentTime = 0;
                await globalAudioRef.current.play();
            } catch (_e) {
                globalAudioRef.current.play().catch(() => {
                    // Playback may be interrupted
                });
            }
        }
    }, []);

    const stopGlobalAlarm = useCallback(() => {
        if (globalAudioRef.current) {
            globalAudioRef.current.pause();
            globalAudioRef.current.currentTime = 0;
        }
        setGlobalAlarmSource(null);

        if (Capacitor.getPlatform() === 'android') {
            try {
                ForegroundService.stopForegroundService();
                KeepAwake.allowSleep();
            } catch (_e) {
                // Foreground service stop may fail if not started
            }
        }
    }, []);

    useEffect(() => {
        const initNotifications = async () => {
            await NotificationService.initialize();

            NotificationService.initListeners(
                ({ originalId, actionId, actionType }) => {
                    if (actionType !== 'FOCUS_ALARM') {
                        stopGlobalAlarm();
                    }

                    if (actionId === 'mark-done' || actionType === 'TODO_ACTIONS') {
                        setTodos((prevTodos) =>
                            prevTodos.map((todo) =>
                                todo.id === originalId ? { ...todo, completed: true, reminder: false } : todo,
                            ),
                        );
                    }
                },
                ({ actionType }) => {
                    playGlobalAlarm(actionType);
                },
            );
        };

        initNotifications();
    }, [playGlobalAlarm, stopGlobalAlarm, setTodos]);

    useEffect(() => {
        const checkForUpdates = async () => {
            const ignoredVersion = localStorage.getItem('ignoredUpdateVersion');
            const info = await checkForUpdate();
            if (info?.available && info.tag !== ignoredVersion) {
                setUpdateInfo(info);
                setShowUpdateModal(true);
            }
        };
        checkForUpdates();
    }, []);

    const handleCheckForUpdates = useCallback(async () => {
        setCheckingUpdate(true);
        const ignoredVersion = localStorage.getItem('ignoredUpdateVersion');
        const info = await checkForUpdate(true);
        if (info?.available && info.tag !== ignoredVersion) {
            setUpdateInfo(info);
            setShowUpdateModal(true);
            showToast({ type: 'success', message: `Update found: ${info.tag}` });
        } else {
            showToast({ type: 'info', message: 'You are on the latest version' });
        }
        setCheckingUpdate(false);
    }, [showToast]);

    const handleRemindLater = useCallback(() => {
        if (updateInfo?.tag) {
            localStorage.setItem('ignoredUpdateVersion', updateInfo.tag);
        }
        setShowUpdateModal(false);
    }, [updateInfo]);

    const handleCloseUpdateModal = useCallback(() => {
        setShowUpdateModal(false);
    }, []);

    useEffect(() => {
        loadDataForDate(date);

        NotificationService.checkExactAlarmPermission().then((hasPermission) => {
            if (!hasPermission) {
                const alreadyPrompted = localStorage.getItem('alarmPermissionPrompted');
                if (!alreadyPrompted) {
                    setShowAlarmPermissionModal(true);
                }
            }
        });
    }, [date, loadDataForDate]);

    const handleSave = useCallback(async () => {
        try {
            await saveData();
            showToast({ type: 'success', message: 'Progress saved!' });
        } catch {
            showToast({ type: 'error', message: 'Failed to save progress.' });
        }
    }, [saveData, showToast]);

    const handleDownloadPDF = useCallback(() => {
        downloadPDF();
        showToast({ type: 'success', message: 'PDF downloaded!' });
    }, [downloadPDF, showToast]);

    const handleDownloadMD = useCallback(() => {
        downloadMD();
        showToast({ type: 'success', message: 'Markdown downloaded!' });
    }, [downloadMD, showToast]);

    const handleExport = useCallback(async () => {
        try {
            const count = await exportData();
            showToast({ type: 'success', message: `Backup downloaded! ${count} days exported.` });
        } catch {
            showToast({ type: 'error', message: 'Export failed. Please try again.' });
        }
    }, [exportData, showToast]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleImportFile = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) {
                return;
            }

            try {
                await importData(file);
                showToast({ type: 'success', message: 'Import successful! Refresh to see changes.' });
                window.location.reload();
            } catch {
                showToast({ type: 'error', message: 'Import failed. Please check the file format.' });
            }

            event.target.value = '';
        },
        [importData, showToast],
    );

    return (
        <div
            className="min-h-screen pb-12 font-sans transition-colors duration-300 relative bg-app-bg text-app-text-main"
            style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            <input type="file" ref={fileInputRef} onChange={handleImportFile} accept=".json" className="hidden" />

            {/* Alarm Permission Modal */}
            <AlarmPermissionModal
                isOpen={showAlarmPermissionModal}
                onClose={() => {
                    localStorage.setItem('alarmPermissionPrompted', 'true');
                    setShowAlarmPermissionModal(false);
                }}
                onOpenSettings={() => {
                    localStorage.setItem('alarmPermissionPrompted', 'true');
                    NotificationService.openExactAlarmSettings();
                    setShowAlarmPermissionModal(false);
                }}
            />

            <div className="relative z-10 text-app-text-main">
                {/* Global Alarm Overlay */}
                <AnimatePresence>
                    {globalAlarmSource && globalAlarmSource !== 'FOCUS_ALARM' && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-app-bg/95 backdrop-blur-md p-6"
                        >
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.2 }}
                                className="text-app-accent-warning mb-6"
                            >
                                <Timer size={64} />
                            </motion.div>
                            <h1 className="text-3xl font-bold text-app-text-main mb-2">Alarm!</h1>
                            <p className="text-lg text-app-text-muted mb-8 text-center">
                                Your scheduled task is ready.
                            </p>
                            <button
                                type="button"
                                onClick={stopGlobalAlarm}
                                className="w-full max-w-sm py-4 px-8 rounded-2xl bg-app-accent-warning text-white font-bold tracking-wider text-xl shadow-2xl shadow-app-accent-warning/30 hover:bg-app-accent-warning/90 transition-all active:scale-95 flex items-center justify-center gap-3"
                            >
                                <X size={28} strokeWidth={3} /> STOP ALARM
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <Layout>
                    <Header
                        hasUnsavedChanges={hasUnsavedChanges}
                        isSaving={isSaving}
                        lastSaved={lastSaved}
                        onSave={handleSave}
                        onDownloadPDF={handleDownloadPDF}
                        onDownloadMD={handleDownloadMD}
                        onExport={handleExport}
                        onImportClick={handleImportClick}
                        onCheckForUpdates={handleCheckForUpdates}
                        isCheckingUpdate={checkingUpdate}
                    />

                    <motion.main
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.5 }}
                        className="mx-auto w-full max-w-7xl px-2 sm:px-4"
                    >
                        <Routes>
                            <Route
                                path="/"
                                element={
                                    <ErrorBoundary>
                                        <Suspense
                                            fallback={
                                                <div className="space-y-4">
                                                    <SkeletonCard count={2} />
                                                </div>
                                            }
                                        >
                                            <TrackerPage
                                                date={date}
                                                setDate={setDate}
                                                subjects={subjects}
                                                setSubjects={setSubjects}
                                            />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                            <Route
                                path="/review"
                                element={
                                    <ErrorBoundary>
                                        <Suspense
                                            fallback={
                                                <div className="space-y-4">
                                                    <SkeletonCard count={2} />
                                                </div>
                                            }
                                        >
                                            <ReviewPage
                                                checklistItems={checklistItems}
                                                setChecklistItems={setChecklistItems}
                                                qualityChecks={qualityChecks}
                                                setQualityChecks={setQualityChecks}
                                                dayRating={dayRating}
                                                setDayRating={setDayRating}
                                                errors={errors}
                                                setErrors={setErrors}
                                            />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                            <Route
                                path="/stats"
                                element={
                                    <ErrorBoundary>
                                        <Suspense
                                            fallback={
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
                                                    <SkeletonCard />
                                                    <SkeletonCard />
                                                </div>
                                            }
                                        >
                                            <StatsPage subjects={subjects} currentDate={date} />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                            <Route
                                path="/todo"
                                element={
                                    <ErrorBoundary>
                                        <Suspense
                                            fallback={
                                                <div className="space-y-4">
                                                    <SkeletonCard />
                                                </div>
                                            }
                                        >
                                            <TodoPage todos={todos} setTodos={setTodos} />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                            <Route
                                path="/focus"
                                element={
                                    <ErrorBoundary>
                                        <Suspense
                                            fallback={
                                                <div className="flex items-center justify-center py-12">
                                                    <div className="w-12 h-12 border-4 border-app-primary border-t-transparent rounded-full animate-spin" />
                                                </div>
                                            }
                                        >
                                            <FocusPage
                                                globalAlarmSource={globalAlarmSource}
                                                stopGlobalAlarm={stopGlobalAlarm}
                                            />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                        </Routes>
                    </motion.main>
                </Layout>

                <UpdateModal
                    isOpen={showUpdateModal}
                    onClose={handleCloseUpdateModal}
                    version={updateInfo?.tag ?? ''}
                    url={updateInfo?.url ?? ''}
                    notes={updateInfo?.notes ?? ''}
                    onRemindLater={handleRemindLater}
                />
            </div>
        </div>
    );
}

export default App;
