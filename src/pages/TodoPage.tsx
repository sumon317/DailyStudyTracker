import { Bell, BellOff, CheckSquare, Plus, Square, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import TimePicker from '../components/shared/TimePicker';
import { useToast } from '../providers/ToastProvider';
import { NotificationService } from '../services/notificationService';
import type { Todo, TodoPageProps } from '../types';

/**
 * A reminder cancellation that *throws* has to read as one that failed.
 *
 * The service reports a refusal as `false`, and every handler below already has a
 * message and a recovery path for that. A rejected promise - a bridge that
 * refuses to answer at all, a partial `NotificationService`, a future refactor -
 * used to escape the `try/finally` those handlers use instead: no toast, the task
 * silently unchanged, and an unhandled rejection on top. For the user the two are
 * the same event, so they are collapsed into the one answer.
 */
const cancelTodoReminder = async (id: number): Promise<boolean> => {
    try {
        return await NotificationService.cancelTodoNotification(id);
    } catch {
        return false;
    }
};

const SCHEDULE_FAILED_ERROR = 'The reminder service could not be reached.';

const scheduleTodoReminder = async (
    id: number,
    title: string,
    body: string,
    hour: number,
    minute: number,
): Promise<{ success: boolean; error?: string; sessionOnly?: boolean }> => {
    try {
        return await NotificationService.scheduleTodoNotification(id, title, body, hour, minute, 'TODO_ACTIONS');
    } catch {
        return { success: false, error: SCHEDULE_FAILED_ERROR };
    }
};

// Todo ids double as notification entity ids, so a Date.now() collision would merge two
// reminders into one notification and duplicate React keys.
const nextTodoId = (existing: Todo[]): number => {
    let candidate = Date.now();
    const taken = new Set(existing.map((todo) => todo.id));
    while (taken.has(candidate)) {
        candidate += 1;
    }
    return candidate;
};

const parseReminderTime = (time: string): { hours: number; minutes: number } | null => {
    const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) {
        return null;
    }
    return { hours: Number(time.slice(0, 2)), minutes: Number(match[1]) };
};

