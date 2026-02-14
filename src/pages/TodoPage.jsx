import React, { useState } from 'react';
import { NotificationService } from '../utils/notificationService';
import TimePicker from '../components/TimePicker';
import { Plus, Square, CheckSquare, Bell, BellOff, Trash2 } from 'lucide-react';

const TodoPage = ({ todos, setTodos }) => {
    const [newItem, setNewItem] = useState('');

    const handleAdd = (e) => {
        e.preventDefault();
        if (!newItem.trim()) return;

        const newTodo = {
            id: Date.now(),
            text: newItem.trim(),
            completed: false,
            time: '',
            reminder: false
        };

        setTodos([newTodo, ...todos]);
        setNewItem('');
    };

    const toggleTodo = (id) => {
        setTodos(todos.map(todo => {
            if (todo.id === id) {
                return { ...todo, completed: !todo.completed };
            }
            return todo;
        }));
    };

    const deleteTodo = async (id) => {
        // Cancel notification if exists
        const todo = todos.find(t => t.id === id);
        if (todo && todo.reminder) {
            await NotificationService.cancelNotification(id);
        }
        setTodos(todos.filter(t => t.id !== id));
    };

    const handleTimeChange = (id, newTime) => {
        setTodos(todos.map(todo => {
            if (todo.id === id) {
                const updatedTodo = { ...todo, time: newTime };
                // If time changes and reminder is on, we should probably update/cancel it
                // For simplicity, if time changes, let's turn off reminder so user has to re-enable
                if (todo.reminder) {
                    NotificationService.cancelNotification(id);
                    updatedTodo.reminder = false;
                }
                return updatedTodo;
            }
            return todo;
        }));
    };

    const handleReminder = async (id) => {
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        if (!todo.time) {
            alert('Please set a time for the reminder first.');
            return;
        }

        if (todo.reminder) {
            // Turn off
            const success = await NotificationService.cancelNotification(id);
            if (success) {
                setTodos(todos.map(t => t.id === id ? { ...t, reminder: false } : t));
            }
        } else {
            // Turn on
            const [hours, minutes] = todo.time.split(':');
            const now = new Date();
            let scheduledTime = new Date();
            scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

            // If time has passed today, schedule for tomorrow
            if (scheduledTime <= now) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
            }

            const result = await NotificationService.scheduleNotification(
                id,
                `ToDo Reminder`,
                `Don't forget: ${todo.text}`,
                scheduledTime,
                'TODO_ACTIONS'
            );

            if (result.success) {
                setTodos(todos.map(t => t.id === id ? { ...t, reminder: true } : t));
            } else {
                alert(`Failed to schedule notification: ${result.error || 'Unknown error'}`);
            }
        }
    };

    // Sort: Active first, then by ID (newest first). Completed go to bottom.
    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    return (
        <div className="space-y-4 sm:space-y-6 pb-20">
            {/* Input Area */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm">
                <form onSubmit={handleAdd} className="flex gap-2">
                    <input
                        type="text"
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        placeholder="Add a new task..."
                        className="flex-1 rounded-lg border border-app-border bg-app-bg px-4 py-2 text-sm text-app-text-main placeholder-app-text-muted focus:border-app-primary focus:outline-none focus:ring-1 focus:ring-app-primary transition-all"
                    />
                    <button
                        type="submit"
                        disabled={!newItem.trim()}
                        className="flex items-center justify-center rounded-lg bg-app-primary px-4 py-2 text-white transition-colors hover:bg-app-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={20} />
                    </button>
                </form>
            </div>

            {/* Todo List */}
            <div className="space-y-2">
                {activeTodos.length === 0 && completedTodos.length === 0 && (
                    <div className="text-center py-12 text-app-text-muted text-sm">
                        No tasks yet. Add one above! ✨
                    </div>
                )}

                {/* Active Items */}
                {activeTodos.map(todo => (
                    <div
                        key={todo.id}
                        className="group flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-app-border bg-app-surface p-3 sm:p-4 shadow-sm transition-all hover:border-app-primary/30"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <button
                                onClick={() => toggleTodo(todo.id)}
                                className="text-app-text-muted hover:text-app-primary transition-colors shrink-0"
                            >
                                <Square size={20} />
                            </button>
                            <span className="text-sm sm:text-base text-app-text-main truncate">
                                {todo.text}
                            </span>
                        </div>

                        <div className="flex items-center gap-3 sm:gap-4 self-end sm:self-auto ml-auto sm:ml-0">
                            <div className="w-auto shrink-0">
                                <TimePicker
                                    value={todo.time}
                                    onChange={(newTime) => handleTimeChange(todo.id, newTime)}
                                />
                            </div>
                            <button
                                onClick={() => handleReminder(todo.id)}
                                className={`p-1.5 rounded-full transition-colors ${todo.reminder
                                    ? 'bg-app-accent-warning text-white hover:bg-app-accent-warning/90'
                                    : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                    }`}
                                title={todo.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                            >
                                {todo.reminder ? <Bell size={18} fill="currentColor" /> : <BellOff size={18} />}
                            </button>
                            <button
                                onClick={() => deleteTodo(todo.id)}
                                className="text-app-text-muted hover:text-destructive p-1.5 rounded-lg transition-all focus:opacity-100"
                                title="Delete"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}

                {/* Divider if both exist */}
                {activeTodos.length > 0 && completedTodos.length > 0 && (
                    <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-app-border"></div>
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-app-bg px-2 text-xs text-app-text-muted">Completed</span>
                        </div>
                    </div>
                )}

                {/* Completed Items */}
                {completedTodos.map(todo => (
                    <div
                        key={todo.id}
                        className="group flex items-center justify-between rounded-xl border border-app-border/50 bg-app-bg/50 p-3 sm:p-4 transition-all opacity-70 hover:opacity-100"
                    >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <button
                                onClick={() => toggleTodo(todo.id)}
                                className="text-app-primary transition-colors shrink-0"
                            >
                                <CheckSquare size={20} />
                            </button>
                            <span className="text-sm sm:text-base text-app-text-muted line-through truncate decoration-app-text-muted/50">
                                {todo.text}
                            </span>
                        </div>
                        <button
                            onClick={() => deleteTodo(todo.id)}
                            className="text-app-text-muted hover:text-destructive p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                            title="Delete"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TodoPage;
