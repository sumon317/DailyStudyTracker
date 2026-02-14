import React, { memo, useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, BookOpen, Bell, BellOff, Repeat2, X } from 'lucide-react';
import { NotificationService } from '../utils/notificationService';
import TimePicker from './TimePicker';
import { motion, AnimatePresence } from 'framer-motion';

const DAYS = [
    { label: 'S', value: 0, full: 'Sunday' },
    { label: 'M', value: 1, full: 'Monday' },
    { label: 'T', value: 2, full: 'Tuesday' },
    { label: 'W', value: 3, full: 'Wednesday' },
    { label: 'T', value: 4, full: 'Thursday' },
    { label: 'F', value: 5, full: 'Friday' },
    { label: 'S', value: 6, full: 'Saturday' },
];

const RecurringModal = ({ isOpen, onClose, onSave, onStopRepeating, initialDays, subjectName, isCurrentlyRecurring }) => {
    const [selectedDays, setSelectedDays] = useState(initialDays || [0, 1, 2, 3, 4, 5, 6]);

    const toggleDay = (dayValue) => {
        setSelectedDays(prev => {
            if (prev.includes(dayValue)) {
                return prev.filter(d => d !== dayValue);
            } else {
                return [...prev, dayValue].sort();
            }
        });
    };

    const handleSave = () => {
        onSave(selectedDays);
        // No need to call onClose() — parent's onSave handler already closes the modal
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-app-surface w-full max-w-sm rounded-xl border border-app-border shadow-2xl overflow-hidden"
            >
                <div className="p-4 border-b border-app-border flex justify-between items-center bg-app-bg/50">
                    <h3 className="font-semibold text-app-text-main">Recurring Days</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-app-bg text-app-text-muted">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-sm text-app-text-muted">
                        Select days to repeat <span className="font-medium text-app-primary">{subjectName}</span>:
                    </p>

                    <div className="flex justify-between gap-1">
                        {DAYS.map((day) => {
                            const isSelected = selectedDays.includes(day.value);
                            return (
                                <button
                                    key={day.value}
                                    onClick={() => toggleDay(day.value)}
                                    className={`
                                        w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center transition-all
                                        ${isSelected
                                            ? 'bg-app-primary text-white shadow-md scale-105'
                                            : 'bg-app-bg text-app-text-muted border border-app-border hover:bg-app-border'
                                        }
                                    `}
                                    title={day.full}
                                >
                                    {day.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="pt-2 flex justify-between">
                        {isCurrentlyRecurring ? (
                            <button
                                onClick={() => { onStopRepeating(); }}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                Stop Repeating
                            </button>
                        ) : (
                            <div />
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-app-text-muted hover:bg-app-bg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={selectedDays.length === 0}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-app-primary text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

const TrackerForm = memo(({ subjects, setSubjects }) => {
    const [editingRecurringIndex, setEditingRecurringIndex] = useState(null);

    const handleChange = useCallback((index, field, value) => {
        // Prevent negative numbers
        if ((field === 'planned' || field === 'actual') && parseFloat(value) < 0) {
            return;
        }

        setSubjects(prevSubjects => prevSubjects.map((subj, i) => {
            if (i === index) {
                const updatedSubj = { ...subj, [field]: value };

                // Auto-calculate KPI when planned or actual changes
                if (field === 'actual' || field === 'planned') {
                    const planned = parseFloat(field === 'planned' ? value : updatedSubj.planned);
                    const actual = parseFloat(field === 'actual' ? value : updatedSubj.actual);

                    if (!isNaN(planned) && !isNaN(actual) && planned > 0) {
                        updatedSubj.kpi = actual >= (0.8 * planned) ? 'Y' : 'N';
                    } else {
                        updatedSubj.kpi = 'N';
                    }
                }
                return updatedSubj;
            }
            return subj;
        }));
    }, [setSubjects]);

    const addSubject = useCallback(() => {
        setSubjects(prev => [
            ...prev,
            {
                id: Date.now(),
                name: 'New Subject',
                planned: '60',
                actual: '0',
                kpi: 'N',
                time: '',
                reminder: false,
                recurring: false,
                recurringDays: [0, 1, 2, 3, 4, 5, 6] // Default to every day
            }
        ]);
    }, [setSubjects]);

    const removeSubject = useCallback(async (index) => {
        if (subjects.length <= 1) return; // Keep at least one subject

        // Cancel notification if exists
        const subject = subjects[index];
        if (subject.reminder && subject.id) {
            await NotificationService.cancelNotification(subject.id);
        }

        setSubjects(prev => prev.filter((_, i) => i !== index));
    }, [setSubjects, subjects]);

    const handleReminder = useCallback(async (index) => {
        const subject = subjects[index];

        // Ensure subject has an ID (legacy support)
        if (!subject.id) {
            // If missing ID, we can't reliably schedule. Ideally we'd add one but for now alert.
            // In practice, App.jsx now adds IDs, but old saves might lack them.
            // Let's generate a temporary one if needed, but it won't persist well if not saved.
            // For now assuming ID exists or refusing.
            alert("Please reset your subjects to enable reminders (missing ID).");
            return;
        }

        if (!subject.time) {
            alert('Please set a time for the reminder first.');
            return;
        }

        if (subject.reminder) {
            // Turn off
            const success = await NotificationService.cancelNotification(subject.id);
            if (success) {
                handleChange(index, 'reminder', false);
            }
        } else {
            // Turn on
            const [hours, minutes] = subject.time.split(':');
            const now = new Date();
            let scheduledTime = new Date();
            scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

            // If time has passed today, schedule for tomorrow
            if (scheduledTime <= now) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
            }

            const result = await NotificationService.scheduleNotification(
                subject.id,
                `Study Time: ${subject.name}`,
                `It's time to start studying ${subject.name}! Target: ${subject.planned} min.`,
                scheduledTime
            );

            if (result.success) {
                handleChange(index, 'reminder', true);

                // Alert user with specific time and day
                const isTomorrow = scheduledTime.getDate() !== now.getDate();
                const timeStr = scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                alert(`Reminder set for ${isTomorrow ? 'Tomorrow' : 'Today'} at ${timeStr}`);
            } else {
                alert(`Failed to schedule notification: ${result.error || 'Unknown error'}`);
            }
        }
    }, [subjects, handleChange]);

    const handleRecurringSave = useCallback((days) => {
        if (editingRecurringIndex !== null) {
            // Single state update to avoid race condition between two handleChange calls
            setSubjects(prevSubjects => prevSubjects.map((subj, i) => {
                if (i === editingRecurringIndex) {
                    return { ...subj, recurring: true, recurringDays: days };
                }
                return subj;
            }));
            setEditingRecurringIndex(null);
        }
    }, [editingRecurringIndex, setSubjects]);

    const handleStopRepeating = useCallback(() => {
        if (editingRecurringIndex !== null) {
            setSubjects(prevSubjects => prevSubjects.map((subj, i) => {
                if (i === editingRecurringIndex) {
                    return { ...subj, recurring: false, recurringDays: [] };
                }
                return subj;
            }));
            setEditingRecurringIndex(null);
        }
    }, [editingRecurringIndex, setSubjects]);

    const handleRecurringClick = useCallback((index) => {
        setEditingRecurringIndex(index);
    }, []);

    const totalPlanned = useMemo(() =>
        subjects.reduce((acc, curr) => acc + (parseFloat(curr.planned) || 0), 0),
        [subjects]
    );

    const totalActual = useMemo(() =>
        subjects.reduce((acc, curr) => acc + (parseFloat(curr.actual) || 0), 0),
        [subjects]
    );

    const dayRating = useMemo(() => {
        const kpiCount = subjects.filter(s => s.kpi === 'Y').length;
        const ratio = kpiCount / subjects.length;
        if (ratio >= 0.8) return 'Productive';
        if (ratio >= 0.5) return 'Okayish';
        return 'Unproductive';
    }, [subjects]);

    const dayRatingColor = useMemo(() => {
        if (dayRating === 'Productive') return 'text-green-600 dark:text-green-400';
        if (dayRating === 'Okayish') return 'text-amber-600 dark:text-amber-400';
        return 'text-red-500 dark:text-red-400';
    }, [dayRating]);

    return (
        <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm relative">
            <AnimatePresence>
                {editingRecurringIndex !== null && (
                    <RecurringModal
                        isOpen={true}
                        onClose={() => setEditingRecurringIndex(null)}
                        onSave={handleRecurringSave}
                        onStopRepeating={handleStopRepeating}
                        initialDays={subjects[editingRecurringIndex].recurringDays || [0, 1, 2, 3, 4, 5, 6]}
                        subjectName={subjects[editingRecurringIndex].name}
                        isCurrentlyRecurring={subjects[editingRecurringIndex].recurring}
                    />
                )}
            </AnimatePresence>

            <div className="border-b border-app-border bg-app-bg/50 px-3 sm:px-6 py-2 sm:py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-app-primary" />
                    <h2 className="text-sm sm:text-lg font-semibold text-app-text-main">Study Planner</h2>
                </div>
                <button
                    onClick={addSubject}
                    className="flex items-center gap-1 rounded-lg bg-app-primary px-2.5 sm:px-3 py-1.5 text-xs font-medium text-app-primary-fg hover:bg-app-primary-hover transition-colors"
                >
                    <Plus size={14} /> Add
                </button>
            </div>

            {/* ===== MOBILE: Card Layout ===== */}
            <div className="sm:hidden divide-y divide-app-border">
                {subjects.map((subject, index) => (
                    <div key={index} className={`px-3 py-2.5 ${index % 2 === 0 ? 'bg-app-surface' : 'bg-app-bg/40'}`}>
                        {/* Row 1: Subject name + delete */}
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="text"
                                value={subject.name}
                                onChange={(e) => handleChange(index, 'name', e.target.value)}
                                className="flex-1 min-w-0 rounded-md border border-app-border bg-transparent px-2 py-1 text-sm font-medium text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                            />
                            {subjects.length > 1 && (
                                <button
                                    onClick={() => removeSubject(index)}
                                    className="p-1 rounded-lg text-app-text-muted hover:text-app-accent-error hover:bg-app-bg transition-colors shrink-0"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                        {/* Row 2: Plan / Actual / KPI */}
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 flex items-center gap-1.5">
                                <span className="text-[10px] uppercase text-app-text-muted font-medium shrink-0">Plan</span>
                                <input
                                    type="number"
                                    value={subject.planned}
                                    onChange={(e) => handleChange(index, 'planned', e.target.value)}
                                    className="w-full rounded-md border border-app-border bg-app-surface px-1.5 py-1 text-sm text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                />
                            </div>
                            <div className="flex-1 flex items-center gap-1.5">
                                <span className="text-[10px] uppercase text-app-text-muted font-medium shrink-0">Act</span>
                                <input
                                    type="number"
                                    value={subject.actual}
                                    onChange={(e) => handleChange(index, 'actual', e.target.value)}
                                    className="w-full rounded-md border border-app-border bg-app-surface px-1.5 py-1 text-sm text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    placeholder="0"
                                />
                            </div>
                            <div className={`
                                inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold
                                ${subject.kpi === 'Y'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-app-bg text-app-text-muted'}
                            `}>
                                {subject.kpi === 'Y' ? '✓ KPI' : '✗ KPI'}
                            </div>
                        </div>
                        {/* Row 3: Time + Alert + Repeat */}
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-28 shrink-0">
                                <TimePicker
                                    value={subject.time}
                                    onChange={(newTime) => {
                                        handleChange(index, 'time', newTime);
                                        if (subject.reminder) {
                                            NotificationService.cancelNotification(subject.id);
                                            handleChange(index, 'reminder', false);
                                        }
                                    }}
                                />
                            </div>
                            <button
                                onClick={() => handleReminder(index)}
                                className={`p-1.5 rounded-full transition-colors ${subject.reminder
                                    ? 'bg-app-accent-warning text-white hover:bg-app-accent-warning/90'
                                    : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                    }`}
                                title={subject.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                            >
                                {subject.reminder ? <Bell size={14} fill="currentColor" /> : <BellOff size={14} />}
                            </button>
                            <button
                                onClick={() => handleRecurringClick(index)}
                                className={`flex items-center gap-0.5 p-1.5 rounded-full transition-colors ${subject.recurring
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'text-app-text-muted hover:bg-app-bg hover:text-blue-500'
                                    }`}
                                title="Configure recurring"
                            >
                                <Repeat2 size={14} />
                            </button>
                        </div>
                        {/* Row 4: Mon, Tue... day indicators (view only) */}
                        <div className="flex flex-wrap items-center gap-1.5 opacity-80">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel, dayIdx) => {
                                const isActive = subject.recurring && subject.recurringDays && subject.recurringDays.includes(dayIdx);
                                return (
                                    <span
                                        key={dayIdx}
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors
                                            ${isActive
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-app-bg text-app-text-muted'
                                            }
                                        `}
                                    >
                                        {dayLabel}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                ))}
                {/* Mobile totals */}
                <div className="px-3 py-2.5 bg-app-bg/50 flex items-center gap-4 text-xs font-bold text-app-text-main">
                    <span>Total</span>
                    <span>Plan: {totalPlanned}</span>
                    <span>Act: {totalActual}</span>
                    <span className={dayRatingColor}>{dayRating}</span>
                </div>
            </div>

            {/* ===== DESKTOP: Table Layout ===== */}
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-app-text-muted min-w-[600px]">
                    <thead className="bg-app-bg/50 text-xs uppercase text-app-text-main">
                        <tr>
                            <th className="px-4 md:px-6 py-3">Subject</th>
                            <th className="px-4 md:px-6 py-3">Plan</th>
                            <th className="px-4 md:px-6 py-3">Actual</th>
                            <th className="px-4 md:px-6 py-3">KPI</th>
                            <th className="px-4 md:px-6 py-3">Time</th>
                            <th className="px-4 md:px-6 py-3 w-10">Alert</th>
                            <th className="px-4 md:px-6 py-3 w-10" title="Recurring Days">Repeat</th>
                            <th className="px-4 py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border">
                        {subjects.map((subject, index) => (
                            <tr key={index} className={`hover:bg-app-primary/10 transition-colors ${index % 2 === 0 ? 'bg-app-surface' : 'bg-app-bg/70'}`}>
                                <td className="px-4 md:px-6 py-3">
                                    <input
                                        type="text"
                                        value={subject.name}
                                        onChange={(e) => handleChange(index, 'name', e.target.value)}
                                        className="w-full max-w-[180px] rounded-md border border-app-border bg-transparent px-2 py-1 text-sm font-medium text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    />
                                </td>
                                <td className="px-4 md:px-6 py-3">
                                    <input
                                        type="number"
                                        value={subject.planned}
                                        onChange={(e) => handleChange(index, 'planned', e.target.value)}
                                        className="w-full max-w-[80px] rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    />
                                </td>
                                <td className="px-4 md:px-6 py-3">
                                    <input
                                        type="number"
                                        value={subject.actual}
                                        onChange={(e) => handleChange(index, 'actual', e.target.value)}
                                        className="w-full max-w-[80px] rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                        placeholder="0"
                                    />
                                </td>
                                <td className="px-4 md:px-6 py-3">
                                    <div className={`
                                        inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold w-[40px]
                                        ${subject.kpi === 'Y'
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                            : 'bg-app-bg text-app-text-muted'}
                                    `}>
                                        {subject.kpi === 'Y' ? 'Yes' : 'No'}
                                    </div>
                                </td>
                                <td className="px-4 md:px-6 py-3">
                                    <TimePicker
                                        value={subject.time}
                                        onChange={(newTime) => {
                                            handleChange(index, 'time', newTime);
                                            if (subject.reminder) {
                                                NotificationService.cancelNotification(subject.id);
                                                handleChange(index, 'reminder', false);
                                            }
                                        }}
                                    />
                                </td>
                                <td className="px-4 md:px-6 py-3 text-center">
                                    <button
                                        onClick={() => handleReminder(index)}
                                        className={`p-1.5 rounded-full transition-colors ${subject.reminder
                                            ? 'bg-app-accent-warning text-white hover:bg-app-accent-warning/90'
                                            : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                            }`}
                                        title={subject.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                                    >
                                        {subject.reminder ? <Bell size={16} fill="currentColor" /> : <BellOff size={16} />}
                                    </button>
                                </td>
                                <td className="px-4 md:px-6 py-3 text-center">
                                    <button
                                        onClick={() => handleRecurringClick(index)}
                                        className={`flex items-center justify-center gap-1 p-1.5 rounded-full transition-colors ${subject.recurring
                                            ? 'bg-blue-500 text-white hover:bg-blue-600'
                                            : 'text-app-text-muted hover:bg-app-bg hover:text-blue-500'
                                            }`}
                                        title="Configure recurring days"
                                    >
                                        <Repeat2 size={16} />
                                        {subject.recurring && subject.recurringDays && subject.recurringDays.length < 7 && (
                                            <span className="text-[10px] font-bold">{subject.recurringDays.length}</span>
                                        )}
                                    </button>
                                </td>
                                <td className="px-4 py-3">
                                    {subjects.length > 1 && (
                                        <button
                                            onClick={() => removeSubject(index)}
                                            className="p-1.5 rounded-lg text-app-text-muted hover:text-app-accent-error hover:bg-app-bg transition-colors"
                                            title="Remove subject"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        <tr className="bg-app-bg/50 font-bold text-app-text-main">
                            <td className="px-4 md:px-6 py-3">Total</td>
                            <td className="px-4 md:px-6 py-3">{totalPlanned}</td>
                            <td className="px-4 md:px-6 py-3">{totalActual}</td>
                            <td className={`px-4 md:px-6 py-3 ${dayRatingColor}`}>
                                {dayRating}
                            </td>
                            <td colSpan={4}></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
});

TrackerForm.displayName = 'TrackerForm';

export default TrackerForm;
