import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../services/notificationService';
import type { Subject } from '../../types';
import TrackerForm from './TrackerForm';

vi.mock('../../services/notificationService', () => ({
    NotificationService: {
        scheduleNotification: vi.fn().mockResolvedValue({ success: true }),
        cancelNotification: vi.fn().mockResolvedValue(true),
    },
}));

const showToastSpy = vi.fn();
vi.mock('../../providers/ToastProvider', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../providers/ToastProvider')>();
    return {
        ...actual,
        useToast: () => ({ showToast: showToastSpy, dismissToast: vi.fn() }),
    };
});

interface HarnessProps {
    initial?: Subject[];
}

const baseSubject: Subject = {
    id: 1,
    name: 'Accounts',
    planned: '60',
    actual: '0',
    kpi: 'N',
    time: '',
    reminder: false,
};

const TrackerFormHarness = ({ initial = [baseSubject] }: HarnessProps) => {
    const [subjects, setSubjects] = useState<Subject[]>(initial);
    return (
        <>
            <TrackerForm subjects={subjects} setSubjects={setSubjects} />
            <output data-testid="ids">{subjects.map((subject) => subject.id).join(',')}</output>
            <output data-testid="names">{subjects.map((subject) => subject.name).join('|')}</output>
        </>
    );
};

// The planner renders a card layout and a table layout at the same time and
// hides one with CSS, so most queries legitimately match twice.
const plannerButton = (name: string | RegExp) => screen.getAllByRole('button', { name })[0] as HTMLElement;
const desktopTable = () => within(screen.getByRole('table'));
// The table is queried through its own scope, otherwise index 0 is the card
// layout that the table simply mirrors.
const desktopInput = (label: string, index = 0) =>
    desktopTable().getAllByLabelText(new RegExp(label))[index] as HTMLElement;
const errorTextFor = (field: HTMLElement): string => {
    const describedBy = field.getAttribute('aria-describedby');
    return describedBy ? (document.getElementById(describedBy)?.textContent ?? '') : '';
};
const setClock = (iso: string) => {
    // Only `Date` is faked so `userEvent` and `waitFor` keep using real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
};
const openRecurringDialog = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
    await user.click(plannerButton(name));
    return screen.findByRole('dialog', { name: 'Recurring Days' });
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

