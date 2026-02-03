import React from 'react';
import { CheckSquare } from 'lucide-react';

const Checklist = ({ items, setItems }) => {
    const toggleCheck = (id) => {
        const newItems = items.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item
        );
        setItems(newItems);
    };

    const updateLabel = (id, newLabel) => {
        const newItems = items.map((item) =>
            item.id === id ? { ...item, label: newLabel } : item
        );
        setItems(newItems);
    };

    return (
        <div className="rounded-xl border border-app-border bg-app-surface p-4 sm:p-6 shadow-sm">
            <div className="mb-3 sm:mb-4 flex items-center gap-2">
                <CheckSquare className="text-app-primary" size={18} />
                <h2 className="text-base sm:text-lg font-semibold text-app-text-main">Output Checklist</h2>
            </div>
            <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className={`flex items-start gap-2 sm:gap-3 rounded-lg border p-2 sm:p-3 transition-colors ${item.checked
                            ? 'border-app-primary/30 bg-app-primary/5'
                            : 'border-app-border hover:bg-app-bg'
                            }`}
                    >
                        <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => toggleCheck(item.id)}
                            className="mt-0.5 h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-primary cursor-pointer"
                        />
                        <input
                            type="text"
                            value={item.label}
                            onChange={(e) => updateLabel(item.id, e.target.value)}
                            className={`flex-1 bg-transparent border-none p-0 text-xs sm:text-sm focus:ring-0 focus:outline-none ${item.checked ? 'text-app-primary font-medium' : 'text-app-text-muted'}`}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Checklist;

