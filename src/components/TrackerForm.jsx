import React, { memo, useCallback, useMemo } from 'react';
import { Plus, Trash2, BookOpen } from 'lucide-react';

const TrackerForm = memo(({ subjects, setSubjects }) => {
    const handleChange = useCallback((index, field, value) => {
        // Prevent negative numbers
        if ((field === 'planned' || field === 'actual') && parseFloat(value) < 0) {
            return;
        }

        setSubjects(prevSubjects => prevSubjects.map((subj, i) => {
            if (i === index) {
                const updatedSubj = { ...subj, [field]: value };

                // Auto-calculate KPI (only when actual changes)
                if (field === 'actual') {
                    const planned = parseFloat(updatedSubj.planned);
                    const actual = parseFloat(value);
                    if (!isNaN(planned) && !isNaN(actual) && planned > 0) {
                        updatedSubj.kpi = actual >= (0.8 * planned) ? 'Y' : 'N';
                    }
                }
                return updatedSubj;
            }
            return subj;
        }));
    }, [setSubjects]);

    const addSubject = useCallback(() => {
        setSubjects(prev => [...prev, { name: 'New Subject', planned: '60', actual: '0', kpi: 'N' }]);
    }, [setSubjects]);

    const removeSubject = useCallback((index) => {
        if (subjects.length <= 1) return; // Keep at least one subject
        setSubjects(prev => prev.filter((_, i) => i !== index));
    }, [setSubjects, subjects.length]);

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
                <table className="w-full text-left text-xs sm:text-sm text-app-text-muted min-w-[500px]">
                    <thead className="bg-app-bg/50 text-[10px] sm:text-xs uppercase text-app-text-main">
                        <tr>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Subject</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Plan</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Actual</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">KPI</th>
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
                                    <select
                                        value={subject.kpi}
                                        onChange={(e) => handleChange(index, 'kpi', e.target.value)}
                                        className="block w-full max-w-[60px] sm:max-w-[80px] rounded-md border border-app-border bg-app-surface px-1 sm:px-2 py-1 text-xs sm:text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                    >
                                        <option value="">-</option>
                                        <option value="Y">Yes</option>
                                        <option value="N">No</option>
                                    </select>
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
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
});

TrackerForm.displayName = 'TrackerForm';

export default TrackerForm;
