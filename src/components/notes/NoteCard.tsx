import { Archive, ArchiveRestore, CheckSquare, Pin, RotateCcw, Square, Trash2 } from 'lucide-react';
import { getNoteColorConfig, partitionTaskItems } from '../../services/notesService';
import type { Note } from '../../types';
import RichTextRenderer from './RichTextRenderer';

interface NoteCardProps {
    note: Note;
    searchQuery?: string;
    onOpen: (noteId: string) => void;
    onTogglePin: (noteId: string) => void;
    onArchiveToggle: (noteId: string) => void;
    onMoveToTrash: (noteId: string) => void;
    onRestoreFromTrash: (noteId: string) => void;
    onDeletePermanently: (noteId: string) => void;
}

const MAX_PREVIEW_ITEMS = 6;

export default function NoteCard({
    note,
    searchQuery,
    onOpen,
    onTogglePin,
    onArchiveToggle,
    onMoveToTrash,
    onRestoreFromTrash,
    onDeletePermanently,
}: NoteCardProps) {
    const colorConfig = getNoteColorConfig(note.color);
    const { activeItems, checkedItems } = partitionTaskItems(note.items, note.autoSortChecked);
    const visibleItems = activeItems.slice(0, MAX_PREVIEW_ITEMS);
    const hiddenActiveCount = Math.max(0, activeItems.length - visibleItems.length);
    const formattedDate = new Date(note.updatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    });

    return (
        <article
            className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 hover:shadow-lg ${colorConfig.cardClass}`}
        >
            <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => onOpen(note.id)}
                        className="flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary rounded-lg min-w-0"
                    >
                        <h3 className="font-bold text-base text-app-text-main break-words [overflow-wrap:anywhere]">
                            {note.title.trim() || 'Untitled note'}
                        </h3>
                    </button>
                    {note.folder !== 'trash' && (
                        <button
                            type="button"
                            onClick={() => onTogglePin(note.id)}
                            aria-label={note.pinned ? `Unpin ${note.title || 'note'}` : `Pin ${note.title || 'note'}`}
                            aria-pressed={note.pinned}
                            className={`rounded-lg p-1.5 transition-colors ${
                                note.pinned
                                    ? 'bg-app-primary/15 text-app-primary'
                                    : 'text-app-text-muted hover:bg-app-bg/60 hover:text-app-text-main'
                            }`}
                        >
                            <Pin size={15} aria-hidden="true" className={note.pinned ? 'fill-current' : ''} />
                        </button>
                    )}
                </div>

                <div className="text-left text-sm text-app-text-muted rounded-lg">
                    {note.type === 'text' ? (
                        note.body.trim().length > 0 ? (
                            <div className="text-app-text-main/90 break-words [overflow-wrap:anywhere]">
                                <RichTextRenderer text={note.body} highlightQuery={searchQuery} />
                            </div>
                        ) : (
                            <p className="italic text-app-text-muted">Empty text note</p>
                        )
                    ) : (
                        <div className="space-y-1.5">
                            {visibleItems.map((item) => (
                                <div key={item.id} className={`flex items-start gap-2 ${item.isChild ? 'pl-5' : ''}`}>
                                    {item.checked ? (
                                        <CheckSquare
                                            size={15}
                                            aria-hidden="true"
                                            className="mt-0.5 shrink-0 text-app-primary"
                                        />
                                    ) : (
                                        <Square
                                            size={15}
                                            aria-hidden="true"
                                            className="mt-0.5 shrink-0 text-app-text-muted"
                                        />
                                    )}
                                    <span
                                        className={`break-words whitespace-normal min-w-0 flex-1 [overflow-wrap:anywhere] ${
                                            item.checked ? 'line-through text-app-text-muted' : 'text-app-text-main/90'
                                        }`}
                                    >
                                        {item.text || 'List item'}
                                    </span>
                                </div>
                            ))}
                            {hiddenActiveCount > 0 && (
                                <p className="text-xs font-medium text-app-text-muted">
                                    +{hiddenActiveCount} more {hiddenActiveCount === 1 ? 'item' : 'items'}
                                </p>
                            )}
                            {checkedItems.length > 0 && (
                                <p className="pt-1 text-xs font-medium text-app-text-muted">
                                    +{checkedItems.length} checked {checkedItems.length === 1 ? 'item' : 'items'}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-4 pt-2 border-t border-app-border/50 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    {note.labels.map((label) => (
                        <span
                            key={label}
                            className="rounded-md bg-app-bg/70 px-2 py-0.5 text-[11px] font-medium text-app-text-main border border-app-border/60"
                        >
                            #{label}
                        </span>
                    ))}
                    <span className="text-[11px] text-app-text-muted">{formattedDate}</span>
                </div>

                <div className="flex items-center gap-1">
                    {note.folder === 'trash' ? (
                        <>
                            <button
                                type="button"
                                onClick={() => onRestoreFromTrash(note.id)}
                                aria-label={`Restore ${note.title || 'note'}`}
                                className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-bg/60 hover:text-app-primary transition-colors"
                            >
                                <RotateCcw size={15} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onDeletePermanently(note.id)}
                                aria-label={`Delete ${note.title || 'note'} permanently`}
                                className="rounded-lg p-1.5 text-app-text-muted hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
                            >
                                <Trash2 size={15} aria-hidden="true" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => onArchiveToggle(note.id)}
                                aria-label={
                                    note.folder === 'archived'
                                        ? `Unarchive ${note.title || 'note'}`
                                        : `Archive ${note.title || 'note'}`
                                }
                                className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-bg/60 hover:text-app-text-main transition-colors"
                            >
                                {note.folder === 'archived' ? (
                                    <ArchiveRestore size={15} aria-hidden="true" />
                                ) : (
                                    <Archive size={15} aria-hidden="true" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => onMoveToTrash(note.id)}
                                aria-label={`Move ${note.title || 'note'} to trash`}
                                className="rounded-lg p-1.5 text-app-text-muted hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
                            >
                                <Trash2 size={15} aria-hidden="true" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
