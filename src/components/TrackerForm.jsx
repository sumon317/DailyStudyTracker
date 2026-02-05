import React, { memo, useCallback, useMemo } from 'react';
import { Plus, Trash2, BookOpen, Bell, BellOff } from 'lucide-react';
import { NotificationService } from '../utils/notificationService';
import TimePicker from './TimePicker';

const TrackerForm = memo(({ subjects, setSubjects }) => {
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
                reminder: false
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
                // Optional: Alert user
                // alert(`Reminder set for ${scheduledTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
            } else {
                alert(`Failed to schedule notification: ${result.error || 'Unknown error'}`);
            }
        }
    }, [subjects, handleChange]);

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
        <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm">
            <div className="border-b border-app-border bg-app-bg/50 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-app-primary" />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Study Planner</h2>
                </div>
                <button
                    onClick={addSubject}
                    className="flex items-center gap-1 rounded-lg bg-app-primary px-3 py-1.5 text-xs font-medium text-app-primary-fg hover:bg-app-primary-hover transition-colors"
                >
                    <Plus size={14} /> Add Subject
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm text-app-text-muted min-w-[600px]">
                    <thead className="bg-app-bg/50 text-[10px] sm:text-xs uppercase text-app-text-main">
                        <tr>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Subject</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Plan</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Actual</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">KPI</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Time</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 w-10">Alert</th>
                            <th className="px-2 sm:px-4 py-2 sm:py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border">
                        {subjects.map((subject, index) => (
                            <tr key={index} className={`hover:bg-app-primary/10 transition-colors ${index % 2 === 0 ? 'bg-app-surface' : 'bg-app-bg/70'}`}>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">
                                    <input
                                        type="text"
                                        value={subject.name}
                                        onChange={(e) => handleChange(index, 'name', e.target.value)}
                                        className="w-full min-w-[80px] max-w-[150px] sm:max-w-[180px] rounded-md border border-app-border bg-transparent px-1.5 sm:px-2 py-1 text-xs sm:text-sm font-medium text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    />
                                </td>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">
                                    <input
                                        type="number"
                                        value={subject.planned}
                                        onChange={(e) => handleChange(index, 'planned', e.target.value)}
                                        className="w-full max-w-[60px] sm:max-w-[80px] rounded-md border border-app-border bg-app-surface px-1.5 sm:px-2 py-1 text-xs sm:text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    />
                                </td>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">
                                    <input
                                        type="number"
                                        value={subject.actual}
                                        onChange={(e) => handleChange(index, 'actual', e.target.value)}
                                        className="w-full max-w-[60px] sm:max-w-[80px] rounded-md border border-app-border bg-app-surface px-1.5 sm:px-2 py-1 text-xs sm:text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                        placeholder="0"
                                    />
                                </td>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">
                                    <div className={`
                                        inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold w-[40px]
                                        ${subject.kpi === 'Y'
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                            : 'bg-app-bg text-app-text-muted'}
                                    `}>
                                        {subject.kpi === 'Y' ? 'Yes' : 'No'}
                                    </div>
                                </td>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">
                                    <TimePicker
                                        value={subject.time}
                                        onChange={(newTime) => {
                                            handleChange(index, 'time', newTime);
                                            // If reminder was on, turn it off as time changed
                                            if (subject.reminder) {
                                                NotificationService.cancelNotification(subject.id);
                                                handleChange(index, 'reminder', false);
                                            }
                                        }}
                                    />
                                </td>
                                <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 text-center">
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
                                <td className="px-2 sm:px-4 py-2 sm:py-3">
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
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Total</td>
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">{totalPlanned}</td>
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">{totalActual}</td>
                            <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 ${dayRatingColor}`}>
                                {dayRating}
                            </td>
                            <td colSpan={3}></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
});

TrackerForm.displayName = 'TrackerForm';

export default TrackerForm;
