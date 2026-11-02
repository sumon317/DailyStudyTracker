import type { Note, NoteColor, NoteFolder, NoteSortDirection, NoteSortField, NoteTaskItem, NoteType } from '../types';

export const NOTES_STORAGE_KEY = 'study_notes_v1';
export const NOTE_LABELS_STORAGE_KEY = 'study_note_labels_v1';
export const NOTE_PREFERENCES_STORAGE_KEY = 'study_note_preferences_v1';

export interface NoteColorConfig {
    id: NoteColor;
    label: string;
    swatchClass: string;
    cardClass: string;
}

const DEFAULT_NOTE_COLOR_CONFIG: NoteColorConfig = {
    id: 'default',
    label: 'Default',
    swatchClass: 'bg-app-surface border-app-border text-app-text-main',
    cardClass: 'bg-app-surface/90 border-app-border',
};

export const NOTE_COLORS: readonly NoteColorConfig[] = [
    DEFAULT_NOTE_COLOR_CONFIG,
    {
        id: 'coral',
        label: 'Coral',
        swatchClass: 'bg-rose-400 dark:bg-rose-500 border-rose-500 dark:border-rose-400',
        cardClass: 'bg-rose-100/90 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800/60',
    },
    {
        id: 'orange',
        label: 'Peach',
        swatchClass: 'bg-orange-400 dark:bg-orange-500 border-orange-500 dark:border-orange-400',
        cardClass: 'bg-orange-100/90 dark:bg-orange-950/60 border-orange-300 dark:border-orange-800/60',
    },
    {
        id: 'sand',
        label: 'Sand',
        swatchClass: 'bg-amber-400 dark:bg-amber-500 border-amber-500 dark:border-amber-400',
        cardClass: 'bg-amber-100/90 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800/60',
    },
    {
        id: 'mint',
        label: 'Mint',
        swatchClass: 'bg-emerald-400 dark:bg-emerald-500 border-emerald-500 dark:border-emerald-400',
        cardClass: 'bg-emerald-100/90 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800/60',
    },
    {
        id: 'sage',
        label: 'Sage',
        swatchClass: 'bg-teal-400 dark:bg-teal-500 border-teal-500 dark:border-teal-400',
        cardClass: 'bg-teal-100/90 dark:bg-teal-950/60 border-teal-300 dark:border-teal-800/60',
    },
    {
        id: 'fog',
        label: 'Fog',
        swatchClass: 'bg-cyan-400 dark:bg-cyan-500 border-cyan-500 dark:border-cyan-400',
        cardClass: 'bg-cyan-100/90 dark:bg-cyan-950/60 border-cyan-300 dark:border-cyan-800/60',
    },
    {
        id: 'storm',
        label: 'Storm',
        swatchClass: 'bg-sky-400 dark:bg-sky-500 border-sky-500 dark:border-sky-400',
        cardClass: 'bg-sky-100/90 dark:bg-sky-950/60 border-sky-300 dark:border-sky-800/60',
    },
    {
        id: 'dusk',
        label: 'Dusk',
        swatchClass: 'bg-indigo-400 dark:bg-indigo-500 border-indigo-500 dark:border-indigo-400',
        cardClass: 'bg-indigo-100/90 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800/60',
    },
    {
        id: 'blossom',
        label: 'Blossom',
        swatchClass: 'bg-fuchsia-400 dark:bg-fuchsia-500 border-fuchsia-500 dark:border-fuchsia-400',
        cardClass: 'bg-fuchsia-100/90 dark:bg-fuchsia-950/60 border-fuchsia-300 dark:border-fuchsia-800/60',
    },
    {
        id: 'clay',
        label: 'Clay',
        swatchClass: 'bg-stone-400 dark:bg-stone-500 border-stone-500 dark:border-stone-400',
        cardClass: 'bg-stone-200/90 dark:bg-stone-900/70 border-stone-300 dark:border-stone-700/60',
    },
    {
        id: 'chalk',
        label: 'Chalk',
        swatchClass: 'bg-slate-400 dark:bg-slate-500 border-slate-500 dark:border-slate-400',
        cardClass: 'bg-slate-200/90 dark:bg-slate-900/70 border-slate-300 dark:border-slate-700/60',
    },
] as const;