describe('TrackerForm', () => {
    beforeEach(() => {
        showToastSpy.mockClear();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValue({ success: true });
        vi.mocked(NotificationService.cancelNotification).mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders a planner table with a total row', () => {
        render(<TrackerFormHarness />);

        expect(screen.getByRole('heading', { name: 'Study Planner' })).toBeInTheDocument();
        const table = screen.getByRole('table');
        expect(within(table).getByRole('columnheader', { name: 'Subject' })).toBeInTheDocument();
        expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
        expect(within(table).getByText('Total')).toBeInTheDocument();
    });

    it('marks the totals row with a row header', () => {
        render(<TrackerFormHarness />);

        expect(desktopTable().getByRole('rowheader', { name: 'Total' })).toBeInTheDocument();
    });

    it('hides the delete control while only one subject remains', () => {
        render(<TrackerFormHarness />);

        expect(screen.queryByRole('button', { name: 'Remove subject 1' })).not.toBeInTheDocument();
    });

    it('adds a subject with a unique id and seeded values', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        await user.click(screen.getByRole('button', { name: 'Add subject' }));
        await user.click(screen.getByRole('button', { name: 'Add subject' }));

        expect(screen.getByTestId('ids').textContent?.split(',')).toHaveLength(3);
        expect(new Set(screen.getByTestId('ids').textContent?.split(',')).size).toBe(3);
        expect(screen.getAllByDisplayValue('New Subject').length).toBeGreaterThan(0);
    });

    it('removes a subject and cancels its reminder first', async () => {
        const user = userEvent.setup();
        render(
            <TrackerFormHarness
                initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics', reminder: true, time: '09:00' }]}
            />,
        );

        await user.click(plannerButton('Remove subject 2'));

        expect(vi.mocked(NotificationService.cancelNotification).mock.calls[0]?.[0]).toBe(2);
        expect(screen.getByTestId('names')).toHaveTextContent('Accounts');
    });

    it('still removes the subject when cancelling the reminder fails, and warns', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.cancelNotification).mockRejectedValueOnce(new Error('bridge down'));

        render(
            <TrackerFormHarness
                initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics', reminder: true, time: '09:00' }]}
            />,
        );

        await user.click(plannerButton('Remove subject 2'));

        await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Accounts'));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'warning', message: expect.stringContaining('reminder') }),
        );
    });

    it('warns when the device reports the cancel as unsuccessful rather than throwing', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.cancelNotification).mockResolvedValueOnce(false);

        render(
            <TrackerFormHarness
                initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics', reminder: true, time: '09:00' }]}
            />,
        );

        await user.click(plannerButton('Remove subject 2'));

        await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Accounts'));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'warning', message: expect.stringContaining('reminder') }),
        );
    });

    it('hands focus to the next row when a subject is removed', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics' }]} />);

        await user.click(desktopTable().getAllByRole('button', { name: 'Remove subject 1' })[0] as HTMLElement);

        await waitFor(() => expect(desktopTable().getByRole('textbox', { name: 'Subject 1 name' })).toHaveFocus());
    });

    it('falls back to the add control when the last removable subject goes', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics' }]} />);

        await user.click(desktopTable().getAllByRole('button', { name: 'Remove subject 2' })[0] as HTMLElement);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Add subject' })).toHaveFocus());
    });

    it('recomputes the KPI flag from planned and actual minutes', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const actual = desktopInput('Actual minutes');
        await user.clear(actual);
        await user.type(actual, '48');
        expect(within(screen.getByRole('table')).getByText('Yes')).toBeInTheDocument();

        await user.clear(actual);
        await user.type(actual, '10');
        expect(within(screen.getByRole('table')).getByText('No')).toBeInTheDocument();
    });

    it('normalises a cleared numeric field to zero', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const planned = desktopInput('Planned minutes');
        await user.clear(planned);

        expect(planned).toHaveValue(0);
    });

    it('rejects an out-of-range duration and explains why', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const planned = desktopInput('Planned minutes');
        await user.clear(planned);
        await user.type(planned, '5000');

        // Typing is rejected keystroke by keystroke, so the last accepted value survives.
        expect(planned).toHaveValue(500);
        expect(planned).toHaveAttribute('aria-invalid', 'true');
        expect(errorTextFor(planned)).toContain('Enter a value between 0 and 1440');
    });

    it('declares the duration bounds it actually enforces', () => {
        render(<TrackerFormHarness />);

        const planned = desktopInput('Planned minutes');
        expect(planned).toHaveAttribute('min', '0');
        expect(planned).toHaveAttribute('max', '1440');
        expect(planned).toHaveAttribute('step', '1');
    });

    it('rejects a fractional duration and explains why', () => {
        render(<TrackerFormHarness />);

        const planned = desktopInput('Planned minutes');
        // A number input silently drops letters, so the malformed value has to
        // be injected to reach the validator at all.
        fireEvent.change(planned, { target: { value: '1.234' } });

        expect(planned).toHaveAttribute('aria-invalid', 'true');
        expect(errorTextFor(planned)).toContain('Enter a number of minutes');
    });

    it('clears the validation message once a valid value is typed', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const planned = desktopInput('Planned minutes');
        await user.clear(planned);
        await user.type(planned, '9999');
        expect(planned).toHaveAttribute('aria-invalid', 'true');

        await user.clear(planned);
        await user.type(planned, '45');

        expect(planned).not.toHaveAttribute('aria-invalid');
        expect(planned).toHaveValue(45);
    });

    it('rejects an over-long subject name, explains why, and keeps the stored value', () => {
        render(<TrackerFormHarness />);

        const name = desktopInput('Subject 1 name');
        // `maxLength` stops typing, so the guard is only reachable programmatically.
        fireEvent.change(name, { target: { value: 'x'.repeat(201) } });

        expect(name).toHaveAttribute('aria-invalid', 'true');
        expect(errorTextFor(name)).toContain('Keep the subject name to 200 characters or fewer');
        expect(name).toHaveValue('Accounts');
    });

    it('accepts a subject name exactly at the limit it advertises', () => {
        render(<TrackerFormHarness />);

        const name = desktopInput('Subject 1 name');
        fireEvent.change(name, { target: { value: 'x'.repeat(200) } });

        // The message says "200 or fewer", so 200 itself has to be accepted -
        // otherwise the limit the error names is one short of the one enforced.
        expect(name).not.toHaveAttribute('aria-invalid');
        expect(name).toHaveValue('x'.repeat(200));
    });

    it('keeps the subject name field within its maximum length', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const name = desktopInput('Subject 1 name');
        expect(name).toHaveAttribute('maxlength', '200');

        await user.clear(name);
        await user.type(name, 'Cost Accounting');

        expect(name).toHaveValue('Cost Accounting');
    });

    it('keys planner field ids to the subject id rather than the row position', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics' }]} />);

        expect(desktopTable().getByRole('textbox', { name: 'Subject 2 name' })).toHaveAttribute(
            'id',
            'desktop-subject-name-2',
        );

        await user.click(desktopTable().getAllByRole('button', { name: 'Remove subject 1' })[0] as HTMLElement);

        // The survivor is now row 1 but keeps the id its own field was bound to.
        expect(desktopTable().getByRole('textbox', { name: 'Subject 1 name' })).toHaveAttribute(
            'id',
            'desktop-subject-name-2',
        );
    });

    it('keeps a validation message with its own subject when an earlier row is removed', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[baseSubject, { ...baseSubject, id: 2, name: 'Economics' }]} />);

        const secondPlanned = desktopInput('Planned minutes', 1);
        fireEvent.change(secondPlanned, { target: { value: '5000' } });
        expect(secondPlanned).toHaveAttribute('aria-invalid', 'true');

        await user.click(desktopTable().getAllByRole('button', { name: 'Remove subject 1' })[0] as HTMLElement);

        const survivor = desktopInput('Planned minutes');
        expect(survivor).toHaveAttribute('id', 'desktop-subject-planned-2');
        expect(survivor).toHaveAttribute('aria-invalid', 'true');
        expect(errorTextFor(survivor)).toContain('Enter a value between 0 and 1440');
    });

    it('refuses a reminder without a scheduled time and says so in a live region', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        await user.click(plannerButton('Set reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: 'Please set a time for the reminder first.' }),
        );
        expect(NotificationService.scheduleNotification).not.toHaveBeenCalled();
    });

    it('schedules a reminder for later today and reports the outcome', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, id: 7, name: 'Accounts', time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        expect(call?.[0]).toBe(7);
        expect(call?.[3]).toEqual(new Date(2024, 0, 15, 9, 30, 0, 0));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success', message: expect.stringContaining('today') }),
        );
    });

    it('rolls a past reminder time over to tomorrow', async () => {
        setClock('2024-01-15T20:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        expect(call?.[3]).toEqual(new Date(2024, 0, 16, 9, 30, 0, 0));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success', message: expect.stringContaining('tomorrow') }),
        );
    });

    it('rolls over a month boundary without drifting', async () => {
        setClock('2024-01-31T23:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '22:00' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        expect(call?.[3]).toEqual(new Date(2024, 1, 1, 22, 0, 0, 0));
    });

    it('spells out the one-shot, session-bound nature of a web reminder', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        // The web path of the service reports that the alarm only lives as long
        // as the page does, so the form has to say so rather than imply a
        // standing daily reminder.
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({
            success: true,
            sessionOnly: true,
            reliableOnlyWhileOpen: true,
        });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('while this tab remains open') }),
        );
    });

    it('makes no session claim when the alarm is scheduled natively', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        const message = showToastSpy.mock.calls.at(-1)?.[0]?.message ?? '';
        expect(message).toContain('Reminder set for today at');
        expect(message).not.toContain('tab');
    });

    it('reports an alarm the device accepted but downgraded to an inexact one', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        // The plugin resolves a downgraded alarm as a *success*, and the service
        // documents `warning` as the only place the downgrade is ever reported.
        // A bare "Reminder set for today at 09:30" would promise an exact
        // minute the device has already said it cannot keep.
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({
            success: true,
            inexact: true,
            warning: 'AlarmManager will deliver in an inexact window',
        });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                message: expect.stringContaining('may deliver it a few minutes late'),
            }),
        );
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('AlarmManager will deliver') }),
        );
    });

    it('keeps the reminder armed even when the alarm came back inexact', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({ success: true, inexact: true });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        // A downgrade is a caveat, not a failure: the alarm is registered, so
        // the control has to flip to the cancel state in both layouts.
        await waitFor(() =>
            expect(screen.getAllByRole('button', { name: 'Cancel reminder for subject 1' })).toHaveLength(2),
        );
        const message = showToastSpy.mock.calls.at(-1)?.[0]?.message ?? '';
        expect(message).toMatch(/may deliver it a few minutes late\.?$/);
    });

    it('claims an exact minute only when the device reported no downgrade', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({ success: true });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        const message = showToastSpy.mock.calls.at(-1)?.[0]?.message ?? '';
        expect(message).not.toContain('late');
    });

    it('locks the reminder control while the device call is in flight', async () => {
        const user = userEvent.setup();
        let settle: ((result: { success: boolean }) => void) | undefined;
        vi.mocked(NotificationService.scheduleNotification).mockReturnValueOnce(
            new Promise((resolve) => {
                settle = resolve;
            }) as ReturnType<typeof NotificationService.scheduleNotification>,
        );
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        const trigger = plannerButton('Set reminder for subject 1');
        await user.click(trigger);

        expect(trigger).toBeDisabled();

        await act(async () => {
            settle?.({ success: true });
        });

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Set reminder for subject 1' })).toBeNull());
    });

    it('surfaces a rejected schedule and leaves the reminder off', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({ success: false, error: 'denied' });

        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);
        await user.click(plannerButton('Set reminder for subject 1'));

        expect(screen.getAllByRole('button', { name: 'Set reminder for subject 1' })).toHaveLength(2);
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('denied') }),
        );
    });

    it('survives a scheduler that throws outright', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockRejectedValueOnce(new Error('bridge down'));

        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);
        await user.click(plannerButton('Set reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('Unable to schedule') }),
        );
    });

    it('refuses a reminder for a subject with no id', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, id: 0, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('missing ID') }),
        );
    });

    it('refuses a reminder whose stored time is malformed', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '99:99' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('valid time') }),
        );
        expect(NotificationService.scheduleNotification).not.toHaveBeenCalled();
    });

    it('cancels an active reminder and flips the control back', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);

        await user.click(plannerButton('Cancel reminder for subject 1'));

        await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel reminder/ })).not.toBeInTheDocument());
        expect(NotificationService.cancelNotification).toHaveBeenCalledWith(1);
    });

    it('reports a reminder it could not cancel', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.cancelNotification).mockRejectedValueOnce(new Error('bridge down'));

        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);
        await user.click(plannerButton('Cancel reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('Unable to cancel') }),
        );
        // The alarm is still registered, so the control must not claim otherwise.
        expect(screen.getAllByRole('button', { name: 'Cancel reminder for subject 1' })).toHaveLength(2);
    });

    it('reports a cancel the device answers with a plain failure', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.cancelNotification).mockResolvedValueOnce(false);

        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);
        await user.click(plannerButton('Cancel reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('Unable to cancel') }),
        );
        expect(screen.getAllByRole('button', { name: 'Cancel reminder for subject 1' })).toHaveLength(2);
    });

    it('cancels the reminder when its time is changed', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);

        await user.click(plannerButton(/Study time: 9:30 AM/));
        const dialog = await screen.findByRole('dialog', { name: 'Set study time' });
        await user.click(within(dialog).getByRole('button', { name: 'Increase hour' }));
        await user.click(within(dialog).getByRole('button', { name: 'Set' }));

        expect(NotificationService.cancelNotification).toHaveBeenCalledWith(1);
        await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel reminder/ })).not.toBeInTheDocument());
        expect(plannerButton(/Study time: 10:30 AM/)).toBeInTheDocument();
    });

    it('keeps the old time when the reminder it would strand cannot be cancelled', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.cancelNotification).mockRejectedValueOnce(new Error('bridge down'));

        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);

        await user.click(plannerButton(/Study time: 9:30 AM/));
        const dialog = await screen.findByRole('dialog', { name: 'Set study time' });
        await user.click(within(dialog).getByRole('button', { name: 'Increase hour' }));
        await user.click(within(dialog).getByRole('button', { name: 'Set' }));

        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('Unable to cancel') }),
        );
        // Storing the new time would leave an alarm pending at a time the planner
        // no longer shows, so both the time and the reminder stay as they were.
        expect(plannerButton(/Study time: 9:30 AM/)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Cancel reminder for subject 1' })).toHaveLength(2);
    });

    it('changes a time freely while no reminder is scheduled', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton(/Study time: 9:30 AM/));
        const dialog = await screen.findByRole('dialog', { name: 'Set study time' });
        await user.click(within(dialog).getByRole('button', { name: 'Increase hour' }));
        await user.click(within(dialog).getByRole('button', { name: 'Set' }));

        expect(NotificationService.cancelNotification).not.toHaveBeenCalled();
        expect(plannerButton(/Study time: 10:30 AM/)).toBeInTheDocument();
    });

    it('collects recurring days in a modal and applies them to the subject', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(within(dialog).getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
        expect(plannerButton('Configure recurring days for subject 1')).toHaveAttribute('aria-pressed', 'false');

        await user.click(within(dialog).getByRole('button', { name: 'Monday' }));
        await user.click(within(dialog).getByRole('button', { name: 'Tuesday' }));
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));

        expect(plannerButton('Configure recurring days for subject 1')).toHaveAttribute('aria-pressed', 'true');
        // Five of the seven days remain, and the desktop control summarises how many.
        expect(
            desktopTable().getByRole('button', { name: 'Configure recurring days for subject 1' }),
        ).toHaveTextContent('5');
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());
    });

    it('groups the day pickers and describes the current selection', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        const days = within(dialog).getByRole('group', { name: 'Days of the week' });
        expect(within(days).getAllByRole('button')).toHaveLength(7);

        const hint = document.getElementById(
            within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-describedby') ?? '',
        );
        expect(hint).toHaveTextContent('7 of 7 days selected.');

        await user.click(within(dialog).getByRole('button', { name: 'Monday' }));
        expect(hint).toHaveTextContent('6 of 7 days selected.');
    });

    it('cannot save an empty selection of recurring days and says why', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        for (const dayName of DAY_NAMES) {
            await user.click(within(dialog).getByRole('button', { name: dayName }));
        }

        const save = within(dialog).getByRole('button', { name: 'Save' });
        expect(save).toBeDisabled();
        expect(document.getElementById(save.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
            'Select at least one day to save.',
        );

        await user.click(within(dialog).getByRole('button', { name: 'Monday' }));
        expect(save).toBeEnabled();
    });

    it('offers the whole week to a subject that has no stored days', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [] }]} />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        for (const dayName of DAY_NAMES) {
            expect(within(dialog).getByRole('button', { name: dayName })).toHaveAttribute('aria-pressed', 'true');
        }
        expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('closes the recurring dialog from its close control without touching the subject', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        await user.click(within(dialog).getByRole('button', { name: 'Monday' }));
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());
        expect(plannerButton('Configure recurring days for subject 1')).toHaveAttribute('aria-pressed', 'false');
    });

    it('closes the recurring dialog on Escape and gives focus back to its trigger', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const trigger = plannerButton('Configure recurring days for subject 1');
        await user.click(trigger);
        await screen.findByRole('dialog', { name: 'Recurring Days' });

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('gives focus back to its trigger after saving the days', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const trigger = plannerButton('Configure recurring days for subject 1');
        await user.click(trigger);
        const dialog = await screen.findByRole('dialog', { name: 'Recurring Days' });
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('stops repeating days on a subject that already repeats', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 3] }]} />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        await user.click(within(dialog).getByRole('button', { name: 'Stop Repeating' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());
        expect(plannerButton('Configure recurring days for subject 1')).toHaveAttribute('aria-pressed', 'false');
    });

    it('restores the chosen days when the dialog is reopened after stopping', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 3] }]} />);

        let dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        await user.click(within(dialog).getByRole('button', { name: 'Stop Repeating' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recurring Days' })).not.toBeInTheDocument());

        dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        expect(within(dialog).getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(dialog).getByRole('button', { name: 'Wednesday' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(dialog).getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('traps Tab inside the recurring dialog', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        await waitFor(() => expect(within(dialog).getByRole('button', { name: /Close/ })).toHaveFocus());

        const save = within(dialog).getByRole('button', { name: 'Save' });
        save.focus();
        await user.tab();
        expect(within(dialog).getByRole('button', { name: /Close/ })).toHaveFocus();
    });

    it('spells out the repeating days for screen readers on the card layout', () => {
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 3] }]} />);

        expect(screen.getAllByText('Repeats on Monday, Wednesday.').length).toBeGreaterThan(0);
    });

    it('describes the repeating days on the table layout too', () => {
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 3] }]} />);

        // The table's repeat control is icon-only, so without a description a
        // desktop screen-reader user never learns which days are selected.
        const trigger = desktopTable().getByRole('button', { name: 'Configure recurring days for subject 1' });
        const describedBy = trigger.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Repeats on Monday, Wednesday.');
    });

    it('says on the table layout that a subject repeats on no day', () => {
        render(<TrackerFormHarness />);

        const trigger = desktopTable().getByRole('button', { name: 'Configure recurring days for subject 1' });
        const describedBy = trigger.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Does not repeat on any day.');
    });

    it('keeps the table repeat count in step with the days it describes', () => {
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 3] }]} />);

        // The count is read from the same day list as the sentence, so a stale
        // `recurringDays` array cannot make the two disagree.
        expect(
            desktopTable().getByRole('button', { name: 'Configure recurring days for subject 1' }),
        ).toHaveTextContent('2');
    });

    it('drops out-of-range and duplicate stored days before counting them', async () => {
        const user = userEvent.setup();
        // `storage.ts` rejects these on the way in, but the dialog both counts
        // and republishes whatever it is handed.
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [1, 1, 9] }]} />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        const hint = document.getElementById(
            within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-describedby') ?? '',
        );

        expect(hint).toHaveTextContent('1 of 7 days selected.');
        expect(within(dialog).getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(dialog).getByRole('button', { name: 'Wednesday' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('falls back to the whole week when the stored days are all out of range', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, recurring: true, recurringDays: [9] }]} />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        for (const dayName of DAY_NAMES) {
            expect(within(dialog).getByRole('button', { name: dayName })).toHaveAttribute('aria-pressed', 'true');
        }
        expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('announces the day selection as it changes', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        const hint = within(dialog).getByRole('status');

        // A bare `aria-live` paragraph is not reliably announced on change; a
        // `status` region is, and it is what the Save button is described by.
        expect(hint).toHaveAttribute('aria-live', 'polite');
        expect(hint).toHaveAttribute('aria-atomic', 'true');

        await user.click(within(dialog).getByRole('button', { name: 'Monday' }));
        expect(hint).toHaveTextContent('6 of 7 days selected.');
    });

    it('groups the day toggles in a real fieldset', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');
        const days = within(dialog).getByRole('group', { name: 'Days of the week' });

        expect(days.tagName).toBe('FIELDSET');
        expect(within(days).getAllByRole('button')).toHaveLength(7);
    });

    it('spells out whether a subject met its KPI on the card layout', () => {
        render(
            <TrackerFormHarness
                initial={[
                    { ...baseSubject, id: 1, name: 'Accounts', planned: '60', actual: '50', kpi: 'Y' },
                    { ...baseSubject, id: 2, name: 'Economics', planned: '60', actual: '0', kpi: 'N' },
                ]}
            />,
        );

        // A bare tick reads as "check mark KPI", which does not say whether the
        // goal was met or name the subject it belongs to.
        expect(screen.getAllByText('Accounts: KPI met').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Economics: KPI not met').length).toBeGreaterThan(0);

        // The glyphs stay on screen but are decoration; the sentence replaces
        // them for assistive technology.
        const met = screen.getAllByText('Accounts: KPI met')[0] as HTMLElement;
        const caption = met.previousElementSibling;
        expect(caption).toHaveAttribute('aria-hidden', 'true');
        expect(caption).toHaveTextContent('KPI');
        expect(caption?.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
        expect(caption?.previousElementSibling).toHaveTextContent('✓');
    });

    it('does not hand out a duplicate subject id when a stored one sits at the id ceiling', async () => {
        const user = userEvent.setup();
        // `storage.ts` accepts ids up to `Number.MAX_SAFE_INTEGER`, so a JSON
        // backup can deliver exactly this. `MAX + 1` is the first float past the
        // safe range and adding one to *it* rounds back to itself, which used to
        // give both new rows the same id - and with it the same React key, the
        // same `desktop-subject-name-<id>` and the same validation-message key.
        render(<TrackerFormHarness initial={[{ ...baseSubject, id: Number.MAX_SAFE_INTEGER }]} />);

        await user.click(screen.getByRole('button', { name: 'Add subject' }));
        await user.click(screen.getByRole('button', { name: 'Add subject' }));

        const ids = screen.getByTestId('ids').textContent?.split(',') ?? [];
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);

        const nameIds = screen
            .getAllByRole('textbox', { name: /name$/ })
            .map((field) => field.getAttribute('id'))
            .filter(Boolean);
        expect(new Set(nameIds).size).toBe(nameIds.length);
    });

    it('keeps each new subject row independent past the id ceiling', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, id: Number.MAX_SAFE_INTEGER }]} />);

        await user.click(screen.getByRole('button', { name: 'Add subject' }));

        const added = desktopInput('Subject 2 name');
        await user.clear(added);
        await user.type(added, 'Economics');

        // A duplicate key would have written both edits into the same row.
        expect(desktopInput('Subject 2 name')).toHaveValue('Economics');
        expect(desktopInput('Subject 1 name')).toHaveValue('Accounts');
    });

    it('says when a subject does not repeat on any day', () => {
        render(<TrackerFormHarness />);

        expect(screen.getAllByText('Does not repeat on any day.').length).toBeGreaterThan(0);
    });

    it('derives the day rating from the share of met KPIs', () => {
        const build = (met: number, total: number) =>
            Array.from({ length: total }, (_, index) => ({
                ...baseSubject,
                id: index + 1,
                kpi: index < met ? ('Y' as const) : ('N' as const),
            }));
        const totalRow = () => within(screen.getByRole('table')).getByText('Total').closest('tr');

        const { unmount } = render(<TrackerFormHarness initial={build(4, 5)} />);
        expect(totalRow()).toHaveTextContent('Productive');
        unmount();

        render(<TrackerFormHarness key="okayish" initial={build(3, 5)} />);
        expect(totalRow()).toHaveTextContent('Okayish');
    });

    it('treats a subject list with no KPI as unproductive', () => {
        render(
            <TrackerFormHarness
                initial={[
                    { ...baseSubject, id: 1, kpi: 'N' },
                    { ...baseSubject, id: 2, kpi: 'N' },
                ]}
            />,
        );

        expect(within(screen.getByRole('table')).getByText('Total').closest('tr')).toHaveTextContent('Unproductive');
    });

    it('routes every reminder failure through the shared toast context', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '99:99' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        expect(showToastSpy).toHaveBeenCalledTimes(1);
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: expect.stringContaining('valid time') }),
        );
    });

    it('rolls a past reminder over a year boundary', async () => {
        setClock('2024-12-31T23:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '22:00' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        expect(call?.[3]).toEqual(new Date(2025, 0, 1, 22, 0, 0, 0));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success', message: expect.stringContaining('tomorrow') }),
        );
    });

    it('rolls over even on a day whose successor cannot be named as a date key', async () => {
        // `addLocalDays` answers with a `YYYY-MM-DD` key, and there is no such key
        // for the day after 9999-12-31. Leaving the instant in the past instead
        // asked the service for an alarm it can only refuse with "must be in the
        // future", so the rollover has to fall back to the wall clock.
        setClock('9999-12-31T23:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '22:00' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        expect(call?.[3]).toEqual(new Date(10000, 0, 1, 22, 0, 0, 0));
        expect(showToastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success', message: expect.stringContaining('tomorrow') }),
        );
    });

    it('does not arm a second alarm while the first call is still in flight', async () => {
        const user = userEvent.setup();
        let settle: ((result: { success: boolean }) => void) | undefined;
        vi.mocked(NotificationService.scheduleNotification).mockReturnValueOnce(
            new Promise((resolve) => {
                settle = resolve;
            }) as ReturnType<typeof NotificationService.scheduleNotification>,
        );
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        const trigger = plannerButton('Set reminder for subject 1');
        await user.click(trigger);
        await user.click(trigger);

        // The alarm is already registered with the device at this point, so a
        // second schedule would be a duplicate the user cannot see or cancel.
        expect(NotificationService.scheduleNotification).toHaveBeenCalledTimes(1);

        await act(async () => {
            settle?.({ success: true });
        });
    });

    it('announces a reminder it cancelled, which the bell icon alone cannot', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30', reminder: true }]} />);

        await user.click(plannerButton('Cancel reminder for subject 1'));

        await waitFor(() =>
            expect(showToastSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'info', message: 'Reminder cancelled.' }),
            ),
        );
    });

    it('names a subject whose name was cleared in the reminder it schedules', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, name: '', time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(NotificationService.scheduleNotification).toHaveBeenCalled());
        const call = vi.mocked(NotificationService.scheduleNotification).mock.calls[0];
        // "Study Time: " and "It's time to start studying !" are not reminders.
        expect(call?.[1]).toBe('Study Time: subject 1');
        expect(call?.[2]).toContain("It's time to start studying subject 1!");
    });

    it('keeps a duration it cannot read out of the totals', () => {
        render(<TrackerFormHarness initial={[{ ...baseSubject, planned: 'Infinity', actual: 'not a number' }]} />);

        // `parseFloat('Infinity') || 0` is `Infinity`, so one unreadable row used
        // to print "Infinity" and take the real totals with it.
        const totalRow = within(screen.getByRole('table')).getByText('Total').closest('tr');
        expect(totalRow).toHaveTextContent('Total00Unproductive');
        expect(totalRow).not.toHaveTextContent(/Infinity|NaN/);
    });

    it('names a row whose subject name was cleared', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness />);

        await user.clear(desktopInput('Subject 1 name'));

        expect(desktopTable().getByRole('spinbutton', { name: 'Planned minutes for subject 1' })).toBeInTheDocument();
        expect(desktopTable().getByRole('spinbutton', { name: 'Actual minutes for subject 1' })).toBeInTheDocument();
        // The sentence starts with the name, so a cleared one left a bare ":".
        expect(screen.getAllByText('Subject 1: KPI not met').length).toBeGreaterThan(0);
    });

    it('keeps a long subject name out of the control names', () => {
        render(<TrackerFormHarness />);

        fireEvent.change(desktopInput('Subject 1 name'), { target: { value: 'x'.repeat(200) } });

        const [planned] = desktopTable().getAllByRole('spinbutton');
        const label = planned?.getAttribute('aria-label') ?? '';
        expect(label).toMatch(/^Planned minutes for x+…$/u);
        expect(label.length).toBeLessThan(100);
    });

    it('describes the recurring dialog for a subject whose name was cleared', async () => {
        const user = userEvent.setup();
        render(<TrackerFormHarness initial={[{ ...baseSubject, name: '  ' }]} />);

        const dialog = await openRecurringDialog(user, 'Configure recurring days for subject 1');

        expect(within(dialog).getByText(/Select days to repeat/)).toHaveTextContent(
            'Select days to repeat this subject:',
        );
    });

    it('keeps a long device error out of the reminder toast', async () => {
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({
            success: false,
            error: 'E'.repeat(400),
        });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        const message = showToastSpy.mock.calls.at(-1)?.[0]?.message ?? '';
        // The toast is a one-line summary drawn on top of the planner.
        expect(message).toMatch(/^Failed to schedule notification: E+…$/u);
        expect(message.length).toBeLessThan(200);
    });

    it('keeps a long downgrade warning out of the reminder toast', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({
            success: true,
            inexact: true,
            warning: 'W'.repeat(400),
        });
        render(<TrackerFormHarness initial={[{ ...baseSubject, time: '09:30' }]} />);

        await user.click(plannerButton('Set reminder for subject 1'));

        await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
        const message = showToastSpy.mock.calls.at(-1)?.[0]?.message ?? '';
        expect(message).toMatch(/few minutes late: W+…$/u);
        expect(message.length).toBeLessThan(250);
    });

    it('gives every control a DOM id that no other control shares', () => {
        render(
            <TrackerFormHarness
                initial={[
                    { ...baseSubject, id: 1, recurring: true, recurringDays: [1, 3] },
                    { ...baseSubject, id: 2, name: 'Economics', reminder: true, time: '09:00' },
                ]}
            />,
        );
        // The planner draws a card layout and a table layout at once, so every
        // per-row id exists twice in the document and only the prefix keeps the
        // pair apart.
        fireEvent.change(desktopInput('Planned minutes', 1), { target: { value: '5000' } });

        const ids = Array.from(document.querySelectorAll('[id]'))
            .map((element) => element.id)
            .filter(Boolean);
        expect(ids.length).toBeGreaterThan(0);
        expect([...new Set(ids)].filter((id) => ids.filter((other) => other === id).length > 1)).toEqual([]);
    });
});