const TodoPage = ({ todos, setTodos }: TodoPageProps) => {
    const { showToast } = useToast();
    const [newItem, setNewItem] = useState('');
    const [pendingIds, setPendingIds] = useState<number[]>([]);
    // `pendingIds` state is one render behind, so a second click in the same tick
    // would read a stale (empty) list and run a conflicting reminder mutation.
    const pendingIdsRef = useRef<Set<number>>(new Set());
    // `disabled` on the submit button does not stop an implicit submit from the
    // text field, so two Enter presses in the same tick would add the task twice.
    const submittingRef = useRef(false);
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;

    const setPending = useCallback((id: number, pending: boolean) => {
        pendingIdsRef.current = pending
            ? new Set([...pendingIdsRef.current, id])
            : new Set([...pendingIdsRef.current].filter((pendingId) => pendingId !== id));
        setPendingIds([...pendingIdsRef.current]);
    }, []);

    const handleNewItemChange = (value: string) => {
        submittingRef.current = false;
        setNewItem(value);
    };

    const handleAdd = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const text = newItem.trim();
        if (!text || submittingRef.current) {
            return;
        }
        submittingRef.current = true;
        setTodos((previous) => {
            const newTodo: Todo = {
                id: nextTodoId(previous),
                text,
                completed: false,
                time: '',
                reminder: false,
            };
            return [newTodo, ...previous];
        });
        setNewItem('');
    };

    const toggleTodo = async (id: number) => {
        const todo = todos.find((entry) => entry.id === id);
        if (!todo || pendingIdsRef.current.has(id)) {
            return;
        }
        setPending(id, true);
        try {
            // Only an *armed* reminder has anything to cancel. Cancelling for a task
            // that never had one still costs a bridge round trip, and a failure there
            // blocked the user from completing their own task with a message about a
            // reminder that did not exist.
            if (!todo.completed && todo.reminder) {
                const cancelled = await cancelTodoReminder(id);
                if (!cancelled) {
                    showToastRef.current({
                        type: 'error',
                        message: 'The reminder could not be cancelled; the task was not completed.',
                    });
                    return;
                }
            }
            setTodos((previous) =>
                previous.map((entry) =>
                    entry.id === id
                        ? { ...entry, completed: !todo.completed, reminder: todo.completed ? entry.reminder : false }
                        : entry,
                ),
            );
        } finally {
            setPending(id, false);
        }
    };

    const deleteTodo = async (id: number) => {
        if (pendingIdsRef.current.has(id)) {
            return;
        }
        const todo = todos.find((entry) => entry.id === id);
        setPending(id, true);
        try {
            if (todo?.reminder) {
                const cancelled = await cancelTodoReminder(id);
                if (!cancelled) {
                    showToastRef.current({
                        type: 'error',
                        message: 'The reminder could not be cancelled; the task was not deleted.',
                    });
                    return;
                }
            }
            setTodos((previous) => previous.filter((entry) => entry.id !== id));
        } finally {
            setPending(id, false);
        }
    };

    const handleTimeChange = async (id: number, newTime: string) => {
        const todo = todos.find((entry) => entry.id === id);
        if (!todo || pendingIdsRef.current.has(id)) {
            return;
        }
        // Re-opening the picker and confirming the same time is not an edit. Treating
        // it as one cancelled the notification and silently disarmed the reminder
        // while the control still read as "reminder on".
        if (newTime === todo.time) {
            return;
        }
        setPending(id, true);
        try {
            if (todo.reminder) {
                const cancelled = await cancelTodoReminder(id);
                if (!cancelled) {
                    showToastRef.current({
                        type: 'error',
                        message: 'The reminder could not be cancelled; the time was not changed.',
                    });
                    return;
                }
            }
            setTodos((previous) =>
                previous.map((entry) =>
                    // A changed time invalidates the armed reminder; `App` re-arms it
                    // from the reconciled definitions only once the user sets it again.
                    entry.id === id ? { ...entry, time: newTime, reminder: false } : entry,
                ),
            );
        } finally {
            setPending(id, false);
        }
    };

    const handleReminder = async (id: number) => {
        const todo = todos.find((entry) => entry.id === id);
        if (!todo || pendingIdsRef.current.has(id)) {
            return;
        }
        if (!todo.time) {
            showToastRef.current({ type: 'warning', message: 'Please set a time for the reminder first.' });
            return;
        }
        setPending(id, true);
        try {
            if (todo.reminder) {
                const cancelled = await cancelTodoReminder(id);
                if (cancelled) {
                    setTodos((previous) =>
                        previous.map((entry) => (entry.id === id ? { ...entry, reminder: false } : entry)),
                    );
                } else {
                    showToastRef.current({
                        type: 'error',
                        message: 'Failed to cancel the reminder. Please try again.',
                    });
                }
                return;
            }

            const parsed = parseReminderTime(todo.time);
            if (!parsed) {
                showToastRef.current({
                    type: 'error',
                    message: 'The reminder time is not a valid 24-hour time. Set it again.',
                });
                return;
            }
            const result = await scheduleTodoReminder(
                id,
                'ToDo Reminder',
                `Don't forget: ${todo.text}`,
                parsed.hours,
                parsed.minutes,
            );
            if (!result.success) {
                showToastRef.current({
                    type: 'error',
                    message: `Failed to schedule the reminder: ${result.error || 'Unknown error'}`,
                });
                return;
            }
            setTodos((previous) => previous.map((entry) => (entry.id === id ? { ...entry, reminder: true } : entry)));
            const sessionMessage = result.sessionOnly ? ' while this tab remains open' : '';
            showToastRef.current({ type: 'success', message: `Reminder set${sessionMessage} at ${todo.time}.` });
        } finally {
            setPending(id, false);
        }
    };

    const activeTodos = todos.filter((todo) => !todo.completed);
    const completedTodos = todos.filter((todo) => todo.completed);

    return (
        <section className="space-y-4 sm:space-y-6 pb-20" aria-labelledby="todo-page-title">
            <h1 id="todo-page-title" className="sr-only">
                Tasks
            </h1>
            <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm">
                <form onSubmit={handleAdd} className="flex gap-2">
                    <label htmlFor="new-todo" className="sr-only">
                        New task
                    </label>
                    <input
                        id="new-todo"
                        type="text"
                        value={newItem}
                        onChange={(event) => handleNewItemChange(event.target.value)}
                        placeholder="Add a new task..."
                        className="flex-1 rounded-lg border border-app-border bg-app-bg px-4 py-2 text-sm text-app-text-main placeholder-app-text-muted focus:border-app-primary focus:outline-none focus:ring-1 focus:border-app-primary transition-all"
                    />
                    <button
                        type="submit"
                        disabled={!newItem.trim()}
                        aria-label="Add task"
                        className="flex items-center justify-center rounded-lg bg-app-primary px-4 py-2 text-white transition-colors hover:bg-app-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={20} aria-hidden="true" />
                    </button>
                </form>
            </div>

            <div className="space-y-2">
                {activeTodos.length === 0 && completedTodos.length === 0 && (
                    <div className="text-center py-12 text-app-text-muted text-sm">No tasks yet. Add one above!</div>
                )}

                {activeTodos.map((todo) => (
                    <div
                        key={todo.id}
                        className="group flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-app-border bg-app-surface p-3 sm:p-4 shadow-sm transition-all hover:border-app-primary/30"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <button
                                type="button"
                                onClick={() => void toggleTodo(todo.id)}
                                aria-label={`Mark "${todo.text}" as done`}
                                disabled={pendingIds.includes(todo.id)}
                                className="text-app-text-muted hover:text-app-primary transition-colors shrink-0 disabled:opacity-50"
                            >
                                <Square size={20} aria-hidden="true" />
                            </button>
                            <span className="text-sm sm:text-base text-app-text-main truncate">{todo.text}</span>
                        </div>

                        <div className="flex items-center gap-3 sm:gap-4 self-end sm:self-auto ml-auto sm:ml-0">
                            <div className="w-auto shrink-0">
                                <TimePicker
                                    value={todo.time}
                                    onChange={(newTime) => void handleTimeChange(todo.id, newTime)}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleReminder(todo.id)}
                                disabled={pendingIds.includes(todo.id)}
                                aria-label={
                                    todo.reminder ? `Cancel reminder for ${todo.text}` : `Set reminder for ${todo.text}`
                                }
                                className={`p-1.5 rounded-full transition-colors disabled:opacity-50 ${
                                    todo.reminder
                                        ? 'bg-app-accent-warning text-app-bg hover:bg-app-accent-warning/90'
                                        : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                }`}
                                title={todo.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                            >
                                {todo.reminder ? (
                                    <Bell size={18} fill="currentColor" aria-hidden="true" />
                                ) : (
                                    <BellOff size={18} aria-hidden="true" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => void deleteTodo(todo.id)}
                                disabled={pendingIds.includes(todo.id)}
                                aria-label={`Delete task ${todo.text}`}
                                className="text-app-text-muted hover:text-app-accent-error p-1.5 rounded-lg transition-all focus:opacity-100 disabled:opacity-50"
                                title="Delete"
                            >
                                <Trash2 size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                ))}

                {activeTodos.length > 0 && completedTodos.length > 0 && (
                    <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-app-border" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-app-bg px-2 text-xs text-app-text-muted">Completed</span>
                        </div>
                    </div>
                )}

                {completedTodos.map((todo) => (
                    <div
                        key={todo.id}
                        className="group flex items-center justify-between rounded-xl border border-app-border/50 bg-app-bg/50 p-3 sm:p-4 transition-all opacity-70 hover:opacity-100"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <button
                                type="button"
                                onClick={() => void toggleTodo(todo.id)}
                                aria-label={`Mark "${todo.text}" as not done`}
                                disabled={pendingIds.includes(todo.id)}
                                className="text-app-primary transition-colors shrink-0 disabled:opacity-50"
                            >
                                <CheckSquare size={20} aria-hidden="true" />
                            </button>
                            <span className="text-sm sm:text-base text-app-text-muted line-through truncate decoration-app-text-muted/50">
                                {todo.text}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void deleteTodo(todo.id)}
                            disabled={pendingIds.includes(todo.id)}
                            aria-label={`Delete task ${todo.text}`}
                            className="text-app-text-muted hover:text-app-accent-error p-2 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                            title="Delete"
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default TodoPage;
