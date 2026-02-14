import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { Download, FileText, Upload, Save, MoreVertical } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Pages & Components
import TrackerPage from './pages/TrackerPage';
import ReviewPage from './pages/ReviewPage';
import StatsPage from './pages/StatsPage';
import FocusPage from './pages/FocusPage';
import TodoPage from './pages/TodoPage';
import Layout from './components/Layout';
import LiveBackground from './components/LiveBackground';
import UpdateModal from './components/UpdateModal';
import AlarmPermissionModal from './components/AlarmPermissionModal';
import DatePicker from './components/DatePicker';

// Utils
import { generatePDF } from './utils/pdfGenerator';
import { generateMarkdown } from './utils/mdGenerator';
import { saveToNativeStorage, loadFromNativeStorage, downloadBackup, handleFileImport, saveRecurringSubjects, loadRecurringSubjects } from './db';
import { updateWidget } from './utils/widgetBridge';
import { checkForUpdate } from './utils/checkForUpdate';
import { NotificationService } from './utils/notificationService';

// Default State Constants - defined outside component to avoid recreation
const DEFAULT_SUBJECTS = [
    { id: 1, name: 'New Subject', planned: '60', actual: '0', kpi: 'N', time: '', reminder: false },
];

const DEFAULT_CHECKLIST = [
    { id: 1, label: 'Add your first checklist item here...', checked: false },
];

const DEFAULT_QUALITY = [
    { id: 1, label: 'Did you understand the core concepts?', checked: false },
];

const DEFAULT_ERRORS = [
    { question: '', mistake: '', correctLogic: '' },
];

const DEFAULT_TODOS = [];

// Helper to deep clone defaults
const cloneDefaults = (defaults) => JSON.parse(JSON.stringify(defaults));

// Memoized header animations
const headerAnimation = { opacity: 0, y: -20 };
const headerAnimateIn = { opacity: 1, y: 0 };

