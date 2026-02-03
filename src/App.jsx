import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Download, FileText, Upload, Save } from 'lucide-react';
import { motion } from 'framer-motion';
import TrackerForm from './components/TrackerForm';
import Checklist from './components/Checklist';
import QualityCheck from './components/QualityCheck';
import ErrorLog from './components/ErrorLog';
import Clock from './components/Clock';
import Stopwatch from './components/Stopwatch';
import DatePicker from './components/DatePicker';
import { generatePDF } from './utils/pdfGenerator';
import { generateMarkdown } from './utils/mdGenerator';
import { saveToNativeStorage, loadFromNativeStorage, downloadBackup, handleFileImport } from './db';
import LiveBackground from './components/LiveBackground';
import WeeklyStats from './components/WeeklyStats';
import StudyCharts from './components/StudyCharts';
import CountdownTimer from './components/CountdownTimer';
import { updateWidget } from './utils/widgetBridge';

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

// Helper to deep clone defaults
const cloneDefaults = (defaults) => JSON.parse(JSON.stringify(defaults));

// Memoized header animations
const headerAnimation = { opacity: 0, y: -20 };
const headerAnimateIn = { opacity: 1, y: 0 };
const mainAnimation = { opacity: 0, y: 20 };
const mainAnimateIn = { opacity: 1, y: 0 };

