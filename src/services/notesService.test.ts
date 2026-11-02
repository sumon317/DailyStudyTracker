import { beforeEach, describe, expect, it } from 'vitest';
import {
    applyInlineFormatting,
    checkAllTaskItems,
    convertNoteType,
    createEmptyNote,
    createEmptyTaskItem,
    deleteCheckedTaskItems,
    duplicateNote,
    filterAndSortNotes,
    formatNoteForExport,
    getNoteColorConfig,
    getNoteStats,
    indentTaskItem,
    isNoteEmpty,
    moveTaskItem,
    normalizeTaskHierarchy,
    partitionTaskItems,
    readNotePreferences,
    readStoredLabels,
    readStoredNotes,
    sanitizeNote,
    toggleTaskItemChecked,
    tokenizeRichText,
    uncheckAllTaskItems,
    unindentTaskItem,
    writeNotePreferences,
    writeStoredLabels,
    writeStoredNotes,
} from './notesService';

describe('notesService', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('creates and sanitizes text and list notes', () => {
        const textNote = createEmptyNote('text', ['  Physics ', 'Physics', '']);
        expect(textNote.type).toBe('text');
        expect(textNote.labels).toEqual(['Physics']);
        expect(textNote.items).toEqual([]);
        expect(isNoteEmpty(textNote)).toBe(true);

        const listNote = createEmptyNote('list');
        expect(listNote.type).toBe('list');
        expect(listNote.items).toHaveLength(1);
        expect(isNoteEmpty(listNote)).toBe(true);

        expect(sanitizeNote(null)).toBeNull();
        expect(sanitizeNote('invalid')).toBeNull();

        const recovered = sanitizeNote({
            id: 'custom-1',
            type: 'unknown-type',
            title: 'Electrostatics',
            color: 'invalid-color',
            folder: 'invalid-folder',
            labels: ['JEE', 42, ' JEE '],
            items: [{ id: 'i1', text: 'First', checked: 1, isChild: true }, null],
        });
        expect(recovered).not.toBeNull();
        expect(recovered?.type).toBe('text');
        expect(recovered?.color).toBe('default');
        expect(recovered?.folder).toBe('notes');
        expect(recovered?.labels).toEqual(['JEE']);
        expect(recovered?.items[0]?.isChild).toBe(false);
    });

    it('persists and reads notes, labels, and preferences', () => {
        const note = createEmptyNote('text', ['Organic']);
        note.title = 'Reaction Mechanisms';
        note.body = 'SN1 and SN2';

        expect(writeStoredNotes([note])).toBe(true);
        const loaded = readStoredNotes();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.title).toBe('Reaction Mechanisms');

        writeStoredLabels(['Inorganic', 'Physical']);
        const allLabels = readStoredLabels(loaded);
        expect(allLabels).toEqual(['Inorganic', 'Organic', 'Physical']);

        expect(readNotePreferences()).toEqual({
            viewMode: 'grid',
            sortField: 'updatedAt',
            sortDirection: 'desc',
        });

        writeNotePreferences({
            viewMode: 'list',
            sortField: 'title',
            sortDirection: 'asc',
        });
        expect(readNotePreferences()).toEqual({
            viewMode: 'list',
            sortField: 'title',
            sortDirection: 'asc',
        });
    });

    it('converts between text notes and task list notes preserving hierarchy', () => {
        const textNote = createEmptyNote('text');
        textNote.title = 'Study Plan';
        textNote.body = '- [x] Revise Vectors\n  - Dot product\n- [ ] Practice Integration\nPlain task';

        const listNote = convertNoteType(textNote, 'list');
        expect(listNote.type).toBe('list');
        expect(listNote.items).toHaveLength(4);
        expect(listNote.items[0]).toMatchObject({ text: 'Revise Vectors', checked: true, isChild: false });
        expect(listNote.items[1]).toMatchObject({ text: 'Dot product', checked: false, isChild: true });
        expect(listNote.items[2]).toMatchObject({ text: 'Practice Integration', checked: false, isChild: false });
        expect(listNote.items[3]).toMatchObject({ text: 'Plain task', checked: false, isChild: false });

        const roundTripText = convertNoteType(listNote, 'text');
        expect(roundTripText.type).toBe('text');
        expect(roundTripText.body).toContain('Revise Vectors');
        expect(roundTripText.body).toContain('  - Dot product');
    });

    it('cascades parent/subtask checkbox toggles and supports indent, unindent, and move', () => {
        const parent1 = { id: 'p1', text: 'Parent 1', checked: false, isChild: false };
        const child1 = { id: 'c1', text: 'Child 1', checked: false, isChild: true };
        const child2 = { id: 'c2', text: 'Child 2', checked: false, isChild: true };
        const parent2 = { id: 'p2', text: 'Parent 2', checked: false, isChild: false };
        let items = [parent1, child1, child2, parent2];

        items = toggleTaskItemChecked(items, 'p1');
        expect(items.find((i) => i.id === 'p1')?.checked).toBe(true);
        expect(items.find((i) => i.id === 'c1')?.checked).toBe(true);
        expect(items.find((i) => i.id === 'c2')?.checked).toBe(true);

        items = toggleTaskItemChecked(items, 'c1');
        expect(items.find((i) => i.id === 'c1')?.checked).toBe(false);
        expect(items.find((i) => i.id === 'p1')?.checked).toBe(false);

        items = toggleTaskItemChecked(items, 'c1');
        expect(items.find((i) => i.id === 'p1')?.checked).toBe(true);

        const movedChild = moveTaskItem(items, 'c2', 'up');
        expect(movedChild.map((i) => i.id)).toEqual(['p1', 'c2', 'c1', 'p2']);

        const movedGroup = moveTaskItem(movedChild, 'p2', 'up');
        expect(movedGroup.map((i) => i.id)).toEqual(['p2', 'p1', 'c2', 'c1']);

        const indented = indentTaskItem(movedGroup, 'p1');
        expect(indented.find((i) => i.id === 'p1')?.isChild).toBe(true);

        const unindented = unindentTaskItem(indented, 'p1');
        expect(unindented.find((i) => i.id === 'p1')?.isChild).toBe(false);

        const partitioned = partitionTaskItems(unindented, true);
        expect(partitioned.activeItems.map((i) => i.id)).toEqual(['p2']);
        expect(partitioned.checkedItems.map((i) => i.id)).toEqual(['p1', 'c2', 'c1']);

        const allChecked = checkAllTaskItems(unindented);
        expect(allChecked.every((i) => i.checked)).toBe(true);

        const allUnchecked = uncheckAllTaskItems(allChecked);
        expect(allUnchecked.every((i) => !i.checked)).toBe(true);

        const afterDelete = deleteCheckedTaskItems(allChecked);
        expect(afterDelete).toHaveLength(1);
        expect(afterDelete[0]?.text).toBe('');
    });

    it('applies inline formatting and tokenizes rich text and clickable links', () => {
        const bold = applyInlineFormatting('Hello world', 6, 11, 'bold');
        expect(bold.text).toBe('Hello **world**');

        const unbold = applyInlineFormatting(bold.text, 6, 15, 'bold');
        expect(unbold.text).toBe('Hello world');

        const link = applyInlineFormatting('Read docs', 5, 9, 'link', 'https://crustack.github.io/NotallyX');
        expect(link.text).toBe('Read [docs](https://crustack.github.io/NotallyX)');

        const sampleFormatted = '**Bold** *Italic* ~~Strike~~ `code` [docs](https://example.com)';
        const cleared = applyInlineFormatting(sampleFormatted, 0, sampleFormatted.length, 'clear');
        expect(cleared.text).toBe('Bold Italic Strike code docs');

        const spans = tokenizeRichText(
            'Check **important** *note* ~~old~~ `x=1` [NotallyX](https://github.com/Crustack/NotallyX) https://example.com test@example.com +1 (555) 234-5678',
        );
        expect(spans.some((s) => s.type === 'bold' && s.content === 'important')).toBe(true);
        expect(spans.some((s) => s.type === 'italic' && s.content === 'note')).toBe(true);
        expect(spans.some((s) => s.type === 'strikethrough' && s.content === 'old')).toBe(true);
        expect(spans.some((s) => s.type === 'code' && s.content === 'x=1')).toBe(true);
        expect(spans.filter((s) => s.type === 'link')).toHaveLength(4);
    });

    it('filters, sorts, duplicates, and exports notes', () => {
        const noteA = createEmptyNote('text', ['Math']);
        noteA.title = 'Alpha Calculus';
        noteA.body = 'Limits and derivatives';
        noteA.updatedAt = '2026-05-01T10:00:00.000Z';

        const noteB = createEmptyNote('list', ['Chemistry']);
        noteB.title = 'Beta Polymers';
        noteB.items = [createEmptyTaskItem('Nylon 6,6')];
        noteB.updatedAt = '2026-05-02T10:00:00.000Z';

        const sortedByUpdated = filterAndSortNotes([noteA, noteB], {
            folder: 'notes',
            sortField: 'updatedAt',
            sortDirection: 'desc',
        });
        expect(sortedByUpdated.map((n) => n.title)).toEqual(['Beta Polymers', 'Alpha Calculus']);

        const filteredByLabel = filterAndSortNotes([noteA, noteB], {
            folder: 'notes',
            selectedLabel: 'Math',
        });
        expect(filteredByLabel).toHaveLength(1);
        expect(filteredByLabel[0]?.title).toBe('Alpha Calculus');

        const filteredByQuery = filterAndSortNotes([noteA, noteB], {
            folder: 'notes',
            searchQuery: 'nylon',
        });
        expect(filteredByQuery).toHaveLength(1);
        expect(filteredByQuery[0]?.title).toBe('Beta Polymers');

        const stats = getNoteStats(noteA);
        expect(stats.words).toBe(5);
        expect(stats.characters).toBe('Limits and derivatives'.length);

        const copy = duplicateNote(noteB);
        expect(copy.id).not.toBe(noteB.id);
        expect(copy.title).toBe('Beta Polymers (Copy)');

        expect(formatNoteForExport(noteA, 'md')).toContain('# Alpha Calculus');
        expect(formatNoteForExport(noteB, 'txt')).toContain('- [ ] Nylon 6,6');
        expect(formatNoteForExport(noteA, 'json')).toContain('"Alpha Calculus"');
        expect(getNoteColorConfig('mint').id).toBe('mint');
        expect(normalizeTaskHierarchy([{ id: '1', text: 'Orphan', checked: false, isChild: true }])[0]?.isChild).toBe(
            false,
        );
    });
});
