import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef } from 'react';
import type { ChecklistItemProps, ChecklistProps } from '../../types';
import { reserveRecordId } from '../shared/recordIds';

const MAX_LABEL_LENGTH = 200;
// A free-text objective is a poor accessible name on its own: at the 200
// characters `maxLength` allows, the control is announced faster than it can be
// read. Only as much as tells one row from the next is kept.
const MAX_NAME_IN_LABEL = 60;

// Ids are derived from the record id rather than its position, so they survive a
// removal that renumbers everything below it.
const checkboxDomId = (id: number): string => `checklist-item-${id}-checked`;
const textDomId = (id: number): string => `checklist-item-${id}-label-input`;

const shortenForLabel = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > MAX_NAME_IN_LABEL ? `${trimmed.slice(0, MAX_NAME_IN_LABEL - 1).trimEnd()}…` : trimmed;
};

const ChecklistItem = memo(
    ({ item, index, onToggle, onUpdateLabel, onRemove }: ChecklistItemProps & { index: number }) => {
        // Every row shares the same generic caption, so each control needs a
        // position-scoped name to stay distinguishable to assistive technology.
        const position = index + 1;
        // Whitespace is not a name: a blank row fell back to naming itself by its
        // own text, which reads as nothing at all.
        const describeItem = item.label.trim() ? `“${shortenForLabel(item.label)}”` : `objective ${position}`;

        return (
            <div
                className={`group flex items-center gap-2 rounded-lg border p-3 transition-colors sm:gap-3 sm:p-3 ${
                    item.checked ? 'border-app-primary/30 bg-app-primary/5' : 'border-app-border hover:bg-app-bg'
                }`}
            >
                <input
                    id={checkboxDomId(item.id)}
                    type="checkbox"
                    checked={item.checked}
                    onChange={onToggle}
                    aria-label={`Mark checklist ${describeItem} as ${item.checked ? 'not done' : 'done'}`}
                    className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-app-border text-app-primary focus:ring-app-primary"
                />
                <label htmlFor={textDomId(item.id)} className="sr-only">
                    Checklist objective {position}
                </label>
                <input
                    id={textDomId(item.id)}
                    type="text"
                    maxLength={MAX_LABEL_LENGTH}
                    value={item.label}
                    onChange={(event) => onUpdateLabel(event.target.value)}
                    placeholder="Type your objective..."
                    className={`min-w-0 flex-1 border-none bg-transparent p-0 text-xs focus:outline-none focus:ring-0 placeholder:text-app-text-muted/70 sm:text-sm ${item.checked ? 'font-medium leading-relaxed text-app-primary line-through decoration-app-primary/40' : 'text-app-text-main'}`}
                />
                {/* No hover on touch, so the control stays visible on small screens. */}
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded p-1 text-app-text-muted opacity-100 transition-opacity hover:text-app-accent-error focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-app-primary sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Remove checklist ${describeItem}`}
                >
                    <Trash2 size={14} aria-hidden="true" />
                </button>
            </div>
        );
    },
);

ChecklistItem.displayName = 'ChecklistItem';

const Checklist = memo(({ items, setItems }: ChecklistProps) => {
    const headingId = useId();
    // A counter, not a mirror of the stored ids: `reserveRecordId` checks the
    // ids actually in use, so this only has to stay ahead of its own last
    // result and never has to re-scan the list on every render.
    const lastIdRef = useRef(0);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const pendingFocusIdRef = useRef<number | null>(null);

    // A new row is announced by the field it lands in, so the caret follows the
    // add instead of staying on the button that was just pressed.
    useEffect(() => {
        const pendingId = pendingFocusIdRef.current;
        const added = pendingId === null ? undefined : items.find((item) => item.id === pendingId);
        if (!added) {
            return;
        }
        pendingFocusIdRef.current = null;
        document.getElementById(textDomId(added.id))?.focus();
    }, [items]);

    const toggleCheck = useCallback(
        (id: number) => {
            setItems((prevItems) =>
                prevItems.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
            );
        },
        [setItems],
    );

    const updateLabel = useCallback(
        (id: number, newLabel: string) => {
            setItems((prevItems) => prevItems.map((item) => (item.id === id ? { ...item, label: newLabel } : item)));
        },
        [setItems],
    );

    const addItem = useCallback(() => {
        // The id is reserved before the update so the state updater stays pure.
        const newId = reserveRecordId(
            lastIdRef.current,
            items.map((item) => item.id),
        );
        lastIdRef.current = newId;
        pendingFocusIdRef.current = newId;
        setItems((prevItems) => [...prevItems, { id: newId, label: '', checked: false }]);
    }, [items, setItems]);

    const removeItem = useCallback(
        (id: number) => {
            // The pressed control unmounts with its row, so the caret moves to
            // the next row's field instead of collapsing onto <body>. That field
            // already exists, so it can take focus before the row is dropped.
            const removedIndex = items.findIndex((item) => item.id === id);
            const nextId = removedIndex === -1 ? undefined : items[removedIndex + 1]?.id;
            setItems((prevItems) => prevItems.filter((item) => item.id !== id));
            const nextField = nextId === undefined ? null : document.getElementById(textDomId(nextId));
            (nextField ?? addButtonRef.current)?.focus();
        },
        [items, setItems],
    );

    return (
        <section
            className="rounded-xl border border-app-border bg-app-surface p-3 shadow-sm sm:p-5"
            aria-labelledby={headingId}
        >
            <div className="mb-3 flex items-center justify-between sm:mb-4">
                <div className="flex items-center gap-2">
                    <CheckSquare className="text-app-primary" size={18} aria-hidden="true" />
                    <h2 id={headingId} className="text-base font-semibold text-app-text-main sm:text-lg">
                        Output Checklist
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
                <legend className="sr-only">Checklist objectives</legend>
                {items.length === 0 ? (
                    <div className="rounded-lg border-2 border-dashed border-app-border py-6 text-center">
                        <p className="mb-2 text-sm text-app-text-muted">Track specific outcomes here</p>
                        <button
                            type="button"
                            onClick={addItem}
                            className="text-xs font-medium text-app-primary hover:underline focus:outline-none focus:ring-2 focus:ring-app-primary"
                        >
                            + Add your first objective
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        {items.map((item, index) => (
                            <ChecklistItem
                                key={item.id}
                                item={item}
                                index={index}
                                onToggle={() => toggleCheck(item.id)}
                                onUpdateLabel={(label) => updateLabel(item.id, label)}
                                onRemove={() => removeItem(item.id)}
                            />
                        ))}
                    </div>
                )}
            </fieldset>
        </section>
    );
});

Checklist.displayName = 'Checklist';

export default Checklist;
