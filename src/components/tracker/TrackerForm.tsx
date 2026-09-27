import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellOff, BookOpen, Plus, Repeat2, Trash2, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useToast } from '../../providers/ToastProvider';
import type { SessionNotificationScheduleResult } from '../../services/notificationService';
import { NotificationService } from '../../services/notificationService';
import type { DayLabel, RecurringModalProps, Subject, TrackerFormProps } from '../../types';
import { addLocalDays, formatLocalDate } from '../../utils/dateUtils';
import { focusAfterContainer, getFocusableElements } from '../shared/focusOrder';
import { reserveRecordId } from '../shared/recordIds';
import TimePicker from '../shared/TimePicker';

const MAX_MINUTES = 1440;
const MAX_SUBJECT_NAME_LENGTH = 200;
// Free text is a poor accessible name on its own: a 200-character subject name
// read out before the control that carries it is unusable. Only as much of it as
// still tells the row apart is kept.
const MAX_NAME_IN_LABEL = 60;
// A plugin or bridge error is arbitrary text - `notificationService` will
// `JSON.stringify` anything it is handed - and the toast is a summary shown on
// top of the planner, not a place to render a stack trace.
const MAX_ERROR_DETAIL_LENGTH = 120;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// Minutes are whole numbers, so the field refuses exactly what the native
// number spinner would refuse.
const MINUTES_PATTERN = /^\d+$/;
const isValidTimeValue = (value: string): boolean => value.length === 0 || TIME_PATTERN.test(value);

const DAYS: DayLabel[] = [
    { label: 'S', value: 0, full: 'Sunday' },
    { label: 'M', value: 1, full: 'Monday' },
    { label: 'T', value: 2, full: 'Tuesday' },
    { label: 'W', value: 3, full: 'Wednesday' },
    { label: 'T', value: 4, full: 'Thursday' },
    { label: 'F', value: 5, full: 'Friday' },
    { label: 'S', value: 6, full: 'Saturday' },
];
const ALL_DAYS = DAYS.map((day) => day.value);

const isDayIndex = (day: number): boolean => Number.isInteger(day) && day >= 0 && day <= 6;

/**
 * `storage.ts` already rejects out-of-range and duplicate day indices on the way
 * in, but the dialog both counts and republishes whatever it is handed, so a bad
 * value would inflate the "N of 7" hint and be written straight back out.
 */
const normalizeDays = (days: readonly number[]): number[] =>
    [...new Set(days.filter(isDayIndex))].sort((first, second) => first - second);

/** The days a subject actually repeats on, in week order. */
const activeDays = (subject: Subject): DayLabel[] =>
    DAYS.filter((day) => subject.recurring === true && (subject.recurringDays ?? []).includes(day.value));

// One sentence for both layouts: the card layout reads it out, and the table
// points its icon-only repeat control at the same text, so the two cannot drift.
const describeRepeatingDays = (subject: Subject): string => {
    const days = activeDays(subject);
    return days.length > 0 ? `Repeats on ${days.map((day) => day.full).join(', ')}.` : 'Does not repeat on any day.';
};

const repeatDescriptionDomId = (subjectId: number): string => `subject-repeat-days-${subjectId}`;

// Validation state is keyed by subject id, not by row position, so removing a
// row cannot re-attach a message to the subject that took its place.
const fieldErrorKey = (subjectId: number, field: string): string => `${field}-${subjectId}`;

const shortenForLabel = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > MAX_NAME_IN_LABEL ? `${trimmed.slice(0, MAX_NAME_IN_LABEL - 1).trimEnd()}…` : trimmed;
};

/**
 * What to call a subject inside a label or a notification.
 *
 * The name is free text and can be cleared, which left a dangling "Planned
 * minutes for " and a notification reading "Study Time: ". Every other name in
 * the row is positional, so a blank row falls back to that rather than to
 * nothing. Named `subjectLabel` because the modal's own prop is `subjectName`.
 */
const subjectLabel = (subject: Subject, position: number): string =>
    subject.name.trim().length > 0 ? shortenForLabel(subject.name) : `subject ${position}`;

/** Why a reminder could not be set, in one line the planner can show. */
const errorDetail = (message: string | undefined): string => {
    const detail = (message ?? '').trim() || 'Unknown error';
    return detail.length > MAX_ERROR_DETAIL_LENGTH
        ? `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH - 1).trimEnd()}…`
        : detail;
};

/**
 * A stored duration as a number.
 *
 * `|| 0` only catches `NaN`: `parseFloat('Infinity')` is `Infinity`, and it is
 * truthy, so one unparseable row would print "Infinity" in the totals and drag
 * every other total with it.
 */
const minutesOf = (value: string): number => {
    const minutes = Number.parseFloat(value);
    return Number.isFinite(minutes) ? minutes : 0;
};

const isKpiMet = (subject: Subject): boolean => {
    const planned = minutesOf(subject.planned);
    return planned > 0 && minutesOf(subject.actual) >= 0.8 * planned;
};

