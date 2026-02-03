import React, { memo, useCallback } from 'react';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';

const ChecklistItem = memo(({ item, onToggle, onUpdateLabel, onRemove }) => (
    <div
        className={`group flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-3 transition-colors ${item.checked
            ? 'border-app-primary/30 bg-app-primary/5'
            : 'border-app-border hover:bg-app-bg'
            }`}
    >
        <input
            type="checkbox"
            checked={item.checked}
            onChange={onToggle}
            className="h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-primary cursor-pointer flex-shrink-0"
        />
        <input
            type="text"
            value={item.label}
            onChange={(e) => onUpdateLabel(e.target.value)}
            placeholder="Type your objective..."
            className={`flex-1 min-w-0 bg-transparent border-none p-0 text-xs sm:text-sm focus:ring-0 focus:outline-none placeholder-app-text-muted/50 ${item.checked ? 'text-app-primary font-medium line-through decoration-app-primary/40' : 'text-app-text-main'}`}
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

ChecklistItem.displayName = 'ChecklistItem';

const Checklist = memo(({ items, setItems }) => {
    const toggleCheck = useCallback((id) => {
        setItems(prevItems => prevItems.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item
        ));
    }, [setItems]);

    const updateLabel = useCallback((id, newLabel) => {
        setItems(prevItems => prevItems.map((item) =>
            item.id === id ? { ...item, label: newLabel } : item
        ));
    }, [setItems]);

    const addItem = useCallback(() => {
        setItems(prev => [
            ...prev,
            { id: Date.now(), label: '', checked: false }
        ]);
    }, [setItems]);

    const removeItem = useCallback((id) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, [setItems]);

    return (
        <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
            <div className="mb-3 sm:mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <CheckSquare className="text-app-primary" size={18} />
                    <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Output Checklist</h2>
                </div>
                <button
                    onClick={addItem}
                    className="flex items-center gap-1 rounded-lg bg-app-primary/10 px-2 py-1 text-xs font-medium text-app-primary hover:bg-app-primary/20 transition-colors"
                >
                    <Plus size={14} /> Add Item
                </button>
            </div>

            {items.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-app-border rounded-lg">
                    <p className="text-sm text-app-text-muted mb-2">Track specific outcomes here</p>
                    <button onClick={addItem} className="text-app-primary text-xs font-medium hover:underline">
                        + Add your first objective
                    </button>
                </div>
            ) : (
                <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                    {items.map((item) => (
                        <ChecklistItem
                            key={item.id}
                            item={item}
                            onToggle={() => toggleCheck(item.id)}
                            onUpdateLabel={(label) => updateLabel(item.id, label)}
                            onRemove={() => removeItem(item.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});

Checklist.displayName = 'Checklist';

export default Checklist;
