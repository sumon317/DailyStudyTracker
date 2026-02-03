import React, { useState, useEffect } from 'react';
import { Download, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import TrackerForm from './components/TrackerForm';
import Checklist from './components/Checklist';
import QualityCheck from './components/QualityCheck';
import ErrorLog from './components/ErrorLog';
import Clock from './components/Clock';
import DatePicker from './components/DatePicker';
import { generatePDF } from './utils/pdfGenerator';
import { generateMarkdown } from './utils/mdGenerator';
import { saveToNativeStorage, loadFromNativeStorage } from './db';
import LiveBackground from './components/LiveBackground';

// Default State Constants
const DEFAULT_SUBJECTS = [
    { name: 'Accounts', planned: '150', actual: '0', kpi: 'N' },
    { name: 'Microeconomics', planned: '60', actual: '0', kpi: 'N' },
    { name: 'PPM', planned: '50', actual: '0', kpi: 'N' },
    { name: 'Entrepreneurship', planned: '40', actual: '0', kpi: 'N' },
    { name: 'English', planned: '30', actual: '0', kpi: 'N' },
    { name: 'CVAC', planned: '30', actual: '0', kpi: 'N' },
];

const DEFAULT_CHECKLIST = [
    { id: 1, label: 'Accounts: 5–6 problems solved', checked: false },
    { id: 2, label: 'Micro: 2 numericals / diagrams', checked: false },
    { id: 3, label: 'PPM: 1–2 exam answers', checked: false },
    { id: 4, label: 'Entrepreneurship: 1 topic / case', checked: false },
    { id: 5, label: 'English: 1 passage / writing', checked: false },
    { id: 6, label: 'CVAC: 1 task / MCQs', checked: false },
];

const DEFAULT_QUALITY = [
    { id: 1, label: 'Can explain Accounts work without notes', checked: false },
    { id: 2, label: 'Can explain Micro work without notes', checked: false },
];

const DEFAULT_ERRORS = [
    { question: '', mistake: '', correctLogic: '' },
    { question: '', mistake: '', correctLogic: '' },
    { question: '', mistake: '', correctLogic: '' },
];

function App() {
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
        // Reset classes
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

    const [subjects, setSubjects] = useState(() => JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)));
    const [checklistItems, setChecklistItems] = useState(() => JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)));
    const [qualityChecks, setQualityChecks] = useState(() => JSON.parse(JSON.stringify(DEFAULT_QUALITY)));
    const [dayRating, setDayRating] = useState('');
    const [errors, setErrors] = useState(() => JSON.parse(JSON.stringify(DEFAULT_ERRORS)));

    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);

    const handleSave = async () => {
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
            console.log('Data saved successfully');
        } catch (error) {
            console.error('Failed to save:', error);
            alert('Failed to save progress.');
        } finally {
            setIsSaving(false);
        }
    };

    // Track unsaved changes
    useEffect(() => {
        setHasUnsavedChanges(true);
    }, [subjects, checklistItems, qualityChecks, dayRating, errors]);

    // Load data when date changes
    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await loadFromNativeStorage(date);
                if (data) {
                    setSubjects(data.subjects || JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)));
                    setChecklistItems(data.checklistItems || JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)));
                    setQualityChecks(data.qualityChecks || JSON.parse(JSON.stringify(DEFAULT_QUALITY)));
                    setDayRating(data.dayRating || '');
                    setErrors(data.errors || JSON.parse(JSON.stringify(DEFAULT_ERRORS)));

                    if (data.updatedAt) {
                        setLastSaved(data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt));
                    }
                    console.log('Data loaded for', date);
                } else {
                    // Reset to defaults
                    setSubjects(JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)));
                    setChecklistItems(JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)));
                    setQualityChecks(JSON.parse(JSON.stringify(DEFAULT_QUALITY)));
                    setDayRating('');
                    setErrors(JSON.parse(JSON.stringify(DEFAULT_ERRORS)));
                    setLastSaved(null);
                }
                // Mark as clean after load
                setHasUnsavedChanges(false);
            } catch (error) {
                console.error('Failed to load day:', error);
            }
        };
        loadData();
    }, [date]);

    const handleDownloadPDF = () => {
        generatePDF({ date, subjects, checklistItems, qualityChecks, dayRating, errors });
    };

    const handleDownloadMD = () => {
        generateMarkdown({ date, subjects, checklistItems, qualityChecks, dayRating, errors });
    };

    return (
        <div className={`min-h-screen pb-12 pt-8 font-sans transition-colors duration-300 relative
            ${['cherry-blossom', 'bamboo-forest', 'ocean-depths'].includes(theme) ? 'bg-transparent' : 'bg-app-bg text-app-text-main'}
        `}>
            {/* Live Background Layer */}
            <LiveBackground theme={theme} />

            {/* Content Layer - wrapped in relative z-10 to stay above bg */}
            <div className={`relative z-10 ${theme === 'ocean-depths' ? 'text-white' : 'text-app-text-main'}`}>
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mx-auto mb-6 flex max-w-4xl flex-col items-start justify-between gap-4 px-3 sm:px-4 md:flex-row md:items-center"
                >
                    {/* Header Left */}
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-app-primary">Daily Study Tracker</h1>
                        <div className="flex items-center gap-3 text-app-text-muted">
                            <span>6-Hour Target</span>
                            <span>•</span>

                            <button
                                onClick={handleSave}
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

                    {/* Header Right */}
                    <div className="flex flex-wrap gap-2 sm:gap-3 items-center w-full md:w-auto">
                        {/* Theme Selector */}
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

                        <button
                            onClick={handleDownloadPDF}
                            className="flex items-center gap-2 rounded-lg bg-app-primary px-4 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
                        >
                            <Download size={16} className="sm:w-[18px] sm:h-[18px]" /> <span className="hidden sm:inline">PDF</span>
                        </button>
                        <button
                            onClick={handleDownloadMD}
                            className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-4 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus:ring-2 focus:ring-app-primary focus:ring-offset-2"
                        >
                            <FileText size={16} className="sm:w-[18px] sm:h-[18px]" /> <span className="hidden sm:inline">Markdown</span>
                        </button>
                    </div>
                </motion.div>

                {/* Main Content */}
                <motion.main
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="mx-auto max-w-4xl space-y-4 sm:space-y-6 px-2 sm:px-4"
                >
                    {/* Date Input & Clock Section */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <DatePicker date={date} setDate={setDate} />
                        <div className="rounded-xl border border-app-border bg-app-surface p-5 shadow-sm flex items-center justify-center h-[90px] min-w-[140px]">
                            <Clock />
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
                </motion.main>
            </div>
        </div>
    );
}

export default App;
