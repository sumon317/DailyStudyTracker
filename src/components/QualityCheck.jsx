import React, { memo, useCallback } from 'react';
import { Award, Sun, Plus, Trash2 } from 'lucide-react';

const QualityCheckItem = memo(({ check, onToggle, onUpdateLabel, onRemove }) => (
    <div className="group flex items-center gap-3">
        <input
            type="checkbox"
            checked={check.checked}
            onChange={onToggle}
            className="h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-primary bg-app-surface cursor-pointer flex-shrink-0"
        />
        <input
            type="text"
            value={check.label}
            onChange={(e) => onUpdateLabel(e.target.value)}
            placeholder="Type your quality criteria..."
            className={`flex-1 bg-transparent border-none p-0 text-xs sm:text-sm focus:ring-0 focus:outline-none placeholder-app-text-muted/50 ${check.checked ? 'text-app-text-muted line-through' : 'text-app-text-main'}`}
        />
        <button
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 p-1 text-app-text-muted hover:text-app-accent-error transition-all focus:opacity-100"
            title="Remove item"
        >
            <Trash2 size={14} />
        </button>
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

    const addItem = useCallback(() => {
        setChecks(prev => [
            ...prev,
            { id: Date.now(), label: '', checked: false }
        ]);
    }, [setChecks]);

    const removeItem = useCallback((id) => {
        setChecks(prev => prev.filter(item => item.id !== id));
    }, [setChecks]);

    const handleRatingChange = useCallback((e) => {
        setRating(e.target.value);
    }, [setRating]);

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Quality Check Section */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Award className="text-app-primary" size={18} />
                        <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Quality Check</h2>
                    </div>
                    <button
                        onClick={addItem}
                        className="flex items-center gap-1 rounded-lg bg-app-primary/10 px-2 py-1 text-xs font-medium text-app-primary hover:bg-app-primary/20 transition-colors"
                    >
                        <Plus size={14} /> Add Item
                    </button>
                </div>

                {checks.length === 0 ? (
                    <div className="text-center py-4 border-2 border-dashed border-app-border rounded-lg">
                        <p className="text-xs text-app-text-muted mb-1">Define your daily standards</p>
                        <button onClick={addItem} className="text-app-primary text-xs font-medium hover:underline">
                            + Add quality criteria
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {checks.map((check) => (
                            <QualityCheckItem
                                key={check.id}
                                check={check}
                                onToggle={() => toggleCheck(check.id)}
                                onUpdateLabel={(label) => updateLabel(check.id, label)}
                                onRemove={() => removeItem(check.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Day Rating Section */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4 flex items-center gap-2">
                    <Sun className="text-app-accent-warning" size={18} />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Day Rating</h2>
                </div>
                <div className="flex gap-2 sm:gap-4 h-full items-start">
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
