import React from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';

const ErrorLog = ({ errors, setErrors }) => {
    const addError = () => {
        setErrors([...errors, { question: '', mistake: '', correctLogic: '' }]);
    };

    const removeError = (index) => {
        const newErrors = errors.filter((_, i) => i !== index);
        setErrors(newErrors);
    };

    const updateError = (index, field, value) => {
        const newErrors = [...errors];
        newErrors[index][field] = value;
        setErrors(newErrors);
    };

    return (
        <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
            <div className="mb-3 sm:mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <AlertCircle className="text-app-accent-error" size={18} />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Error Log</h2>
                </div>
                <button
                    onClick={addError}
                    className="flex items-center gap-1 rounded-md bg-app-bg px-3 py-1.5 text-sm font-medium text-app-text-muted hover:bg-app-border transition-colors border border-app-border"
                >
                    <Plus size={16} /> Add Log
                </button>
            </div>

            <div className="space-y-3 sm:space-y-4">
                {errors.map((error, index) => (
                    <div key={index} className="relative grid gap-3 sm:gap-4 rounded-lg border border-app-border bg-app-bg/50 p-3 sm:p-4 grid-cols-1 sm:grid-cols-3">
                        <button
                            onClick={() => removeError(index)}
                            className="absolute -right-2 -top-2 rounded-full bg-app-surface border border-app-border p-1 text-app-text-muted shadow-sm hover:text-app-accent-error sm:hidden"
                        >
                            <Trash2 size={16} />
                        </button>

                        <div className="space-y-1">
                            <label className="text-[10px] sm:text-xs font-semibold uppercase text-app-text-muted">Question</label>
                            <textarea
                                value={error.question}
                                onChange={(e) => updateError(index, 'question', e.target.value)}
                                rows={2}
                                className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                                placeholder="Topic details..."
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] sm:text-xs font-semibold uppercase text-app-text-muted">Mistake</label>
                            <textarea
                                value={error.mistake}
                                onChange={(e) => updateError(index, 'mistake', e.target.value)}
                                rows={2}
                                className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                                placeholder="What went wrong?"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] sm:text-xs font-semibold uppercase text-app-text-muted">Correct Logic</label>
                            <div className="flex gap-2">
                                <textarea
                                    value={error.correctLogic}
                                    onChange={(e) => updateError(index, 'correctLogic', e.target.value)}
                                    rows={2}
                                    className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                                    placeholder="Key take-away..."
                                />
                                <button
                                    onClick={() => removeError(index)}
                                    className="hidden h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-surface hover:text-app-accent-error hover:shadow-sm sm:flex transition-colors border border-transparent hover:border-app-border"
                                    title="Remove log"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {errors.length === 0 && (
                    <div className="flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-app-border text-app-text-muted">
                        <span className="text-sm">No errors logged today! Great job.</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ErrorLog;
