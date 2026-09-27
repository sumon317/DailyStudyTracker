import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ChecklistItem } from '../../types';
import Checklist from './Checklist';

interface HarnessProps {
    initial?: ChecklistItem[];
}

const ChecklistHarness = ({ initial = [] }: HarnessProps) => {
    const [items, setItems] = useState<ChecklistItem[]>(initial);
    return (
        <>
            <Checklist items={items} setItems={setItems} />
            <output data-testid="count">{items.length}</output>
        </>
    );
};

describe('Checklist', () => {
    it('offers a first-objective call to action while empty', () => {
        render(<ChecklistHarness />);

        expect(screen.getByRole('heading', { name: 'Output Checklist' })).toBeInTheDocument();
        expect(screen.getByText('Track specific outcomes here')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add your first objective/i })).toBeInTheDocument();
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('adds rows from the header and the empty state, each with unique ids', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness />);

        await user.click(screen.getByRole('button', { name: /Add your first objective/i }));
        await user.click(screen.getByRole('button', { name: 'Add Item' }));
        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        expect(screen.getByTestId('count')).toHaveTextContent('3');
        const ids = screen
            .getAllByRole('textbox')
            .map((input) => input.getAttribute('id'))
            .filter(Boolean);
        expect(new Set(ids).size).toBe(3);
    });

    it('gives every row a distinct accessible name', () => {
        render(
            <ChecklistHarness
                initial={[
                    { id: 1, label: 'Read notes', checked: false },
                    { id: 2, label: '', checked: false },
                ]}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Mark checklist “Read notes” as done' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Mark checklist objective 2 as done' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Checklist objective 2' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove checklist “Read notes”' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove checklist objective 2' })).toBeInTheDocument();
    });

    it('reflects the completed state in the checkbox name', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness initial={[{ id: 1, label: 'Read notes', checked: false }]} />);

        await user.click(screen.getByRole('checkbox'));

        expect(screen.getByRole('checkbox', { name: 'Mark checklist “Read notes” as not done' })).toBeChecked();
    });

    it('edits the row text', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness initial={[{ id: 1, label: 'Draft', checked: false }]} />);

        const input = screen.getByRole('textbox', { name: 'Checklist objective 1' });
        await user.clear(input);
        await user.type(input, 'Final notes');

        expect(input).toHaveValue('Final notes');
        expect(screen.getByRole('button', { name: 'Remove checklist “Final notes”' })).toBeInTheDocument();
    });

    it('removes a row and renumbers the remaining positions', async () => {
        const user = userEvent.setup();
        render(
            <ChecklistHarness
                initial={[
                    { id: 1, label: 'First', checked: false },
                    { id: 2, label: 'Second', checked: false },
                    { id: 3, label: 'Third', checked: false },
                ]}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Remove checklist “Second”' }));

        expect(screen.getByTestId('count')).toHaveTextContent('2');
        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toHaveValue('First');
        expect(screen.getByRole('textbox', { name: 'Checklist objective 2' })).toHaveValue('Third');
    });

    it('groups rows inside a labelled fieldset', () => {
        render(<ChecklistHarness initial={[{ id: 1, label: 'Only', checked: false }]} />);

        const fieldset = screen.getByRole('group', { name: 'Checklist objectives' });
        expect(within(fieldset).getByRole('checkbox')).toBeInTheDocument();
    });

    it('accepts an external setter that is not a state updater', () => {
        const setItems = vi.fn();
        render(<Checklist items={[]} setItems={setItems} />);

        act(() => {
            screen.getByRole('button', { name: 'Add Item' }).click();
        });

        expect(setItems).toHaveBeenCalledTimes(1);
    });

    it('caps how much text a single objective can hold', () => {
        render(<ChecklistHarness initial={[{ id: 1, label: 'Only', checked: false }]} />);

        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toHaveAttribute('maxlength', '200');
    });

    it('moves focus into the row it just added', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        const field = screen.getByRole('textbox', { name: 'Checklist objective 1' });
        await waitFor(() => expect(field).toHaveFocus());
        await user.type(field, 'Type straight away');
        expect(field).toHaveValue('Type straight away');
    });

    it('hands focus to the following row when a row is removed', async () => {
        const user = userEvent.setup();
        render(
            <ChecklistHarness
                initial={[
                    { id: 1, label: 'First', checked: false },
                    { id: 2, label: 'Second', checked: false },
                ]}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Remove checklist “First”' }));

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toHaveFocus());
    });

    it('falls back to the add control when the last row is removed', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness initial={[{ id: 1, label: 'Only', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Remove checklist “Only”' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Item' })).toHaveFocus());
    });

    it('keeps a surviving row bound to its own field ids after a removal', async () => {
        const user = userEvent.setup();
        render(
            <ChecklistHarness
                initial={[
                    { id: 7, label: 'First', checked: false },
                    { id: 9, label: 'Second', checked: false },
                ]}
            />,
        );

        expect(screen.getByRole('textbox', { name: 'Checklist objective 2' })).toHaveAttribute(
            'id',
            'checklist-item-9-label-input',
        );

        await user.click(screen.getByRole('button', { name: 'Remove checklist “First”' }));

        const survivor = screen.getByRole('textbox', { name: 'Checklist objective 1' });
        expect(survivor).toHaveAttribute('id', 'checklist-item-9-label-input');
        expect(screen.getByRole('checkbox', { name: /Second/ })).toHaveAttribute('id', 'checklist-item-9-checked');
    });

    it('does not hand out a duplicate id when a stored row sits at the id ceiling', async () => {
        const user = userEvent.setup();
        // `storage.ts` accepts ids up to `Number.MAX_SAFE_INTEGER`, so a JSON
        // backup can deliver exactly this. `MAX + 1` is the first float past the
        // safe range and adding one to *it* rounds back to itself, which used to
        // give both new rows the same id - and with it the same React key and
        // the same `checklist-item-<id>-*` DOM ids.
        render(<ChecklistHarness initial={[{ id: Number.MAX_SAFE_INTEGER, label: 'Imported', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));
        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        expect(screen.getByTestId('count')).toHaveTextContent('3');
        const fieldIds = screen.getAllByRole('textbox').map((field) => field.getAttribute('id'));
        const checkboxIds = screen.getAllByRole('checkbox').map((box) => box.getAttribute('id'));
        expect(new Set(fieldIds).size).toBe(3);
        expect(new Set(checkboxIds).size).toBe(3);
    });

    it('reaches the add control and its rows when the list starts at the id ceiling', async () => {
        const user = userEvent.setup();
        render(<ChecklistHarness initial={[{ id: Number.MAX_SAFE_INTEGER, label: 'Imported', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        // Each row still gets a usable, distinct accessible name and a caret.
        const added = screen.getByRole('textbox', { name: 'Checklist objective 2' });
        await waitFor(() => expect(added).toHaveFocus());
        await user.type(added, 'Fresh row');
        expect(added).toHaveValue('Fresh row');
    });

    it('keeps a long objective out of the control names', () => {
        render(<ChecklistHarness initial={[{ id: 1, label: 'x'.repeat(200), checked: false }]} />);

        // `maxLength` allows 200 characters, which is far more than a control
        // name can usefully carry: the name is read out before the row is.
        const name = screen.getByRole('checkbox').getAttribute('aria-label') ?? '';
        expect(name).toMatch(/^Mark checklist “x+…” as done$/u);
        expect(name.length).toBeLessThan(100);
    });

    it('names a row whose objective is only whitespace by its position', () => {
        render(<ChecklistHarness initial={[{ id: 1, label: '   ', checked: false }]} />);

        // The row named itself with its own text before, which read as "Mark
        // checklist “” as done".
        expect(screen.getByRole('checkbox', { name: 'Mark checklist objective 1 as done' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove checklist objective 1' })).toBeInTheDocument();
    });
});
