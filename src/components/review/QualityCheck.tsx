import { Award, Plus, Sun, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef } from 'react';
import type { QualityCheckItemCompProps, QualityCheckProps, RatingOptionProps } from '../../types';
import { reserveRecordId } from '../shared/recordIds';

const MAX_LABEL_LENGTH = 200;
// A free-text criterion is a poor accessible name on its own: at the 200
// characters `maxLength` allows, the control is announced faster than it can be
// read. Only as much as tells one row from the next is kept.
const MAX_NAME_IN_LABEL = 60;

const checkboxDomId = (id: number): string => `quality-check-${id}-checked`;
const textDomId = (id: number): string => `quality-check-${id}-text`;

const shortenForLabel = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > MAX_NAME_IN_LABEL ? `${trimmed.slice(0, MAX_NAME_IN_LABEL - 1).trimEnd()}…` : trimmed;
};

const QualityCheckItem = memo(
    ({ check, index, onToggle, onUpdateLabel, onRemove }: QualityCheckItemCompProps & { index: number }) => {
        // Each row is captioned by position so duplicate criteria stay distinct
        // for assistive technology instead of sharing one generic name.
        const position = index + 1;
        // Whitespace is not a name: a blank row fell back to naming itself by its
        // own text, which reads as nothing at all.
        const describeCheck = check.label.trim() ? `“${shortenForLabel(check.label)}”` : `criterion ${position}`;

        return (
            <div className="group flex items-center gap-3">
                <input
                    id={checkboxDomId(check.id)}
                    type="checkbox"
                    checked={check.checked}
                    onChange={onToggle}
                    aria-label={`Mark quality ${describeCheck} as ${check.checked ? 'not met' : 'met'}`}
                    className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-app-border bg-app-surface text-app-primary focus:ring-app-primary"
                />
                <label htmlFor={textDomId(check.id)} className="sr-only">
                    Quality criterion {position}
                </label>
                <input
                    id={textDomId(check.id)}
                    type="text"
                    maxLength={MAX_LABEL_LENGTH}
                    value={check.label}
                    onChange={(event) => onUpdateLabel(event.target.value)}
                    placeholder="Type your quality criteria..."
                    className={`min-w-0 flex-1 border-none bg-transparent p-0 text-xs focus:outline-none focus:ring-0 placeholder:text-app-text-muted/70 sm:text-sm ${check.checked ? 'text-app-text-muted line-through' : 'text-app-text-main'}`}
                />
                {/* No hover on touch, so the control stays visible on small screens. */}
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded p-1 text-app-text-muted opacity-100 transition-opacity hover:text-app-accent-error focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-app-primary sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Remove quality ${describeCheck}`}
                >
                    <Trash2 size={14} aria-hidden="true" />
                </button>
            </div>
        );
    },
);

QualityCheckItem.displayName = 'QualityCheckItem';

const RatingOption = memo(({ option, isSelected, onSelect, name }: RatingOptionProps & { name: string }) => (
    <label
        className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-xs font-medium transition-all focus-within:ring-2 focus-within:ring-app-primary sm:p-3 sm:text-sm ${
            isSelected
                ? 'border-app-primary bg-app-primary/10 text-app-primary ring-1 ring-app-primary'
                : 'border-app-border text-app-text-muted hover:border-app-primary/50 hover:bg-app-bg'
        }`}
    >
        <input type="radio" name={name} value={option} checked={isSelected} onChange={onSelect} className="sr-only" />
        {option}
    </label>
));

RatingOption.displayName = 'RatingOption';

const RATING_OPTIONS = ['Productive', 'Okayish', 'Unproductive'];

