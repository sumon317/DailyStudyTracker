import {
    Archive,
    ArrowUpDown,
    FileText,
    LayoutGrid,
    List,
    ListChecks,
    Plus,
    Search,
    StickyNote,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import NoteCard from '../components/notes/NoteCard';
import NoteEditor from '../components/notes/NoteEditor';
import { subscribeToDataImported } from '../services/dataImportEvents';
import {
    createEmptyNote,
    duplicateNote,
    filterAndSortNotes,
    isNoteEmpty,
    readNotePreferences,
    readStoredLabels,
    readStoredNotes,
    writeNotePreferences,
    writeStoredLabels,
    writeStoredNotes,
} from '../services/notesService';
import type {
    Note,
    NoteFolder,
    NoteSortDirection,
    NoteSortField,
    NotesPageProps,
    NoteType,
    NoteViewMode,
} from '../types';

const NotesPage = ({ notes: externalNotes, setNotes: setExternalNotes }: NotesPageProps = {}) => {
    const [internalNotes, setInternalNotes] = useState<Note[]>(() => externalNotes ?? readStoredNotes());
    const notes = externalNotes !== undefined && setExternalNotes !== undefined ? externalNotes : internalNotes;

    const updateNotes = useCallback(
        (updater: Note[] | ((prev: Note[]) => Note[])) => {
            if (setExternalNotes) {
                setExternalNotes((prev) => {
                    const next = typeof updater === 'function' ? updater(prev) : updater;
                    writeStoredNotes(next);
                    return next;
                });
            } else {
                setInternalNotes((prev) => {
                    const next = typeof updater === 'function' ? updater(prev) : updater;
                    writeStoredNotes(next);
                    return next;
                });
            }
        },
        [setExternalNotes],
    );

    const [customLabels, setCustomLabels] = useState<string[]>(() => readStoredLabels(notes));
    const [activeFolder, setActiveFolder] = useState<NoteFolder>('notes');
    const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [statusBanner, setStatusBanner] = useState<string | null>(null);

    const initialPrefs = useMemo(() => readNotePreferences(), []);
    const [viewMode, setViewMode] = useState<NoteViewMode>(initialPrefs.viewMode);
    const [sortField, setSortField] = useState<NoteSortField>(initialPrefs.sortField);
    const [sortDirection, setSortDirection] = useState<NoteSortDirection>(initialPrefs.sortDirection);

    useEffect(() => {
        return subscribeToDataImported(() => {
            const reloaded = readStoredNotes();
            setInternalNotes(reloaded);
            setCustomLabels(readStoredLabels(reloaded));
        });
    }, []);

    useEffect(() => {
        writeNotePreferences({ viewMode, sortField, sortDirection });
    }, [viewMode, sortField, sortDirection]);

    const availableLabels = useMemo(() => {
        const merged = new Set<string>(customLabels);
        for (const note of notes) {
            for (const label of note.labels) {
                if (label.trim()) {
                    merged.add(label.trim());
                }
            }
        }
        return [...merged].sort((a, b) => a.localeCompare(b));
    }, [customLabels, notes]);

    const handleCreateLabel = useCallback((label: string) => {
        const cleaned = label.trim();
        if (!cleaned) {
            return;
        }
        setCustomLabels((prev) => {
            const next = [...new Set([...prev, cleaned])].sort((a, b) => a.localeCompare(b));
            writeStoredLabels(next);
            return next;
        });
    }, []);

    const handleCreateNote = (type: NoteType) => {
        const defaultLabels = selectedLabel ? [selectedLabel] : [];
        const created = createEmptyNote(type, defaultLabels);
        updateNotes((prev) => [created, ...prev]);
        setActiveFolder('notes');
        setActiveNoteId(created.id);
    };

    const handleCloseEditor = () => {
        if (activeNoteId) {
            const current = notes.find((entry) => entry.id === activeNoteId);
            if (current && isNoteEmpty(current)) {
                updateNotes((prev) => prev.filter((entry) => entry.id !== activeNoteId));
            }
        }
        setActiveNoteId(null);
    };

    const handleUpdateNote = useCallback(
        (updated: Note) => {
            updateNotes((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        },
        [updateNotes],
    );

    const handleTogglePin = (noteId: string) => {
        updateNotes((prev) =>
            prev.map((note) =>
                note.id === noteId ? { ...note, pinned: !note.pinned, updatedAt: new Date().toISOString() } : note,
            ),
        );
    };

    const handleArchiveToggle = (noteId: string) => {
        updateNotes((prev) =>
            prev.map((note) => {
                if (note.id !== noteId) {
                    return note;
                }
                const nextFolder: NoteFolder = note.folder === 'archived' ? 'notes' : 'archived';
                return {
                    ...note,
                    folder: nextFolder,
                    pinned: false,
                    updatedAt: new Date().toISOString(),
                };
            }),
        );
    };

    const handleMoveToTrash = (noteId: string) => {
        updateNotes((prev) =>
            prev.map((note) =>
                note.id === noteId
                    ? { ...note, folder: 'trash', pinned: false, updatedAt: new Date().toISOString() }
                    : note,
            ),
        );
        if (activeNoteId === noteId) {
            setActiveNoteId(null);
        }
    };

    const handleRestoreFromTrash = (noteId: string) => {
        updateNotes((prev) =>
            prev.map((note) =>
                note.id === noteId ? { ...note, folder: 'notes', updatedAt: new Date().toISOString() } : note,
            ),
        );
    };

    const handleDeletePermanently = (noteId: string) => {
        updateNotes((prev) => prev.filter((note) => note.id !== noteId));
        if (activeNoteId === noteId) {
            setActiveNoteId(null);
        }
    };

    const handleEmptyTrash = () => {
        updateNotes((prev) => prev.filter((note) => note.folder !== 'trash'));
        setStatusBanner('Trash emptied');
    };

    const handleDuplicateNote = (note: Note) => {
        const copy = duplicateNote(note);
        updateNotes((prev) => [copy, ...prev]);
        setActiveNoteId(copy.id);
        setStatusBanner('Created copy of note');
    };

    const activeNote = useMemo(
        () => (activeNoteId ? (notes.find((entry) => entry.id === activeNoteId) ?? null) : null),
        [activeNoteId, notes],
    );

    const visibleNotes = useMemo(
        () =>
            filterAndSortNotes(notes, {
                folder: activeFolder,
                searchQuery,
                selectedLabel,
                sortField,
                sortDirection,
            }),
        [activeFolder, notes, searchQuery, selectedLabel, sortDirection, sortField],
    );

    const pinnedNotes = useMemo(
        () => (activeFolder === 'notes' ? visibleNotes.filter((note) => note.pinned) : []),
        [activeFolder, visibleNotes],
    );

    const unpinnedNotes = useMemo(
        () => (activeFolder === 'notes' ? visibleNotes.filter((note) => !note.pinned) : visibleNotes),
        [activeFolder, visibleNotes],
    );

    const folderCounts = useMemo(() => {
        let activeCount = 0;
        let archivedCount = 0;
        let trashCount = 0;
        for (const note of notes) {
            if (note.folder === 'notes') {
                activeCount += 1;
            } else if (note.folder === 'archived') {
                archivedCount += 1;
            } else if (note.folder === 'trash') {
                trashCount += 1;
            }
        }
        return { notes: activeCount, archived: archivedCount, trash: trashCount };
    }, [notes]);

    return (
        <section className="space-y-6 pb-8" aria-labelledby="notes-page-title">
            <h1 id="notes-page-title" className="sr-only">
                Notes
            </h1>

            {/* Header & Quick Create Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-app-border bg-app-surface/70 p-4 sm:p-5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-app-primary/15 text-app-primary">
                        <StickyNote size={22} aria-hidden="true" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-app-text-main">Study Notes</h2>
                        <p className="text-xs text-app-text-muted">
                            Rich notes, task lists with subtasks, labels & color organization
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleCreateNote('text')}
                        className="inline-flex items-center gap-2 rounded-xl bg-app-primary px-4 py-2.5 text-sm font-semibold text-app-primary-fg shadow-md shadow-app-primary/20 hover:opacity-95 transition-all"
                    >
                        <Plus size={16} aria-hidden="true" />
                        <FileText size={16} aria-hidden="true" />
                        <span>New Note</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleCreateNote('list')}
                        className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-bg/70 px-4 py-2.5 text-sm font-semibold text-app-text-main hover:border-app-primary hover:text-app-primary transition-all"
                    >
                        <ListChecks size={16} aria-hidden="true" />
                        <span>New Task List</span>
                    </button>
                </div>
            </div>

            {statusBanner && (
                <div
                    role="status"
                    className="flex items-center justify-between rounded-xl border border-app-primary/30 bg-app-primary/10 px-4 py-2 text-xs font-medium text-app-text-main"
                >
                    <span>{statusBanner}</span>
                    <button
                        type="button"
                        onClick={() => setStatusBanner(null)}
                        aria-label="Dismiss notification"
                        className="p-1 text-app-text-muted hover:text-app-text-main"
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            )}

            {/* Inbuilt Note Editor */}
            {activeNote ? (
                <NoteEditor
                    note={activeNote}
                    availableLabels={availableLabels}
                    onChange={handleUpdateNote}
                    onClose={handleCloseEditor}
                    onCreateLabel={handleCreateLabel}
                    onDuplicate={handleDuplicateNote}
                    onDeletePermanently={handleDeletePermanently}
                    onNotify={(msg) => setStatusBanner(msg)}
                />
            ) : (
                <>
                    {/* Folder Navigation, Search Bar, Sort & View Controls */}
                    <div className="space-y-3 rounded-2xl border border-app-border bg-app-surface/50 p-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            {/* Folders: Notes, Archived, Trash */}
                            <fieldset
                                aria-label="Note folders"
                                className="flex items-center gap-1.5 rounded-xl bg-app-bg/60 p-1 border border-app-border/60"
                            >
                                {(
                                    [
                                        { id: 'notes', label: 'Notes', icon: StickyNote, count: folderCounts.notes },
                                        {
                                            id: 'archived',
                                            label: 'Archived',
                                            icon: Archive,
                                            count: folderCounts.archived,
                                        },
                                        { id: 'trash', label: 'Trash', icon: Trash2, count: folderCounts.trash },
                                    ] as const
                                ).map(({ id, label, icon: Icon, count }) => {
                                    const selected = activeFolder === id;
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => setActiveFolder(id)}
                                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                                selected
                                                    ? 'bg-app-primary text-app-primary-fg shadow-sm'
                                                    : 'text-app-text-muted hover:text-app-text-main'
                                            }`}
                                        >
                                            <Icon size={14} aria-hidden="true" />
                                            <span>{label}</span>
                                            <span
                                                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                                                    selected
                                                        ? 'bg-app-primary-fg/20 text-app-primary-fg'
                                                        : 'bg-app-surface text-app-text-muted'
                                                }`}
                                            >
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </fieldset>

                            {/* Search + Sort + Grid/List Toggle */}
                            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                                <div className="relative flex-1 min-w-[180px] max-w-md">
                                    <Search
                                        size={15}
                                        aria-hidden="true"
                                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted"
                                    />
                                    <input
                                        type="search"
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        placeholder="Search notes, tasks, or #labels..."
                                        aria-label="Search notes"
                                        className="w-full rounded-xl border border-app-border bg-app-bg/70 pl-9 pr-8 py-2 text-xs sm:text-sm text-app-text-main placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery('')}
                                            aria-label="Clear search"
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-text-muted hover:text-app-text-main"
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>

                                <label className="sr-only" htmlFor="notes-sort-select">
                                    Sort notes by
                                </label>
                                <select
                                    id="notes-sort-select"
                                    value={sortField}
                                    onChange={(event) => setSortField(event.target.value as NoteSortField)}
                                    className="rounded-xl border border-app-border bg-app-bg/70 px-2.5 py-2 text-xs font-medium text-app-text-main focus:outline-none focus:ring-2 focus:ring-app-primary"
                                >
                                    <option value="updatedAt">Modified date</option>
                                    <option value="createdAt">Created date</option>
                                    <option value="title">Title</option>
                                </select>

                                <button
                                    type="button"
                                    onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                    aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                                    className="rounded-xl border border-app-border bg-app-bg/70 p-2 text-app-text-muted hover:text-app-text-main"
                                >
                                    <ArrowUpDown size={15} aria-hidden="true" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'))}
                                    aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                                    className="rounded-xl border border-app-border bg-app-bg/70 p-2 text-app-text-muted hover:text-app-text-main"
                                >
                                    {viewMode === 'grid' ? (
                                        <List size={15} aria-hidden="true" />
                                    ) : (
                                        <LayoutGrid size={15} aria-hidden="true" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Label Filter Chips */}
                        {availableLabels.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-app-border/50">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-app-text-muted mr-1">
                                    <Tag size={12} aria-hidden="true" />
                                    <span>Labels:</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedLabel(null)}
                                    aria-pressed={selectedLabel === null}
                                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                                        selectedLabel === null
                                            ? 'bg-app-primary text-app-primary-fg shadow-sm'
                                            : 'bg-app-bg/60 text-app-text-muted hover:text-app-text-main'
                                    }`}
                                >
                                    All
                                </button>
                                {availableLabels.map((label) => {
                                    const active = selectedLabel === label;
                                    return (
                                        <button
                                            key={label}
                                            type="button"
                                            onClick={() => setSelectedLabel(active ? null : label)}
                                            aria-pressed={active}
                                            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                                                active
                                                    ? 'bg-app-primary text-app-primary-fg shadow-sm'
                                                    : 'bg-app-bg/60 text-app-text-muted hover:text-app-text-main'
                                            }`}
                                        >
                                            #{label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {activeFolder === 'trash' && folderCounts.trash > 0 && (
                        <div className="flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs sm:text-sm text-app-text-main">
                            <span>Notes in Trash can be restored or deleted permanently.</span>
                            <button
                                type="button"
                                onClick={handleEmptyTrash}
                                className="rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 transition-colors"
                            >
                                Empty Trash
                            </button>
                        </div>
                    )}

                    {/* Notes Grid / List */}
                    {visibleNotes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-app-border bg-app-surface/30 py-14 px-4 text-center">
                            <StickyNote size={40} aria-hidden="true" className="mb-3 text-app-text-muted/60" />
                            <h3 className="text-base font-bold text-app-text-main">
                                {searchQuery || selectedLabel
                                    ? 'No matching notes found'
                                    : activeFolder === 'archived'
                                      ? 'No archived notes'
                                      : activeFolder === 'trash'
                                        ? 'Trash is empty'
                                        : 'No study notes yet'}
                            </h3>
                            <p className="mt-1 max-w-md text-xs sm:text-sm text-app-text-muted">
                                {activeFolder === 'notes' && !searchQuery && !selectedLabel
                                    ? 'Create a rich text note for formulas & summaries, or a task list note with subtasks.'
                                    : 'Try adjusting your search or switching folders.'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {pinnedNotes.length > 0 && (
                                <section aria-label="Pinned notes" className="space-y-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-app-text-muted px-1">
                                        Pinned
                                    </h3>
                                    <div
                                        className={
                                            viewMode === 'grid'
                                                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
                                                : 'space-y-3'
                                        }
                                    >
                                        {pinnedNotes.map((note) => (
                                            <NoteCard
                                                key={note.id}
                                                note={note}
                                                searchQuery={searchQuery}
                                                onOpen={setActiveNoteId}
                                                onTogglePin={handleTogglePin}
                                                onArchiveToggle={handleArchiveToggle}
                                                onMoveToTrash={handleMoveToTrash}
                                                onRestoreFromTrash={handleRestoreFromTrash}
                                                onDeletePermanently={handleDeletePermanently}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {unpinnedNotes.length > 0 && (
                                <section
                                    aria-label={pinnedNotes.length > 0 ? 'Other notes' : 'Notes list'}
                                    className="space-y-3"
                                >
                                    {pinnedNotes.length > 0 && (
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-app-text-muted px-1">
                                            Others
                                        </h3>
                                    )}
                                    <div
                                        className={
                                            viewMode === 'grid'
                                                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
                                                : 'space-y-3'
                                        }
                                    >
                                        {unpinnedNotes.map((note) => (
                                            <NoteCard
                                                key={note.id}
                                                note={note}
                                                searchQuery={searchQuery}
                                                onOpen={setActiveNoteId}
                                                onTogglePin={handleTogglePin}
                                                onArchiveToggle={handleArchiveToggle}
                                                onMoveToTrash={handleMoveToTrash}
                                                onRestoreFromTrash={handleRestoreFromTrash}
                                                onDeletePermanently={handleDeletePermanently}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
};

export default NotesPage;