const ValidationMessage = ({ id, message }: { id: string; message: string | undefined }) =>
    message ? (
        <p id={id} className="mt-0.5 text-[11px] font-medium leading-tight text-app-accent-error">
            {message}
        </p>
    ) : null;

const RecurringModal = ({
    isOpen,
    onClose,
    onSave,
    onStopRepeating,
    initialDays,
    subjectName,
    isCurrentlyRecurring,
}: RecurringModalProps) => {
    const titleId = useId();
    const hintId = `${titleId}-hint`;
    // A subject that never chose days (or was left with an empty list) starts
    // from the full week instead of an unusable, unsaveable empty grid.
    const [selectedDays, setSelectedDays] = useState<number[]>(() => {
        const stored = normalizeDays(initialDays);
        return stored.length > 0 ? stored : [...ALL_DAYS];
    });
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    const toggleDay = (dayValue: number) => {
        setSelectedDays((prev) =>
            (prev.includes(dayValue) ? prev.filter((day) => day !== dayValue) : [...prev, dayValue]).sort(
                (first, second) => first - second,
            ),
        );
    };

    const handleSave = () => {
        const days = normalizeDays(selectedDays);
        // Storage rejects `recurring: true` without days, and the disabled Save
        // button is the only thing standing between those two states.
        if (days.length === 0) {
            return;
        }
        onSave(days);
    };

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusTimer = window.setTimeout(() => {
            closeButtonRef.current?.focus();
        }, 0);
        return () => {
            window.clearTimeout(focusTimer);
            triggerRef.current?.focus();
        };
    }, [isOpen]);

    const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab' || !dialogRef.current) {
            return;
        }
        // The app's shared selector, so the trap cannot drift from the one the
        // rest of the focus handling uses; it also skips anything hidden.
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length === 0) {
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onKeyDown={handleDialogKeyDown}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-app-surface w-full max-w-sm rounded-xl border border-app-border shadow-2xl overflow-hidden"
            >
                <div className="p-4 border-b border-app-border flex justify-between items-center bg-app-bg/50">
                    <h3 id={titleId} className="font-semibold text-app-text-main">
                        Recurring Days
                    </h3>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        aria-label="Close recurring days dialog"
                        onClick={onClose}
                        className="p-1 rounded-full hover:bg-app-bg text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-sm text-app-text-muted">
                        {/* The name is free text and can be cleared, which read as
                            "Select days to repeat :" - the sentence still has to
                            say what the days are for. */}
                        Select days to repeat{' '}
                        <span className="font-medium text-app-primary">{subjectName.trim() || 'this subject'}</span>:
                    </p>

                    {/* A fieldset rather than `role="group"`: the day toggles are
                        form controls, so the browser element is the honest group
                        and it satisfies the project's own a11y lint rule. */}
                    <fieldset className="m-0 border-0 p-0">
                        <legend className="sr-only">Days of the week</legend>
                        <div className="flex justify-between gap-1">
                            {DAYS.map((day) => {
                                const isSelected = selectedDays.includes(day.value);
                                return (
                                    <button
                                        type="button"
                                        key={day.value}
                                        aria-label={day.full}
                                        aria-pressed={isSelected}
                                        onClick={() => toggleDay(day.value)}
                                        className={`
                                            w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center transition-all
                                            ${
                                                isSelected
                                                    ? 'bg-app-primary text-white shadow-md scale-105'
                                                    : 'bg-app-bg text-app-text-muted border border-app-border hover:bg-app-border'
                                            }
                                        `}
                                        title={day.full}
                                    >
                                        {day.label}
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>

                    {/* Always rendered so the Save button's description never
                        dangles, and a `status` region so the change is announced
                        while the caret stays on the day that was toggled. */}
                    <p
                        id={hintId}
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className="text-xs text-app-text-muted"
                    >
                        {selectedDays.length === 0
                            ? 'Select at least one day to save.'
                            : `${selectedDays.length} of ${ALL_DAYS.length} days selected.`}
                    </p>

                    <div className="pt-2 flex justify-between">
                        {isCurrentlyRecurring ? (
                            <button
                                type="button"
                                onClick={() => {
                                    onStopRepeating();
                                }}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-app-accent-error hover:bg-app-accent-error/10 transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary"
                            >
                                Stop Repeating
                            </button>
                        ) : (
                            <div />
                        )}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-app-text-muted hover:bg-app-bg transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={selectedDays.length === 0}
                                aria-describedby={hintId}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-app-primary text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

const TrackerForm = memo(({ subjects, setSubjects }: TrackerFormProps) => {
    const [editingRecurringId, setEditingRecurringId] = useState<number | null>(null);
    // Rejected input is simply ignored (the controlled field snaps back to the
    // last valid value), so the reason has to be surfaced explicitly.
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [pendingReminderIds, setPendingReminderIds] = useState<number[]>([]);
    const { showToast } = useToast();
    // See `Checklist`: `reserveRecordId` checks the ids actually in use, so this
    // only has to remember the last id it handed out.
    const lastSubjectIdRef = useRef(0);
    const addButtonRef = useRef<HTMLButtonElement>(null);

    const fieldError = (subjectId: number, field: string): string | undefined =>
        validationErrors[fieldErrorKey(subjectId, field)];

    const reportInvalid = useCallback((subjectId: number, field: string, message: string) => {
        const key = fieldErrorKey(subjectId, field);
        setValidationErrors((prev) => (prev[key] === message ? prev : { ...prev, [key]: message }));
    }, []);

    const clearInvalid = useCallback((subjectId: number, field: string) => {
        const key = fieldErrorKey(subjectId, field);
        setValidationErrors((prev) => {
            if (!(key in prev)) {
                return prev;
            }
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const updateSubject = useCallback(
        (subjectId: number, patch: Partial<Subject>) => {
            setSubjects((prevSubjects) =>
                prevSubjects.map((subject) => {
                    if (subject.id !== subjectId) {
                        return subject;
                    }
                    const updatedSubject = { ...subject, ...patch };
                    if (patch.planned !== undefined || patch.actual !== undefined) {
                        updatedSubject.kpi = isKpiMet(updatedSubject) ? 'Y' : 'N';
                    }
                    return updatedSubject;
                }),
            );
        },
        [setSubjects],
    );

    const handleChange = useCallback(
        (subjectId: number, field: keyof Subject, value: string | boolean | null) => {
            if (value === null) {
                return;
            }
            if (field === 'name' && typeof value === 'string' && value.length > MAX_SUBJECT_NAME_LENGTH) {
                reportInvalid(
                    subjectId,
                    'name',
                    `Keep the subject name to ${MAX_SUBJECT_NAME_LENGTH} characters or fewer.`,
                );
                return;
            }
            if (field === 'time' && typeof value === 'string' && !isValidTimeValue(value)) {
                reportInvalid(subjectId, 'time', 'Use a 24-hour time such as 09:30.');
                return;
            }
            if (field === 'planned' || field === 'actual') {
                if (typeof value !== 'string') {
                    return;
                }
                const normalizedValue = value.trim() === '' ? '0' : value.trim();
                const numericValue = Number(normalizedValue);
                if (!MINUTES_PATTERN.test(normalizedValue)) {
                    reportInvalid(subjectId, field, 'Enter a number of minutes, for example 45.');
                    return;
                }
                if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > MAX_MINUTES) {
                    reportInvalid(subjectId, field, `Enter a value between 0 and ${MAX_MINUTES} minutes.`);
                    return;
                }
                clearInvalid(subjectId, field);
                updateSubject(subjectId, { [field]: normalizedValue });
                return;
            }

            if (field === 'name' || field === 'time') {
                clearInvalid(subjectId, field);
            }
            updateSubject(subjectId, { [field]: value });
        },
        [clearInvalid, reportInvalid, updateSubject],
    );

    // `cancelNotification` reports a failed cancel either by throwing or by
    // resolving `false`; both mean the alarm is still registered on the device.
    const cancelSubjectReminder = useCallback(async (subjectId: number): Promise<boolean> => {
        try {
            return await NotificationService.cancelNotification(subjectId);
        } catch {
            return false;
        }
    }, []);

    const markReminderPending = useCallback((subjectId: number, pending: boolean) => {
        setPendingReminderIds((prev) =>
            pending ? (prev.includes(subjectId) ? prev : [...prev, subjectId]) : prev.filter((id) => id !== subjectId),
        );
    }, []);

    const addSubject = useCallback(() => {
        // The id is reserved before the update so the state updater stays pure.
        const newId = reserveRecordId(
            lastSubjectIdRef.current,
            subjects.map((subject) => subject.id),
        );
        lastSubjectIdRef.current = newId;
        setSubjects((prev) => [
            ...prev,
            {
                id: newId,
                name: 'New Subject',
                planned: '60',
                actual: '0',
                kpi: 'N',
                time: '',
                reminder: false,
                recurring: false,
                recurringDays: [...ALL_DAYS],
            },
        ]);
    }, [setSubjects, subjects]);

    const removeSubject = useCallback(
        async (subjectId: number, row: HTMLElement | null) => {
            if (subjects.length <= 1) {
                showToast({ type: 'info', message: 'Keep at least one subject in the planner.' });
                return;
            }
            const subject = subjects.find((entry) => entry.id === subjectId);
            if (!subject) {
                return;
            }
            if (subject.reminder && subject.id && !(await cancelSubjectReminder(subject.id))) {
                showToast({ type: 'warning', message: 'The reminder could not be cancelled on the device.' });
            }

            setSubjects((prev) => prev.filter((entry) => entry.id !== subjectId));
            // The pressed control unmounts with its row, so focus is handed to
            // whatever follows instead of collapsing onto <body>.
            focusAfterContainer(row, addButtonRef.current);
        },
        [cancelSubjectReminder, setSubjects, showToast, subjects],
    );

    const handleTimeChange = useCallback(
        async (subject: Subject, newTime: string) => {
            if (subject.reminder) {
                // The pending alarm is keyed to the old time, so it has to be
                // cancelled first; if it cannot be, the field keeps its value
                // rather than stranding an alarm at a time nobody can see.
                if (!subject.id || !(await cancelSubjectReminder(subject.id))) {
                    showToast({
                        type: 'error',
                        message: 'Unable to cancel the reminder, so the time was not changed.',
                    });
                    return;
                }
                updateSubject(subject.id, { time: newTime, reminder: false });
                return;
            }
            handleChange(subject.id, 'time', newTime);
        },
        [cancelSubjectReminder, handleChange, showToast, updateSubject],
    );

    const handleReminder = useCallback(
        async (subject: Subject) => {
            if (pendingReminderIds.includes(subject.id)) {
                return;
            }

            if (!subject.id) {
                showToast({
                    type: 'error',
                    message: 'Please reset your subjects to enable reminders (missing ID).',
                });
                return;
            }

            if (!subject.time) {
                showToast({ type: 'error', message: 'Please set a time for the reminder first.' });
                return;
            }

            if (subject.reminder) {
                markReminderPending(subject.id, true);
                try {
                    if (await cancelSubjectReminder(subject.id)) {
                        updateSubject(subject.id, { reminder: false });
                        // The one outcome of this control with no feedback at all
                        // was the one the user asked for: the bell swaps its icon,
                        // which a screen reader is not told about. A time change
                        // already rewrites the field, so it does not repeat this.
                        showToast({ type: 'info', message: 'Reminder cancelled.' });
                    } else {
                        showToast({ type: 'error', message: 'Unable to cancel the reminder. Please try again.' });
                    }
                } finally {
                    markReminderPending(subject.id, false);
                }
                return;
            }

            if (!TIME_PATTERN.test(subject.time)) {
                showToast({ type: 'error', message: 'Please set a valid time for the reminder first.' });
                return;
            }

            const [hours, minutes] = subject.time.split(':');
            const h = Number.parseInt(hours ?? '0', 10);
            const m = Number.parseInt(minutes ?? '0', 10);
            const now = new Date();
            const scheduledTime = new Date();
            scheduledTime.setHours(h, m, 0, 0);

            if (scheduledTime <= now) {
                const tomorrow = addLocalDays(formatLocalDate(now), 1);
                if (tomorrow) {
                    scheduledTime.setFullYear(
                        Number(tomorrow.slice(0, 4)),
                        Number(tomorrow.slice(5, 7)) - 1,
                        Number(tomorrow.slice(8, 10)),
                    );
                } else {
                    // A day key that cannot be named - the last day of year 9999,
                    // or a calendar day a zone skipped at a dateline change - left
                    // the instant in the past, and the service can only refuse
                    // that with "must be in the future". Stepping the wall clock
                    // still lands on the next day, which is what the user asked
                    // for, and it cannot fail.
                    scheduledTime.setDate(scheduledTime.getDate() + 1);
                }
            }

            // A cleared name would otherwise reach the notification as
            // "Study Time: " and "It's time to start studying !".
            const position = subjects.findIndex((entry) => entry.id === subject.id) + 1;
            const label = subjectLabel(subject, position > 0 ? position : 1);

            markReminderPending(subject.id, true);
            try {
                const result: SessionNotificationScheduleResult = await NotificationService.scheduleNotification(
                    subject.id,
                    `Study Time: ${label}`,
                    `It's time to start studying ${label}! Target: ${subject.planned} min.`,
                    scheduledTime,
                );

                if (!result.success) {
                    showToast({
                        type: 'error',
                        message: `Failed to schedule notification: ${errorDetail(result.error)}`,
                    });
                    return;
                }

                // Applied inside the try, so the subject is already armed while
                // the control is still locked. Releasing the lock first left a
                // window where the button was live and still read "Set reminder"
                // for an alarm the device had accepted, and a second press in
                // that window armed a duplicate.
                updateSubject(subject.id, { reminder: true });

                const isTomorrow = formatLocalDate(scheduledTime) !== formatLocalDate(now);
                const timeStr = scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                // The service registers a single, non-repeating alarm, and the web
                // path only survives while the page stays open, so the confirmation
                // states that instead of implying a standing daily reminder.
                const sessionNote = result.sessionOnly ? ' while this tab remains open' : '';
                // The plugin resolves a downgraded alarm as a *success*, and
                // `result.warning` is the only place the downgrade is ever reported.
                // Claiming an exact minute for it would promise something the device
                // has already said it cannot keep, so the caveat rides along with the
                // confirmation and the toast drops to a warning.
                const inexactNote = result.inexact
                    ? ` The device may deliver it a few minutes late${result.warning ? `: ${errorDetail(result.warning)}` : '.'}`
                    : '';
                showToast({
                    type: result.inexact ? 'warning' : 'success',
                    message: `Reminder set for ${isTomorrow ? 'tomorrow' : 'today'} at ${timeStr}${sessionNote}.${inexactNote}`,
                });
            } catch {
                showToast({ type: 'error', message: 'Unable to schedule the reminder. Please try again.' });
            } finally {
                markReminderPending(subject.id, false);
            }
        },
        [cancelSubjectReminder, markReminderPending, pendingReminderIds, showToast, subjects, updateSubject],
    );

    const handleRecurringSave = useCallback(
        (days: number[]) => {
            if (editingRecurringId === null) {
                return;
            }
            updateSubject(editingRecurringId, { recurring: true, recurringDays: [...days] });
            setEditingRecurringId(null);
        },
        [editingRecurringId, updateSubject],
    );

    const handleStopRepeating = useCallback(() => {
        if (editingRecurringId === null) {
            return;
        }
        // The chosen days are kept, so reopening the dialog restores them.
        updateSubject(editingRecurringId, { recurring: false });
        setEditingRecurringId(null);
    }, [editingRecurringId, updateSubject]);

    const handleRecurringClick = useCallback((subjectId: number) => {
        setEditingRecurringId(subjectId);
    }, []);

    const totalPlanned = useMemo(() => subjects.reduce((acc, curr) => acc + minutesOf(curr.planned), 0), [subjects]);

    const totalActual = useMemo(() => subjects.reduce((acc, curr) => acc + minutesOf(curr.actual), 0), [subjects]);

    const dayRating = useMemo(() => {
        const kpiCount = subjects.filter((s) => s.kpi === 'Y').length;
        const ratio = kpiCount / subjects.length;
        if (ratio >= 0.8) {
            return 'Productive';
        }
        if (ratio >= 0.5) {
            return 'Okayish';
        }
        return 'Unproductive';
    }, [subjects]);

    const dayRatingColor = useMemo(() => {
        if (dayRating === 'Productive') {
            return 'text-app-accent-success';
        }
        if (dayRating === 'Okayish') {
            return 'text-app-accent-warning';
        }
        return 'text-app-accent-error';
    }, [dayRating]);

    const editingSubject = useMemo(
        () => (editingRecurringId === null ? undefined : subjects.find((subject) => subject.id === editingRecurringId)),
        [editingRecurringId, subjects],
    );

    return (
        <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm relative">
            <AnimatePresence>
                {editingSubject && (
                    <RecurringModal
                        isOpen={true}
                        onClose={() => setEditingRecurringId(null)}
                        onSave={handleRecurringSave}
                        onStopRepeating={handleStopRepeating}
                        initialDays={editingSubject.recurringDays ?? []}
                        subjectName={editingSubject.name}
                        isCurrentlyRecurring={editingSubject.recurring === true}
                    />
                )}
            </AnimatePresence>

            <div className="border-b border-app-border bg-app-bg/50 px-3 sm:px-6 py-2 sm:py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-app-primary" aria-hidden="true" />
                    <h2 className="text-sm sm:text-lg font-semibold text-app-text-main">Study Planner</h2>
                </div>
                <button
                    ref={addButtonRef}
                    type="button"
                    aria-label="Add subject"
                    onClick={addSubject}
                    className="flex items-center gap-1 rounded-lg bg-app-primary px-2.5 sm:px-3 py-1.5 text-xs font-medium text-app-primary-fg hover:bg-app-primary-hover transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary"
                >
                    <Plus size={14} aria-hidden="true" /> Add
                </button>
            </div>

            {/* ===== MOBILE: Card Layout ===== */}
            <div className="sm:hidden divide-y divide-app-border">
                {subjects.map((subject, index) => {
                    const repeatingDays = activeDays(subject);
                    // The sentence below starts with the name, so a cleared one
                    // left a leading ":" - and this one starts a sentence, hence
                    // the capitalised fallback rather than the one used mid-label.
                    const kpiOwner = subject.name.trim()
                        ? `${shortenForLabel(subject.name)}: `
                        : `Subject ${index + 1}: `;
                    return (
                        <div
                            key={subject.id}
                            data-subject-row
                            className={`px-3 py-2.5 ${index % 2 === 0 ? 'bg-app-surface' : 'bg-app-bg/40'}`}
                        >
                            {/* Row 1: Subject name + delete */}
                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    id={`mobile-subject-name-${subject.id}`}
                                    aria-label={`Subject ${index + 1} name`}
                                    aria-invalid={fieldError(subject.id, 'name') ? true : undefined}
                                    aria-describedby={
                                        fieldError(subject.id, 'name')
                                            ? `mobile-subject-name-error-${subject.id}`
                                            : undefined
                                    }
                                    maxLength={MAX_SUBJECT_NAME_LENGTH}
                                    type="text"
                                    value={subject.name}
                                    onChange={(e) => handleChange(subject.id, 'name', e.target.value)}
                                    className="flex-1 min-w-0 rounded-md border border-app-border bg-transparent px-2 py-1 text-sm font-medium text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                />
                                {subjects.length > 1 && (
                                    <button
                                        type="button"
                                        aria-label={`Remove subject ${index + 1}`}
                                        onClick={(event) =>
                                            void removeSubject(
                                                subject.id,
                                                event.currentTarget.closest<HTMLElement>('[data-subject-row]'),
                                            )
                                        }
                                        className="p-1 rounded-lg text-app-text-muted hover:text-app-accent-error hover:bg-app-bg transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-app-primary"
                                    >
                                        <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                            <ValidationMessage
                                id={`mobile-subject-name-error-${subject.id}`}
                                message={fieldError(subject.id, 'name')}
                            />
                            {/* Row 2: Plan / Actual / KPI */}
                            <div className="flex items-start gap-2 mb-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <label
                                            htmlFor={`mobile-subject-planned-${subject.id}`}
                                            className="text-[10px] uppercase text-app-text-muted font-medium shrink-0"
                                        >
                                            Plan
                                        </label>
                                        <input
                                            id={`mobile-subject-planned-${subject.id}`}
                                            type="number"
                                            min={0}
                                            max={MAX_MINUTES}
                                            step={1}
                                            value={subject.planned}
                                            onChange={(e) => handleChange(subject.id, 'planned', e.target.value)}
                                            aria-invalid={fieldError(subject.id, 'planned') ? true : undefined}
                                            aria-describedby={
                                                fieldError(subject.id, 'planned')
                                                    ? `mobile-subject-planned-error-${subject.id}`
                                                    : undefined
                                            }
                                            className="w-full rounded-md border border-app-border bg-app-surface px-1.5 py-1 text-sm text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                        />
                                    </div>
                                    <ValidationMessage
                                        id={`mobile-subject-planned-error-${subject.id}`}
                                        message={fieldError(subject.id, 'planned')}
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <label
                                            htmlFor={`mobile-subject-actual-${subject.id}`}
                                            className="text-[10px] uppercase text-app-text-muted font-medium shrink-0"
                                        >
                                            Act
                                        </label>
                                        <input
                                            id={`mobile-subject-actual-${subject.id}`}
                                            type="number"
                                            min={0}
                                            max={MAX_MINUTES}
                                            step={1}
                                            value={subject.actual}
                                            onChange={(e) => handleChange(subject.id, 'actual', e.target.value)}
                                            aria-invalid={fieldError(subject.id, 'actual') ? true : undefined}
                                            aria-describedby={
                                                fieldError(subject.id, 'actual')
                                                    ? `mobile-subject-actual-error-${subject.id}`
                                                    : undefined
                                            }
                                            className="w-full rounded-md border border-app-border bg-app-surface px-1.5 py-1 text-sm text-app-text-main focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                            placeholder="0"
                                        />
                                    </div>
                                    <ValidationMessage
                                        id={`mobile-subject-actual-error-${subject.id}`}
                                        message={fieldError(subject.id, 'actual')}
                                    />
                                </div>
                                <div
                                    className={`
                                    inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold mt-1
                                    ${
                                        subject.kpi === 'Y'
                                            ? 'bg-app-accent-success/10 text-app-accent-success'
                                            : 'bg-app-bg text-app-text-muted'
                                    }
                                `}
                                >
                                    {/* A bare tick reads as "check mark KPI", which
                                        does not say whether the goal was met, so
                                        the state is spelled out for assistive
                                        technology and the glyph is decoration. */}
                                    <span aria-hidden="true">{subject.kpi === 'Y' ? '✓' : '✗'}</span>
                                    <span aria-hidden="true"> KPI</span>
                                    <span className="sr-only">
                                        {`${kpiOwner}KPI ${subject.kpi === 'Y' ? 'met' : 'not met'}`}
                                    </span>
                                </div>
                            </div>
                            {/* Row 3: Time + Alert + Repeat */}
                            <div className="flex items-center gap-2 mb-1.5">
                                <fieldset
                                    className="m-0 w-28 shrink-0 border-0 p-0"
                                    aria-label={`Reminder time for subject ${index + 1}`}
                                    aria-describedby={
                                        fieldError(subject.id, 'time')
                                            ? `mobile-subject-time-error-${subject.id}`
                                            : undefined
                                    }
                                >
                                    <TimePicker
                                        value={subject.time}
                                        onChange={(newTime) => {
                                            void handleTimeChange(subject, newTime);
                                        }}
                                    />
                                </fieldset>
                                <button
                                    type="button"
                                    aria-label={`${subject.reminder ? 'Cancel reminder' : 'Set reminder'} for subject ${index + 1}`}
                                    disabled={pendingReminderIds.includes(subject.id)}
                                    onClick={() => {
                                        void handleReminder(subject);
                                    }}
                                    className={`p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-50 ${
                                        subject.reminder
                                            ? 'bg-app-accent-warning text-app-bg hover:bg-app-accent-warning/90'
                                            : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                    }`}
                                    title={subject.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                                >
                                    {subject.reminder ? (
                                        <Bell size={14} fill="currentColor" aria-hidden="true" />
                                    ) : (
                                        <BellOff size={14} aria-hidden="true" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Configure recurring days for subject ${index + 1}`}
                                    aria-pressed={subject.recurring === true}
                                    onClick={() => handleRecurringClick(subject.id)}
                                    className={`flex items-center gap-0.5 p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary ${
                                        subject.recurring
                                            ? 'bg-app-primary text-white hover:bg-app-primary-hover'
                                            : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                    }`}
                                    title="Configure recurring"
                                >
                                    <Repeat2 size={14} aria-hidden="true" />
                                </button>
                            </div>
                            <ValidationMessage
                                id={`mobile-subject-time-error-${subject.id}`}
                                message={fieldError(subject.id, 'time')}
                            />
                            {/* Row 4: Sun, Mon, Tue... day indicators (view only) */}
                            <div className="flex flex-wrap items-center gap-1.5 opacity-80">
                                <span className="sr-only">{describeRepeatingDays(subject)}</span>
                                {DAYS.map((day) => {
                                    const isActive = repeatingDays.includes(day);
                                    return (
                                        <span
                                            key={day.value}
                                            aria-hidden="true"
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors
                                            ${isActive ? 'bg-blue-500 text-white' : 'bg-app-bg text-app-text-muted'}
                                        `}
                                        >
                                            {day.label}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
                {/* Mobile totals */}
                <div className="px-3 py-2.5 bg-app-bg/50 flex items-center gap-4 text-xs font-bold text-app-text-main">
                    <span>Total</span>
                    <span>Plan: {totalPlanned}</span>
                    <span>Act: {totalActual}</span>
                    <span className={dayRatingColor}>{dayRating}</span>
                </div>
            </div>

            {/* ===== DESKTOP: Table Layout ===== */}
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-app-text-muted min-w-[600px]">
                    <thead className="bg-app-bg/50 text-xs uppercase text-app-text-main">
                        <tr>
                            <th scope="col" className="px-4 md:px-6 py-3">
                                Subject
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3">
                                Plan
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3">
                                Actual
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3">
                                KPI
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3">
                                Time
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3 w-10">
                                Alert
                            </th>
                            <th scope="col" className="px-4 md:px-6 py-3 w-10" title="Recurring Days">
                                Repeat
                            </th>
                            <th scope="col" aria-label="Actions" className="px-4 py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border">
                        {subjects.map((subject, index) => {
                            // The badge counts the days the row actually shows, so
                            // it can never disagree with the sentence beside it.
                            const repeatCount = activeDays(subject).length;
                            return (
                                <tr
                                    key={subject.id}
                                    data-subject-row
                                    className={`hover:bg-app-primary/10 transition-colors ${index % 2 === 0 ? 'bg-app-surface' : 'bg-app-bg/70'}`}
                                >
                                    <td className="px-4 md:px-6 py-3">
                                        <input
                                            id={`desktop-subject-name-${subject.id}`}
                                            aria-label={`Subject ${index + 1} name`}
                                            aria-invalid={fieldError(subject.id, 'name') ? true : undefined}
                                            aria-describedby={
                                                fieldError(subject.id, 'name')
                                                    ? `desktop-subject-name-error-${subject.id}`
                                                    : undefined
                                            }
                                            maxLength={MAX_SUBJECT_NAME_LENGTH}
                                            type="text"
                                            value={subject.name}
                                            onChange={(e) => handleChange(subject.id, 'name', e.target.value)}
                                            className="w-full max-w-[180px] rounded-md border border-app-border bg-transparent px-2 py-1 text-sm font-medium text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                        />
                                        <ValidationMessage
                                            id={`desktop-subject-name-error-${subject.id}`}
                                            message={fieldError(subject.id, 'name')}
                                        />
                                    </td>
                                    <td className="px-4 md:px-6 py-3">
                                        <input
                                            id={`desktop-subject-planned-${subject.id}`}
                                            type="number"
                                            min={0}
                                            max={MAX_MINUTES}
                                            step={1}
                                            // A column header does not label the control
                                            // inside the cell, so the field is named here.
                                            aria-label={`Planned minutes for ${subjectLabel(subject, index + 1)}`}
                                            value={subject.planned}
                                            onChange={(e) => handleChange(subject.id, 'planned', e.target.value)}
                                            aria-invalid={fieldError(subject.id, 'planned') ? true : undefined}
                                            aria-describedby={
                                                fieldError(subject.id, 'planned')
                                                    ? `desktop-subject-planned-error-${subject.id}`
                                                    : undefined
                                            }
                                            className="w-full max-w-[80px] rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                        />
                                        <ValidationMessage
                                            id={`desktop-subject-planned-error-${subject.id}`}
                                            message={fieldError(subject.id, 'planned')}
                                        />
                                    </td>
                                    <td className="px-4 md:px-6 py-3">
                                        <input
                                            id={`desktop-subject-actual-${subject.id}`}
                                            type="number"
                                            min={0}
                                            max={MAX_MINUTES}
                                            step={1}
                                            aria-label={`Actual minutes for ${subjectLabel(subject, index + 1)}`}
                                            value={subject.actual}
                                            onChange={(e) => handleChange(subject.id, 'actual', e.target.value)}
                                            aria-invalid={fieldError(subject.id, 'actual') ? true : undefined}
                                            aria-describedby={
                                                fieldError(subject.id, 'actual')
                                                    ? `desktop-subject-actual-error-${subject.id}`
                                                    : undefined
                                            }
                                            className="w-full max-w-[80px] rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text-main shadow-sm focus:border-app-primary focus:ring-1 focus:ring-app-primary"
                                            placeholder="0"
                                        />
                                        <ValidationMessage
                                            id={`desktop-subject-actual-error-${subject.id}`}
                                            message={fieldError(subject.id, 'actual')}
                                        />
                                    </td>
                                    <td className="px-4 md:px-6 py-3">
                                        <div
                                            className={`
                                        inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold w-[40px]
                                        ${
                                            subject.kpi === 'Y'
                                                ? 'bg-app-accent-success/10 text-app-accent-success'
                                                : 'bg-app-bg text-app-text-muted'
                                        }
                                    `}
                                        >
                                            {subject.kpi === 'Y' ? 'Yes' : 'No'}
                                        </div>
                                    </td>
                                    <td className="px-4 md:px-6 py-3">
                                        <fieldset
                                            className="m-0 border-0 p-0"
                                            aria-label={`Reminder time for subject ${index + 1}`}
                                            aria-describedby={
                                                fieldError(subject.id, 'time')
                                                    ? `desktop-subject-time-error-${subject.id}`
                                                    : undefined
                                            }
                                        >
                                            <TimePicker
                                                value={subject.time}
                                                onChange={(newTime) => {
                                                    void handleTimeChange(subject, newTime);
                                                }}
                                            />
                                        </fieldset>
                                        <ValidationMessage
                                            id={`desktop-subject-time-error-${subject.id}`}
                                            message={fieldError(subject.id, 'time')}
                                        />
                                    </td>
                                    <td className="px-4 md:px-6 py-3 text-center">
                                        <button
                                            type="button"
                                            aria-label={`${subject.reminder ? 'Cancel reminder' : 'Set reminder'} for subject ${index + 1}`}
                                            disabled={pendingReminderIds.includes(subject.id)}
                                            onClick={() => {
                                                void handleReminder(subject);
                                            }}
                                            className={`p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-50 ${
                                                subject.reminder
                                                    ? 'bg-app-accent-warning text-app-bg hover:bg-app-accent-warning/90'
                                                    : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                            }`}
                                            title={subject.reminder ? 'Cancel Reminder' : 'Set Reminder'}
                                        >
                                            {subject.reminder ? (
                                                <Bell size={16} fill="currentColor" aria-hidden="true" />
                                            ) : (
                                                <BellOff size={16} aria-hidden="true" />
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-4 md:px-6 py-3 text-center">
                                        {/* The card layout reads this sentence out; the
                                        table's control is icon-only, so without it a
                                        desktop screen-reader user never learns which
                                        days the subject repeats on. */}
                                        <span id={repeatDescriptionDomId(subject.id)} className="sr-only">
                                            {describeRepeatingDays(subject)}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={`Configure recurring days for subject ${index + 1}`}
                                            aria-pressed={subject.recurring === true}
                                            aria-describedby={repeatDescriptionDomId(subject.id)}
                                            onClick={() => handleRecurringClick(subject.id)}
                                            className={`flex items-center justify-center gap-1 p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary ${
                                                subject.recurring
                                                    ? 'bg-app-primary text-white hover:bg-app-primary-hover'
                                                    : 'text-app-text-muted hover:bg-app-bg hover:text-app-primary'
                                            }`}
                                            title="Configure recurring days"
                                        >
                                            <Repeat2 size={16} aria-hidden="true" />
                                            {repeatCount < ALL_DAYS.length && repeatCount > 0 && (
                                                <span className="text-[10px] font-bold">{repeatCount}</span>
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        {subjects.length > 1 && (
                                            <button
                                                type="button"
                                                aria-label={`Remove subject ${index + 1}`}
                                                onClick={(event) =>
                                                    void removeSubject(
                                                        subject.id,
                                                        event.currentTarget.closest<HTMLElement>('[data-subject-row]'),
                                                    )
                                                }
                                                className="p-1.5 rounded-lg text-app-text-muted hover:text-app-accent-error hover:bg-app-bg transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary"
                                                title="Remove subject"
                                            >
                                                <Trash2 size={14} aria-hidden="true" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        <tr className="bg-app-bg/50 font-bold text-app-text-main">
                            <th scope="row" className="px-4 md:px-6 py-3 text-left font-bold">
                                Total
                            </th>
                            <td className="px-4 md:px-6 py-3">{totalPlanned}</td>
                            <td className="px-4 md:px-6 py-3">{totalActual}</td>
                            <td className={`px-4 md:px-6 py-3 ${dayRatingColor}`}>{dayRating}</td>
                            <td colSpan={4}></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
});

TrackerForm.displayName = 'TrackerForm';

export default TrackerForm;
