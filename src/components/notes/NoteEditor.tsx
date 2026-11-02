import {
    Archive,
    ArchiveRestore,
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    Bold,
    Check,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Code,
    Copy,
    Download,
    Eye,
    IndentDecrease,
    IndentIncrease,
    Italic,
    Link2,
    ListChecks,
    MoreVertical,
    Palette,
    Pencil,
    Pin,
    Plus,
    Redo2,
    RemoveFormatting,
    Search,
    Square,
    Strikethrough,
    Tag,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { InlineFormatType } from '../../services/notesService';
import {
    applyInlineFormatting,
    checkAllTaskItems,
    convertNoteType,
    createEmptyTaskItem,
    deleteCheckedTaskItems,
    formatNoteForExport,
    getNoteColorConfig,
    getNotePlainText,
    getNoteStats,
    indentTaskItem,
    moveTaskItem,
    NOTE_COLORS,
    partitionTaskItems,
    toggleTaskItemChecked,
    uncheckAllTaskItems,
    unindentTaskItem,
} from '../../services/notesService';
import type { Note, NoteColor, NoteTaskItem } from '../../types';
import RichTextRenderer from './RichTextRenderer';

interface NoteEditorProps {
    note: Note;
    availableLabels: string[];
    onChange: (updated: Note) => void;
    onClose: () => void;
    onCreateLabel: (label: string) => void;
    onDuplicate: (note: Note) => void;
    onDeletePermanently?: (noteId: string) => void;
    onNotify?: (message: string) => void;
}

interface EditorSnapshot {
    title: string;
    body: string;
    items: NoteTaskItem[];
}

const MAX_UNDO_HISTORY = 1000;

export default function NoteEditor({
    note,
    availableLabels,
    onChange,
    onClose,
    onCreateLabel,
    onDuplicate,
    onDeletePermanently,
    onNotify,
}: NoteEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
    const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showLabelPicker, setShowLabelPicker] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showFindBar, setShowFindBar] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [showLinkPrompt, setShowLinkPrompt] = useState(false);
    const [linkUrlInput, setLinkUrlInput] = useState('https://');
    const [newLabelInput, setNewLabelInput] = useState('');
    const [collapsedChecked, setCollapsedChecked] = useState(false);

    const colorConfig = getNoteColorConfig(note.color);
    const stats = getNoteStats(note);
    const { activeItems, checkedItems } = partitionTaskItems(note.items, note.autoSortChecked);

    const recordSnapshotAndApply = useCallback(
        (updater: (current: Note) => Note) => {
            setUndoStack((prev) => {
                const snapshot: EditorSnapshot = {
                    title: note.title,
                    body: note.body,
                    items: note.items.map((item) => ({ ...item })),
                };
                const next = [...prev, snapshot];
                return next.length > MAX_UNDO_HISTORY ? next.slice(next.length - MAX_UNDO_HISTORY) : next;
            });
            setRedoStack([]);
            const updated = updater(note);
            onChange({
                ...updated,
                updatedAt: new Date().toISOString(),
            });
        },
        [note, onChange],
    );

    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) {
            return;
        }
        const previous = undoStack[undoStack.length - 1];
        if (!previous) {
            return;
        }
        setUndoStack((prev) => prev.slice(0, -1));
        setRedoStack((prev) => [
            ...prev,
            {
                title: note.title,
                body: note.body,
                items: note.items.map((item) => ({ ...item })),
            },
        ]);
        onChange({
            ...note,
            title: previous.title,
            body: previous.body,
            items: previous.items,
            updatedAt: new Date().toISOString(),
        });
    }, [note, onChange, undoStack]);

    const handleRedo = useCallback(() => {
        if (redoStack.length === 0) {
            return;
        }
        const nextSnapshot = redoStack[redoStack.length - 1];
        if (!nextSnapshot) {
            return;
        }
        setRedoStack((prev) => prev.slice(0, -1));
        setUndoStack((prev) => [
            ...prev,
            {
                title: note.title,
                body: note.body,
                items: note.items.map((item) => ({ ...item })),
            },
        ]);
        onChange({
            ...note,
            title: nextSnapshot.title,
            body: nextSnapshot.body,
            items: nextSnapshot.items,
            updatedAt: new Date().toISOString(),
        });
    }, [note, onChange, redoStack]);

    const handleFormat = (format: InlineFormatType, customUrl?: string) => {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? note.body.length;
        const end = textarea?.selectionEnd ?? note.body.length;
        const result = applyInlineFormatting(note.body, start, end, format, customUrl);
        recordSnapshotAndApply((current) => ({
            ...current,
            body: result.text,
        }));
        window.setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(result.selectionStart, result.selectionEnd);
            }
        }, 0);
    };

    const handleInsertLink = () => {
        const url = linkUrlInput.trim() || 'https://';
        handleFormat('link', url);
        setShowLinkPrompt(false);
        setLinkUrlInput('https://');
    };

    const handleUpdateTaskText = (itemId: string, text: string) => {
        recordSnapshotAndApply((current) => ({
            ...current,
            items: current.items.map((item) => (item.id === itemId ? { ...item, text } : item)),
        }));
    };

    const handleAddTaskAfter = (afterId?: string, asChild = false) => {
        const newItem = createEmptyTaskItem('', asChild);
        recordSnapshotAndApply((current) => {
            if (!afterId) {
                return {
                    ...current,
                    items: [...current.items, newItem],
                };
            }
            const index = current.items.findIndex((item) => item.id === afterId);
            if (index === -1) {
                return {
                    ...current,
                    items: [...current.items, newItem],
                };
            }
            const nextItems = [...current.items];
            nextItems.splice(index + 1, 0, newItem);
            return {
                ...current,
                items: nextItems,
            };
        });
    };

    const handleRemoveTaskItem = (itemId: string) => {
        recordSnapshotAndApply((current) => {
            const filtered = current.items.filter((item) => item.id !== itemId);
            return {
                ...current,
                items: filtered.length > 0 ? filtered : [createEmptyTaskItem()],
            };
        });
    };

    const handleToggleLabel = (label: string) => {
        const hasLabel = note.labels.includes(label);
        const nextLabels = hasLabel ? note.labels.filter((entry) => entry !== label) : [...note.labels, label];
        onChange({
            ...note,
            labels: nextLabels,
            updatedAt: new Date().toISOString(),
        });
    };

    const handleAddCustomLabel = () => {
        const cleaned = newLabelInput.trim();
        if (!cleaned) {
            return;
        }
        onCreateLabel(cleaned);
        if (!note.labels.includes(cleaned)) {
            onChange({
                ...note,
                labels: [...note.labels, cleaned],
                updatedAt: new Date().toISOString(),
            });
        }
        setNewLabelInput('');
    };

    const handleSelectColor = (color: NoteColor) => {
        onChange({
            ...note,
            color,
            updatedAt: new Date().toISOString(),
        });
    };

    const handleCopyText = async () => {
        const content = `${note.title ? `${note.title}\n\n` : ''}${getNotePlainText(note)}`;
        try {
            await navigator.clipboard?.writeText(content);
            onNotify?.('Copied note to clipboard');
        } catch {
            onNotify?.('Could not access clipboard');
        }
        setShowMoreMenu(false);
    };

    const handleExportFile = (format: 'txt' | 'md' | 'json') => {
        const payload = formatNoteForExport(note, format);
        const mimeType = format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/plain';
        const blob = new Blob([payload], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const safeName = (note.title.trim() || 'note').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
        anchor.href = url;
        anchor.download = `${safeName}.${format}`;
        anchor.click();
        URL.revokeObjectURL(url);
        onNotify?.(`Exported note as .${format}`);
        setShowMoreMenu(false);
    };

    const findMatchCount = (() => {
        const query = findQuery.trim().toLowerCase();
        if (!query) {
            return 0;
        }
        const haystack = `${note.title}\n${getNotePlainText(note)}`.toLowerCase();
        return haystack.split(query).length - 1;
    })();

    return (
        <section
            aria-label="Inbuilt Note Editor"
            className={`rounded-2xl border p-4 sm:p-6 shadow-xl transition-colors ${colorConfig.cardClass}`}
        >
            {/* Top Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-app-border/60">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Back to notes list"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-app-border bg-app-bg/70 px-3 py-2 text-sm font-medium text-app-text-main hover:bg-app-bg transition-colors"
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        <span>Done</span>
                    </button>

                    <div className="flex items-center rounded-xl border border-app-border bg-app-bg/60 p-0.5">
                        <button
                            type="button"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0 || isReadOnly}
                            aria-label="Undo"
                            className="rounded-lg p-1.5 text-app-text-main disabled:opacity-40 hover:bg-app-surface transition-colors"
                        >
                            <Undo2 size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0 || isReadOnly}
                            aria-label="Redo"
                            className="rounded-lg p-1.5 text-app-text-main disabled:opacity-40 hover:bg-app-surface transition-colors"
                        >
                            <Redo2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setIsReadOnly((prev) => !prev)}
                        aria-label={isReadOnly ? 'Switch to edit mode' : 'Switch to read-only view mode'}
                        aria-pressed={isReadOnly}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            isReadOnly
                                ? 'border-app-primary bg-app-primary/15 text-app-primary'
                                : 'border-app-border bg-app-bg/60 text-app-text-muted hover:text-app-text-main'
                        }`}
                    >
                        {isReadOnly ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        <span>{isReadOnly ? 'Edit' : 'View'}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowFindBar((prev) => !prev)}
                        aria-label="Find in note"
                        aria-pressed={showFindBar}
                        className={`rounded-xl border p-2 transition-colors ${
                            showFindBar
                                ? 'border-app-primary bg-app-primary/15 text-app-primary'
                                : 'border-app-border bg-app-bg/60 text-app-text-muted hover:text-app-text-main'
                        }`}
                    >
                        <Search size={16} aria-hidden="true" />
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            onChange({
                                ...note,
                                pinned: !note.pinned,
                                updatedAt: new Date().toISOString(),
                            })
                        }
                        aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                        aria-pressed={note.pinned}
                        className={`rounded-xl border p-2 transition-colors ${
                            note.pinned
                                ? 'border-app-primary bg-app-primary/15 text-app-primary'
                                : 'border-app-border bg-app-bg/60 text-app-text-muted hover:text-app-text-main'
                        }`}
                    >
                        <Pin size={16} aria-hidden="true" className={note.pinned ? 'fill-current' : ''} />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setShowColorPicker((prev) => !prev);
                            setShowLabelPicker(false);
                            setShowMoreMenu(false);
                        }}
                        aria-label="Change note color"
                        aria-expanded={showColorPicker}
                        className="rounded-xl border border-app-border bg-app-bg/60 p-2 text-app-text-muted hover:text-app-text-main transition-colors"
                    >
                        <Palette size={16} aria-hidden="true" />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setShowLabelPicker((prev) => !prev);
                            setShowColorPicker(false);
                            setShowMoreMenu(false);
                        }}
                        aria-label="Manage labels"
                        aria-expanded={showLabelPicker}
                        className="rounded-xl border border-app-border bg-app-bg/60 p-2 text-app-text-muted hover:text-app-text-main transition-colors"
                    >
                        <Tag size={16} aria-hidden="true" />
                    </button>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => {
                                setShowMoreMenu((prev) => !prev);
                                setShowColorPicker(false);
                                setShowLabelPicker(false);
                            }}
                            aria-label="More note actions"
                            aria-expanded={showMoreMenu}
                            className="rounded-xl border border-app-border bg-app-bg/60 p-2 text-app-text-muted hover:text-app-text-main transition-colors"
                        >
                            <MoreVertical size={16} aria-hidden="true" />
                        </button>

                        {showMoreMenu && (
                            <div
                                role="menu"
                                aria-label="Note actions"
                                className="absolute right-0 mt-2 w-60 rounded-2xl border border-app-border bg-app-surface p-2 shadow-2xl z-30 space-y-1"
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        const nextType = note.type === 'text' ? 'list' : 'text';
                                        recordSnapshotAndApply((current) => convertNoteType(current, nextType));
                                        setShowMoreMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                >
                                    <ListChecks size={16} aria-hidden="true" />
                                    <span>
                                        {note.type === 'text' ? 'Convert to task list' : 'Convert to text note'}
                                    </span>
                                </button>

                                {note.type === 'list' && (
                                    <>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onChange({
                                                    ...note,
                                                    autoSortChecked: !note.autoSortChecked,
                                                    updatedAt: new Date().toISOString(),
                                                });
                                                setShowMoreMenu(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                        >
                                            <span>Auto-sort checked items</span>
                                            {note.autoSortChecked && <Check size={15} aria-hidden="true" />}
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: uncheckAllTaskItems(current.items),
                                                }));
                                                setShowMoreMenu(false);
                                            }}
                                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                        >
                                            <Square size={16} aria-hidden="true" />
                                            <span>Uncheck all items</span>
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: checkAllTaskItems(current.items),
                                                }));
                                                setShowMoreMenu(false);
                                            }}
                                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                        >
                                            <CheckSquare size={16} aria-hidden="true" />
                                            <span>Check all items</span>
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: deleteCheckedTaskItems(current.items),
                                                }));
                                                setShowMoreMenu(false);
                                            }}
                                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                            <span>Delete checked items</span>
                                        </button>
                                    </>
                                )}

                                <div className="my-1 border-t border-app-border/60" />

                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        onDuplicate(note);
                                        setShowMoreMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                >
                                    <Copy size={16} aria-hidden="true" />
                                    <span>Make a copy</span>
                                </button>

                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => void handleCopyText()}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                >
                                    <Copy size={16} aria-hidden="true" />
                                    <span>Copy plain text</span>
                                </button>

                                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
                                    Export Note
                                </div>
                                <div className="grid grid-cols-3 gap-1 px-2 pb-1">
                                    {(['md', 'txt', 'json'] as const).map((ext) => (
                                        <button
                                            key={ext}
                                            type="button"
                                            onClick={() => handleExportFile(ext)}
                                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-app-border bg-app-bg/70 py-1.5 text-xs font-medium text-app-text-main hover:bg-app-bg"
                                        >
                                            <Download size={12} aria-hidden="true" />
                                            <span>.{ext}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="my-1 border-t border-app-border/60" />

                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        onChange({
                                            ...note,
                                            folder: note.folder === 'archived' ? 'notes' : 'archived',
                                            updatedAt: new Date().toISOString(),
                                        });
                                        setShowMoreMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-app-text-main hover:bg-app-bg transition-colors"
                                >
                                    {note.folder === 'archived' ? (
                                        <ArchiveRestore size={16} aria-hidden="true" />
                                    ) : (
                                        <Archive size={16} aria-hidden="true" />
                                    )}
                                    <span>{note.folder === 'archived' ? 'Unarchive note' : 'Archive note'}</span>
                                </button>

                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        if (note.folder === 'trash' && onDeletePermanently) {
                                            onDeletePermanently(note.id);
                                        } else {
                                            onChange({
                                                ...note,
                                                folder: 'trash',
                                                pinned: false,
                                                updatedAt: new Date().toISOString(),
                                            });
                                        }
                                        setShowMoreMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                    <span>{note.folder === 'trash' ? 'Delete forever' : 'Move to trash'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Find in Note Bar */}
            {showFindBar && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-app-border bg-app-bg/70 px-3 py-2">
                    <Search size={15} aria-hidden="true" className="text-app-text-muted shrink-0" />
                    <input
                        type="search"
                        value={findQuery}
                        onChange={(event) => setFindQuery(event.target.value)}
                        placeholder="Find in note..."
                        aria-label="Find in note"
                        className="flex-1 bg-transparent text-sm text-app-text-main focus:outline-none"
                    />
                    {findQuery.trim().length > 0 && (
                        <span className="text-xs font-medium text-app-text-muted">
                            {findMatchCount} {findMatchCount === 1 ? 'match' : 'matches'}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            setShowFindBar(false);
                            setFindQuery('');
                        }}
                        aria-label="Close find bar"
                        className="rounded-lg p-1 text-app-text-muted hover:text-app-text-main"
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            )}

            {/* NotallyX 12-Color Palette Selector */}
            {showColorPicker && (
                <fieldset
                    aria-label="Note color palette"
                    className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-bg/70 p-3"
                >
                    {NOTE_COLORS.map((entry) => {
                        const isSelected = note.color === entry.id;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => handleSelectColor(entry.id)}
                                aria-label={`Color ${entry.label}`}
                                aria-pressed={isSelected}
                                className={`flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-transform ${
                                    entry.swatchClass
                                } ${isSelected ? 'scale-110 ring-2 ring-app-primary' : 'hover:scale-105'}`}
                            >
                                {isSelected && (
                                    <Check
                                        size={14}
                                        aria-hidden="true"
                                        className="text-white drop-shadow stroke-[2.5]"
                                    />
                                )}
                            </button>
                        );
                    })}
                </fieldset>
            )}

            {/* Label Manager */}
            {showLabelPicker && (
                <div className="mt-3 rounded-xl border border-app-border bg-app-bg/70 p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {availableLabels.map((label) => {
                            const active = note.labels.includes(label);
                            return (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={() => handleToggleLabel(label)}
                                    aria-pressed={active}
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                        active
                                            ? 'border-app-primary bg-app-primary/15 text-app-primary'
                                            : 'border-app-border bg-app-surface text-app-text-muted hover:text-app-text-main'
                                    }`}
                                >
                                    <span>#{label}</span>
                                    {active && <Check size={12} aria-hidden="true" />}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={newLabelInput}
                            onChange={(event) => setNewLabelInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleAddCustomLabel();
                                }
                            }}
                            placeholder="Create new label..."
                            aria-label="New label name"
                            className="flex-1 rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-xs text-app-text-main focus:outline-none focus:ring-2 focus:ring-app-primary"
                        />
                        <button
                            type="button"
                            onClick={handleAddCustomLabel}
                            className="inline-flex items-center gap-1 rounded-lg bg-app-primary px-3 py-1.5 text-xs font-semibold text-app-primary-fg hover:opacity-90 transition-opacity"
                        >
                            <Plus size={14} aria-hidden="true" />
                            <span>Add Label</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Title and Metadata Header */}
            <div className="mt-4 space-y-2">
                <input
                    type="text"
                    value={note.title}
                    readOnly={isReadOnly}
                    onChange={(event) =>
                        recordSnapshotAndApply((current) => ({
                            ...current,
                            title: event.target.value,
                        }))
                    }
                    placeholder="Title"
                    aria-label="Note title"
                    className="w-full bg-transparent text-xl sm:text-2xl font-bold text-app-text-main placeholder:text-app-text-muted/60 focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-3 text-xs text-app-text-muted">
                    <span>
                        Edited{' '}
                        {new Date(note.updatedAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </span>
                    <span>•</span>
                    {note.type === 'text' ? (
                        <span>
                            {stats.words} {stats.words === 1 ? 'word' : 'words'} ({stats.characters} chars)
                        </span>
                    ) : (
                        <span>
                            {stats.checkedCount}/{stats.totalCount} completed
                        </span>
                    )}
                    {note.labels.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {note.labels.map((label) => (
                                <span
                                    key={label}
                                    className="rounded-md bg-app-bg/70 px-2 py-0.5 text-[11px] font-medium text-app-text-main border border-app-border/60"
                                >
                                    #{label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Text Note Formatting Toolbar & Body */}
            {note.type === 'text' && (
                <div className="mt-4 space-y-3">
                    {!isReadOnly && (
                        <div
                            role="toolbar"
                            aria-label="Text formatting toolbar"
                            className="flex flex-wrap items-center gap-1 rounded-xl border border-app-border bg-app-bg/70 p-1.5"
                        >
                            <button
                                type="button"
                                onClick={() => handleFormat('bold')}
                                aria-label="Bold"
                                className="rounded-lg p-1.5 text-app-text-main hover:bg-app-surface transition-colors"
                            >
                                <Bold size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleFormat('italic')}
                                aria-label="Italic"
                                className="rounded-lg p-1.5 text-app-text-main hover:bg-app-surface transition-colors"
                            >
                                <Italic size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleFormat('strikethrough')}
                                aria-label="Strikethrough"
                                className="rounded-lg p-1.5 text-app-text-main hover:bg-app-surface transition-colors"
                            >
                                <Strikethrough size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleFormat('code')}
                                aria-label="Monospace code"
                                className="rounded-lg p-1.5 text-app-text-main hover:bg-app-surface transition-colors"
                            >
                                <Code size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowLinkPrompt((prev) => !prev)}
                                aria-label="Insert link"
                                aria-pressed={showLinkPrompt}
                                className="rounded-lg p-1.5 text-app-text-main hover:bg-app-surface transition-colors"
                            >
                                <Link2 size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleFormat('clear')}
                                aria-label="Clear formatting"
                                className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-surface hover:text-app-text-main transition-colors"
                            >
                                <RemoveFormatting size={15} aria-hidden="true" />
                            </button>
                        </div>
                    )}

                    {showLinkPrompt && !isReadOnly && (
                        <div className="flex items-center gap-2 rounded-xl border border-app-border bg-app-bg/70 p-2">
                            <input
                                type="url"
                                value={linkUrlInput}
                                onChange={(event) => setLinkUrlInput(event.target.value)}
                                placeholder="https://example.com"
                                aria-label="Link URL"
                                className="flex-1 rounded-lg border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text-main focus:outline-none focus:ring-2 focus:ring-app-primary"
                            />
                            <button
                                type="button"
                                onClick={handleInsertLink}
                                className="rounded-lg bg-app-primary px-3 py-1 text-xs font-semibold text-app-primary-fg hover:opacity-90 transition-opacity"
                            >
                                Insert Link
                            </button>
                        </div>
                    )}

                    {isReadOnly ? (
                        <div className="min-h-[220px] rounded-xl border border-app-border/50 bg-app-surface/40 dark:bg-black/15 backdrop-blur-sm p-4 text-sm text-app-text-main">
                            {note.body.trim().length > 0 ? (
                                <RichTextRenderer text={note.body} highlightQuery={findQuery} />
                            ) : (
                                <p className="italic text-app-text-muted">No content in this note.</p>
                            )}
                        </div>
                    ) : (
                        <>
                            <textarea
                                ref={textareaRef}
                                value={note.body}
                                onChange={(event) =>
                                    recordSnapshotAndApply((current) => ({
                                        ...current,
                                        body: event.target.value,
                                    }))
                                }
                                rows={10}
                                placeholder="Write your study notes here... Supports **bold**, *italic*, ~~strikethrough~~, `monospace`, and [links](https://...)"
                                aria-label="Note content"
                                className="w-full rounded-xl border border-app-border/60 bg-app-surface/50 dark:bg-black/20 backdrop-blur-sm p-3.5 text-sm leading-relaxed text-app-text-main placeholder:text-app-text-muted/60 focus:outline-none focus:ring-2 focus:ring-app-primary resize-y"
                            />

                            {note.body.trim().length > 0 && (
                                <div className="rounded-xl border border-app-border/50 bg-app-surface/40 dark:bg-black/15 backdrop-blur-sm p-3.5 space-y-1.5">
                                    <div className="text-[11px] font-semibold uppercase tracking-wider text-app-text-muted">
                                        Formatted Preview & Clickable Links
                                    </div>
                                    <div className="text-sm text-app-text-main">
                                        <RichTextRenderer text={note.body} highlightQuery={findQuery} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Task List Editor (Subtasks, Indent, Reorder, Auto-sort Checked Section) */}
            {note.type === 'list' && (
                <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                        {activeItems.map((item, idx) => (
                            <div
                                key={item.id}
                                className={`flex items-center gap-1.5 rounded-xl border border-app-border/60 bg-app-surface/50 dark:bg-black/20 backdrop-blur-sm px-2.5 py-2 transition-all ${
                                    item.isChild ? 'ml-6 sm:ml-8 border-dashed' : ''
                                }`}
                            >
                                <button
                                    type="button"
                                    disabled={isReadOnly}
                                    onClick={() =>
                                        recordSnapshotAndApply((current) => ({
                                            ...current,
                                            items: toggleTaskItemChecked(current.items, item.id),
                                        }))
                                    }
                                    aria-label={
                                        item.checked
                                            ? `Mark "${item.text || `Item ${idx + 1}`}" as incomplete`
                                            : `Mark "${item.text || `Item ${idx + 1}`}" as complete`
                                    }
                                    className="p-1 text-app-text-muted hover:text-app-primary disabled:opacity-50"
                                >
                                    {item.checked ? (
                                        <CheckSquare size={18} aria-hidden="true" className="text-app-primary" />
                                    ) : (
                                        <Square size={18} aria-hidden="true" />
                                    )}
                                </button>

                                <input
                                    type="text"
                                    value={item.text}
                                    readOnly={isReadOnly}
                                    onChange={(event) => handleUpdateTaskText(item.id, event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !isReadOnly) {
                                            event.preventDefault();
                                            handleAddTaskAfter(item.id, item.isChild);
                                        }
                                    }}
                                    placeholder={item.isChild ? 'Subtask...' : 'List item...'}
                                    aria-label={item.isChild ? `Subtask ${idx + 1}` : `Task item ${idx + 1}`}
                                    className={`flex-1 bg-transparent text-sm focus:outline-none ${
                                        item.checked ? 'line-through text-app-text-muted' : 'text-app-text-main'
                                    }`}
                                />

                                {!isReadOnly && (
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: item.isChild
                                                        ? unindentTaskItem(current.items, item.id)
                                                        : indentTaskItem(current.items, item.id),
                                                }))
                                            }
                                            aria-label={item.isChild ? 'Unindent subtask' : 'Indent as subtask'}
                                            className="rounded-lg p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text-main"
                                        >
                                            {item.isChild ? (
                                                <IndentDecrease size={14} aria-hidden="true" />
                                            ) : (
                                                <IndentIncrease size={14} aria-hidden="true" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: moveTaskItem(current.items, item.id, 'up'),
                                                }))
                                            }
                                            aria-label="Move item up"
                                            className="rounded-lg p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text-main"
                                        >
                                            <ArrowUp size={14} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                recordSnapshotAndApply((current) => ({
                                                    ...current,
                                                    items: moveTaskItem(current.items, item.id, 'down'),
                                                }))
                                            }
                                            aria-label="Move item down"
                                            className="rounded-lg p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text-main"
                                        >
                                            <ArrowDown size={14} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTaskItem(item.id)}
                                            aria-label="Remove task item"
                                            className="rounded-lg p-1 text-app-text-muted hover:bg-rose-500/15 hover:text-rose-400"
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}

                        {!isReadOnly && (
                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => handleAddTaskAfter(undefined, false)}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-app-border bg-app-bg/40 px-3 py-2 text-xs font-semibold text-app-text-main hover:border-app-primary hover:text-app-primary transition-colors"
                                >
                                    <Plus size={14} aria-hidden="true" />
                                    <span>Add item</span>
                                </button>
                                {activeItems.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            handleAddTaskAfter(activeItems[activeItems.length - 1]?.id, true)
                                        }
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-app-border bg-app-bg/40 px-3 py-2 text-xs font-medium text-app-text-muted hover:border-app-primary hover:text-app-primary transition-colors"
                                    >
                                        <IndentIncrease size={14} aria-hidden="true" />
                                        <span>Add subtask</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Auto-sorted Checked Items Section */}
                    {checkedItems.length > 0 && (
                        <div className="pt-3 border-t border-app-border/60 space-y-2">
                            <button
                                type="button"
                                onClick={() => setCollapsedChecked((prev) => !prev)}
                                aria-expanded={!collapsedChecked}
                                className="flex items-center gap-1.5 text-xs font-semibold text-app-text-muted hover:text-app-text-main"
                            >
                                {collapsedChecked ? (
                                    <ChevronRight size={15} aria-hidden="true" />
                                ) : (
                                    <ChevronDown size={15} aria-hidden="true" />
                                )}
                                <span>Checked items ({checkedItems.length})</span>
                            </button>

                            {!collapsedChecked && (
                                <div className="space-y-1.5">
                                    {checkedItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className={`flex items-center gap-2 rounded-xl border border-app-border/40 bg-app-surface/40 dark:bg-black/15 backdrop-blur-sm px-2.5 py-1.5 ${
                                                item.isChild ? 'ml-6 sm:ml-8' : ''
                                            }`}
                                        >
                                            <button
                                                type="button"
                                                disabled={isReadOnly}
                                                onClick={() =>
                                                    recordSnapshotAndApply((current) => ({
                                                        ...current,
                                                        items: toggleTaskItemChecked(current.items, item.id),
                                                    }))
                                                }
                                                aria-label={`Uncheck "${item.text || 'item'}"`}
                                                className="p-1 text-app-primary disabled:opacity-50"
                                            >
                                                <CheckSquare size={16} aria-hidden="true" />
                                            </button>
                                            <span className="flex-1 text-sm line-through text-app-text-muted">
                                                {item.text || 'Completed item'}
                                            </span>
                                            {!isReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveTaskItem(item.id)}
                                                    aria-label={`Remove checked item "${item.text || 'item'}"`}
                                                    className="rounded-lg p-1 text-app-text-muted hover:text-rose-400"
                                                >
                                                    <X size={14} aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
