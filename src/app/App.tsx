import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, FileText, MoreVertical, RefreshCw, Save, Timer, Upload, X } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { formatHours } from '../components/charts/metrics';
import AlarmPermissionModal from '../components/dialogs/AlarmPermissionModal';
import UpdateModal from '../components/dialogs/UpdateModal';
import { useModalLayer } from '../components/dialogs/useModalLayer';
import Layout from '../components/layout/Layout';
import ThemeSelector from '../components/layout/ThemeSelector';
import DatePicker from '../components/shared/DatePicker';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import { focusAfterContainer, getFocusableElements } from '../components/shared/focusOrder';
import { SkeletonCard } from '../components/shared/SkeletonLoader';
import { useData } from '../providers/DataProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useToast } from '../providers/ToastProvider';
import type { AlarmAudioController } from '../services/alarmAudio';
import { createAlarmAudio } from '../services/alarmAudio';
import type {
    ExactAlarmState,
    SessionNotificationScheduleResult,
    SubjectNotificationDefinition,
    TodoNotificationDefinition,
} from '../services/notificationService';
import { NotificationService } from '../services/notificationService';
import { subscribeToPersistenceErrors, subscribeToPersistenceRecovered } from '../services/persistenceEvents';
import { checkForUpdate } from '../services/updateService';
import type { HeaderProps, UpdateResult } from '../types';

interface NotificationReconcileInput {
    subjectNotificationDefinitions: SubjectNotificationDefinition[];
    todoNotificationDefinitions: TodoNotificationDefinition[];
    date: string;
}

const TrackerPage = lazy(() => import('../pages/TrackerPage'));
const ReviewPage = lazy(() => import('../pages/ReviewPage'));
const StatsPage = lazy(() => import('../pages/StatsPage'));
const TodoPage = lazy(() => import('../pages/TodoPage'));
const FocusPage = lazy(() => import('../pages/FocusPage'));

const headerAnimation = { opacity: 0, y: -20 };
const headerAnimateIn = { opacity: 1, y: 0 };

const FOCUSABLE_MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const NOTIFICATION_RECONCILE_DEBOUNCE_MS = 250;
/**
 * How long the same reconcile complaint stays suppressed.
 *
 * The reconcile pass runs on every data change, on every resume, and on a debounce
 * that re-arms as fast as the user types. A permanently broken exact-alarm grant
 * therefore fails it many times a minute, and a toast per failure is a nag the
 * only cure for is closing the app. One message per window says the same thing at
 * a rate a user can act on, and the alarm-permission sheet is still the real fix.
 */
const RECONCILE_NOTICE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * How long the same persistence failure stays reported.
 *
 * Matches the interval the periodic autosave runs at, so a store that is down
 * for good is announced once per flush cycle rather than once per flush. Exported
 * so the tests measure the real window instead of restating the number.
 */
export const PERSISTENCE_NOTICE_COOLDOWN_MS = 10_000;

// `1 day record` and `1 days` are both wrong, and a count that is read back to
// the user as a success message has to agree with the file it describes.
const pluralize = (count: number, singular: string, plural: string): string =>
    `${count} ${count === 1 ? singular : plural}`;

const RouteFallback = ({ label, children }: { label: string; children: ReactNode }) => (
    // `data-route-loading` is the shell's own "a route is still resolving" flag.
    // A test that waits for a route to commit needs a readiness signal that is
    // not the shell's `<main>` - that landmark is on screen for every route,
    // including the ones whose chunk has not arrived yet.
    <div role="status" aria-live="polite" data-route-loading={label}>
        <span className="sr-only">{label}</span>
        {children}
    </div>
);

// `localStorage` throws instead of returning null in some privacy modes, so
// every read/write is guarded to keep the surrounding async flow alive.
const readStorageFlag = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStorageFlag = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage is unavailable; the in-memory state still drives the UI.
    }
};

// Dismissing the exact-alarm sheet used to write a sticky `alarmPermissionPrompted`
// flag, so a single dismissal suppressed the prompt for the rest of the install.
// The prompt is now rate limited by a cooldown instead: it comes back once the
// window lapses and the permission is still missing, without nagging on every
// foreground transition.
const ALARM_PERMISSION_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ALARM_PERMISSION_PROMPTED_AT_KEY = 'alarmPermissionPromptedAt';

const isAlarmPermissionPromptDue = (): boolean => {
    const lastPromptedAt = Number.parseInt(readStorageFlag(ALARM_PERMISSION_PROMPTED_AT_KEY) ?? '', 10);
    if (!Number.isFinite(lastPromptedAt)) {
        return true;
    }
    // A stamp in the future means the device clock moved backwards (timezone
    // change, manual correction, restored backup). Trusting it would suppress the
    // prompt until the clock caught up, so an untrustworthy stamp counts as due.
    if (lastPromptedAt > Date.now()) {
        return true;
    }
    return Date.now() - lastPromptedAt >= ALARM_PERMISSION_PROMPT_COOLDOWN_MS;
};