const VALID_COLORS = new Set<NoteColor>(NOTE_COLORS.map((entry) => entry.id));
const VALID_FOLDERS = new Set<NoteFolder>(['notes', 'archived', 'trash']);
const VALID_TYPES = new Set<NoteType>(['text', 'list']);

let idCounter = 0;

export const createNoteId = (prefix = 'note'): string => {
    idCounter += 1;
    return `${prefix}-${Date.now()}-${idCounter}`;
};

export const getNoteColorConfig = (color: NoteColor): NoteColorConfig => {
    return NOTE_COLORS.find((entry) => entry.id === color) ?? DEFAULT_NOTE_COLOR_CONFIG;
};

export const createEmptyTaskItem = (text = '', isChild = false): NoteTaskItem => ({
    id: createNoteId('item'),
    text,
    checked: false,
    isChild,
});

export const createEmptyNote = (type: NoteType = 'text', defaultLabels: string[] = []): Note => {
    const now = new Date().toISOString();
    return {
        id: createNoteId('note'),
        type,
        title: '',
        body: '',
        items: type === 'list' ? [createEmptyTaskItem()] : [],
        color: 'default',
        labels: [...new Set(defaultLabels.map((label) => label.trim()).filter(Boolean))],
        pinned: false,
        folder: 'notes',
        autoSortChecked: true,
        createdAt: now,
        updatedAt: now,
    };
};

export const normalizeTaskHierarchy = (items: NoteTaskItem[]): NoteTaskItem[] => {
    let seenParent = false;
    return items.map((item) => {
        if (!item.isChild) {
            seenParent = true;
            return { ...item, isChild: false };
        }
        if (!seenParent) {
            seenParent = true;
            return { ...item, isChild: false };
        }
        return { ...item };
    });
};

const sanitizeTaskItems = (rawItems: unknown): NoteTaskItem[] => {
    if (!Array.isArray(rawItems)) {
        return [];
    }
    const items: NoteTaskItem[] = [];
    for (const candidate of rawItems) {
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }
        const record = candidate as Record<string, unknown>;
        const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : createNoteId('item');
        const text = typeof record.text === 'string' ? record.text : '';
        const checked = Boolean(record.checked);
        const isChild = Boolean(record.isChild);
        items.push({ id, text, checked, isChild });
    }
    return normalizeTaskHierarchy(items);
};

export const sanitizeNote = (candidate: unknown): Note | null => {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }
    const record = candidate as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : createNoteId('note');
    const type: NoteType =
        typeof record.type === 'string' && VALID_TYPES.has(record.type as NoteType)
            ? (record.type as NoteType)
            : 'text';
    const title = typeof record.title === 'string' ? record.title : '';
    const body = typeof record.body === 'string' ? record.body : '';
    const color: NoteColor =
        typeof record.color === 'string' && VALID_COLORS.has(record.color as NoteColor)
            ? (record.color as NoteColor)
            : 'default';
    const folder: NoteFolder =
        typeof record.folder === 'string' && VALID_FOLDERS.has(record.folder as NoteFolder)
            ? (record.folder as NoteFolder)
            : 'notes';
    const labels: string[] = Array.isArray(record.labels)
        ? [
              ...new Set(
                  record.labels
                      .filter((entry): entry is string => typeof entry === 'string')
                      .map((entry) => entry.trim())
                      .filter(Boolean),
              ),
          ]
        : [];
    const now = new Date().toISOString();
    const createdAt = typeof record.createdAt === 'string' && record.createdAt.length > 0 ? record.createdAt : now;
    const updatedAt =
        typeof record.updatedAt === 'string' && record.updatedAt.length > 0 ? record.updatedAt : createdAt;

    return {
        id,
        type,
        title,
        body,
        items: sanitizeTaskItems(record.items),
        color,
        labels,
        pinned: Boolean(record.pinned),
        folder,
        autoSortChecked: record.autoSortChecked === undefined ? true : Boolean(record.autoSortChecked),
        createdAt,
        updatedAt,
    };
};

