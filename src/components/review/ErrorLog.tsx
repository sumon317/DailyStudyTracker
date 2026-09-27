import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef } from 'react';
import type { ErrorLogEntry, ErrorLogItemProps, ErrorLogProps } from '../../types';
import { reserveRecordId } from '../shared/recordIds';

const MAX_FIELD_LENGTH = 2000;

const questionDomId = (id: number): string => `error-question-${id}`;
const mistakeDomId = (id: number): string => `error-mistake-${id}`;
const logicDomId = (id: number): string => `error-logic-${id}`;

const ErrorLogItem = memo(({ error, index, onUpdate, onRemove }: ErrorLogItemProps) => {
    const recordId = String(error.id);
    const titleId = `error-log-record-${recordId}`;
    // Field ids follow the record id, so typing never moves a label off its field.
    const questionId = questionDomId(error.id);
    const mistakeId = mistakeDomId(error.id);
    const logicId = logicDomId(error.id);

    return (
        <article
            className="relative grid grid-cols-1 gap-3 rounded-lg border border-app-border bg-app-bg/50 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4"
            aria-labelledby={titleId}
        >
            <h3 id={titleId} className="sr-only">
                Error log {index + 1}
            </h3>
            <button
                type="button"
                onClick={onRemove}
                className="absolute -right-2 -top-2 rounded-full border border-app-border bg-app-surface p-1 text-app-text-muted shadow-sm hover:text-app-accent-error focus:outline-none focus:ring-2 focus:ring-app-primary sm:hidden"
                aria-label={`Remove error log ${index + 1}`}
            >
                <Trash2 size={16} aria-hidden="true" />
            </button>

            <div className="space-y-1">
                <label
                    htmlFor={questionId}
                    className="text-[10px] font-semibold uppercase text-app-text-muted sm:text-xs"
                >
                    Question
                </label>
                <textarea
                    id={questionId}
                    maxLength={MAX_FIELD_LENGTH}
                    value={error.question}
                    onChange={(event) => onUpdate('question', event.target.value)}
                    rows={2}
                    className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                    placeholder="Topic details..."
                />
            </div>
            <div className="space-y-1">
                <label
                    htmlFor={mistakeId}
                    className="text-[10px] font-semibold uppercase text-app-text-muted sm:text-xs"
                >
                    Mistake
                </label>
                <textarea
                    id={mistakeId}
                    maxLength={MAX_FIELD_LENGTH}
                    value={error.mistake}
                    onChange={(event) => onUpdate('mistake', event.target.value)}
                    rows={2}
                    className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                    placeholder="What went wrong?"
                />
            </div>
            <div className="space-y-1">
                <label htmlFor={logicId} className="text-[10px] font-semibold uppercase text-app-text-muted sm:text-xs">
                    Correct Logic
                </label>
                <div className="flex gap-2">
                    <textarea
                        id={logicId}
                        maxLength={MAX_FIELD_LENGTH}
                        value={error.correctLogic}
                        onChange={(event) => onUpdate('correctLogic', event.target.value)}
                        rows={2}
                        className="block w-full rounded-md border border-app-border bg-app-surface text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-app-primary"
                        placeholder="Key take-away..."
                    />
                    <button
                        type="button"
                        onClick={onRemove}
                        className="hidden h-8 w-8 items-center justify-center rounded-lg border border-transparent text-app-text-muted transition-colors hover:border-app-border hover:bg-app-surface hover:text-app-accent-error hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-app-primary sm:flex"
                        aria-label={`Remove error log ${index + 1}`}
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </article>
    );
});

ErrorLogItem.displayName = 'ErrorLogItem';

const ErrorLog = memo(({ errors, setErrors }: ErrorLogProps) => {
    const headingId = useId();
    // See `Checklist`: the allocator checks the ids in use, so this ref only has
    // to remember the last id it handed out.
    const lastIdRef = useRef(0);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const pendingFocusIdRef = useRef<number | null>(null);

    // A new record is announced by the first field it lands in, so the caret
    // follows the add instead of staying on the button that was just pressed.
    useEffect(() => {
        const pendingId = pendingFocusIdRef.current;
        const added = pendingId === null ? undefined : errors.find((error) => error.id === pendingId);
        if (!added) {
            return;
        }
        pendingFocusIdRef.current = null;
        document.getElementById(questionDomId(added.id))?.focus();
    }, [errors]);

    const addError = useCallback(() => {
        // The id is reserved before the update so the state updater stays pure.
        const newId = reserveRecordId(
            lastIdRef.current,
            errors.map((error) => error.id),
        );
        lastIdRef.current = newId;
        pendingFocusIdRef.current = newId;
        setErrors((prev) => [...prev, { id: newId, question: '', mistake: '', correctLogic: '' }]);
    }, [errors, setErrors]);

    const removeError = useCallback(
        (id: number) => {
            // The pressed control unmounts with its record, so the caret moves
            // to the next record's first field instead of collapsing onto
            // <body>. That field already exists, so it can take focus first.
            const removedIndex = errors.findIndex((error) => error.id === id);
            const nextId = removedIndex === -1 ? undefined : errors[removedIndex + 1]?.id;
            setErrors((prev) => prev.filter((error) => error.id !== id));
            const nextField = nextId === undefined ? null : document.getElementById(questionDomId(nextId));
            (nextField ?? addButtonRef.current)?.focus();
        },
        [errors, setErrors],
    );

    const updateError = useCallback(
        (id: number, field: keyof ErrorLogEntry, value: string) => {
            setErrors((prev) => prev.map((error) => (error.id === id ? { ...error, [field]: value } : error)));
        },
        [setErrors],
    );

    return (
        <section
            className="rounded-xl border border-app-border bg-app-surface p-3 shadow-sm sm:p-6"
            aria-labelledby={headingId}
        >
            <div className="mb-3 flex items-center justify-between sm:mb-4">
                <div className="flex items-center gap-2">
                    <AlertCircle className="text-app-accent-error" size={18} aria-hidden="true" />
                    <h2 id={headingId} className="text-base font-semibold text-app-text-main sm:text-lg">
                        Error Log
                    </h2>
                </div>
                <button
                    ref={addButtonRef}
                    type="button"
                    onClick={addError}
                    className="flex items-center gap-1 rounded-md border border-app-border bg-app-bg px-3 py-1.5 text-sm font-medium text-app-text-muted transition-colors hover:border-app-border focus:outline-none focus:ring-2 focus:ring-app-primary"
                >
                    <Plus size={16} aria-hidden="true" /> Add Log
                </button>
            </div>

            <div className="space-y-3 sm:space-y-4">
                {errors.map((error, index) => (
                    <ErrorLogItem
                        key={error.id}
                        error={error}
                        index={index}
                        onUpdate={(field, value) => updateError(error.id, field, value)}
                        onRemove={() => removeError(error.id)}
                    />
                ))}

                {errors.length === 0 && (
                    <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-app-border text-app-text-muted">
                        <span className="text-sm">No errors logged today! Great job.</span>
                        {/* The checklist and quality panels both offer a way in
                            from their empty state; this one had none, so the
                            only add control was the header button. */}
                        <button
                            type="button"
                            onClick={addError}
                            className="rounded text-xs font-medium text-app-primary hover:underline focus:outline-none focus:ring-2 focus:ring-app-primary"
                        >
                            + Add your first error log
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
});

ErrorLog.displayName = 'ErrorLog';

export default ErrorLog;
