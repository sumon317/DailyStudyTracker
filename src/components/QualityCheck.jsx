import React, { memo, useCallback } from 'react';
import { Award, Sun } from 'lucide-react';

const QualityCheckItem = memo(({ check, onToggle, onUpdateLabel }) => (
    <div className="flex items-center gap-3">
        <input
            type="checkbox"
            checked={check.checked}
            onChange={onToggle}
            className="h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-primary bg-app-surface cursor-pointer"
        />
        <input
            type="text"
            value={check.label}
            onChange={(e) => onUpdateLabel(e.target.value)}
            className="flex-1 bg-transparent border-none p-0 text-xs sm:text-sm text-app-text-muted focus:ring-0 focus:outline-none"
        />
    </div>
));

QualityCheckItem.displayName = 'QualityCheckItem';

const RatingOption = memo(({ option, isSelected, onSelect }) => (
    <label
        className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border p-2 sm:p-3 text-xs sm:text-sm font-medium transition-all ${isSelected
            ? 'border-app-primary bg-app-primary/10 text-app-primary ring-1 ring-app-primary'
            : 'border-app-border text-app-text-muted hover:border-app-primary/50 hover:bg-app-bg'
            }`}
    >
        <input
            type="radio"
            name="day-rating"
            value={option}
            checked={isSelected}
            onChange={onSelect}
            className="sr-only"
        />
        {option}
    </label>
));

RatingOption.displayName = 'RatingOption';

const RATING_OPTIONS = ['Productive', 'Okayish', 'Unproductive'];

const QualityCheck = memo(({ checks, setChecks, rating, setRating }) => {
    const toggleCheck = useCallback((id) => {
        setChecks(prevChecks => prevChecks.map((check) =>
            check.id === id ? { ...check, checked: !check.checked } : check
        ));
    }, [setChecks]);

    const updateLabel = useCallback((id, newLabel) => {
        setChecks(prevChecks => prevChecks.map((check) =>
            check.id === id ? { ...check, label: newLabel } : check
        ));
    }, [setChecks]);

    const handleRatingChange = useCallback((e) => {
        setRating(e.target.value);
    }, [setRating]);

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
                        <QualityCheckItem
                            key={check.id}
                            check={check}
                            onToggle={() => toggleCheck(check.id)}
                            onUpdateLabel={(label) => updateLabel(check.id, label)}
                        />
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
                    {RATING_OPTIONS.map((option) => (
                        <RatingOption
                            key={option}
                            option={option}
                            isSelected={rating === option}
                            onSelect={handleRatingChange}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
});

QualityCheck.displayName = 'QualityCheck';

export default QualityCheck;
