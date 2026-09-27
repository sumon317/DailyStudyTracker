import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudyCharts from '../components/charts/StudyCharts';
import WeeklyStats from '../components/charts/WeeklyStats';
import AlarmPermissionModal from '../components/dialogs/AlarmPermissionModal';
import Stopwatch from '../components/focus/Stopwatch';
import Checklist from '../components/review/Checklist';
import ErrorLog from '../components/review/ErrorLog';
import DatePicker from '../components/shared/DatePicker';
import TimePicker from '../components/shared/TimePicker';

vi.mock('../services/storage', () => ({
    exportAllData: vi.fn().mockResolvedValue([
        {
            date: '2024-01-15',
            updatedAt: '2024-01-15T10:00:00.000Z',
            subjects: [{ id: 1, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '', reminder: false }],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        },
    ]),
}));

const subjects = [
    { id: 11, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '', reminder: false },
    { id: 12, name: 'Economics', planned: '90', actual: '30', kpi: 'N', time: '', reminder: false },
];

describe('scoped accessibility behavior', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('gives DatePicker calendar semantics, keyboard movement, Escape, and focus restoration', async () => {
        const user = userEvent.setup();
        const setDate = vi.fn();
        render(<DatePicker date="2024-01-15" setDate={setDate} />);

        const trigger = screen.getByRole('button', { name: /Study Date/i });
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        await user.click(trigger);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('grid', { name: 'Study date calendar' })).toBeInTheDocument();
        const selectedDay = within(dialog).getByRole('button', { name: /January 15, 2024.*selected/i });
        expect(selectedDay).toHaveAttribute('tabindex', '0');
        await waitFor(() => expect(selectedDay).toHaveFocus());

        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(document.activeElement).toHaveAttribute('data-date', '2024-01-16'));
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('traps and restores focus in the alarm permission dialog', async () => {
        const user = userEvent.setup();

        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open permission dialog
                    </button>
                    <AlarmPermissionModal isOpen={open} onClose={() => setOpen(false)} onOpenSettings={vi.fn()} />
                </>
            );
        }

        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open permission dialog' });
        opener.focus();
        await user.click(opener);

        const dialog = await screen.findByRole('dialog', { name: 'Alarm Permission Needed' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const closeButton = within(dialog).getByRole('button', { name: 'Close alarm permission dialog' });
        const settingsButton = within(dialog).getByRole('button', { name: 'Open Settings' });
        await waitFor(() => expect(closeButton).toHaveFocus());

        settingsButton.focus();
        await user.keyboard('{Tab}');
        expect(closeButton).toHaveFocus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(opener).toHaveFocus();
    });

    it('associates checklist controls and exposes chart summaries, progressbars, and a table', () => {
        render(<Checklist items={[{ id: 4, label: 'Read accounts notes', checked: false }]} setItems={vi.fn()} />);
        expect(
            screen.getByRole('checkbox', { name: 'Mark checklist “Read accounts notes” as done' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove checklist “Read accounts notes”' })).toBeInTheDocument();

        render(<StudyCharts subjects={subjects} />);
        expect(screen.getByText(/75 minutes studied out of 150 minutes planned/i)).toBeInTheDocument();
        expect(screen.getAllByRole('progressbar')).toHaveLength(2);
        expect(screen.getByRole('table', { name: 'Study metrics by subject' })).toBeInTheDocument();
    });

    it('gives duplicate checklist rows distinct, position-scoped names', () => {
        render(
            <Checklist
                items={[
                    { id: 1, label: 'Same', checked: false },
                    { id: 2, label: 'Same', checked: false },
                ]}
                setItems={vi.fn()}
            />,
        );

        const names = screen.getAllByRole('textbox').map((field) => field.getAttribute('id'));
        expect(new Set(names).size).toBe(2);
        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Checklist objective 2' })).toBeInTheDocument();
    });

    it('does not let Tab strand an open DatePicker calendar', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <DatePicker date="2024-01-15" setDate={vi.fn()} />
                <button type="button">After</button>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: /Study Date/i }));
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        await waitFor(() => expect(document.activeElement).toHaveAttribute('data-date', '2024-01-15'));

        await user.tab();

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('hands focus out of the TimePicker popover instead of trapping it', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <TimePicker value="" onChange={vi.fn()} />
                <button type="button">After</button>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: 'Set Time' }));
        const dialog = await screen.findByRole('dialog', { name: 'Set study time' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Increase hour' })).toHaveFocus());
        // The popover is self-contained: Escape is always an escape hatch.
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Set Time' })).toHaveFocus();
    });

    it('gives the time picker a labelled dialog and restores focus on Escape', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="" onChange={vi.fn()} />);

        const trigger = screen.getByRole('button', { name: 'Set Time' });
        await user.click(trigger);
        expect(await screen.findByRole('dialog', { name: 'Set study time' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Increase hour' })).toBeInTheDocument();

        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('keeps ErrorLog field IDs tied to stable record IDs', () => {
        render(
            <ErrorLog
                errors={[
                    { id: 101, question: 'same', mistake: 'same', correctLogic: 'same' },
                    { id: 202, question: 'same', mistake: 'same', correctLogic: 'same' },
                ]}
                setErrors={vi.fn()}
            />,
        );

        const questionFields = screen.getAllByLabelText('Question');
        expect(questionFields[0]).toHaveAttribute('id', 'error-question-101');
        expect(questionFields[1]).toHaveAttribute('id', 'error-question-202');
        fireEvent.change(questionFields[0] as HTMLTextAreaElement, { target: { value: 'changed' } });
        expect(questionFields[0]).toHaveAttribute('id', 'error-question-101');
    });

    it('gives weekly statistics a textual chart summary and table', async () => {
        render(<WeeklyStats currentDate="2024-01-15" />);

        expect(await screen.findByRole('img', { name: /minutes studied out of/i })).toBeInTheDocument();
        expect(await screen.findByRole('table', { name: /daily study minutes/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /weekly stats/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('uses wall-clock elapsed time when the stopwatch interval is throttled', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        render(<Stopwatch />);

        fireEvent.click(screen.getByRole('button', { name: 'Start stopwatch' }));
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(screen.getByRole('timer')).toHaveTextContent('00:00:05');

        vi.setSystemTime(new Date('2024-01-01T00:00:15Z'));
        fireEvent(document, new Event('visibilitychange'));
        expect(screen.getByRole('timer')).toHaveTextContent('00:00:15');
    });
});
