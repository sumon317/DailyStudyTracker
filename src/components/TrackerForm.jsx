import React from 'react';

const TrackerForm = ({ subjects, setSubjects }) => {
    const handleChange = (index, field, value) => {
        // Prevent negative numbers
        if ((field === 'planned' || field === 'actual') && parseFloat(value) < 0) {
            return;
        }

        const newSubjects = subjects.map((subj, i) => {
            if (i === index) {
                // Create shallow copy of the object being updated
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
        });

        setSubjects(newSubjects);
    };

    const calculateTotal = (field) => {
        return subjects.reduce((acc, curr) => {
            const val = parseFloat(curr[field]) || 0;
            return acc + val;
        }, 0);
    };

    const getDayRating = () => {
        const kpiCount = subjects.filter(s => s.kpi === 'Y').length;
        const ratio = kpiCount / subjects.length;

        if (ratio >= 0.8) return 'Productive'; // ≥ 5/6
        if (ratio >= 0.5) return 'Okayish';    // ≥ 3/6
        return 'Unproductive';
    };

    const getDayRatingColor = () => {
        const rating = getDayRating();
        if (rating === 'Productive') return 'text-green-600 dark:text-green-400';
        if (rating === 'Okayish') return 'text-amber-600 dark:text-amber-400';
        return 'text-red-500 dark:text-red-400';
    };

    return (
        <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm">
            <div className="border-b border-app-border bg-app-bg/50 px-4 sm:px-6 py-3 sm:py-4">
                <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Study Planner</h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm text-app-text-muted min-w-[500px]">
                    <thead className="bg-app-bg/50 text-[10px] sm:text-xs uppercase text-app-text-main">
                        <tr>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Subject</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Plan</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Actual</th>
                            <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">KPI</th>
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
                            </tr>
                        ))}
                        <tr className="bg-app-bg/50 font-bold text-app-text-main">
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">Total</td>
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">{calculateTotal('planned')}</td>
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3">{calculateTotal('actual')}</td>
                            <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 ${getDayRatingColor()}`}>
                                {getDayRating()}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TrackerForm;
