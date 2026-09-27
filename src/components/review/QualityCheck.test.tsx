import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { QualityCheckItem } from '../../types';
import QualityCheck from './QualityCheck';

interface HarnessProps {
    checks?: QualityCheckItem[];
    rating?: string;
}

const QualityCheckHarness = ({ checks: initialChecks = [], rating: initialRating = '' }: HarnessProps) => {
    const [checks, setChecks] = useState<QualityCheckItem[]>(initialChecks);
    const [rating, setRating] = useState(initialRating);
    return (
        <>
            <QualityCheck checks={checks} setChecks={setChecks} rating={rating} setRating={setRating} />
            <output data-testid="count">{checks.length}</output>
        </>
    );
};

describe('QualityCheck', () => {
    it('shows an empty criteria state next to the day rating', () => {
        render(<QualityCheckHarness />);

        expect(screen.getByRole('heading', { name: 'Quality Check' })).toBeInTheDocument();
        expect(screen.getByText('Define your daily standards')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add quality criteria/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Day Rating' })).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(3);
    });

    it('adds criteria rows with unique ids', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness />);

        await user.click(screen.getByRole('button', { name: /Add quality criteria/i }));
        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        expect(screen.getByTestId('count')).toHaveTextContent('2');
        const ids = screen
            .getAllByRole('textbox')
            .map((input) => input.getAttribute('id'))
            .filter(Boolean);
        expect(new Set(ids).size).toBe(2);
    });

    it('gives every row a distinct accessible name', () => {
        render(
            <QualityCheckHarness
                checks={[
                    { id: 1, label: 'Cite sources', checked: false },
                    { id: 2, label: '', checked: true },
                ]}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Mark quality “Cite sources” as met' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Mark quality criterion 2 as not met' })).toBeChecked();
        expect(screen.getByRole('textbox', { name: 'Quality criterion 1' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Quality criterion 2' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove quality “Cite sources”' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove quality criterion 2' })).toBeInTheDocument();
    });

    it('toggles, edits and removes criteria', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness checks={[{ id: 1, label: 'Cite sources', checked: false }]} />);

        await user.click(screen.getByRole('checkbox'));
        expect(screen.getByRole('checkbox', { name: /as not met/ })).toBeChecked();

        const input = screen.getByRole('textbox', { name: 'Quality criterion 1' });
        await user.clear(input);
        await user.type(input, 'Cite two sources');
        expect(input).toHaveValue('Cite two sources');

        await user.click(screen.getByRole('button', { name: 'Remove quality “Cite two sources”' }));
        expect(screen.getByTestId('count')).toHaveTextContent('0');
    });

    it('records the chosen day rating and keeps only one radio checked', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness />);

        const radios = screen.getAllByRole('radio');
        expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);

        await user.click(screen.getByRole('radio', { name: 'Okayish' }));

        expect(screen.getByRole('radio', { name: 'Okayish' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Productive' })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: 'Unproductive' })).not.toBeChecked();
    });

    it('pre-selects a stored rating', () => {
        render(<QualityCheckHarness rating="Productive" />);

        expect(screen.getByRole('radio', { name: 'Productive' })).toBeChecked();
    });

    it('keeps keyboard focus visible on the rating options', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness />);

        const radio = screen.getByRole('radio', { name: 'Productive' });
        radio.focus();
        await user.keyboard(' ');

        expect(radio).toBeChecked();
    });

    it('groups criteria and rating in labelled fieldsets', () => {
        render(<QualityCheckHarness checks={[{ id: 1, label: 'One', checked: false }]} />);

        expect(screen.getByRole('group', { name: 'Quality criteria' })).toBeInTheDocument();
        const ratingGroup = screen.getByRole('group', { name: 'Choose a day rating' });
        expect(within(ratingGroup).getAllByRole('radio')).toHaveLength(3);
    });

    it('caps how much text a single criterion can hold', () => {
        render(<QualityCheckHarness checks={[{ id: 1, label: 'One', checked: false }]} />);

        expect(screen.getByRole('textbox', { name: 'Quality criterion 1' })).toHaveAttribute('maxlength', '200');
    });

    it('moves focus into the row it just added', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        const field = screen.getByRole('textbox', { name: 'Quality criterion 1' });
        await waitFor(() => expect(field).toHaveFocus());
    });

    it('hands focus to the following row when a row is removed', async () => {
        const user = userEvent.setup();
        render(
            <QualityCheckHarness
                checks={[
                    { id: 1, label: 'First', checked: false },
                    { id: 2, label: 'Second', checked: false },
                ]}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Remove quality “First”' }));

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Quality criterion 1' })).toHaveFocus());
    });

    it('falls back to the add control when the last row is removed', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness checks={[{ id: 1, label: 'Only', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Remove quality “Only”' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Item' })).toHaveFocus());
    });

    it('keeps a surviving row bound to its own field ids after a removal', async () => {
        const user = userEvent.setup();
        render(
            <QualityCheckHarness
                checks={[
                    { id: 4, label: 'First', checked: false },
                    { id: 5, label: 'Second', checked: false },
                ]}
            />,
        );

        expect(screen.getByRole('textbox', { name: 'Quality criterion 2' })).toHaveAttribute(
            'id',
            'quality-check-5-text',
        );

        await user.click(screen.getByRole('button', { name: 'Remove quality “First”' }));

        expect(screen.getByRole('textbox', { name: 'Quality criterion 1' })).toHaveAttribute(
            'id',
            'quality-check-5-text',
        );
        expect(screen.getByRole('checkbox', { name: /Second/ })).toHaveAttribute('id', 'quality-check-5-checked');
    });

    it('scopes the rating radio group to each instance', async () => {
        const user = userEvent.setup();
        function Pair() {
            const [first, setFirst] = useState('');
            const [second, setSecond] = useState('');
            return (
                <>
                    <QualityCheck checks={[]} setChecks={() => undefined} rating={first} setRating={setFirst} />
                    <QualityCheck checks={[]} setChecks={() => undefined} rating={second} setRating={setSecond} />
                </>
            );
        }
        render(<Pair />);

        const radios = screen.getAllByRole('radio') as HTMLInputElement[];
        const names = new Set(radios.map((radio) => radio.name));
        expect(names.size).toBe(2);
        // One group per panel, so the two panels cannot clear each other.
        expect(radios.slice(0, 3).every((radio) => radio.name === radios[0]?.name)).toBe(true);

        await user.click(radios[0] as HTMLInputElement);
        expect(radios[0]).toBeChecked();
        expect(radios[3]).not.toBeChecked();
    });

    it('does not hand out a duplicate id when a stored criterion sits at the id ceiling', async () => {
        const user = userEvent.setup();
        // `storage.ts` accepts ids up to `Number.MAX_SAFE_INTEGER`, and
        // `MAX + 1` is the first float past the safe range, so the old
        // `lastId + 1` seed gave both new rows the same id - and with it the
        // same React key and the same `quality-check-<id>-*` DOM ids.
        render(<QualityCheckHarness checks={[{ id: Number.MAX_SAFE_INTEGER, label: 'Imported', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));
        await user.click(screen.getByRole('button', { name: 'Add Item' }));

        expect(screen.getByTestId('count')).toHaveTextContent('3');
        const fieldIds = screen.getAllByRole('textbox').map((field) => field.getAttribute('id'));
        const checkboxIds = screen.getAllByRole('checkbox').map((box) => box.getAttribute('id'));
        expect(new Set(fieldIds).size).toBe(3);
        expect(new Set(checkboxIds).size).toBe(3);
    });

    it('keeps toggling the right criterion after adding past the id ceiling', async () => {
        const user = userEvent.setup();
        render(<QualityCheckHarness checks={[{ id: Number.MAX_SAFE_INTEGER, label: 'Imported', checked: false }]} />);

        await user.click(screen.getByRole('button', { name: 'Add Item' }));
        await user.type(screen.getByRole('textbox', { name: 'Quality criterion 2' }), 'Cite two sources');

        await user.click(screen.getByRole('checkbox', { name: 'Mark quality “Cite two sources” as met' }));

        // A duplicate key would have made this toggle the wrong row.
        expect(screen.getByRole('checkbox', { name: 'Mark quality “Cite two sources” as not met' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Imported/ })).not.toBeChecked();
    });

    it('keeps a long criterion out of the control names', () => {
        render(<QualityCheckHarness checks={[{ id: 1, label: 'x'.repeat(200), checked: false }]} />);

        // `maxLength` allows 200 characters, which is far more than a control
        // name can usefully carry: the name is read out before the row is.
        const name = screen.getByRole('checkbox').getAttribute('aria-label') ?? '';
        expect(name).toMatch(/^Mark quality “x+…” as met$/u);
        expect(name.length).toBeLessThan(100);
    });

    it('names a row whose criterion is only whitespace by its position', () => {
        render(<QualityCheckHarness checks={[{ id: 1, label: '   ', checked: false }]} />);

        // The row named itself with its own text before, which read as "Mark
        // quality “” as met".
        expect(screen.getByRole('checkbox', { name: 'Mark quality criterion 1 as met' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove quality criterion 1' })).toBeInTheDocument();
    });
});
