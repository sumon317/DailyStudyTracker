import React from 'react';
import { Award, Sun } from 'lucide-react';

const QualityCheck = ({ checks, setChecks, rating, setRating }) => {
    const toggleCheck = (id) => {
        const newChecks = checks.map((check) =>
            check.id === id ? { ...check, checked: !check.checked } : check
        );
        setChecks(newChecks);
    };

    const updateLabel = (id, newLabel) => {
        const newChecks = checks.map((check) =>
            check.id === id ? { ...check, label: newLabel } : check
        );
        setChecks(newChecks);
    };

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Quality Check Section */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4 flex items-center gap-2">
                    <Award className="text-app-primary" size={18} />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Quality Check</h2>
                </div>
                <div className="space-y-3">
                    {checks.map((check) => (
                        <div key={check.id} className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={check.checked}
                                onChange={() => toggleCheck(check.id)}
                                className="h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-primary bg-app-surface cursor-pointer"
                            />
                            <input
                                type="text"
                                value={check.label}
                                onChange={(e) => updateLabel(check.id, e.target.value)}
                                className="flex-1 bg-transparent border-none p-0 text-xs sm:text-sm text-app-text-muted focus:ring-0 focus:outline-none"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Day Rating Section */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4 flex items-center gap-2">
                    <Sun className="text-app-accent-warning" size={18} />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Day Rating</h2>
                </div>
                <div className="flex gap-2 sm:gap-4">
                    {['Productive', 'Okayish', 'Unproductive'].map((option) => (
                        <label
                            key={option}
                            className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border p-2 sm:p-3 text-xs sm:text-sm font-medium transition-all ${rating === option
                                ? 'border-app-primary bg-app-primary/10 text-app-primary ring-1 ring-app-primary'
                                : 'border-app-border text-app-text-muted hover:border-app-primary/50 hover:bg-app-bg'
                                }`}
                        >
                            <input
                                type="radio"
                                name="day-rating"
                                value={option}
                                checked={rating === option}
                                onChange={(e) => setRating(e.target.value)}
                                className="sr-only"
                            />
                            {option}
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default QualityCheck;

