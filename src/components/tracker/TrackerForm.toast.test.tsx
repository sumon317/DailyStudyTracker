import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../providers/ToastProvider';
import type { Subject } from '../../types';
import TrackerForm from './TrackerForm';

vi.mock('../../services/notificationService', () => ({
    NotificationService: {
        scheduleNotification: vi.fn().mockResolvedValue({ success: true }),
        cancelNotification: vi.fn().mockResolvedValue(true),
    },
}));

const baseSubject: Subject = {
    id: 1,
    name: 'Accounts',
    planned: '60',
    actual: '0',
    kpi: 'N',
    time: '',
    reminder: false,
};

const Harness = ({ initial }: { initial: Subject[] }) => {
    const [subjects, setSubjects] = useState<Subject[]>(initial);
    return <TrackerForm subjects={subjects} setSubjects={setSubjects} />;
};

const renderPlanner = (initial: Subject[]) =>
    render(
        <ToastProvider>
            <Harness initial={initial} />
        </ToastProvider>,
    );

const reminderButton = (name: string | RegExp) => screen.getAllByRole('button', { name })[0] as HTMLElement;
const setClock = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
};

// The unit suite stubs `useToast`; these cases keep the real provider so the
// announcement path (toast -> live region) is exercised end to end.
describe('TrackerForm toast integration', () => {
    it('announces a missing reminder time in an assertive live region', async () => {
        const user = userEvent.setup();
        renderPlanner([{ ...baseSubject }]);

        await user.click(reminderButton('Set reminder for subject 1'));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Please set a time for the reminder first.');
        expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('announces a successful reminder politely', async () => {
        const user = userEvent.setup();
        renderPlanner([{ ...baseSubject, time: '09:30' }]);

        await user.click(reminderButton('Set reminder for subject 1'));

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent(/Reminder set for (today|tomorrow) at/);
        expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('announces the session-only caveat of a web reminder', async () => {
        setClock('2024-01-15T08:00:00');
        const user = userEvent.setup();
        const { NotificationService } = await import('../../services/notificationService');
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValueOnce({
            success: true,
            sessionOnly: true,
            reliableOnlyWhileOpen: true,
        });
        renderPlanner([{ ...baseSubject, time: '09:30' }]);

        await user.click(reminderButton('Set reminder for subject 1'));

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent(/Reminder set for today at .* while this tab remains open\./);
        vi.useRealTimers();
    });

    it('keeps the planner usable and dismisses the toast on request', async () => {
        const user = userEvent.setup();
        renderPlanner([{ ...baseSubject }]);

        await user.click(reminderButton('Set reminder for subject 1'));
        await screen.findByRole('alert');

        await user.click(screen.getByRole('button', { name: /^Dismiss notification:/ }));

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Study Planner' })).toBeInTheDocument();
    });

    it('announces a cancelled reminder politely', async () => {
        const user = userEvent.setup();
        renderPlanner([{ ...baseSubject, time: '09:30', reminder: true }]);

        await user.click(reminderButton('Cancel reminder for subject 1'));

        // The bell swaps its icon and nothing else, so without this the one
        // outcome of the control a screen reader is never told about is the one
        // the user asked for.
        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('Reminder cancelled.');
        expect(status).toHaveAttribute('aria-live', 'polite');
        await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel reminder/ })).toBeNull());
    });
});
