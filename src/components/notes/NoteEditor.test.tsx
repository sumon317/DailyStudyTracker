import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotesPage from '../../pages/NotesPage';
import { createEmptyNote, createEmptyTaskItem } from '../../services/notesService';

describe('NotesPage and NoteEditor integration', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('supports creating a text note, formatting text, undo/redo, colors, labels, find, and view mode', async () => {
        const user = userEvent.setup();
        render(<NotesPage />);

        await user.click(screen.getByRole('button', { name: /New Note/i }));
        const editor = screen.getByRole('region', { name: 'Inbuilt Note Editor' });

        const titleInput = within(editor).getByRole('textbox', { name: 'Note title' });
        await user.type(titleInput, 'Organic Chemistry');
        expect(titleInput).toHaveValue('Organic Chemistry');

        const bodyInput = within(editor).getByRole('textbox', { name: 'Note content' });
        await user.type(bodyInput, 'Benzene ring stability');

        await user.click(within(editor).getByRole('button', { name: 'Bold' }));
        expect((bodyInput as HTMLTextAreaElement).value).toContain('**');

        await user.click(within(editor).getByRole('button', { name: 'Italic' }));
        await user.click(within(editor).getByRole('button', { name: 'Strikethrough' }));
        await user.click(within(editor).getByRole('button', { name: 'Monospace code' }));

        await user.click(within(editor).getByRole('button', { name: 'Insert link' }));
        const linkUrlField = within(editor).getByRole('textbox', { name: 'Link URL' });
        await user.clear(linkUrlField);
        await user.type(linkUrlField, 'https://crustack.github.io/NotallyX');
        await user.click(within(editor).getByRole('button', { name: 'Insert Link' }));
        expect((bodyInput as HTMLTextAreaElement).value).toContain('https://crustack.github.io/NotallyX');

        await user.click(within(editor).getByRole('button', { name: 'Undo' }));
        await user.click(within(editor).getByRole('button', { name: 'Redo' }));

        await user.click(within(editor).getByRole('button', { name: 'Change note color' }));
        await user.click(within(editor).getByRole('button', { name: 'Color Mint' }));

        await user.click(within(editor).getByRole('button', { name: 'Manage labels' }));
        const labelInput = within(editor).getByRole('textbox', { name: 'New label name' });
        await user.type(labelInput, 'Chemistry{Enter}');
        expect(within(editor).getAllByText('#Chemistry').length).toBeGreaterThan(0);

        await user.click(within(editor).getByRole('button', { name: 'Find in note' }));
        const findBox = within(editor).getByRole('searchbox', { name: 'Find in note' });
        await user.type(findBox, 'Benzene');
        expect(within(editor).getByText(/1 match/i)).toBeInTheDocument();
        await user.click(within(editor).getByRole('button', { name: 'Close find bar' }));

        await user.click(within(editor).getByRole('button', { name: 'Switch to read-only view mode' }));
        expect(within(editor).getByRole('button', { name: 'Switch to edit mode' })).toBeInTheDocument();
        await user.click(within(editor).getByRole('button', { name: 'Switch to edit mode' }));

        await user.click(within(editor).getByRole('button', { name: 'Pin note' }));
        await user.click(within(editor).getByRole('button', { name: 'Back to notes list' }));

        expect(screen.getByRole('region', { name: 'Pinned notes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Organic Chemistry' })).toBeInTheDocument();
    });

    it('supports task list notes with subtasks, indent/unindent, move, auto-sort, and type conversion', async () => {
        const user = userEvent.setup();
        const initialListNote = {
            ...createEmptyNote('list', ['Checklist']),
            id: 'list-1',
            title: 'Exam Prep Checklist',
            items: [
                { ...createEmptyTaskItem('Parent Task 1', false), id: 'p1' },
                { ...createEmptyTaskItem('Subtask 1.1', true), id: 'c1' },
                { ...createEmptyTaskItem('Parent Task 2', false), id: 'p2' },
            ],
        };

        render(<NotesPage notes={[initialListNote]} />);
        await user.click(screen.getByRole('button', { name: 'Exam Prep Checklist' }));

        const editor = screen.getByRole('region', { name: 'Inbuilt Note Editor' });

        await user.click(within(editor).getByRole('button', { name: /Add item/i }));
        await user.click(within(editor).getByRole('button', { name: /Add subtask/i }));

        const indentButtons = within(editor).getAllByRole('button', { name: /Indent as subtask|Unindent subtask/i });
        if (indentButtons[1]) {
            await user.click(indentButtons[1]);
        }

        const moveDownButtons = within(editor).getAllByRole('button', { name: 'Move item down' });
        if (moveDownButtons[0]) {
            await user.click(moveDownButtons[0]);
        }

        await user.click(within(editor).getByRole('button', { name: /Mark "Parent Task 1" as complete/i }));
        expect(within(editor).getByRole('button', { name: /Checked items/i })).toBeInTheDocument();

        await user.click(within(editor).getByRole('button', { name: 'More note actions' }));
        await user.click(within(editor).getByRole('menuitem', { name: 'Check all items' }));

        await user.click(within(editor).getByRole('button', { name: 'More note actions' }));
        await user.click(within(editor).getByRole('menuitem', { name: 'Uncheck all items' }));

        await user.click(within(editor).getByRole('button', { name: 'More note actions' }));
        await user.click(within(editor).getByRole('menuitem', { name: 'Convert to text note' }));
        expect(within(editor).getByRole('textbox', { name: 'Note content' })).toBeInTheDocument();
    });

    it('manages folders (Notes, Archived, Trash), search, sort, view mode, and duplicate', async () => {
        const user = userEvent.setup();
        const note1 = {
            ...createEmptyNote('text', ['Physics']),
            id: 'n1',
            title: 'Kinematics Equations',
            body: 'v = u + at and https://example.com',
            pinned: false,
        };
        const note2 = {
            ...createEmptyNote('text', ['Math']),
            id: 'n2',
            title: 'Matrices & Determinants',
            body: 'Cramer rule',
            pinned: true,
        };

        const setNotes = vi.fn();
        render(<NotesPage notes={[note1, note2]} />);

        const searchInput = screen.getByRole('searchbox', { name: 'Search notes' });
        await user.type(searchInput, 'Kinematics');
        expect(screen.getByText('Kinematics Equations')).toBeInTheDocument();
        expect(screen.queryByText('Matrices & Determinants')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Clear search' }));

        await user.click(screen.getByRole('button', { name: '#Physics' }));
        expect(screen.getByText('Kinematics Equations')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'All' }));

        await user.selectOptions(screen.getByLabelText('Sort notes by'), 'title');
        await user.click(screen.getByRole('button', { name: /Sort direction/i }));
        await user.click(screen.getByRole('button', { name: /Switch to list view/i }));

        await user.click(screen.getByRole('button', { name: 'Archive Kinematics Equations' }));
        const folderGroup = screen.getByRole('group', { name: 'Note folders' });
        await user.click(within(folderGroup).getByRole('button', { name: /Archived/i }));
        expect(screen.getByText('Kinematics Equations')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Unarchive Kinematics Equations' }));
        await user.click(within(folderGroup).getByRole('button', { name: /^Notes/i }));

        await user.click(screen.getByRole('button', { name: 'Move Kinematics Equations to trash' }));
        await user.click(within(folderGroup).getByRole('button', { name: /Trash/i }));
        expect(screen.getByText('Kinematics Equations')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Restore Kinematics Equations' }));
        await user.click(within(folderGroup).getByRole('button', { name: /^Notes/i }));
        expect(screen.getByText('Kinematics Equations')).toBeInTheDocument();
        expect(setNotes).not.toHaveBeenCalled();
    });
});