export const readStoredNotes = (): Note[] => {
    try {
        const raw = localStorage.getItem(NOTES_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        const valid: Note[] = [];
        const seenIds = new Set<string>();
        for (const entry of parsed) {
            const note = sanitizeNote(entry);
            if (note && !seenIds.has(note.id)) {
                seenIds.add(note.id);
                valid.push(note);
            }
        }
        return valid;
    } catch {
        return [];
    }
};

export const writeStoredNotes = (notes: Note[]): boolean => {
    try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
        return true;
    } catch {
        return false;
    }
};

export const readStoredLabels = (notes: Note[] = []): string[] => {
    const collected = new Set<string>();
    try {
        const raw = localStorage.getItem(NOTE_LABELS_STORAGE_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (typeof item === 'string' && item.trim().length > 0) {
                        collected.add(item.trim());
                    }
                }
            }
        }
    } catch {
        // Ignore storage read errors
    }
    for (const note of notes) {
        for (const label of note.labels) {
            if (label.trim().length > 0) {
                collected.add(label.trim());
            }
        }
    }
    return [...collected].sort((first, second) => first.localeCompare(second));
};

export const writeStoredLabels = (labels: string[]): void => {
    try {
        const normalized = [...new Set(labels.map((label) => label.trim()).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b),
        );
        localStorage.setItem(NOTE_LABELS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore storage write errors
    }
};

export interface NotePreferences {
    viewMode: 'grid' | 'list';
    sortField: NoteSortField;
    sortDirection: NoteSortDirection;
}

const DEFAULT_PREFERENCES: NotePreferences = {
    viewMode: 'grid',
    sortField: 'updatedAt',
    sortDirection: 'desc',
};

export const readNotePreferences = (): NotePreferences => {
    try {
        const raw = localStorage.getItem(NOTE_PREFERENCES_STORAGE_KEY);
        if (!raw) {
            return DEFAULT_PREFERENCES;
        }
        const parsed = JSON.parse(raw) as Partial<NotePreferences>;
        return {
            viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
            sortField:
                parsed.sortField === 'createdAt' || parsed.sortField === 'title' ? parsed.sortField : 'updatedAt',
            sortDirection: parsed.sortDirection === 'asc' ? 'asc' : 'desc',
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
};

export const writeNotePreferences = (prefs: NotePreferences): void => {
    try {
        localStorage.setItem(NOTE_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Ignore storage write errors
    }
};

/**
 * Converts a note between NotallyX Text mode and Task List mode without losing content.
 * - Text -> List: splits non-empty lines into task items (leading spaces or `- ` create subtasks).
 * - List -> Text: joins task items into lines (subtasks are indented with two spaces).
 */
export const convertNoteType = (note: Note, targetType: NoteType): Note => {
    if (note.type === targetType) {
        return note;
    }
    const now = new Date().toISOString();
    if (targetType === 'list') {
        const rawLines = note.body.split(/\r?\n/);
        const items: NoteTaskItem[] = [];
        for (const rawLine of rawLines) {
            if (rawLine.trim().length === 0) {
                continue;
            }
            const isIndented = /^(?:\s{2,}|\t)/.test(rawLine);
            const checkboxMatch = /^\s*(?:[-*]\s*)?\[([ xX])\]\s*(.*)$/.exec(rawLine);
            if (checkboxMatch) {
                items.push({
                    id: createNoteId('item'),
                    text: checkboxMatch[2] ?? '',
                    checked: (checkboxMatch[1] ?? '').toLowerCase() === 'x',
                    isChild: isIndented && items.length > 0,
                });
            } else {
                const cleaned = rawLine.replace(/^\s*[-*]\s+/, '').trim();
                items.push({
                    id: createNoteId('item'),
                    text: cleaned,
                    checked: false,
                    isChild: isIndented && items.length > 0,
                });
            }
        }
        return {
            ...note,
            type: 'list',
            body: '',
            items: items.length > 0 ? normalizeTaskHierarchy(items) : [createEmptyTaskItem()],
            updatedAt: now,
        };
    }

    const lines = note.items
        .filter((item) => item.text.trim().length > 0)
        .map((item) => `${item.isChild ? '  - ' : ''}${item.text}`);
    return {
        ...note,
        type: 'text',
        body: lines.join('\n'),
        items: [],
        updatedAt: now,
    };
};

/**
 * Toggles a task item's checked state using NotallyX parent/subtask cascading rules:
 * - Toggling a parent item cascades its new `checked` state to all of its immediate subtasks.
 * - Toggling a subtask updates its parent to `checked: true` when all subtasks are checked,
 *   or `checked: false` when any subtask is unchecked.
 */
export const toggleTaskItemChecked = (items: NoteTaskItem[], itemId: string): NoteTaskItem[] => {
    const normalized = normalizeTaskHierarchy(items);
    const index = normalized.findIndex((entry) => entry.id === itemId);
    if (index === -1) {
        return normalized;
    }
    const target = normalized[index];
    if (!target) {
        return normalized;
    }
    const nextChecked = !target.checked;
    const updated = normalized.map((item) => ({ ...item }));
    const updatedTarget = updated[index];
    if (updatedTarget) {
        updatedTarget.checked = nextChecked;
    }

    if (!target.isChild) {
        for (let cursor = index + 1; cursor < updated.length; cursor += 1) {
            const child = updated[cursor];
            if (!child?.isChild) {
                break;
            }
            child.checked = nextChecked;
        }
        return updated;
    }

    let parentIndex = index - 1;
    while (parentIndex >= 0 && updated[parentIndex]?.isChild) {
        parentIndex -= 1;
    }
    if (parentIndex >= 0) {
        const parent = updated[parentIndex];
        if (parent) {
            let allChildrenChecked = true;
            for (let cursor = parentIndex + 1; cursor < updated.length; cursor += 1) {
                const sibling = updated[cursor];
                if (!sibling?.isChild) {
                    break;
                }
                if (!sibling.checked) {
                    allChildrenChecked = false;
                    break;
                }
            }
            parent.checked = allChildrenChecked;
        }
    }
    return updated;
};

export const indentTaskItem = (items: NoteTaskItem[], itemId: string): NoteTaskItem[] => {
    const normalized = normalizeTaskHierarchy(items);
    const index = normalized.findIndex((entry) => entry.id === itemId);
    if (index <= 0) {
        return normalized;
    }
    const updated = normalized.map((entry, idx) => (idx === index ? { ...entry, isChild: true } : { ...entry }));
    return normalizeTaskHierarchy(updated);
};

export const unindentTaskItem = (items: NoteTaskItem[], itemId: string): NoteTaskItem[] => {
    const normalized = normalizeTaskHierarchy(items);
    const index = normalized.findIndex((entry) => entry.id === itemId);
    if (index === -1) {
        return normalized;
    }
    const updated = normalized.map((entry, idx) => (idx === index ? { ...entry, isChild: false } : { ...entry }));
    return normalizeTaskHierarchy(updated);
};

interface TaskGroup {
    parent: NoteTaskItem;
    children: NoteTaskItem[];
}

export const groupTaskItems = (items: NoteTaskItem[]): TaskGroup[] => {
    const normalized = normalizeTaskHierarchy(items);
    const groups: TaskGroup[] = [];
    for (const item of normalized) {
        if (!item.isChild || groups.length === 0) {
            groups.push({ parent: { ...item, isChild: false }, children: [] });
        } else {
            const currentGroup = groups[groups.length - 1];
            if (currentGroup) {
                currentGroup.children.push({ ...item, isChild: true });
            }
        }
    }
    return groups;
};

export const flattenTaskGroups = (groups: TaskGroup[]): NoteTaskItem[] => {
    const result: NoteTaskItem[] = [];
    for (const group of groups) {
        result.push({ ...group.parent, isChild: false });
        for (const child of group.children) {
            result.push({ ...child, isChild: true });
        }
    }
    return result;
};

export const moveTaskItem = (items: NoteTaskItem[], itemId: string, direction: 'up' | 'down'): NoteTaskItem[] => {
    const normalized = normalizeTaskHierarchy(items);
    const index = normalized.findIndex((entry) => entry.id === itemId);
    if (index === -1) {
        return normalized;
    }
    const target = normalized[index];
    if (!target) {
        return normalized;
    }

    if (target.isChild) {
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        const neighbor = normalized[swapIndex];
        if (!neighbor?.isChild) {
            return normalized;
        }
        const copy = normalized.map((entry) => ({ ...entry }));
        const currentItem = copy[index];
        const neighborItem = copy[swapIndex];
        if (currentItem && neighborItem) {
            copy[index] = neighborItem;
            copy[swapIndex] = currentItem;
        }
        return copy;
    }

    const groups = groupTaskItems(normalized);
    const groupIndex = groups.findIndex((group) => group.parent.id === itemId);
    if (groupIndex === -1) {
        return normalized;
    }
    const targetGroupIndex = direction === 'up' ? groupIndex - 1 : groupIndex + 1;
    if (targetGroupIndex < 0 || targetGroupIndex >= groups.length) {
        return normalized;
    }
    const currentGroup = groups[groupIndex];
    const swapGroup = groups[targetGroupIndex];
    if (currentGroup && swapGroup) {
        groups[groupIndex] = swapGroup;
        groups[targetGroupIndex] = currentGroup;
    }
    return flattenTaskGroups(groups);
};

export const uncheckAllTaskItems = (items: NoteTaskItem[]): NoteTaskItem[] =>
    normalizeTaskHierarchy(items).map((item) => ({ ...item, checked: false }));

export const checkAllTaskItems = (items: NoteTaskItem[]): NoteTaskItem[] =>
    normalizeTaskHierarchy(items).map((item) => ({ ...item, checked: true }));

export const deleteCheckedTaskItems = (items: NoteTaskItem[]): NoteTaskItem[] => {
    const remaining = normalizeTaskHierarchy(items).filter((item) => !item.checked);
    return remaining.length > 0 ? remaining : [createEmptyTaskItem()];
};

export const partitionTaskItems = (
    items: NoteTaskItem[],
    autoSortChecked: boolean,
): { activeItems: NoteTaskItem[]; checkedItems: NoteTaskItem[] } => {
    const normalized = normalizeTaskHierarchy(items);
    if (!autoSortChecked) {
        return { activeItems: normalized, checkedItems: [] };
    }
    const groups = groupTaskItems(normalized);
    const activeGroups: TaskGroup[] = [];
    const checkedGroups: TaskGroup[] = [];

    for (const group of groups) {
        const allChildrenChecked = group.children.every((child) => child.checked);
        if (group.parent.checked && allChildrenChecked) {
            checkedGroups.push(group);
        } else {
            activeGroups.push(group);
        }
    }

    return {
        activeItems: flattenTaskGroups(activeGroups),
        checkedItems: flattenTaskGroups(checkedGroups),
    };
};

// ---------------------------------------------------------------------------
// Text Formatting & Tokenization (NotallyX Rich Text & Link Support)
// ---------------------------------------------------------------------------

export type InlineFormatType = 'bold' | 'italic' | 'strikethrough' | 'code' | 'link' | 'clear';

export interface FormattedSelectionResult {
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

export const applyInlineFormatting = (
    text: string,
    selectionStart: number,
    selectionEnd: number,
    format: InlineFormatType,
    linkUrl = 'https://',
): FormattedSelectionResult => {
    const start = Math.max(0, Math.min(selectionStart, text.length));
    const end = Math.max(start, Math.min(selectionEnd, text.length));
    const before = text.slice(0, start);
    const selected = text.slice(start, end);
    const after = text.slice(end);

    if (format === 'clear') {
        const stripped = (selected || text)
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
        if (selected.length > 0) {
            return {
                text: `${before}${stripped}${after}`,
                selectionStart: start,
                selectionEnd: start + stripped.length,
            };
        }
        return {
            text: stripped,
            selectionStart: 0,
            selectionEnd: stripped.length,
        };
    }

    if (format === 'link') {
        const label = selected || 'link text';
        const inserted = `[${label}](${linkUrl})`;
        return {
            text: `${before}${inserted}${after}`,
            selectionStart: start + 1,
            selectionEnd: start + 1 + label.length,
        };
    }

    const markers: Record<Exclude<InlineFormatType, 'link' | 'clear'>, string> = {
        bold: '**',
        italic: '*',
        strikethrough: '~~',
        code: '`',
    };
    const marker = markers[format];
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
        const unwrapped = selected.slice(marker.length, selected.length - marker.length);
        return {
            text: `${before}${unwrapped}${after}`,
            selectionStart: start,
            selectionEnd: start + unwrapped.length,
        };
    }

    const content = selected || format;
    const wrapped = `${marker}${content}${marker}`;
    return {
        text: `${before}${wrapped}${after}`,
        selectionStart: start + marker.length,
        selectionEnd: start + marker.length + content.length,
    };
};

export type RichTextSpan =
    | { type: 'text'; content: string }
    | { type: 'bold'; content: string }
    | { type: 'italic'; content: string }
    | { type: 'strikethrough'; content: string }
    | { type: 'code'; content: string }
    | { type: 'link'; label: string; href: string };

const TOKEN_PATTERN =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*|(https?:\/\/[^\s<]+[^<.,:;"')\]\s])|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(\+?\d[\d\s()-]{6,}\d))/g;

export const tokenizeRichText = (input: string): RichTextSpan[] => {
    if (!input) {
        return [];
    }
    const spans: RichTextSpan[] = [];
    let lastIndex = 0;
    const regex = new RegExp(TOKEN_PATTERN.source, 'g');
    let match = regex.exec(input);

    while (match !== null) {
        if (match.index > lastIndex) {
            spans.push({ type: 'text', content: input.slice(lastIndex, match.index) });
        }
        if (match[2] !== undefined && match[3] !== undefined) {
            spans.push({ type: 'link', label: match[2], href: match[3] });
        } else if (match[4] !== undefined) {
            spans.push({ type: 'bold', content: match[4] });
        } else if (match[5] !== undefined) {
            spans.push({ type: 'strikethrough', content: match[5] });
        } else if (match[6] !== undefined) {
            spans.push({ type: 'code', content: match[6] });
        } else if (match[7] !== undefined) {
            spans.push({ type: 'italic', content: match[7] });
        } else if (match[8] !== undefined) {
            spans.push({ type: 'link', label: match[8], href: match[8] });
        } else if (match[9] !== undefined) {
            spans.push({ type: 'link', label: match[9], href: `mailto:${match[9]}` });
        } else if (match[10] !== undefined) {
            const digits = match[10].replace(/[^\d+]/g, '');
            spans.push({ type: 'link', label: match[10], href: `tel:${digits}` });
        }
        lastIndex = regex.lastIndex;
        match = regex.exec(input);
    }

    if (lastIndex < input.length) {
        spans.push({ type: 'text', content: input.slice(lastIndex) });
    }
    return spans;
};

// ---------------------------------------------------------------------------
// Search, Filter, Sort & Stats
// ---------------------------------------------------------------------------

export const getNotePlainText = (note: Note): string => {
    if (note.type === 'list') {
        return note.items.map((item) => item.text).join('\n');
    }
    return note.body;
};

export const getNoteStats = (
    note: Note,
): { words: number; characters: number; checkedCount: number; totalCount: number } => {
    const plain = `${note.title} ${getNotePlainText(note)}`.trim();
    const characters = getNotePlainText(note).length;
    const words = plain.length === 0 ? 0 : plain.split(/\s+/).filter(Boolean).length;
    const checkedCount = note.items.filter((item) => item.checked).length;
    const totalCount = note.items.length;
    return { words, characters, checkedCount, totalCount };
};

export const isNoteEmpty = (note: Note): boolean => {
    if (note.title.trim().length > 0) {
        return false;
    }
    if (note.type === 'text') {
        return note.body.trim().length === 0;
    }
    return note.items.every((item) => item.text.trim().length === 0);
};

export interface FilterNotesOptions {
    folder: NoteFolder;
    searchQuery?: string;
    selectedLabel?: string | null;
    sortField?: NoteSortField;
    sortDirection?: NoteSortDirection;
}

export const filterAndSortNotes = (notes: Note[], options: FilterNotesOptions): Note[] => {
    const query = (options.searchQuery ?? '').trim().toLowerCase();
    const labelFilter = options.selectedLabel ?? null;
    const sortField = options.sortField ?? 'updatedAt';
    const sortDirection = options.sortDirection ?? 'desc';

    const filtered = notes.filter((note) => {
        if (note.folder !== options.folder) {
            return false;
        }
        if (labelFilter && !note.labels.includes(labelFilter)) {
            return false;
        }
        if (!query) {
            return true;
        }
        const titleMatch = note.title.toLowerCase().includes(query);
        const bodyMatch = getNotePlainText(note).toLowerCase().includes(query);
        const labelMatch = note.labels.some((label) => label.toLowerCase().includes(query));
        return titleMatch || bodyMatch || labelMatch;
    });

    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

    return [...filtered].sort((first, second) => {
        if (sortField === 'title') {
            const firstTitle = (first.title || 'Untitled').toLowerCase();
            const secondTitle = (second.title || 'Untitled').toLowerCase();
            return firstTitle.localeCompare(secondTitle) * directionMultiplier;
        }
        const firstValue = first[sortField];
        const secondValue = second[sortField];
        return firstValue.localeCompare(secondValue) * directionMultiplier;
    });
};

export const formatNoteForExport = (note: Note, format: 'txt' | 'md' | 'json'): string => {
    if (format === 'json') {
        return JSON.stringify(note, null, 2);
    }
    const titleHeader = note.title.trim() || 'Untitled Note';
    const labelsLine = note.labels.length > 0 ? `Labels: ${note.labels.map((label) => `#${label}`).join(' ')}\n\n` : '';
    if (note.type === 'list') {
        const listLines = note.items
            .map((item) => `${item.isChild ? '  ' : ''}- [${item.checked ? 'x' : ' '}] ${item.text}`)
            .join('\n');
        return format === 'md'
            ? `# ${titleHeader}\n\n${labelsLine}${listLines}\n`
            : `${titleHeader}\n${'='.repeat(titleHeader.length)}\n\n${labelsLine}${listLines}\n`;
    }
    return format === 'md'
        ? `# ${titleHeader}\n\n${labelsLine}${note.body}\n`
        : `${titleHeader}\n${'='.repeat(titleHeader.length)}\n\n${labelsLine}${note.body}\n`;
};

export const duplicateNote = (note: Note): Note => {
    const now = new Date().toISOString();
    return {
        ...note,
        id: createNoteId('note'),
        title: note.title ? `${note.title} (Copy)` : 'Untitled (Copy)',
        items: note.items.map((item) => ({ ...item, id: createNoteId('item') })),
        labels: [...note.labels],
        createdAt: now,
        updatedAt: now,
    };
};