// Memoized Header component to prevent re-renders
const Header = memo(({
    theme, setTheme, hasUnsavedChanges, isSaving, lastSaved,
    onSave, onDownloadPDF, onDownloadMD, onExport, onImportClick, fileInputRef,
    date, setDate, subjects
}) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        };
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
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
                    <h1 className="text-3xl font-bold tracking-tight text-app-primary truncate">Daily Study Tracker</h1>
                    <div className="flex items-center gap-2 text-app-text-muted text-sm">
                        <span>Target: {subjects.reduce((acc, s) => acc + (parseInt(s.planned) || 0), 0) / 60}h</span>
                        <span>•</span>
                        <button
                            onClick={onSave}
                            disabled={isSaving || !hasUnsavedChanges}
                            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all
                                ${hasUnsavedChanges
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
                                {lastSaved.toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                </div>

                {/* Mobile: Date + Save + Theme + Menu — all in one row */}
                <div className="flex sm:hidden items-center gap-2 flex-1 min-w-0">
                    <div className="shrink-0">
                        <DatePicker date={date} setDate={setDate} compact />
                    </div>
                    <button
                        onClick={onSave}
                        disabled={isSaving || !hasUnsavedChanges}
                        className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all
                            ${hasUnsavedChanges
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
                    <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        className={`h-8 sm:h-10 rounded-lg border border-app-border bg-app-surface px-1.5 sm:px-2 text-[11px] sm:text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary
                            ${Capacitor.isNativePlatform() ? 'w-24 text-[10px]' : 'w-20 sm:w-40'}
                        `}
                    >
                        <optgroup label="Standard">
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                            <option value="material-light">Mat. Day</option>
                            <option value="material-dark">Mat. Night</option>
                        </optgroup>
                        <optgroup label="Live Themes ✨">
                            <option value="cherry-blossom">🌸 Cherry</option>
                            <option value="bamboo-forest">🎋 Bamboo</option>
                            <option value="ocean-depths">🌊 Ocean</option>
                        </optgroup>
                    </select>

                    {/* Desktop: show all buttons */}
                    <div className="hidden sm:flex items-center gap-2">
                        <button onClick={onExport} className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover" title="Backup">
                            <Save size={16} /><span className="hidden md:inline">Backup</span>
                        </button>
                        <button onClick={onImportClick} className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg" title="Restore">
                            <Upload size={16} /><span className="hidden md:inline">Restore</span>
                        </button>
                        <button onClick={onDownloadPDF} className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover">
                            <Download size={16} /><span className="hidden md:inline">PDF</span>
                        </button>
                        <button onClick={onDownloadMD} className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg">
                            <FileText size={16} /><span className="hidden md:inline">Markdown</span>
                        </button>
                    </div>

                    {/* Mobile: overflow menu */}
                    <div className="relative sm:hidden" ref={menuRef}>
                        <button
                            onClick={() => setMenuOpen(prev => !prev)}
                            className="p-2 rounded-lg border border-app-border bg-app-surface text-app-text-muted hover:text-app-text-main transition-colors"
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
                                    <button onClick={() => { onExport(); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors">
                                        <Save size={16} className="text-app-primary" /> Backup
                                    </button>
                                    <button onClick={() => { onImportClick(); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border">
                                        <Upload size={16} className="text-app-primary" /> Restore
                                    </button>
                                    <button onClick={() => { onDownloadPDF(); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border">
                                        <Download size={16} className="text-app-primary" /> Export PDF
                                    </button>
                                    <button onClick={() => { onDownloadMD(); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors border-t border-app-border">
                                        <FileText size={16} className="text-app-primary" /> Export MD
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </div>
    );
});

Header.displayName = 'Header';

function App() {
    const fileInputRef = useRef(null);

    const [date, setDate] = useState(() => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });

    const [theme, setTheme] = useState(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            return localStorage.getItem('theme') || 'cherry-blossom';
        }
        return 'cherry-blossom';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('dark', 'theme-material', 'theme-cherry', 'theme-bamboo', 'theme-ocean');

        if (theme === 'dark') {
            root.classList.add('dark');
        } else if (theme === 'material-light') {
            root.classList.add('theme-material');
        } else if (theme === 'material-dark') {
            root.classList.add('dark', 'theme-material');
        } else if (theme === 'ocean-depths') {
            root.classList.add('dark', 'theme-ocean');
        } else if (theme === 'cherry-blossom') {
            root.classList.add('theme-cherry');
        } else if (theme === 'bamboo-forest') {
            root.classList.add('theme-bamboo');
        }

        localStorage.setItem('theme', theme);
    }, [theme]);

    const [subjects, setSubjects] = useState(() => cloneDefaults(DEFAULT_SUBJECTS));
    const [checklistItems, setChecklistItems] = useState(() => cloneDefaults(DEFAULT_CHECKLIST));
    const [qualityChecks, setQualityChecks] = useState(() => cloneDefaults(DEFAULT_QUALITY));
    const [dayRating, setDayRating] = useState('');
    const [errors, setErrors] = useState(() => cloneDefaults(DEFAULT_ERRORS));
    const [todos, setTodos] = useState(() => cloneDefaults(DEFAULT_TODOS));

    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [showAlarmPermissionModal, setShowAlarmPermissionModal] = useState(false);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            await saveToNativeStorage(date, {
                subjects,
                checklistItems,
                qualityChecks,
                dayRating,
                errors,
                todos,
            });
            setLastSaved(new Date());
            setHasUnsavedChanges(false);

            // Sync recurring subjects
            try {
                const existingRecurring = await loadRecurringSubjects();
                // Build a map of existing recurring by name for reference
                const recurringMap = {};
                for (const r of existingRecurring) {
                    recurringMap[r.name] = r;
                }

                // Process current subjects
                for (const s of subjects) {
                    if (s.recurring) {
                        // Add or update recurring template
                        recurringMap[s.name] = {
                            name: s.name,
                            planned: s.planned,
                            time: s.time,
                            recurring: true,
                            recurringDays: s.recurringDays || [0, 1, 2, 3, 4, 5, 6], // Persist days or default to all
                            recurringAddedDate: recurringMap[s.name]?.recurringAddedDate || date,
                            recurringRemovedDate: null, // Re-enable if toggled back on
                        };
                    } else if (recurringMap[s.name] && !recurringMap[s.name].recurringRemovedDate) {
                        // Subject exists in recurring but was toggled off
                        recurringMap[s.name].recurringRemovedDate = date;
                    }
                }

                await saveRecurringSubjects(Object.values(recurringMap));
            } catch (e) {
                console.warn('Failed to sync recurring subjects:', e);
            }

            // Update Widget
            updateWidget(subjects);
        } catch (error) {
            console.error('Failed to save:', error);
            alert('Failed to save progress.');
        } finally {
            setIsSaving(false);
        }
    }, [date, subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

    // Track unsaved changes
    useEffect(() => {
        setHasUnsavedChanges(true);
    }, [subjects, checklistItems, qualityChecks, dayRating, errors, todos]);

    // Ref to track previous date for save-before-navigate
    const prevDateRef = useRef(date);
    const subjectsRef = useRef(subjects);
    const checklistRef = useRef(checklistItems);
    const qualityRef = useRef(qualityChecks);
    const dayRatingRef = useRef(dayRating);
    const errorsRef = useRef(errors);
    const todosRef = useRef(todos);
    const hasUnsavedRef = useRef(hasUnsavedChanges);

    // Keep refs in sync
    useEffect(() => { subjectsRef.current = subjects; }, [subjects]);
    useEffect(() => { checklistRef.current = checklistItems; }, [checklistItems]);
    useEffect(() => { qualityRef.current = qualityChecks; }, [qualityChecks]);
    useEffect(() => { dayRatingRef.current = dayRating; }, [dayRating]);
    useEffect(() => { errorsRef.current = errors; }, [errors]);
    useEffect(() => { todosRef.current = todos; }, [todos]);
    useEffect(() => { hasUnsavedRef.current = hasUnsavedChanges; }, [hasUnsavedChanges]);

    // Auto-save every 10 seconds if there are unsaved changes
    useEffect(() => {
        const autoSaveInterval = setInterval(() => {
            if (hasUnsavedChanges && !isSaving) {
                handleSave();
            }
        }, 10000); // 10 seconds

        return () => clearInterval(autoSaveInterval);
    }, [hasUnsavedChanges, isSaving, handleSave]);

    // Initialize Notifications once on mount
    useEffect(() => {
        const initNotifications = async () => {
            await NotificationService.initialize();

            // Initialize notification actions listener
            NotificationService.initListeners(({ originalId, actionId, actionType }) => {
                if (actionId === 'mark-done' || actionType === 'TODO_ACTIONS') {
                    // Handle ToDo
                    setTodos(prevTodos => prevTodos.map(todo =>
                        todo.id === originalId ? { ...todo, completed: true, reminder: false } : todo
                    ));
                } else if (actionId === 'dismiss' || actionType === 'ALARM_ACTIONS') {
                    // Handle Subject/General Alarm
                    setSubjects(prevSubjects => prevSubjects.map(subj =>
                        subj.id === originalId ? { ...subj, reminder: false } : subj
                    ));
                }
            });
        };

        initNotifications();
    }, []);

    // Load data when date changes
    useEffect(() => {
        const loadData = async () => {
            // Save previous date's unsaved data before loading new date
            const oldDate = prevDateRef.current;
            if (oldDate !== date && hasUnsavedRef.current) {
                try {
                    const oldSubjects = subjectsRef.current;
                    await saveToNativeStorage(oldDate, {
                        subjects: oldSubjects,
                        checklistItems: checklistRef.current,
                        qualityChecks: qualityRef.current,
                        dayRating: dayRatingRef.current,
                        errors: errorsRef.current,
                        todos: todosRef.current,
                    });

                    // Sync recurring subjects from old date
                    try {
                        const existingRecurring = await loadRecurringSubjects();
                        const recurringMap = {};
                        for (const r of existingRecurring) {
                            recurringMap[r.name] = r;
                        }
                        for (const s of oldSubjects) {
                            if (s.recurring) {
                                recurringMap[s.name] = {
                                    name: s.name,
                                    planned: s.planned,
                                    time: s.time,
                                    recurring: true,
                                    recurringDays: s.recurringDays || [0, 1, 2, 3, 4, 5, 6],
                                    recurringAddedDate: recurringMap[s.name]?.recurringAddedDate || oldDate,
                                    recurringRemovedDate: null,
                                };
                            } else if (recurringMap[s.name] && !recurringMap[s.name].recurringRemovedDate) {
                                recurringMap[s.name].recurringRemovedDate = oldDate;
                            }
                        }
                        await saveRecurringSubjects(Object.values(recurringMap));
                    } catch (e) {
                        console.warn('Failed to sync recurring on date change:', e);
                    }

                    updateWidget(oldSubjects);
                } catch (error) {
                    console.error('Failed to save before date change:', error);
                }
            }
            prevDateRef.current = date;

            try {
                const data = await loadFromNativeStorage(date);
                if (data) {
                    let loadedSubjects = data.subjects || cloneDefaults(DEFAULT_SUBJECTS);

                    // PATCH: Ensure all subjects have an ID (legacy data support)
                    loadedSubjects = loadedSubjects.map((s, i) => ({
                        ...s,
                        id: s.id || (Date.now() + i)
                    }));

                    // Merge in any active recurring subjects that are missing from saved data
                    try {
                        const allRecurring = await loadRecurringSubjects();
                        const activeRecurring = allRecurring.filter(r => {
                            if (r.recurringRemovedDate && r.recurringRemovedDate <= date) return false;
                            if (r.recurringAddedDate && r.recurringAddedDate > date) return false;

                            // Check if today matches recurring days (0=Sun, 6=Sat)
                            // Use split to avoid timezone issues with new Date(dateString)
                            if (r.recurringDays && Array.isArray(r.recurringDays)) {
                                const [y, m, d] = date.split('-').map(Number);
                                const currentDay = new Date(y, m - 1, d).getDay();
                                if (!r.recurringDays.includes(currentDay)) {
                                    return false;
                                }
                            }

                            return true;
                        });

                        const existingNames = new Set(loadedSubjects.map(s => s.name));
                        const missingRecurring = activeRecurring
                            .filter(r => !existingNames.has(r.name))
                            .map((r, idx) => ({
                                id: Date.now() + idx + 1000,
                                name: r.name,
                                planned: r.planned || '60',
                                actual: '0',
                                kpi: 'N',
                                time: r.time || '',
                                reminder: false,
                                recurring: true,
                                recurringDays: r.recurringDays || [0, 1, 2, 3, 4, 5, 6]
                            }));

                        if (missingRecurring.length > 0) {
                            loadedSubjects = [...loadedSubjects, ...missingRecurring];
                        }
                    } catch (e) {
                        console.warn('Failed to merge recurring subjects:', e);
                    }

                    setSubjects(loadedSubjects);
                    setChecklistItems(data.checklistItems || cloneDefaults(DEFAULT_CHECKLIST));
                    setQualityChecks(data.qualityChecks || cloneDefaults(DEFAULT_QUALITY));
                    setDayRating(data.dayRating || '');
                    setErrors(data.errors || cloneDefaults(DEFAULT_ERRORS));
                    setTodos(data.todos || cloneDefaults(DEFAULT_TODOS));

                    if (data.updatedAt) {
                        setLastSaved(data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt));
                    }
                } else {
                    // No saved data for this date — auto-populate from recurring subjects
                    let recurringSubjects = [];
                    try {
                        const allRecurring = await loadRecurringSubjects();
                        recurringSubjects = allRecurring
                            .filter(r => {
                                // Must be active (not removed, or removed after this date)
                                if (r.recurringRemovedDate && r.recurringRemovedDate <= date) return false;
                                // Must have been added on or before this date
                                if (r.recurringAddedDate && r.recurringAddedDate > date) return false;

                                // Check if today matches recurring days
                                // Use split to avoid timezone issues with new Date(dateString)
                                if (r.recurringDays && Array.isArray(r.recurringDays)) {
                                    const [y, m, d] = date.split('-').map(Number);
                                    const currentDay = new Date(y, m - 1, d).getDay();
                                    if (!r.recurringDays.includes(currentDay)) {
                                        return false;
                                    }
                                }

                                return true;
                            })
                            .map((r, idx) => ({
                                id: Date.now() + idx,
                                name: r.name,
                                planned: r.planned || '60',
                                actual: '0',
                                kpi: 'N',
                                time: r.time || '',
                                reminder: false,
                                recurring: true,
                                recurringDays: r.recurringDays || [0, 1, 2, 3, 4, 5, 6]
                            }));
                    } catch (e) {
                        console.warn('Failed to load recurring subjects:', e);
                    }

                    if (recurringSubjects.length > 0) {
                        setSubjects(recurringSubjects);
                    } else {
                        setSubjects(cloneDefaults(DEFAULT_SUBJECTS));
                    }
                    setChecklistItems(cloneDefaults(DEFAULT_CHECKLIST));
                    setQualityChecks(cloneDefaults(DEFAULT_QUALITY));
                    setDayRating('');
                    setErrors(cloneDefaults(DEFAULT_ERRORS));
                    setTodos(cloneDefaults(DEFAULT_TODOS));
                    setLastSaved(null);
                }
                setHasUnsavedChanges(false);
            } catch (error) {
                console.error('Failed to load day:', error);
            }
        };
        loadData();

        // Check for updates (non-blocking) - Only run once on mount
        checkForUpdate().then(info => {
            if (info && info.available) {
                setUpdateInfo(info);
            }
        });

        // Check exact alarm permission (Android 12+)
        NotificationService.checkExactAlarmPermission().then(hasPermission => {
            if (!hasPermission) {
                // Only show once per session, check localStorage
                const alreadyPrompted = localStorage.getItem('alarmPermissionPrompted');
                if (!alreadyPrompted) {
                    setShowAlarmPermissionModal(true);
                }
            }
        });
    }, [date]);

    const handleDownloadPDF = useCallback(() => {
        generatePDF({ date, subjects, checklistItems, qualityChecks, dayRating, errors });
    }, [date, subjects, checklistItems, qualityChecks, dayRating, errors]);

    const handleDownloadMD = useCallback(() => {
        generateMarkdown({ date, subjects, checklistItems, qualityChecks, dayRating, errors });
    }, [date, subjects, checklistItems, qualityChecks, dayRating, errors]);

    // Export all data
    const handleExport = useCallback(async () => {
        try {
            const count = await downloadBackup();
            alert(`✅ Backup downloaded! ${count} days exported.`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('❌ Export failed. Please try again.');
        }
    }, []);

    // Trigger file input for import
    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    // Handle file selection for import
    const handleImportFile = useCallback(async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const count = await handleFileImport(file);
            alert(`✅ Import successful! ${count} days restored.Refresh to see changes.`);
            // Reload current date's data
            window.location.reload();
        } catch (error) {
            console.error('Import failed:', error);
            alert('❌ Import failed. Please check the file format.');
        }

        // Reset file input
        event.target.value = '';
    }, []);

    // Memoize class names
    const containerClassName = useMemo(() =>
        `min-h-screen pb-12 font-sans transition-colors duration-300 relative ${['cherry-blossom', 'bamboo-forest', 'ocean-depths'].includes(theme)
            ? 'bg-transparent'
            : 'bg-app-bg text-app-text-main'
        }`,
        [theme]
    );

    const contentClassName = useMemo(() =>
        `relative z-10 ${theme === 'ocean-depths' ? 'text-white' : 'text-app-text-main'}`,
        [theme]
    );

    return (
        <BrowserRouter>
            <div className={containerClassName}>
                <LiveBackground theme={theme} />

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImportFile}
                    accept=".json"
                    className="hidden"
                />

                {/* Update Modal */}
                {updateInfo && (
                    <UpdateModal
                        updateInfo={updateInfo}
                        onClose={() => setUpdateInfo(null)}
                    />
                )}

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

                <div className={contentClassName}>
                    <Layout>
                        <Header
                            theme={theme}
                            setTheme={setTheme}
                            hasUnsavedChanges={hasUnsavedChanges}
                            isSaving={isSaving}
                            lastSaved={lastSaved}
                            onSave={handleSave}
                            onDownloadPDF={handleDownloadPDF}
                            onDownloadMD={handleDownloadMD}
                            onExport={handleExport}
                            onImportClick={handleImportClick}
                            fileInputRef={fileInputRef}
                            date={date}
                            setDate={setDate}
                            subjects={subjects}
                        />

                        <motion.main
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2, duration: 0.5 }}
                            className="mx-auto w-full max-w-7xl px-2 sm:px-4"
                        >
                            <Routes>
                                <Route path="/" element={
                                    <TrackerPage
                                        date={date}
                                        setDate={setDate}
                                        subjects={subjects}
                                        setSubjects={setSubjects}
                                    />
                                } />
                                <Route path="/review" element={
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
                                } />
                                <Route path="/stats" element={
                                    <StatsPage
                                        subjects={subjects}
                                        currentDate={date}
                                    />
                                } />
                                <Route path="/todo" element={<TodoPage todos={todos} setTodos={setTodos} />} />
                                <Route path="/focus" element={<FocusPage />} />
                            </Routes>
                        </motion.main>
                    </Layout>
                </div>
            </div>
        </BrowserRouter>
    );
}

export default App;
