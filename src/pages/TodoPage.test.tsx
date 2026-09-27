import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../providers/ToastProvider';
import type { Todo } from '../types';

const mocks = vi.hoisted(() => ({
    cancelTodoNotification: vi.fn(),
    scheduleTodoNotification: vi.fn(),
}));

vi.mock('../services/notificationService', () => ({
    NotificationService: {
        cancelTodoNotification: mocks.cancelTodoNotification,
        scheduleTodoNotification: mocks.scheduleTodoNotification,
    },
}));

import TodoPage from './TodoPage';

const todo = (overrides: Partial<Todo> = {}): Todo => ({
    id: 101,
    text: 'Revise accounts',
    completed: false,
    time: '09:00',
    reminder: false,
    ...overrides,
});

const Harness = ({ initial, onChange }: { initial: Todo[]; onChange?: (todos: Todo[]) => void }) => {
    const [todos, setTodos] = useState<Todo[]>(initial);
    return (
        <TodoPage
            todos={todos}
            setTodos={(updater) =>
                setTodos((previous) => {
                    const next = typeof updater === 'function' ? updater(previous) : updater;
                    onChange?.(next);
                    return next;
                })
            }
        />
    );
};

const renderPage = (initial: Todo[], onChange?: (todos: Todo[]) => void) =>
    render(
        <ToastProvider>
            <Harness initial={initial} onChange={onChange} />
        </ToastProvider>,
    );

/**
 * The live toast region. It is looked up by role rather than by text because a
 * rejection has to be observable *while it is on screen*: `expectToast` proves
 * the text, and this proves the toast is actually announced.
 */
const errorToast = () => screen.findByRole('alert', {}, { timeout: 4000 });
const expectToast = async (message: string | RegExp) => {
    const node = await screen.findByText(message);
    expect(node).toBeInTheDocument();
};