const markAlarmPermissionPrompted = (): void => {
    writeStorageFlag(ALARM_PERMISSION_PROMPTED_AT_KEY, String(Date.now()));
};

const reminderDate = (date: string, time: string): Date | null => {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dateMatch || !timeMatch) {
        return null;
    }
    const target = new Date(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
        0,
        0,
    );
    return Number.isNaN(target.getTime()) ? null : target;
};

/**
 * The backwards half of `focusAfterContainer`, which only ever moves forwards.
 *
 * A menu that closes under the caret has to say where the caret goes next, and
 * "next" depends on the direction Tab was pressed in. A panel whose only
 * controls are hidden has no focusable element to anchor on, so the container's
 * own document position is the anchor - the mirror of the forwards case.
 */
const focusBeforeContainer = (container: HTMLElement | null, fallback?: HTMLElement | null): void => {
    if (!container) {
        fallback?.focus();
        return;
    }

    const focusable = getFocusableElements(document);
    const firstInside = focusable.find((element) => container.contains(element));
    const index = firstInside === undefined ? -1 : focusable.indexOf(firstInside);
    const previous =
        index > 0
            ? focusable[index - 1]
            : focusable.find(
                  (element) => (element.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              );

    (previous ?? fallback ?? container).focus();
};

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
        const menuButtonRef = useRef<HTMLButtonElement>(null);
        const menuPanelRef = useRef<HTMLDivElement>(null);

        // Activating a menu item unmounts the panel while it still holds focus,
        // which drops the caret on <body> and restarts the tab sequence from the
        // top of the page. Handing focus back to the trigger keeps the keyboard
        // where the user was.
        const closeMenu = useCallback((restoreFocus: boolean) => {
            setMenuOpen(false);
            if (restoreFocus) {
                menuButtonRef.current?.focus();
            }
        }, []);

        useEffect(() => {
            if (!menuOpen) {
                return;
            }
            const handleClickOutside = (e: Event) => {
                if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                    closeMenu(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
                document.removeEventListener('touchstart', handleClickOutside);
            };
        }, [closeMenu, menuOpen]);

        useEffect(() => {
            if (!menuOpen) {
                return;
            }
            const focusTimer = window.setTimeout(() => {
                menuPanelRef.current?.querySelector<HTMLButtonElement>(FOCUSABLE_MENU_ITEM_SELECTOR)?.focus();
            }, 0);
            return () => window.clearTimeout(focusTimer);
        }, [menuOpen]);

        const handleMenuKeyDown = useCallback(
            (event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Tab') {
                    // Let focus leave the menu, but hand it to a real control
                    // outside the panel rather than letting the panel disappear
                    // from under the caret. Direction matters: sending a
                    // backwards Tab *forwards* - which is what always calling
                    // `focusAfterContainer` did - dropped the user past the
                    // trigger they had just opened the menu from, so Shift+Tab
                    // was the one way out that moved the wrong way.
                    //
                    // The default is cancelled because focus is being moved by
                    // hand: leaving the browser's own Tab to run as well moved
                    // focus twice, once in each direction, and the second move
                    // won.
                    event.preventDefault();
                    closeMenu(false);
                    if (event.shiftKey) {
                        focusBeforeContainer(menuPanelRef.current, menuButtonRef.current);
                    } else {
                        focusAfterContainer(menuPanelRef.current, menuButtonRef.current);
                    }
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu(true);
                    return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    return;
                }
                const items = [
                    ...(menuPanelRef.current?.querySelectorAll<HTMLButtonElement>(FOCUSABLE_MENU_ITEM_SELECTOR) ?? []),
                ];
                if (items.length === 0) {
                    return;
                }
                event.preventDefault();
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : event.key === 'ArrowDown'
                            ? (currentIndex + 1 + items.length) % items.length
                            : (currentIndex - 1 + items.length) % items.length;
                items[nextIndex]?.focus();
            },
            [closeMenu],
        );

        return (
            <header className="sticky top-0 z-50 bg-app-bg/80 backdrop-blur-md w-full border-b border-app-border mb-2 sm:mb-6">
                <motion.div
                    initial={headerAnimation}
                    animate={headerAnimateIn}
                    transition={{ duration: 0.5 }}
                    className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-4"
                >
                    {/* Desktop: Title + Save */}
                    <div className="hidden sm:block min-w-0">
                        <p className="text-3xl font-bold tracking-tight text-app-primary truncate">
                            Daily Study Tracker
                        </p>
                        <div className="flex items-center gap-2 text-app-text-muted text-sm">
                            <span>
                                Target:{' '}
                                {formatHours(subjects.reduce((acc, s) => acc + (Number.parseFloat(s.planned) || 0), 0))}
                            </span>
                            <span>•</span>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={isSaving || !hasUnsavedChanges}
                                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg
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
                                <span className="text-xs text-app-text-muted">
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
                            className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg
                            ${
                                hasUnsavedChanges
                                    ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                                    : 'bg-app-surface text-app-text-muted border border-app-border'
                            }
                            ${isSaving ? 'opacity-70 cursor-wait' : ''}
                        `}
                        >
                            <Save size={11} aria-hidden="true" />
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
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                title="Backup"
                                aria-label="Download backup"
                            >
                                <Save size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Backup</span>
                            </button>
                            <button
                                type="button"
                                onClick={onImportClick}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                title="Restore"
                                aria-label="Restore backup"
                            >
                                <Upload size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Restore</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadPDF}
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="Export PDF"
                            >
                                <Download size={16} aria-hidden="true" />
                                <span className="hidden md:inline">PDF</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadMD}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="Export Markdown"
                            >
                                <FileText size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Markdown</span>
                            </button>
                        </div>

                        {/* Mobile: overflow menu */}
                        <div className="relative sm:hidden" ref={menuRef}>
                            <button
                                ref={menuButtonRef}
                                type="button"
                                onClick={() => setMenuOpen((prev) => !prev)}
                                className="p-2 rounded-lg border border-app-border bg-app-surface text-app-text-muted hover:text-app-text-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="More options"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                aria-controls={menuOpen ? 'header-more-menu' : undefined}
                            >
                                <MoreVertical size={18} aria-hidden="true" />
                            </button>
                            <AnimatePresence>
                                {menuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                        transition={{ duration: 0.12 }}
                                        id="header-more-menu"
                                        ref={menuPanelRef}
                                        role="menu"
                                        aria-label="More options"
                                        aria-orientation="vertical"
                                        onKeyDown={handleMenuKeyDown}
                                        className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-app-border bg-app-surface shadow-xl overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onExport();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary"
                                        >
                                            <Save size={16} className="text-app-primary" aria-hidden="true" /> Backup
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onImportClick();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <Upload size={16} className="text-app-primary" aria-hidden="true" /> Restore
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onDownloadPDF();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <Download size={16} className="text-app-primary" aria-hidden="true" />{' '}
                                            Export PDF
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onDownloadMD();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <FileText size={16} className="text-app-primary" aria-hidden="true" />{' '}
                                            Export MD
                                        </button>
                                        {onCheckForUpdates && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    onCheckForUpdates();
                                                    closeMenu(true);
                                                }}
                                                disabled={isCheckingUpdate}
                                                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border disabled:opacity-50"
                                            >
                                                {isCheckingUpdate ? (
                                                    <>
                                                        <RefreshCw
                                                            size={16}
                                                            className="animate-spin text-app-primary"
                                                            aria-hidden="true"
                                                        />{' '}
                                                        Checking...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw
                                                            size={16}
                                                            className="text-app-primary"
                                                            aria-hidden="true"
                                                        />{' '}
                                                        Check Updates
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
            </header>
        );
    },
);

Header.displayName = 'Header';

function App() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const {
        date,
        loadedDate,
        isInitialized,
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
    } = useData();
    const { showToast } = useToast();
    const [globalAlarmSource, setGlobalAlarmSource] = useState<string | null>(null);
    const globalAudioRef = useRef<AlarmAudioController | null>(null);
    const [showAlarmPermissionModal, setShowAlarmPermissionModal] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateResult | null>(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [notificationsReady, setNotificationsReady] = useState(false);
    const globalAlarmButtonRef = useRef<HTMLButtonElement>(null);
    const globalAlarmReturnFocusRef = useRef<HTMLElement | null>(null);
    /**
     * The shell is the only in-app owner of the ringing overlay.
     *
     * The rule used to exempt a focus alarm raised while `/focus` was on screen,
     * which needed a `'FOCUS_ALARM'` action type to identify it. Nothing registers
     * that type - the notification service registers only `'ALARM_ACTIONS'` and
     * `'TODO_ACTIONS'` - so the exemption was unreachable while the focus card's
     * own `aria-modal` overlay stayed wired to it. Any app-level alarm, from any
     * route, is now painted here and nowhere else. Android's own `AlarmActivity`
     * is a separate native surface and is unaffected.
     */
    const showGlobalAlarmOverlay = globalAlarmSource !== null;
    /**
     * Joined to the shared modal stack so an open dialog cannot fight the alarm.
     *
     * The overlay paints far above every layer, but a dialog that believes it is
     * the top layer still installs its own `keydown` and `focusin` handlers: one
     * Escape would stop the alarm *and* close the dialog, and the dialog's focus
     * containment would pull the caret straight out of the alarm's stop button.
     * Registering here makes the alarm the top layer for as long as it is up.
     */
    const globalAlarmLayer = useModalLayer(showGlobalAlarmOverlay);

    useEffect(() => {
        if (!showGlobalAlarmOverlay || !globalAlarmLayer.isTop) {
            return;
        }
        // The overlay claims `aria-modal`, so focus has to follow it or the
        // page behind stays reachable to keyboard and screen reader users.
        globalAlarmReturnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusTimer = window.setTimeout(() => {
            globalAlarmButtonRef.current?.focus();
        }, 0);
        return () => {
            window.clearTimeout(focusTimer);
            // Dismissing the overlay must hand the caret back, otherwise it lands
            // on `<body>` and the tab sequence restarts from the top of the page.
            const target = globalAlarmReturnFocusRef.current;
            globalAlarmReturnFocusRef.current = null;
            if (target?.isConnected) {
                target.focus();
            }
        };
    }, [globalAlarmLayer.isTop, showGlobalAlarmOverlay]);

    useEffect(() => {
        // The app-level alarm can fire at any moment, so its media element is
        // built eagerly. The component-level alarms stay lazy (see alarmAudio).
        globalAudioRef.current = createAlarmAudio({ eager: true });
        return () => {
            globalAudioRef.current?.dispose();
            globalAudioRef.current = null;
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
                    smallIcon: 'ic_timer_icon',
                    serviceType: 1073741824 as never,
                    silent: true,
                });
            } catch (_e) {
                // Foreground service may not be available on all devices
            }
        }

        await globalAudioRef.current?.play();
    }, []);

    const stopGlobalAlarm = useCallback(() => {
        globalAudioRef.current?.stop();
        setGlobalAlarmSource(null);

        // `vibrate(0)` is what actually cancels the pattern `playGlobalAlarm`
        // started. Stopping the audio and hiding the overlay left the device
        // buzzing for the rest of the pattern, which is the one part of the alarm
        // the user cannot see and cannot reason about. Guarded because the
        // Vibration API is absent on desktop browsers.
        if (typeof navigator.vibrate === 'function') {
            navigator.vibrate(0);
        }

        if (Capacitor.getPlatform() === 'android') {
            // Both of these return promises, and both used to be called without
            // being awaited: a rejection from either was an unhandled promise
            // rather than a handled "the service was not running", which is the
            // only failure mode they have on a stop. A foreground service that
            // outlives its alarm keeps the notification up over the app, and a
            // screen kept awake after the alarm stops drains the battery for
            // nothing - so the stop is awaited and its outcome is not guessed at.
            void Promise.all([
                Promise.resolve(ForegroundService.stopForegroundService()).catch(() => undefined),
                Promise.resolve(KeepAwake.allowSleep()).catch(() => undefined),
            ]);
        }
    }, []);

    const handleGlobalAlarmKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                stopGlobalAlarm();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }
            // The overlay claims `aria-modal`, so Tab has to stay inside it.
            // Otherwise a keyboard user walks straight out of the dialog into
            // the page it is covering, which the assistive technology has just
            // told them is unreachable.
            const focusable = getFocusableElements(event.currentTarget);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) {
                event.preventDefault();
                return;
            }
            const active = document.activeElement;
            const inside = active instanceof HTMLElement && event.currentTarget.contains(active);
            if (event.shiftKey ? active === first || !inside : active === last || !inside) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            }
        },
        [stopGlobalAlarm],
    );

    const notificationQueueRef = useRef<Promise<void>>(Promise.resolve());
    const notificationGenerationRef = useRef(0);
    const notificationDebounceRef = useRef<number | null>(null);
    const latestReconcileInputRef = useRef<NotificationReconcileInput | null>(null);
    const notificationInitRef = useRef(0);
    const exactPermissionCheckedRef = useRef(false);
    const lastReconcileNoticeAtRef = useRef<Record<'failed' | 'inexact' | 'skipped', number>>({
        failed: 0,
        inexact: 0,
        skipped: 0,
    });
    // Keyed by message so a *different* failure is never swallowed by the
    // cooldown of an unrelated one.
    const persistenceNoticeAtRef = useRef(new Map<string, number>());

    /**
     * Turns a reconcile result into at most one toast per complaint per window.
     *
     * Two failures are reported, and neither used to be:
     *
     * - a *failure* means reminders are not armed at all, which the UI was
     *   silently absorbing;
     * - an *inexact* result is a success the plugin downgraded, and its
     *   `warning` is the only place the downgrade is ever stated. Dropping it
     *   left a reminder that can arrive minutes late looking exactly like one
     *   that will arrive on time.
     *
     * A past stamp (a clock correction, a restored backup) counts as "never
     * reported", so a downgraded alarm is not silenced for the rest of the
     * install.
     */
    const reportReconcileOutcome = useCallback(
        (result: SessionNotificationScheduleResult) => {
            const report = (
                kind: 'failed' | 'inexact' | 'skipped',
                message: string,
                level: 'error' | 'warning',
            ): void => {
                const now = Date.now();
                const last = lastReconcileNoticeAtRef.current[kind];
                if (last > now || now - last < RECONCILE_NOTICE_COOLDOWN_MS) {
                    return;
                }
                lastReconcileNoticeAtRef.current[kind] = now;
                showToast({ type: level, message });
            };
            if (!result.success) {
                report(
                    'failed',
                    result.error
                        ? `Some reminders could not be set: ${result.error}`
                        : 'Some reminders could not be set on this device.',
                    'error',
                );
                return;
            }
            // A half of the pass that deliberately did nothing - the browser
            // build arms nothing while the app is closed, and a pass with no
            // day loaded schedules nothing either. It is a success, but it is a
            // success that leaves reminders unarmed, so it is stated rather than
            // dropped. Without this the `inexact` and `skipped` flags were
            // reported from different places and only one of them ever reached
            // the user.
            if (result.skipped) {
                report(
                    'skipped',
                    result.warning
                        ? `No reminders were armed on this device. ${result.warning}`
                        : 'No reminders were armed on this device.',
                    'warning',
                );
                return;
            }
            if (result.inexact) {
                report(
                    'inexact',
                    `Android may deliver some reminders late instead of on time.${
                        result.warning ? ` (${result.warning})` : ''
                    }`,
                    'warning',
                );
            }
        },
        [showToast],
    );
    const subjectNotificationDefinitions = useMemo(
        () =>
            subjects.flatMap((subject) => {
                if (!subject.reminder || !subject.time) {
                    return [];
                }
                const at = reminderDate(date, subject.time);
                if (!at) {
                    return [];
                }
                return [
                    {
                        id: subject.id,
                        title: `Study Time: ${subject.name}`,
                        body: `It's time to start studying ${subject.name}! Target: ${subject.planned} min.`,
                        date: at,
                    },
                ];
            }),
        [date, subjects],
    );
    const todoNotificationDefinitions = useMemo(
        () =>
            todos.flatMap((todo) => {
                if (todo.completed || !todo.reminder) {
                    return [];
                }
                const match = /^(\d{2}):(\d{2})$/.exec(todo.time);
                if (!match) {
                    return [];
                }
                return [
                    {
                        id: todo.id,
                        title: 'ToDo Reminder',
                        body: `Don't forget: ${todo.text}`,
                        hour: Number(match[1]),
                        minute: Number(match[2]),
                    },
                ];
            }),
        [todos],
    );

    // The reconcile pass is debounced, generation guarded and serialised. Both the
    // data-driven effect below and the `resume` handler reach it through one stable
    // callback, so the debounce/queue logic exists once instead of being
    // reimplemented (and drifting) in the foreground path.
    const requestNotificationReconcile = useCallback(
        (input: NotificationReconcileInput | null) => {
            // Every call supersedes the one before it - including a call that says
            // "there is nothing coherent to schedule". Returning early for a `null`
            // input without touching the pending pass let a debounce that was armed
            // before the selected day changed fire with the definitions it had
            // captured, quietly arming reminders for a day the user had left.
            if (notificationDebounceRef.current !== null) {
                window.clearTimeout(notificationDebounceRef.current);
                notificationDebounceRef.current = null;
            }
            const generation = notificationGenerationRef.current + 1;
            notificationGenerationRef.current = generation;
            if (!input) {
                return;
            }
            notificationDebounceRef.current = window.setTimeout(() => {
                notificationDebounceRef.current = null;
                notificationQueueRef.current = notificationQueueRef.current
                    .catch(() => undefined)
                    .then(async () => {
                        if (generation !== notificationGenerationRef.current) {
                            return;
                        }
                        const result = await NotificationService.reconcileNotifications(
                            input.subjectNotificationDefinitions,
                            input.todoNotificationDefinitions,
                            input.date,
                        );
                        // Re-checked *after* the await, and this is the half that
                        // matters. A pass is superseded the moment the selected
                        // day changes or the app resumes, and the bridge call can
                        // take seconds. Reporting a result for a day the user
                        // already left claims the app failed at something they
                        // are no longer looking at - and it burns the rate-limit
                        // window on that message, so the failure that is still
                        // current is the one that gets swallowed.
                        if (generation !== notificationGenerationRef.current) {
                            return;
                        }
                        reportReconcileOutcome(result);
                    })
                    .catch(() => undefined);
            }, NOTIFICATION_RECONCILE_DEBOUNCE_MS);
        },
        [reportReconcileOutcome],
    );

    useEffect(() => {
        if (!notificationsReady || !isInitialized || loadedDate !== date) {
            // Null also disables the `resume` path: there is nothing coherent to
            // reconcile until the loaded day matches the selected day again.
            latestReconcileInputRef.current = null;
            requestNotificationReconcile(null);
            return;
        }
        const input: NotificationReconcileInput = {
            subjectNotificationDefinitions,
            todoNotificationDefinitions,
            date,
        };
        latestReconcileInputRef.current = input;
        requestNotificationReconcile(input);
    }, [
        date,
        isInitialized,
        loadedDate,
        notificationsReady,
        requestNotificationReconcile,
        subjectNotificationDefinitions,
        todoNotificationDefinitions,
    ]);

    useEffect(() => {
        return () => {
            latestReconcileInputRef.current = null;
            if (notificationDebounceRef.current !== null) {
                window.clearTimeout(notificationDebounceRef.current);
                notificationDebounceRef.current = null;
            }
            notificationGenerationRef.current += 1;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const initializationId = notificationInitRef.current + 1;
        notificationInitRef.current = initializationId;
        const initNotifications = async () => {
            try {
                await NotificationService.initialize();
                if (!active || initializationId !== notificationInitRef.current) {
                    return;
                }
                await NotificationService.initListeners(
                    ({ originalId, type }) => {
                        // Any action performed on a ringing notification is the
                        // user dismissing it, so the app-level alarm always stops.
                        // This used to compare `actionType` against a
                        // `'FOCUS_ALARM'` value that no code ever registers with
                        // the plugin, so the branch was unreachable and the
                        // comparison was the only thing keeping the stop from
                        // running.
                        stopGlobalAlarm();

                        // Which entity a tap acts on comes from the notification's
                        // own metadata, not from the action type: a caller can arm
                        // any entity with any action type, and the two would then
                        // disagree about what the tap meant. `TODO_ACTIONS`
                        // registers exactly one action, so a todo tap is a
                        // mark-done.
                        if (type === 'todo') {
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
                if (active && initializationId === notificationInitRef.current) {
                    setNotificationsReady(true);
                } else {
                    await NotificationService.removeListeners?.();
                }
            } catch {
                if (active && initializationId === notificationInitRef.current) {
                    setNotificationsReady(true);
                }
            }
        };

        void initNotifications();
        return () => {
            active = false;
            setNotificationsReady(false);
            void NotificationService.removeListeners?.();
        };
    }, [playGlobalAlarm, setTodos, stopGlobalAlarm]);

    useEffect(() => {
        let active = true;
        let resumeHandle: { remove: () => Promise<void> } | undefined;
        // Android can drop the exact-alarm grant (and the OS clears pending
        // alarms) while the app is backgrounded, so returning to the foreground
        // re-reads the permission and reconciles the schedule. The reconcile goes
        // through the shared debounce/queue callback above rather than duplicating
        // that logic here.
        const onForeground = async () => {
            // A rejected bridge must not take the rest of the pass down with it:
            // this runs both the initial check (as an un-awaited `void`) and the
            // Capacitor `resume` callback, so a throw here used to surface as an
            // unhandled rejection and silently skipped the reconcile.
            //
            // The tri-state accessor, not the boolean one. `checkExactAlarmPermission`
            // folds `unreadable` - a bridge that could not answer - into `false`,
            // and the boolean is then read as a refusal: a user who already granted
            // the exact-alarm permission is told, on every resume, to go and grant
            // it. Only a real `denied` opens the sheet. `unreadable` and
            // `not-applicable` are both left to the reconcile that follows, which
            // is what actually arms the alarms.
            let state: ExactAlarmState = 'unreadable';
            try {
                state = await NotificationService.getExactAlarmState();
            } catch {
                state = 'unreadable';
            }
            requestNotificationReconcile(latestReconcileInputRef.current);
            if (state !== 'denied' || !isAlarmPermissionPromptDue()) {
                return;
            }
            // Deliberately *not* gated on the teardown flag below. React
            // StrictMode (used by `main.tsx`) re-runs effects on the same
            // instance, so the first pass - the one that actually read the
            // permission - has its closure torn down before its await resolves.
            // Gating on that flag silently dropped the exact-alarm prompt in
            // development. Setting state on a fully unmounted tree is a no-op,
            // so there is nothing to guard here.
            setShowAlarmPermissionModal(true);
        };
        if (!exactPermissionCheckedRef.current) {
            exactPermissionCheckedRef.current = true;
            void onForeground();
        }
        void CapacitorApp.addListener('resume', onForeground).then((handle) => {
            if (active) {
                resumeHandle = handle;
            } else {
                void handle.remove();
            }
        });
        return () => {
            active = false;
            void resumeHandle?.remove();
        };
    }, [requestNotificationReconcile]);

    useEffect(() => {
        let active = true;
        const checkForUpdates = async () => {
            try {
                const ignoredVersion = readStorageFlag('ignoredUpdateVersion');
                const info = await checkForUpdate();
                if (active && info.available && info.tag !== ignoredVersion) {
                    setUpdateInfo(info);
                    setShowUpdateModal(true);
                }
            } catch {
                return;
            }
        };
        void checkForUpdates();
        return () => {
            active = false;
        };
    }, []);

    const handleCheckForUpdates = useCallback(async () => {
        setCheckingUpdate(true);
        try {
            const ignoredVersion = readStorageFlag('ignoredUpdateVersion');
            const info = await checkForUpdate(true);
            if (info.available && info.tag !== ignoredVersion) {
                setUpdateInfo(info);
                setShowUpdateModal(true);
                showToast({ type: 'success', message: `Update found: ${info.tag}` });
            } else {
                showToast({ type: 'info', message: 'You are on the latest version' });
            }
        } catch {
            showToast({ type: 'error', message: 'Unable to check for updates. Please try again.' });
        } finally {
            setCheckingUpdate(false);
        }
    }, [showToast]);

    const handleRemindLater = useCallback(() => {
        if (updateInfo?.tag) {
            writeStorageFlag('ignoredUpdateVersion', updateInfo.tag);
        }
        setShowUpdateModal(false);
    }, [updateInfo]);

    const handleCloseUpdateModal = useCallback(() => {
        setShowUpdateModal(false);
    }, []);

    useEffect(() => {
        /**
         * The *presentation* window, deliberately shorter than the provider's 30s
         * *event* window. `src/services/persistenceEvents.ts` sets out why there are
         * two: the provider stops generating a flood of identical events, and this
         * stops two toasts appearing for one fault - including the case the
         * provider cannot see, because the date picker dispatches the same event
         * outside the provider's flush path and has no window of its own.
         *
         * A write that then succeeds re-arms it, so a store that failed, recovered
         * and failed again a second later is reported instead of being swallowed
         * until the window lapsed.
         */
        const handlePersistenceError = (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Progress could not be saved.';
            // A save that keeps failing is announced by *every* attempt: the
            // autosave debounce, the periodic flush, the page-hide flush, and
            // the date switcher. Reporting each one means a full disk nag every
            // ten seconds for as long as the user leaves the app open, and three
            // toasts are all that fit on screen - so the newest of them pushes
            // the one carrying the same news off. Once per message per window
            // says the same thing at a rate a user can act on.
            const now = Date.now();
            const last = persistenceNoticeAtRef.current.get(message) ?? 0;
            if (last <= now && now - last < PERSISTENCE_NOTICE_COOLDOWN_MS) {
                return;
            }
            persistenceNoticeAtRef.current.set(message, now);
            showToast({ type: 'error', message });
        };
        const handlePersistenceRecovered = () => {
            persistenceNoticeAtRef.current.clear();
        };
        const unsubscribeFromErrors = subscribeToPersistenceErrors(handlePersistenceError);
        const unsubscribeFromRecovered = subscribeToPersistenceRecovered(handlePersistenceRecovered);
        return () => {
            unsubscribeFromErrors();
            unsubscribeFromRecovered();
        };
    }, [showToast]);

    const handleSave = useCallback(async () => {
        try {
            await saveData();
            showToast({ type: 'success', message: 'Progress saved!' });
        } catch {
            showToast({ type: 'error', message: 'Failed to save progress.' });
        }
    }, [saveData, showToast]);

    const handleDownloadPDF = useCallback(async () => {
        try {
            await downloadPDF();
            showToast({ type: 'success', message: 'PDF downloaded!' });
        } catch {
            showToast({ type: 'error', message: 'PDF export failed. Please try again.' });
        }
    }, [downloadPDF, showToast]);

    const handleDownloadMD = useCallback(async () => {
        try {
            await downloadMD();
            showToast({ type: 'success', message: 'Markdown downloaded!' });
        } catch {
            showToast({ type: 'error', message: 'Markdown export failed. Please try again.' });
        }
    }, [downloadMD, showToast]);

    const handleExport = useCallback(async () => {
        try {
            const count = await exportData();
            // "Backup downloaded! 0 days exported." reads as a success while the
            // file it produced holds no study data at all, so an empty backup is
            // reported as the warning it is.
            showToast(
                count > 0
                    ? { type: 'success', message: `Backup downloaded! ${pluralize(count, 'day', 'days')} exported.` }
                    : { type: 'warning', message: 'No saved days to export yet. The backup file is empty.' },
            );
        } catch {
            showToast({ type: 'error', message: 'Export failed. Please try again.' });
        }
    }, [exportData, showToast]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleImportFile = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const input = event.target;
            const file = input.files?.[0];
            if (!file) {
                // The picker was dismissed. The value still has to be cleared, or
                // re-picking the very same file fires no `change` event and the
                // import silently does nothing.
                input.value = '';
                return;
            }

            try {
                const appliedDays = await importData(file);
                // `importData` already reloads the selected day and the global todo
                // list, so the shell does not need `location.reload()`. Reloading
                // here also destroyed the confirmation below before it could be
                // read, and threw away in-memory state for no benefit.
                showToast(
                    appliedDays > 0
                        ? {
                              type: 'success',
                              message: `Import successful. ${pluralize(appliedDays, 'record', 'records')} applied.`,
                          }
                        : {
                              type: 'warning',
                              message: 'Nothing was imported. The backup contained no days that could be applied.',
                          },
                );
            } catch {
                showToast({ type: 'error', message: 'Import failed. Please check the file format.' });
            }

            input.value = '';
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
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".json,application/json"
                className="hidden"
                aria-label="Backup file"
            />

            {/* Alarm Permission Modal */}
            <AlarmPermissionModal
                isOpen={showAlarmPermissionModal}
                onClose={() => {
                    markAlarmPermissionPrompted();
                    setShowAlarmPermissionModal(false);
                }}
                onOpenSettings={() => {
                    markAlarmPermissionPrompted();
                    NotificationService.openExactAlarmSettings();
                    setShowAlarmPermissionModal(false);
                }}
            />

            <div className="relative z-10 text-app-text-main">
                {/*
                 * The one in-app ringing overlay. `z-[9999]` is kept rather than
                 * taken from the modal layer's depth, because an alarm has to
                 * cover *every* dialog - the depth number only wins a
                 * comparison against the other layers, and the alarm must win
                 * against all of them at once.
                 */}
                <AnimatePresence>
                    {showGlobalAlarmOverlay && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="global-alarm-title"
                            onKeyDown={handleGlobalAlarmKeyDown}
                            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-app-bg/95 backdrop-blur-md p-6"
                        >
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.2 }}
                                className="text-app-accent-warning mb-6"
                                aria-hidden="true"
                            >
                                <Timer size={64} />
                            </motion.div>
                            <h2 id="global-alarm-title" className="text-3xl font-bold text-app-text-main mb-2">
                                Alarm!
                            </h2>
                            <p className="text-lg text-app-text-muted mb-8 text-center">
                                Your scheduled task is ready.
                            </p>
                            <button
                                ref={globalAlarmButtonRef}
                                type="button"
                                onClick={stopGlobalAlarm}
                                className="w-full max-w-sm py-4 px-8 rounded-2xl bg-app-accent-warning text-app-bg font-bold tracking-wider text-xl shadow-2xl shadow-app-accent-warning/30 hover:bg-app-accent-warning/90 transition-all active:scale-95 flex items-center justify-center gap-3"
                            >
                                <X size={28} strokeWidth={3} aria-hidden="true" /> STOP ALARM
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
                            {/*
                              Every route's boundary carries a key that is unique to
                              that route. Without it React reuses one boundary
                              instance across all five routes - they render the same
                              component type in the same position - so a single throw
                              latched the fallback on forever and every later
                              navigation rendered the same error panel with no way
                              back to the app.
                            */}
                            <Route
                                path="/"
                                element={
                                    <ErrorBoundary key="route-tracker">
                                        <Suspense
                                            fallback={
                                                <RouteFallback label="Loading study tracker">
                                                    <div className="space-y-4">
                                                        <SkeletonCard count={2} />
                                                    </div>
                                                </RouteFallback>
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
                                    <ErrorBoundary key="route-review">
                                        <Suspense
                                            fallback={
                                                <RouteFallback label="Loading review">
                                                    <div className="space-y-4">
                                                        <SkeletonCard count={2} />
                                                    </div>
                                                </RouteFallback>
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
                                    <ErrorBoundary key="route-stats">
                                        <Suspense
                                            fallback={
                                                <RouteFallback label="Loading study statistics">
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
                                                        <SkeletonCard />
                                                        <SkeletonCard />
                                                    </div>
                                                </RouteFallback>
                                            }
                                        >
                                            {/* The charts plot the *loaded* payload, so the
                                                scope sentence names that day - and says nothing
                                                while a read is in flight, rather than naming
                                                the day that has not arrived yet. */}
                                            <StatsPage subjects={subjects} currentDate={loadedDate} />
                                        </Suspense>
                                    </ErrorBoundary>
                                }
                            />
                            <Route
                                path="/todo"
                                element={
                                    <ErrorBoundary key="route-todo">
                                        <Suspense
                                            fallback={
                                                <RouteFallback label="Loading todos">
                                                    <div className="space-y-4">
                                                        <SkeletonCard />
                                                    </div>
                                                </RouteFallback>
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
                                    <ErrorBoundary key="route-focus">
                                        <Suspense
                                            fallback={
                                                <RouteFallback label="Loading focus timer">
                                                    <div className="flex items-center justify-center py-12">
                                                        <div
                                                            className="w-12 h-12 border-4 border-app-primary border-t-transparent rounded-full animate-spin"
                                                            aria-hidden="true"
                                                        />
                                                    </div>
                                                </RouteFallback>
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
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </motion.main>
                </Layout>

                <UpdateModal
                    isOpen={showUpdateModal}
                    onClose={handleCloseUpdateModal}
                    updateInfo={updateInfo}
                    onRemindLater={handleRemindLater}
                />
            </div>
        </div>
    );
}

export default App;
