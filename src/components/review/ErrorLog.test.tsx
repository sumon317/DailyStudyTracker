import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { ErrorLogEntry } from '../../types';
import ErrorLog from './ErrorLog';

interface HarnessProps {
    initial?: ErrorLogEntry[];
}

const ErrorLogHarness = ({ initial = [] }: HarnessProps) => {
    const [errors, setErrors] = useState<ErrorLogEntry[]>(initial);
    return (
        <>
            <ErrorLog errors={errors} setErrors={setErrors} />
            <output data-testid="count">{errors.length}</output>
        </>
    );
};

describe('ErrorLog', () => {
    it('celebrates an empty log', () => {
        render(<ErrorLogHarness />);

        expect(screen.getByRole('heading', { name: 'Error Log' })).toBeInTheDocument();
        expect(screen.getByText('No errors logged today! Great job.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add Log/i })).toBeInTheDocument();
    });

    it('offers a first-record call to action, matching the other review panels', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness />);

        // The checklist and quality panels both open with a way in from their
        // empty state; the error log used to offer the header button only.
        await user.click(screen.getByRole('button', { name: '+ Add your first error log' }));

        expect(screen.getByTestId('count')).toHaveTextContent('1');
        await waitFor(() => expect(screen.getByLabelText('Question')).toHaveFocus());
    });

    it('adds blank records with unique, position-labelled field ids', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness />);

        await user.click(screen.getByRole('button', { name: /Add Log/i }));
        await user.click(screen.getByRole('button', { name: /Add Log/i }));

        expect(screen.getByTestId('count')).toHaveTextContent('2');
        const questions = screen.getAllByLabelText('Question');
        expect(new Set(questions.map((field) => field.getAttribute('id'))).size).toBe(2);
    });

    it('names each record for screen readers', () => {
        render(
            <ErrorLogHarness
                initial={[
                    { id: 5, question: 'q1', mistake: 'm1', correctLogic: 'l1' },
                    { id: 6, question: 'q2', mistake: 'm2', correctLogic: 'l2' },
                ]}
            />,
        );

        expect(screen.getByRole('article', { name: 'Error log 1' })).toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Error log 2' })).toBeInTheDocument();
    });

    it('writes into each field independently', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness initial={[{ id: 1, question: '', mistake: '', correctLogic: '' }]} />);

        await user.type(screen.getByLabelText('Question'), 'Why is the trial balance unbalanced?');
        await user.type(screen.getByLabelText('Mistake'), 'Forgot the credit side');
        await user.type(screen.getByLabelText('Correct Logic'), 'Debits must equal credits');

        expect(screen.getByLabelText('Question')).toHaveValue('Why is the trial balance unbalanced?');
        expect(screen.getByLabelText('Mistake')).toHaveValue('Forgot the credit side');
        expect(screen.getByLabelText('Correct Logic')).toHaveValue('Debits must equal credits');
    });

    it('removes a record from the header control and renumbers the rest', async () => {
        const user = userEvent.setup();
        render(
            <ErrorLogHarness
                initial={[
                    { id: 1, question: 'first', mistake: '', correctLogic: '' },
                    { id: 2, question: 'second', mistake: '', correctLogic: '' },
                ]}
            />,
        );

        const firstRecord = screen.getByRole('article', { name: 'Error log 1' });
        await user.click(within(firstRecord).getAllByRole('button', { name: 'Remove error log 1' })[0] as HTMLElement);

        expect(screen.getByTestId('count')).toHaveTextContent('1');
        expect(screen.getByRole('article', { name: 'Error log 1' })).toHaveTextContent('second');
    });

    it('reuses a stable id per record so field ids do not move while typing', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness initial={[{ id: 42, question: '', mistake: '', correctLogic: '' }]} />);

        const question = screen.getByLabelText('Question');
        expect(question).toHaveAttribute('id', 'error-question-42');

        await user.type(question, 'abc');

        expect(screen.getByLabelText('Question')).toHaveAttribute('id', 'error-question-42');
    });

    it('caps how much text each field can hold', () => {
        render(<ErrorLogHarness initial={[{ id: 1, question: '', mistake: '', correctLogic: '' }]} />);

        expect(screen.getByLabelText('Question')).toHaveAttribute('maxlength', '2000');
        expect(screen.getByLabelText('Mistake')).toHaveAttribute('maxlength', '2000');
        expect(screen.getByLabelText('Correct Logic')).toHaveAttribute('maxlength', '2000');
    });

    it('moves focus into the first field of the record it just added', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness />);

        await user.click(screen.getByRole('button', { name: /Add Log/i }));

        const question = screen.getByLabelText('Question');
        await waitFor(() => expect(question).toHaveFocus());
        await user.type(question, 'Debit the reserve');
        expect(question).toHaveValue('Debit the reserve');
    });

    it('hands focus to the following record when a record is removed', async () => {
        const user = userEvent.setup();
        render(
            <ErrorLogHarness
                initial={[
                    { id: 1, question: 'first', mistake: '', correctLogic: '' },
                    { id: 2, question: 'second', mistake: '', correctLogic: '' },
                ]}
            />,
        );

        const firstRecord = screen.getByRole('article', { name: 'Error log 1' });
        await user.click(within(firstRecord).getAllByRole('button', { name: 'Remove error log 1' })[0] as HTMLElement);

        await waitFor(() =>
            expect(
                within(screen.getByRole('article', { name: 'Error log 1' })).getByLabelText('Question'),
            ).toHaveFocus(),
        );
    });

    it('falls back to the add control when the last record is removed', async () => {
        const user = userEvent.setup();
        render(<ErrorLogHarness initial={[{ id: 1, question: 'only', mistake: '', correctLogic: '' }]} />);

        const record = screen.getByRole('article', { name: 'Error log 1' });
        await user.click(within(record).getAllByRole('button', { name: 'Remove error log 1' })[0] as HTMLElement);

        await waitFor(() => expect(screen.getByRole('button', { name: /Add Log/i })).toHaveFocus());
    });

    it('keeps a surviving record bound to its own field ids after a removal', async () => {
        const user = userEvent.setup();
        render(
            <ErrorLogHarness
                initial={[
                    { id: 11, question: 'first', mistake: '', correctLogic: '' },
                    { id: 12, question: 'second', mistake: '', correctLogic: '' },
                ]}
            />,
        );

        expect(screen.getAllByLabelText('Question')[1]).toHaveAttribute('id', 'error-question-12');

        const firstRecord = screen.getByRole('article', { name: 'Error log 1' });
        await user.click(within(firstRecord).getAllByRole('button', { name: 'Remove error log 1' })[0] as HTMLElement);

        expect(screen.getByLabelText('Question')).toHaveAttribute('id', 'error-question-12');
    });

    it('does not hand out a duplicate id when a stored record sits at the id ceiling', async () => {
        const user = userEvent.setup();
        // `storage.ts` accepts ids up to `Number.MAX_SAFE_INTEGER`, and
        // `MAX + 1` is the first float past the safe range, so the old
        // `lastId + 1` seed gave both new records the same id - and with it the
        // same React key and the same `error-question-<id>` DOM ids.
        render(
            <ErrorLogHarness
                initial={[{ id: Number.MAX_SAFE_INTEGER, question: 'q', mistake: '', correctLogic: '' }]}
            />,
        );

        await user.click(screen.getByRole('button', { name: /Add Log/i }));
        await user.click(screen.getByRole('button', { name: /Add Log/i }));

        expect(screen.getByTestId('count')).toHaveTextContent('3');
        const questions = screen.getAllByLabelText('Question');
        expect(new Set(questions.map((field) => field.getAttribute('id'))).size).toBe(3);
        expect(new Set(screen.getAllByLabelText('Mistake').map((field) => field.getAttribute('id'))).size).toBe(3);
    });

    it('writes into the record it added rather than its neighbour', async () => {
        const user = userEvent.setup();
        render(
            <ErrorLogHarness
                initial={[{ id: Number.MAX_SAFE_INTEGER, question: 'kept', mistake: '', correctLogic: '' }]}
            />,
        );

        await user.click(screen.getByRole('button', { name: /Add Log/i }));

        const secondRecord = within(screen.getByRole('article', { name: 'Error log 2' }));
        await user.type(secondRecord.getByLabelText('Question'), 'fresh');

        expect(secondRecord.getByLabelText('Question')).toHaveValue('fresh');
        expect(screen.getByRole('article', { name: 'Error log 1' })).toHaveTextContent('kept');
    });
});