// Memoized Header component to prevent re-renders
const Header = memo(({
    theme, setTheme, hasUnsavedChanges, isSaving, lastSaved,
    onSave, onDownloadPDF, onDownloadMD, onExport, onImportClick, fileInputRef
}) => (
    <motion.div
        initial={headerAnimation}
        animate={headerAnimateIn}
        transition={{ duration: 0.5 }}
        className="mx-auto mb-6 flex max-w-4xl flex-col items-start justify-between gap-4 px-3 sm:px-4 md:flex-row md:items-center"
    >
        <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-app-primary">Daily Study Tracker</h1>
            <div className="flex items-center gap-3 text-app-text-muted">
                <span>6-Hour Target</span>
                <span>•</span>
                <button
                    onClick={onSave}
                    disabled={isSaving || !hasUnsavedChanges}
                    className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all
                        ${hasUnsavedChanges
                            ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                            : 'bg-app-surface text-app-text-muted border border-app-border'
                        }
                        ${isSaving ? 'opacity-70 cursor-wait' : ''}
                    `}
                >
                    {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save Progress' : 'Saved'}
                </button>
                {lastSaved && !hasUnsavedChanges && (
                    <span className="text-xs text-app-text-muted/70">
                        Last saved: {lastSaved.toLocaleTimeString()}
                    </span>
                )}
            </div>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3 items-center w-full md:w-auto">
            <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="h-9 sm:h-10 rounded-lg border border-app-border bg-app-surface px-2 text-xs sm:text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary flex-1 sm:flex-none"
            >
                <optgroup label="Standard">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="material-light">Material Day</option>
                    <option value="material-dark">Material Night</option>
                </optgroup>
                <optgroup label="Live Themes ✨">
                    <option value="cherry-blossom">🌸 Cherry Blossom</option>
                    <option value="bamboo-forest">🎋 Bamboo Forest</option>
                    <option value="ocean-depths">🌊 Ocean Depths</option>
                </optgroup>
            </select>

            {/* Export/Import Buttons */}
            <button
                onClick={onExport}
                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
                title="Export all data as backup"
            >
                <Save size={16} className="sm:w-[18px] sm:h-[18px]" />
                <span className="hidden sm:inline">Backup</span>
            </button>
            <button
                onClick={onImportClick}
                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
                title="Import data from backup"
            >
                <Upload size={16} className="sm:w-[18px] sm:h-[18px]" />
                <span className="hidden sm:inline">Restore</span>
            </button>

            <button
                onClick={onDownloadPDF}
                className="flex items-center gap-2 rounded-lg bg-app-primary px-4 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
            >
                <Download size={16} className="sm:w-[18px] sm:h-[18px]" /> <span className="hidden sm:inline">PDF</span>
            </button>
            <button
                onClick={onDownloadMD}
                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-4 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
            >
                <FileText size={16} className="sm:w-[18px] sm:h-[18px]" /> <span className="hidden sm:inline">Markdown</span>
            </button>
        </div>
    </motion.div>
));

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
            return localStorage.getItem('theme') || 'light';
        }
        return 'light';
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

    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            await saveToNativeStorage(date, {
                subjects,
                checklistItems,
                qualityChecks,
                dayRating,
                errors,
            });
            setLastSaved(new Date());
            setHasUnsavedChanges(false);

            // Update Widget
            updateWidget(subjects);
        } catch (error) {
            console.error('Failed to save:', error);
            alert('Failed to save progress.');
        } finally {
            setIsSaving(false);
        }
    }, [date, subjects, checklistItems, qualityChecks, dayRating, errors]);

    // Track unsaved changes
    useEffect(() => {
        setHasUnsavedChanges(true);
    }, [subjects, checklistItems, qualityChecks, dayRating, errors]);

    // Auto-save every 10 seconds if there are unsaved changes
    useEffect(() => {
        const autoSaveInterval = setInterval(() => {
            if (hasUnsavedChanges && !isSaving) {
                handleSave();
            }
        }, 10000); // 10 seconds

        return () => clearInterval(autoSaveInterval);
    }, [hasUnsavedChanges, isSaving, handleSave]);

    // Load data when date changes
    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await loadFromNativeStorage(date);
                if (data) {
                    setSubjects(data.subjects || cloneDefaults(DEFAULT_SUBJECTS));
                    setChecklistItems(data.checklistItems || cloneDefaults(DEFAULT_CHECKLIST));
                    setQualityChecks(data.qualityChecks || cloneDefaults(DEFAULT_QUALITY));
                    setDayRating(data.dayRating || '');
                    setErrors(data.errors || cloneDefaults(DEFAULT_ERRORS));

                    if (data.updatedAt) {
                        setLastSaved(data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt));
                    }
                } else {
                    setSubjects(cloneDefaults(DEFAULT_SUBJECTS));
                    setChecklistItems(cloneDefaults(DEFAULT_CHECKLIST));
                    setQualityChecks(cloneDefaults(DEFAULT_QUALITY));
                    setDayRating('');
                    setErrors(cloneDefaults(DEFAULT_ERRORS));
                    setLastSaved(null);
                }
                setHasUnsavedChanges(false);
            } catch (error) {
                console.error('Failed to load day:', error);
            }
        };
        loadData();
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
            alert(`✅ Import successful! ${count} days restored. Refresh to see changes.`);
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
        `min-h-screen pb-12 pt-8 font-sans transition-colors duration-300 relative ${['cherry-blossom', 'bamboo-forest', 'ocean-depths'].includes(theme)
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
        <div className={containerClassName}>
            <LiveBackground theme={theme} />

            {/* Hidden file input for import */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".json"
                className="hidden"
            />

            <div className={contentClassName}>
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
                />

                <motion.main
                    initial={mainAnimation}
                    animate={mainAnimateIn}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="mx-auto max-w-4xl space-y-4 sm:space-y-6 px-2 sm:px-4"
                >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <DatePicker date={date} setDate={setDate} />
                        <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm flex items-center justify-center gap-4 h-[90px] min-w-[280px]">
                            <Clock />
                            <div className="w-px h-12 bg-app-border" />
                            <Stopwatch />
                        </div>
                    </div>

                    <TrackerForm subjects={subjects} setSubjects={setSubjects} />

                    <Checklist items={checklistItems} setItems={setChecklistItems} />

                    <QualityCheck
                        checks={qualityChecks}
                        setChecks={setQualityChecks}
                        rating={dayRating}
                        setRating={setDayRating}
                    />

                    <ErrorLog errors={errors} setErrors={setErrors} />

                    <StudyCharts subjects={subjects} />

                    <WeeklyStats currentDate={date} />

                    <CountdownTimer />
                </motion.main>
            </div>
        </div>
    );
}

export default App;