const QualityCheck = memo(({ checks, setChecks, rating, setRating }: QualityCheckProps) => {
    const criteriaHeadingId = useId();
    const ratingHeadingId = useId();
    // A shared radio group name would couple every instance on the page, so the
    // group is scoped to this component.
    const ratingGroupName = useId();
    // See `Checklist`: the allocator checks the ids in use, so this ref only
    // has to remember the last id it handed out.
    const lastIdRef = useRef(0);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const pendingFocusIdRef = useRef<number | null>(null);

    // A new row is announced by the field it lands in, so the caret follows the
    // add instead of staying on the button that was just pressed.
    useEffect(() => {
        const pendingId = pendingFocusIdRef.current;
        const added = pendingId === null ? undefined : checks.find((check) => check.id === pendingId);
        if (!added) {
            return;
        }
        pendingFocusIdRef.current = null;
        document.getElementById(textDomId(added.id))?.focus();
    }, [checks]);

    const toggleCheck = useCallback(
        (id: number) => {
            setChecks((prevChecks) =>
                prevChecks.map((check) => (check.id === id ? { ...check, checked: !check.checked } : check)),
            );
        },
        [setChecks],
    );

    const updateLabel = useCallback(
        (id: number, newLabel: string) => {
            setChecks((prevChecks) =>
                prevChecks.map((check) => (check.id === id ? { ...check, label: newLabel } : check)),
            );
        },
        [setChecks],
    );

    const addItem = useCallback(() => {
        // The id is reserved before the update so the state updater stays pure.
        const newId = reserveRecordId(
            lastIdRef.current,
            checks.map((check) => check.id),
        );
        lastIdRef.current = newId;
        pendingFocusIdRef.current = newId;
        setChecks((prevChecks) => [...prevChecks, { id: newId, label: '', checked: false }]);
    }, [checks, setChecks]);

    const removeItem = useCallback(
        (id: number) => {
            // The pressed control unmounts with its row, so the caret moves to
            // the next row's field instead of collapsing onto <body>. That field
            // already exists, so it can take focus before the row is dropped.
            const removedIndex = checks.findIndex((check) => check.id === id);
            const nextId = removedIndex === -1 ? undefined : checks[removedIndex + 1]?.id;
            setChecks((prevChecks) => prevChecks.filter((check) => check.id !== id));
            const nextField = nextId === undefined ? null : document.getElementById(textDomId(nextId));
            (nextField ?? addButtonRef.current)?.focus();
        },
        [checks, setChecks],
    );

    const handleRatingChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            setRating(event.target.value);
        },
        [setRating],
    );

    return (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
            <section
                className="rounded-xl border border-app-border bg-app-surface p-3 shadow-sm sm:p-6"
                aria-labelledby={criteriaHeadingId}
            >
                <div className="mb-3 flex items-center justify-between sm:mb-4">
                    <div className="flex items-center gap-2">
                        <Award className="text-app-primary" size={18} aria-hidden="true" />
                        <h2 id={criteriaHeadingId} className="text-base font-semibold text-app-text-main sm:text-lg">
                            Quality Check
                        </h2>
                    </div>
                    <button
                        ref={addButtonRef}
                        type="button"
                        onClick={addItem}
                        className="flex items-center gap-1 rounded-lg bg-app-primary/10 px-2 py-1 text-xs font-medium text-app-primary transition-colors hover:bg-app-primary/20 focus:outline-none focus:ring-2 focus:ring-app-primary"
                    >
                        <Plus size={14} aria-hidden="true" /> Add Item
                    </button>
                </div>

                <fieldset>
                    <legend className="sr-only">Quality criteria</legend>
                    {checks.length === 0 ? (
                        <div className="rounded-lg border-2 border-dashed border-app-border py-4 text-center">
                            <p className="mb-1 text-xs text-app-text-muted">Define your daily standards</p>
                            <button
                                type="button"
                                onClick={addItem}
                                className="text-xs font-medium text-app-primary hover:underline focus:outline-none focus:ring-2 focus:ring-app-primary"
                            >
                                + Add quality criteria
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {checks.map((check, index) => (
                                <QualityCheckItem
                                    key={check.id}
                                    check={check}
                                    index={index}
                                    onToggle={() => toggleCheck(check.id)}
                                    onUpdateLabel={(label) => updateLabel(check.id, label)}
                                    onRemove={() => removeItem(check.id)}
                                />
                            ))}
                        </div>
                    )}
                </fieldset>
            </section>

            <section
                className="rounded-xl border border-app-border bg-app-surface p-3 shadow-sm sm:p-6"
                aria-labelledby={ratingHeadingId}
            >
                <div className="mb-3 flex items-center gap-2 sm:mb-4">
                    <Sun className="text-app-accent-warning" size={18} aria-hidden="true" />
                    <h2 id={ratingHeadingId} className="text-base font-semibold text-app-text-main sm:text-lg">
                        Day Rating
                    </h2>
                </div>
                <fieldset>
                    <legend className="sr-only">Choose a day rating</legend>
                    <div className="flex h-full items-start gap-2 sm:gap-4">
                        {RATING_OPTIONS.map((option) => (
                            <RatingOption
                                key={option}
                                name={ratingGroupName}
                                option={option}
                                isSelected={rating === option}
                                onSelect={handleRatingChange}
                            />
                        ))}
                    </div>
                </fieldset>
            </section>
        </div>
    );
});

QualityCheck.displayName = 'QualityCheck';

export default QualityCheck;