describe('TodoPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cancelTodoNotification.mockResolvedValue(true);
        mocks.scheduleTodoNotification.mockResolvedValue({ success: true });
    });

    it('keeps a todo whose reminder could not be cancelled', async () => {
        mocks.cancelTodoNotification.mockResolvedValue(false);
        renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: /delete task revise accounts/i }));

        await expectToast('The reminder could not be cancelled; the task was not deleted.');
        expect(screen.getByText('Revise accounts')).toBeInTheDocument();
        expect(mocks.cancelTodoNotification).toHaveBeenCalledWith(101);
    });

    it('deletes the todo once its reminder is cancelled', async () => {
        renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: /delete task revise accounts/i }));

        await waitFor(() => expect(screen.queryByText('Revise accounts')).not.toBeInTheDocument());
        expect(mocks.cancelTodoNotification).toHaveBeenCalledWith(101);
    });

    it('deletes a todo without a reminder without touching notifications', async () => {
        renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: /delete task revise accounts/i }));

        await waitFor(() => expect(screen.queryByText('Revise accounts')).not.toBeInTheDocument());
        expect(mocks.cancelTodoNotification).not.toHaveBeenCalled();
    });

    it('keeps the todo incomplete when the reminder cancellation fails', async () => {
        mocks.cancelTodoNotification.mockResolvedValue(false);
        const { container } = renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' }));

        await expectToast('The reminder could not be cancelled; the task was not completed.');
        expect(mocks.cancelTodoNotification).toHaveBeenCalledWith(101);
        expect(container.querySelector('.line-through')).toBeNull();
    });

    it('completes a todo once its reminder is cancelled', async () => {
        const { container } = renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' }));

        await waitFor(() => expect(container.querySelector('.line-through')).not.toBeNull());
        expect(mocks.cancelTodoNotification).toHaveBeenCalledWith(101);
    });

    it('restores an armed reminder when a completed todo is reopened', async () => {
        // App's reconcile re-arms from the definition list, so a completed todo
        // must carry its `reminder` flag forward to get its notification back.
        const { container } = renderPage([todo({ completed: true, reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as not done' }));

        await waitFor(() => expect(container.querySelector('.line-through')).toBeNull());
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();
    });

    it('completes a todo without a reminder without touching notifications', async () => {
        const { container } = renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' }));

        // Cancelling a reminder that was never armed still costs a bridge round
        // trip, and a failure there blocked the user from completing their own task
        // behind a message about a reminder that did not exist.
        await waitFor(() => expect(container.querySelector('.line-through')).not.toBeNull());
        expect(mocks.cancelTodoNotification).not.toHaveBeenCalled();
    });

    it('completes a todo whose reminder cancellation reports a failure', async () => {
        // The guard is about *arming*: a task with no reminder has nothing to cancel,
        // so an unreadable notification bridge must not stand between the user and
        // ticking off their work.
        mocks.cancelTodoNotification.mockRejectedValue(new Error('bridge offline'));
        const { container } = renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' }));

        await waitFor(() => expect(container.querySelector('.line-through')).not.toBeNull());
        expect(mocks.cancelTodoNotification).not.toHaveBeenCalled();
    });

    it('treats a rejected cancellation as a failed one instead of failing silently', async () => {
        // A rejected promise is not a cancellation the bridge declined - it is a
        // bridge that would not answer at all. Both leave the reminder armed, so
        // both have to produce the same message and the same unchanged task; the
        // throw used to escape the handler's `try/finally` entirely, so the user
        // got no message, no completed task, and an unhandled rejection.
        mocks.cancelTodoNotification.mockRejectedValue(new Error('bridge offline'));
        const { container } = renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' }));

        await expectToast('The reminder could not be cancelled; the task was not completed.');
        expect(container.querySelector('.line-through')).toBeNull();
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();
        // The row is usable again: a stuck pending flag would leave the controls
        // dead for the rest of the session.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Mark "Revise accounts" as done' })).toBeEnabled(),
        );
    });

    it('keeps a task whose rejected cancellation leaves its reminder armed', async () => {
        mocks.cancelTodoNotification.mockRejectedValue(new Error('bridge offline'));
        renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: /delete task revise accounts/i }));

        await expectToast('The reminder could not be cancelled; the task was not deleted.');
        expect(screen.getByText('Revise accounts')).toBeInTheDocument();
    });

    it('keeps the reminder armed when its cancellation is rejected from the toggle', async () => {
        mocks.cancelTodoNotification.mockRejectedValue(new Error('bridge offline'));
        renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: /cancel reminder for revise accounts/i }));

        await expectToast('Failed to cancel the reminder. Please try again.');
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();
    });

    it('reports a rejected schedule instead of raising an unhandled rejection', async () => {
        mocks.scheduleTodoNotification.mockRejectedValue(new Error('bridge offline'));
        renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await expectToast(/Failed to schedule the reminder:/);
        // Nothing was armed, so the control must still offer to arm it.
        expect(screen.getByRole('button', { name: /set reminder for revise accounts/i })).toBeInTheDocument();
    });

    it('never reuses a todo id, so reminders cannot collide', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
        const snapshots: Todo[][] = [];
        renderPage([todo({ id: Date.now() })], (next) => snapshots.push(next));

        const input = screen.getByPlaceholderText('Add a new task...');
        for (const text of ['First task', 'Second task']) {
            fireEvent.change(input, { target: { value: text } });
            fireEvent.submit(input.closest('form') as HTMLFormElement);
        }

        expect(snapshots).toHaveLength(2);
        expect(snapshots[0]?.[0]?.id).toBe(Date.now() + 1);
        expect(snapshots[1]?.[0]?.id).toBe(Date.now() + 2);
        const ids = (snapshots[1] ?? []).map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        vi.useRealTimers();
    });

    it('ignores a repeated submit of the same text in one tick', () => {
        const snapshots: Todo[][] = [];
        renderPage([], (next) => snapshots.push(next));

        const input = screen.getByPlaceholderText('Add a new task...');
        fireEvent.change(input, { target: { value: 'Only once' } });
        const form = input.closest('form') as HTMLFormElement;
        fireEvent.submit(form);
        fireEvent.submit(form);

        // The disabled submit button does not stop an implicit submit from the
        // text field, so a second Enter in the same tick has to be ignored.
        expect(snapshots).toHaveLength(1);
    });

    it('schedules a reminder for a parsed time and reports the session caveat', async () => {
        renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await waitFor(() =>
            expect(mocks.scheduleTodoNotification).toHaveBeenCalledWith(
                101,
                'ToDo Reminder',
                "Don't forget: Revise accounts",
                9,
                0,
                'TODO_ACTIONS',
            ),
        );
        await expectToast(/Reminder set at 09:00\./);
    });

    it('announces that a web reminder only lasts for the session', async () => {
        mocks.scheduleTodoNotification.mockResolvedValue({ success: true, sessionOnly: true });
        renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await expectToast('Reminder set while this tab remains open at 09:00.');
    });

    it('refuses to schedule a reminder without a time', async () => {
        renderPage([todo({ time: '' })]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await expectToast('Please set a time for the reminder first.');
        expect(mocks.scheduleTodoNotification).not.toHaveBeenCalled();
    });

    it('refuses a time that is not a valid 24-hour value', async () => {
        renderPage([todo({ time: '9:5' })]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await expectToast(/not a valid 24-hour time/i);
        expect(mocks.scheduleTodoNotification).not.toHaveBeenCalled();
    });

    it('reports a scheduling failure without arming the reminder', async () => {
        mocks.scheduleTodoNotification.mockResolvedValue({
            success: false,
            error: 'Exact alarm permission not granted',
        });
        renderPage([todo()]);

        fireEvent.click(screen.getByRole('button', { name: /set reminder for revise accounts/i }));

        await expectToast('Failed to schedule the reminder: Exact alarm permission not granted');
        expect(screen.getByRole('button', { name: /set reminder for revise accounts/i })).toBeInTheDocument();
    });

    it('cancels an armed reminder and keeps it armed when the cancellation fails', async () => {
        const { rerender } = render(
            <ToastProvider>
                <Harness initial={[todo({ reminder: true })]} />
            </ToastProvider>,
        );
        mocks.cancelTodoNotification.mockResolvedValue(false);

        fireEvent.click(screen.getByRole('button', { name: /cancel reminder for revise accounts/i }));
        await expectToast('Failed to cancel the reminder. Please try again.');
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();

        mocks.cancelTodoNotification.mockResolvedValue(true);
        rerender(
            <ToastProvider>
                <Harness initial={[todo({ reminder: true })]} />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: /cancel reminder for revise accounts/i }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /set reminder for revise accounts/i })).toBeInTheDocument(),
        );
    });

    it('ignores a repeated time change that would silently disarm the reminder', async () => {
        const snapshots: Todo[][] = [];
        renderPage([todo({ reminder: true, time: '09:00' })], (next) => snapshots.push(next));

        // Re-opening the picker and confirming the same time is not an edit.
        fireEvent.click(screen.getByRole('button', { name: /study time: 9:00 am/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^set$/i }));

        await waitFor(() => expect(screen.queryByRole('button', { name: /^set$/i })).not.toBeInTheDocument());
        expect(mocks.cancelTodoNotification).not.toHaveBeenCalled();
        expect(snapshots).toHaveLength(0);
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();
    });

    it('cancels the reminder when the time really changes', async () => {
        const snapshots: Todo[][] = [];
        renderPage([todo({ reminder: true, time: '09:00' })], (next) => snapshots.push(next));

        fireEvent.click(screen.getByRole('button', { name: /study time: 9:00 am/i }));
        fireEvent.click(await screen.findByRole('button', { name: /increase hour/i }));
        fireEvent.click(screen.getByRole('button', { name: /^set$/i }));

        await waitFor(() => expect(mocks.cancelTodoNotification).toHaveBeenCalledWith(101));
        await waitFor(() => expect(snapshots).toHaveLength(1));
        expect(snapshots[0]?.[0]?.time).toBe('10:00');
        // A changed time invalidates the armed reminder; the user re-arms it.
        expect(snapshots[0]?.[0]?.reminder).toBe(false);
    });

    it('runs one reminder mutation when the control is double-pressed', async () => {
        let releaseCancel: ((value: boolean) => void) | undefined;
        mocks.cancelTodoNotification.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    releaseCancel = resolve;
                }),
        );
        const snapshots: Todo[][] = [];
        renderPage([todo({ reminder: true })], (next) => snapshots.push(next));

        const button = screen.getByRole('button', { name: /delete task revise accounts/i });
        fireEvent.click(button);
        fireEvent.click(button);

        expect(mocks.cancelTodoNotification).toHaveBeenCalledTimes(1);
        releaseCancel?.(true);
        await waitFor(() => expect(snapshots).toHaveLength(1));
    });

    it('names its form field and its row controls for assistive technology', () => {
        renderPage([todo()]);
        expect(screen.getByLabelText('New task')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /set reminder for revise accounts/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete task revise accounts/i })).toBeInTheDocument();
    });

    it('announces failures in an assertive live region', async () => {
        mocks.cancelTodoNotification.mockResolvedValue(false);
        renderPage([todo({ reminder: true })]);

        fireEvent.click(screen.getByRole('button', { name: /delete task revise accounts/i }));

        const node = await errorToast();
        expect(node).toHaveAttribute('aria-live', 'assertive');
        expect(node).toHaveTextContent(/could not be cancelled/);
    });

    it('leaves the time unchanged when its cancellation is rejected', async () => {
        // Last in the file on purpose: the time picker is portalled, and letting a
        // popover's exit animation outlive the test that opened it makes the next
        // one's unmount fail on a node that is already gone.
        const snapshots: Todo[][] = [];
        mocks.cancelTodoNotification.mockRejectedValue(new Error('bridge offline'));
        renderPage([todo({ reminder: true, time: '09:00' })], (next) => snapshots.push(next));

        fireEvent.click(screen.getByRole('button', { name: 'Study time: 9:00 AM' }));
        fireEvent.click(await screen.findByRole('button', { name: /increase hour/i }));
        fireEvent.click(screen.getByRole('button', { name: /^set$/i }));

        await expectToast('The reminder could not be cancelled; the time was not changed.');
        await waitFor(() => expect(screen.queryByRole('button', { name: /^set$/i })).not.toBeInTheDocument());
        expect(snapshots).toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Study time: 9:00 AM' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel reminder for revise accounts/i })).toBeInTheDocument();
    });
});
