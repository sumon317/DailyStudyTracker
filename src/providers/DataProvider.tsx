import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { announceDataImported } from '../services/dataImportEvents';
import { announcePersistenceError, announcePersistenceRecovered } from '../services/persistenceEvents';
import {
    downloadBackup,
    handleFileImport,
    loadFromNativeStorage,
    loadGlobalTodos,
    loadRecurringSubjects,
    saveGlobalTodos,
    saveRecurringSubjects,
    saveToNativeStorage,
} from '../services/storage';
import { shouldPublishWidget, updateWidget } from '../services/widgetService';
import type {
    ChecklistItem,
    DataProviderProps,
    DataProviderValue,
    DayData,
    ErrorLogEntry,
    QualityCheckItem,
    RecurringSubject,
    Subject,
    Todo,
} from '../types';
import { getTodayLocalDate, isValidDateKey, parseLocalDate } from '../utils/dateUtils';

const AUTOSAVE_INTERVAL_MS = 10000;
const AUTOSAVE_DEBOUNCE_MS = 1000;
/**
 * Upper bound on the passes a single flush may take before giving up. One pass is the normal
 * case; the bound only exists so an edit that keeps landing during a save cannot loop forever.
 */
const MAX_FLUSH_PASSES = 3;
/**
 * How many writes one flush may *join* before it gives up. Joining is not an attempt - a caller
 * that waited for another caller's write has not written anything itself - so those iterations
 * get their own budget. Without it a busy queue (a debounced flush, a periodic tick and a
 * lifecycle flush all writing at once) could spend every pass waiting and report "progress could
 * not be saved" for data that another caller was committing successfully. Generous enough that
 * real concurrency (a handful of callers) never reaches it, small enough that a store whose
 * writes never settle cannot keep a drain alive indefinitely.
 */
const MAX_FLUSH_JOINS = 8;
/**
 * A failing store is reported through a window event the shell turns into a toast. One broken
 * write is reported by every flush that was waiting on it - the debounce, the periodic tick, a
 * lifecycle flush and the unmount drain - and a store that stays broken repeats that on every
 * tick for as long as the fault lasts. A repeat of the same failure is therefore announced once
 * per window, and again as soon as the store has proved itself healthy.
 *
 * This is the *event* window. The shell keeps a shorter *presentation* window on top of it, and
 * both re-arm on recovery: see `src/services/persistenceEvents.ts` for why the two exist at all
 * and which of them owns which job.
 */
const ERROR_REPORT_COOLDOWN_MS = 30000;
const UNKNOWN_FAILURE = 'unknown';
const UNSAVED_ERROR = 'Progress could not be saved. Please try again.';
const RECURRING_SAVE_ERROR = 'Unable to save recurring subjects';
const TODO_SAVE_ERROR = 'Unable to save todos';
const DEFAULT_SUBJECT_ID = 1;
const DEFAULT_SUBJECT_NAME = 'New Subject';
const WEEKDAY_COUNT = 7;

let lastGeneratedId = 0;

const isStorableId = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/**
 * `Date.now()` repeats for every call made inside one tick, and two subjects sharing an id
 * collapse into a single widget row, a single reminder and an unresolvable edit. Nudging the
 * value forward whenever the clock does not already do it keeps ids unique per millisecond
 * without changing the shape storage validates (a non-negative safe integer).
 *
 * Storage rejects a day record in full when any id falls outside that range, so the value is
 * forced back into it: a clock that is not a usable number (a stubbed `Date.now`, a system time
 * beyond the safe-integer range) would otherwise hand out ids that no save can ever commit.
 */
const generateId = (): number => {
    const now = Date.now();
    const candidate = isStorableId(now) ? now + Math.floor(Math.random() * 10000) : lastGeneratedId;
    const stepped = candidate > lastGeneratedId ? candidate : lastGeneratedId + 1;
    lastGeneratedId = isStorableId(stepped) ? stepped : (lastGeneratedId + 1) % Number.MAX_SAFE_INTEGER;
    return lastGeneratedId;
};

const dispatchPersistenceError = (error: unknown): void => {
    announcePersistenceError(error);
};

/** What a report is keyed by, so the same fault is recognised however it was thrown. */
const describeFailure = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : UNKNOWN_FAILURE;
};

const createDefaultSubjects = (): Subject[] => [
    {
        id: DEFAULT_SUBJECT_ID,
        name: DEFAULT_SUBJECT_NAME,
        planned: '60',
        actual: '0',
        kpi: 'N',
        time: '',
        reminder: false,
    },
];

const createDefaultDay = (date: string): DayData => ({
    date,
    updatedAt: new Date().toISOString(),
    subjects: createDefaultSubjects(),
    checklistItems: [{ id: 1, label: 'Add your first checklist item here...', checked: false }],
    qualityChecks: [{ id: 1, label: 'Did you understand the core concepts?', checked: false }],
    dayRating: '',
    errors: [{ id: 1, question: '', mistake: '', correctLogic: '' }],
});

/**
 * Storage rejects duplicate and out-of-range recurring days, so an in-memory list that grows
 * either would make the whole day record unsaveable. Normalising on the way in keeps an
 * impossible-to-save payload out of state.
 */
const normalizeRecurringDays = (days: number[] | undefined): number[] | undefined => {
    if (days === undefined) {
        return undefined;
    }
    return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day < WEEKDAY_COUNT))].sort(
        (first, second) => first - second,
    );
};

/** Copies only the fields the storage validators accept, so nothing unexpected is ever written. */
const cloneSubject = (subject: Subject): Subject => {
    const recurringDays = normalizeRecurringDays(subject.recurringDays);
    return {
        id: subject.id,
        name: subject.name,
        planned: subject.planned,
        actual: subject.actual,
        kpi: subject.kpi,
        time: subject.time,
        reminder: subject.reminder,
        ...(subject.recurring === undefined ? {} : { recurring: subject.recurring }),
        ...(recurringDays === undefined ? {} : { recurringDays }),
    };
};

const cloneDayData = (data: DayData): DayData => ({
    ...data,
    subjects: data.subjects.map(cloneSubject),
    checklistItems: data.checklistItems.map((item) => ({ ...item })),
    qualityChecks: data.qualityChecks.map((item) => ({ ...item })),
    errors: data.errors.map((item) => ({ ...item })),
});

const cloneTodos = (todos: Todo[]): Todo[] => todos.map((todo) => ({ ...todo }));

/** A template needs at least one day: storage rejects an empty day list as an invalid template. */
const isRecurringTemplate = (subject: Subject): subject is RecurringSubject =>
    subject.recurring === true && (subject.recurringDays?.length ?? 0) > 0;

/** Narrows a subject to the template shape storage accepts; the caller has proved the days. */
const toTemplate = (subject: Subject): RecurringSubject => ({
    ...cloneSubject(subject),
    recurring: true,
    recurringDays: [...(subject.recurringDays ?? [])],
});

const isPlaceholderSubject = (subject: Subject): boolean =>
    subject.name === DEFAULT_SUBJECT_NAME && subject.actual === '0' && !subject.reminder;

const hasRecurringFlag = (subject: Subject): boolean => subject.recurring === true;

const mergeRecurringTemplates = (
    current: RecurringSubject[],
    previousSubjects: Subject[],
    nextSubjects: Subject[],
): { templates: RecurringSubject[]; changed: boolean } => {
    // `setSubjects` runs on every keystroke, so the common case - no template anywhere - must
    // not pay for a full rebuild plus two serialisations of the template list.
    if (current.length === 0 && !previousSubjects.some(hasRecurringFlag) && !nextSubjects.some(hasRecurringFlag)) {
        return { templates: current, changed: false };
    }

    const byId = new Map<number, RecurringSubject>(current.map((template) => [template.id, toTemplate(template)]));
    const nextRecurring = nextSubjects.filter(isRecurringTemplate);
    const nextIds = new Set(nextRecurring.map((subject) => subject.id));
    for (const subject of previousSubjects) {
        // A template the user just unticked (or emptied) disappears once it is missing from
        // the edited list; templates absent from the day are left alone.
        if (subject.recurring === true && !nextIds.has(subject.id)) {
            byId.delete(subject.id);
        }
    }
    for (const subject of nextRecurring) {
        byId.set(subject.id, toTemplate(subject));
    }
    const templates = [...byId.values()];
    return {
        templates,
        changed: JSON.stringify(templates) !== JSON.stringify(current),
    };
};

const applyRecurringTemplates = (
    data: DayData,
    templates: RecurringSubject[],
    targetDate: string,
    removePlaceholder = false,
): { data: DayData; added: boolean } => {
    const weekday = parseLocalDate(targetDate)?.getDay();
    if (weekday === undefined) {
        return { data, added: false };
    }

    const nextData = cloneDayData(data);
    const matchingTemplates = templates.filter((template) => template.recurringDays.includes(weekday));
    if (removePlaceholder && matchingTemplates.length > 0) {
        nextData.subjects = nextData.subjects.filter((subject) => !isPlaceholderSubject(subject));
    }
    let added = false;
    for (const template of matchingTemplates) {
        // A stored day already carrying this template keeps its own progress; the name
        // fallback keeps a template from being added twice under a different id.
        const existingIndex = nextData.subjects.findIndex(
            (subject) =>
                subject.id === template.id || (subject.name.trim() === template.name.trim() && subject.name.length > 0),
        );
        const clone: Subject = {
            ...cloneSubject(template),
            actual: '0',
            kpi: 'N',
            reminder: false,
            recurring: true,
            recurringDays: [...template.recurringDays],
        };

        if (existingIndex === -1) {
            nextData.subjects.push(clone);
            added = true;
        } else {
            const existing = nextData.subjects[existingIndex];
            if (existing && isPlaceholderSubject(existing)) {
                nextData.subjects[existingIndex] = clone;
                added = true;
            }
        }
    }

    return { data: nextData, added };
};

/**
 * A flush in progress. `settled` never rejects so a late waiter cannot hang on an
 * unhandled rejection, while `failure` keeps the rejection observable for every caller.
 */
interface FlushRecord {
    settled: Promise<void>;
    failure: { error: unknown } | null;
}

const DataContext = createContext<DataProviderValue | null>(null);

export default function DataProvider({ children }: DataProviderProps) {
    const [date, setDateState] = useState(getTodayLocalDate);
    const [loadedDate, setLoadedDateState] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [subjects, setSubjectsState] = useState<Subject[]>(createDefaultSubjects);
    const [checklistItems, setChecklistItemsState] = useState<ChecklistItem[]>(() => [
        { id: 1, label: 'Add your first checklist item here...', checked: false },
    ]);
    const [qualityChecks, setQualityChecksState] = useState<QualityCheckItem[]>(() => [
        { id: 1, label: 'Did you understand the core concepts?', checked: false },
    ]);
    const [dayRating, setDayRatingState] = useState('');
    const [errors, setErrorsState] = useState<ErrorLogEntry[]>(() => [
        { id: 1, question: '', mistake: '', correctLogic: '' },
    ]);
    const [todos, setTodosState] = useState<Todo[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<string | null>(null);

    const dateRef = useRef(date);
    /**
     * The day the in-memory payload actually describes, which is not `loadedDate`: a payload
     * typed before the first read resolved is today's, even though nothing was ever loaded.
     */
    const payloadDateRef = useRef(date);
    const loadedDateRef = useRef<string | null>(null);
    const initializedRef = useRef(false);
    const subjectsRef = useRef(subjects);
    const checklistItemsRef = useRef(checklistItems);
    const qualityChecksRef = useRef(qualityChecks);
    const dayRatingRef = useRef(dayRating);
    const errorsRef = useRef(errors);
    const todosRef = useRef(todos);
    const mountedRef = useRef(true);
    const dayRevisionRef = useRef(0);
    const todoRevisionRef = useRef(0);
    const dayDirtyRef = useRef(false);
    const todoDirtyRef = useRef(false);
    const recurringTemplatesRef = useRef<RecurringSubject[]>([]);
    const recurringDirtyRef = useRef(false);
    const loadRequestRef = useRef(0);
    const explicitLoadRequestedRef = useRef(false);
    const todoLoadRequestRef = useRef(0);
    const initializationPromiseRef = useRef<Promise<void> | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const widgetQueueRef = useRef<Promise<void>>(Promise.resolve());
    const flushRecordRef = useRef<FlushRecord | null>(null);
    const debounceTimerRef = useRef<number | null>(null);
    const savingCountRef = useRef(0);
    const persistenceNoticesRef = useRef(new Map<string, number>());

    useEffect(() => {
        dateRef.current = date;
    }, [date]);

    /**
     * One report per failure, per window.
     *
     * Every background flush that fails lands here - the debounce, the periodic tick, a
     * lifecycle flush and the unmount drain all catch into this - and so does a caller that
     * merely joined a failed write, so a single fault is reported by all of them. Generating
     * that many events says nothing the first one did not, and a clock that moved backwards
     * reports again rather than staying silent until it catches up.
     *
     * Keyed by the failure itself, not by the event: two *different* faults are two pieces of
     * news and both are reported, however close together they arrive.
     */
    const reportPersistenceError = useCallback((error: unknown): void => {
        const now = Date.now();
        const key = describeFailure(error);
        const reportedAt = persistenceNoticesRef.current.get(key) ?? 0;
        if (reportedAt <= now && now - reportedAt < ERROR_REPORT_COOLDOWN_MS) {
            return;
        }
        for (const [reported, at] of persistenceNoticesRef.current) {
            if (at <= now && now - at >= ERROR_REPORT_COOLDOWN_MS) {
                persistenceNoticesRef.current.delete(reported);
            }
        }
        persistenceNoticesRef.current.set(key, now);
        dispatchPersistenceError(error);
    }, []);

    /**
     * A write the store accepted ends the failure episodes this was reporting, so the next
     * fault is news again however soon it arrives. The presentation layer cannot infer this
     * from the failure events alone - it only ever hears that something broke, never that
     * something worked afterwards - so the recovery is announced too, and the shell's own
     * window is re-armed with it. Without that second half a store that failed, recovered
     * and failed again inside the shell's window reported nothing at all until the window
     * lapsed.
     */
    const clearPersistenceError = useCallback(() => {
        if (persistenceNoticesRef.current.size === 0) {
            // Nothing was being suppressed, so there is no episode to end. Announcing
            // a recovery here anyway would clear the shell's window on every successful
            // save, which is exactly the rate limit the window exists to provide.
            return;
        }
        persistenceNoticesRef.current.clear();
        announcePersistenceRecovered();
    }, []);

    const setLoadedDate = useCallback((next: string | null) => {
        loadedDateRef.current = next;
        setLoadedDateState(next);
    }, []);

    const markInitialized = useCallback(() => {
        initializedRef.current = true;
        if (mountedRef.current) {
            setIsInitialized(true);
        }
    }, []);

    const hasUnsavedWrites = useCallback(
        (): boolean => dayDirtyRef.current || todoDirtyRef.current || recurringDirtyRef.current,
        [],
    );

    /**
     * A day may only be written while the payload still describes the selected day. The window
     * between selecting a day and adopting its record is exactly when that stops being true,
     * and writing through it would persist the outgoing day's rows - under the incoming date.
     * A payload typed before the first read resolved is deliberately still writable: refusing
     * that load already decided the edit outranks the stored record.
     */
    const isDayWritable = useCallback((): boolean => payloadDateRef.current === dateRef.current, []);

    const hasFlushableWrites = useCallback(
        (): boolean => todoDirtyRef.current || (hasUnsavedWrites() && isDayWritable()),
        [hasUnsavedWrites, isDayWritable],
    );

    const syncDirtyState = useCallback(() => {
        if (mountedRef.current) {
            setHasUnsavedChanges(hasUnsavedWrites());
        }
    }, [hasUnsavedWrites]);

    const markDayDirty = useCallback(() => {
        dayRevisionRef.current += 1;
        dayDirtyRef.current = true;
        syncDirtyState();
    }, [syncDirtyState]);

    const markTodoDirty = useCallback(() => {
        todoRevisionRef.current += 1;
        todoDirtyRef.current = true;
        syncDirtyState();
    }, [syncDirtyState]);

    const enqueuePersistence = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
        const result = saveQueueRef.current.then(operation, operation);
        saveQueueRef.current = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }, []);

    /**
     * Widget publication is fire-and-forget but must stay ordered: two overlapping flushes
     * could otherwise resolve out of order and leave the today-only widget showing stale rows.
     */
    const publishWidget = useCallback((nextSubjects: Subject[], targetDate: string): void => {
        if (!shouldPublishWidget(targetDate)) {
            return;
        }
        const publish = () => updateWidget(nextSubjects, targetDate);
        widgetQueueRef.current = widgetQueueRef.current.then(publish, publish).then(
            () => undefined,
            () => undefined,
        );
    }, []);

    const writePendingData = useCallback(async (): Promise<void> => {
        const capturedDate = dateRef.current;
        const capturedDayRevision = dayRevisionRef.current;
        const capturedTodoRevision = todoRevisionRef.current;
        const capturedDayDirty = dayDirtyRef.current;
        const capturedTodoDirty = todoDirtyRef.current;
        const capturedRecurringDirty = recurringDirtyRef.current;
        // The payload and the template list it produced share one provenance, so they are only
        // ever written together, and only while that provenance is still the selected day.
        const dayAdoptable = isDayWritable();
        const dayWritable = capturedDayDirty && dayAdoptable;
        const recurringWritable = capturedRecurringDirty && dayAdoptable;
        const dayPayload = dayWritable
            ? {
                  subjects: subjectsRef.current.map(cloneSubject),
                  checklistItems: checklistItemsRef.current.map((item) => ({ ...item })),
                  qualityChecks: qualityChecksRef.current.map((item) => ({ ...item })),
                  dayRating: dayRatingRef.current,
                  errors: errorsRef.current.map((item) => ({ ...item })),
              }
            : null;
        const capturedTodos = capturedTodoDirty ? cloneTodos(todosRef.current) : null;
        const recurringTemplates = recurringWritable
            ? recurringTemplatesRef.current.map((template) => ({
                  ...template,
                  recurringDays: [...template.recurringDays],
              }))
            : null;

        if (mountedRef.current) {
            setIsSaving(true);
        }
        savingCountRef.current += 1;

        const record: FlushRecord = { settled: Promise.resolve(), failure: null };
        const operation = enqueuePersistence(async () => {
            try {
                if (dayPayload) {
                    await saveToNativeStorage(capturedDate, dayPayload);
                }
                if (recurringTemplates) {
                    const recurringSaved = await saveRecurringSubjects(recurringTemplates);
                    if (recurringSaved === false) {
                        throw new Error(RECURRING_SAVE_ERROR);
                    }
                }
                if (dayPayload) {
                    publishWidget(dayPayload.subjects, capturedDate);
                }

                if (capturedTodos) {
                    const todosSaved = await saveGlobalTodos(capturedTodos);
                    if (todosSaved === false) {
                        throw new Error(TODO_SAVE_ERROR);
                    }
                }

                if (dayWritable && dayRevisionRef.current === capturedDayRevision && dateRef.current === capturedDate) {
                    dayDirtyRef.current = false;
                }
                if (capturedTodos && todoRevisionRef.current === capturedTodoRevision) {
                    todoDirtyRef.current = false;
                }
                if (
                    recurringTemplates &&
                    JSON.stringify(recurringTemplatesRef.current) === JSON.stringify(recurringTemplates)
                ) {
                    recurringDirtyRef.current = false;
                }
                // `lastSaved` and the dirty flag describe committed writes, so a flush that
                // only skipped an unwritable day must not look like a successful save.
                if (mountedRef.current && (dayPayload || capturedTodos)) {
                    setLastSaved(new Date().toISOString());
                    syncDirtyState();
                }
                clearPersistenceError();
            } catch (error) {
                record.failure = { error };
                throw error;
            } finally {
                savingCountRef.current -= 1;
                if (savingCountRef.current === 0 && mountedRef.current) {
                    setIsSaving(false);
                }
            }
        });

        record.settled = operation.then(
            () => undefined,
            () => undefined,
        );
        flushRecordRef.current = record;
        try {
            await record.settled;
        } finally {
            if (flushRecordRef.current === record) {
                flushRecordRef.current = null;
            }
        }
        if (record.failure) {
            throw record.failure.error;
        }
    }, [clearPersistenceError, enqueuePersistence, isDayWritable, publishWidget, syncDirtyState]);

    /**
     * Drains every pending change. A date switch, a backup, an import and `saveData` itself
     * all read the persisted state, so leaving an edit behind would either write it under the
     * wrong day or quietly drop it from the artefact the caller is about to produce.
     *
     * Only a write this drain performed itself costs it a pass. Joining another caller's write
     * costs a join instead, so a queue that is busy - the debounce, the periodic tick and a
     * lifecycle flush all saving at once - cannot make this drain give up on data it never even
     * tried to write, and report a save failure for a save that is being made.
     */
    const flushDirtyData = useCallback(async (): Promise<void> => {
        let passes = 0;
        let joins = 0;
        while (passes < MAX_FLUSH_PASSES && joins < MAX_FLUSH_JOINS) {
            if (!hasFlushableWrites()) {
                return;
            }
            const active = flushRecordRef.current;
            if (active) {
                // A concurrent caller already serialised a write. Wait for it rather than queue
                // a second one, then re-check: its failure is only this caller's problem if
                // nothing else picked the still-pending data up in the meantime.
                joins += 1;
                await active.settled;
                if (active.failure && !hasFlushableWrites()) {
                    throw active.failure.error;
                }
                continue;
            }
            passes += 1;
            await writePendingData();
        }
        if (hasFlushableWrites()) {
            throw new Error(UNSAVED_ERROR);
        }
    }, [hasFlushableWrites, writePendingData]);

    const scheduleAutosave = useCallback(() => {
        if (debounceTimerRef.current !== null) {
            window.clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(() => {
            debounceTimerRef.current = null;
            void flushDirtyData().catch(reportPersistenceError);
        }, AUTOSAVE_DEBOUNCE_MS);
    }, [flushDirtyData, reportPersistenceError]);

    const loadDataForDateInternal = useCallback(
        async (targetDate: string, preserveUnsavedChanges: boolean): Promise<void> => {
            if (!isValidDateKey(targetDate)) {
                throw new Error(`Invalid date: ${targetDate}`);
            }

            const requestId = loadRequestRef.current + 1;
            loadRequestRef.current = requestId;
            const startingRevision = dayRevisionRef.current;
            const startingDirty = dayDirtyRef.current;
            const [storedDay, templates] = await Promise.all([
                loadFromNativeStorage(targetDate),
                loadRecurringSubjects(),
            ]);

            if (requestId !== loadRequestRef.current) {
                return;
            }
            if (preserveUnsavedChanges && (startingDirty || dayRevisionRef.current !== startingRevision)) {
                return;
            }
            if (storedDay && storedDay.date !== targetDate) {
                // A record filed under one day that names another cannot be adopted: the payload
                // would stop describing the selected day, and the next save - which keys its write
                // on the selected day - would overwrite a record this provider never showed. The
                // read is refused instead, so the data stays exactly as it is and the failure is
                // reported rather than silently replaced by a default day.
                throw new Error(`Stored record ${storedDay.date} does not describe ${targetDate}`);
            }

            const baseDay = storedDay ? cloneDayData(storedDay) : createDefaultDay(targetDate);
            const recurrenceResult = applyRecurringTemplates(baseDay, templates, targetDate, !storedDay);
            const nextDay = recurrenceResult.data;

            if (!mountedRef.current) {
                return;
            }

            dayRevisionRef.current += 1;
            payloadDateRef.current = targetDate;
            subjectsRef.current = nextDay.subjects;
            checklistItemsRef.current = nextDay.checklistItems;
            qualityChecksRef.current = nextDay.qualityChecks;
            dayRatingRef.current = nextDay.dayRating;
            errorsRef.current = nextDay.errors;
            setSubjectsState(nextDay.subjects);
            setChecklistItemsState(nextDay.checklistItems);
            setQualityChecksState(nextDay.qualityChecks);
            setDayRatingState(nextDay.dayRating);
            setErrorsState(nextDay.errors);
            recurringTemplatesRef.current = templates.map((template) => ({
                ...template,
                actual: '0',
                kpi: 'N',
                reminder: false,
                recurringDays: [...template.recurringDays],
            }));
            recurringDirtyRef.current = false;

            dayDirtyRef.current = recurrenceResult.added && targetDate === dateRef.current;
            setLoadedDate(targetDate);
            syncDirtyState();
            publishWidget(nextDay.subjects, targetDate);
            if (dayDirtyRef.current) {
                scheduleAutosave();
            }
        },
        [publishWidget, scheduleAutosave, setLoadedDate, syncDirtyState],
    );

    const activateDate = useCallback(
        async (targetDate: string): Promise<void> => {
            if (!isValidDateKey(targetDate)) {
                throw new Error(`Invalid date: ${targetDate}`);
            }
            // Keep the selected date and the loaded payload in lockstep: adopting a day that
            // is not the selected date would let a later save write the wrong day, and any
            // write still pending has to land under the outgoing date. The drain therefore
            // runs before the selection moves, while the payload is still adoptable.
            await flushDirtyData();
            const previousDate = dateRef.current;
            const previousLoadedDate = loadedDateRef.current;
            explicitLoadRequestedRef.current = true;
            setLoadedDate(null);
            dateRef.current = targetDate;
            setDateState(targetDate);
            try {
                await loadDataForDateInternal(targetDate, false);
            } catch (error) {
                // Roll the selection back: keeping the new date while the payload still
                // belongs to the old day would let the next save overwrite the wrong record.
                dateRef.current = previousDate;
                setDateState(previousDate);
                setLoadedDate(previousLoadedDate);
                throw error;
            }
        },
        [flushDirtyData, loadDataForDateInternal, setLoadedDate],
    );

    const loadDataForDate = activateDate;

    useEffect(() => {
        if (!initializationPromiseRef.current) {
            initializationPromiseRef.current = (async () => {
                const todoRequest = todoLoadRequestRef.current + 1;
                todoLoadRequestRef.current = todoRequest;
                const startingTodoRevision = todoRevisionRef.current;
                const startingTodoDirty = todoDirtyRef.current;
                try {
                    const storedTodos = await loadGlobalTodos();
                    if (
                        mountedRef.current &&
                        todoRequest === todoLoadRequestRef.current &&
                        !startingTodoDirty &&
                        todoRevisionRef.current === startingTodoRevision
                    ) {
                        const nextTodos = storedTodos ? cloneTodos(storedTodos) : [];
                        todoRevisionRef.current += 1;
                        todosRef.current = nextTodos;
                        setTodosState(nextTodos);
                        todoDirtyRef.current = false;
                        syncDirtyState();
                    }
                } catch (error) {
                    // Reported per failure: a single variable would lose the first error when
                    // both reads fail during startup.
                    if (mountedRef.current) {
                        reportPersistenceError(error);
                    }
                }

                try {
                    if (!explicitLoadRequestedRef.current) {
                        await loadDataForDateInternal(dateRef.current, true);
                    }
                } catch (error) {
                    if (mountedRef.current) {
                        reportPersistenceError(error);
                    }
                }

                markInitialized();
            })();
        }
        void initializationPromiseRef.current;
    }, [loadDataForDateInternal, markInitialized, reportPersistenceError, syncDirtyState]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            void flushDirtyData().catch(reportPersistenceError);
        }, AUTOSAVE_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [flushDirtyData, reportPersistenceError]);

    useEffect(() => {
        const flushOnLifecycleEvent = () => {
            void flushDirtyData().catch(reportPersistenceError);
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                flushOnLifecycleEvent();
            }
        };
        window.addEventListener('pagehide', flushOnLifecycleEvent);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('pagehide', flushOnLifecycleEvent);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [flushDirtyData, reportPersistenceError]);

    useEffect(() => {
        // The only place that marks the provider unmounted: `useRef(true)` covers the first
        // mount, and this effect runs again on every remount (React strict-mode double invoke).
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (debounceTimerRef.current !== null) {
                window.clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            // The debounce timer that never fired is the whole point of this drain: it is the
            // last chance to land the edit before the page goes away.
            void flushDirtyData().catch(reportPersistenceError);
        };
    }, [flushDirtyData, reportPersistenceError]);

    const setDate = useCallback(
        async (newDate: string): Promise<void> => {
            if (!isValidDateKey(newDate)) {
                throw new Error(`Invalid date: ${newDate}`);
            }
            if (newDate === dateRef.current && (loadedDateRef.current === newDate || !initializedRef.current)) {
                // Already showing this day from a coherent load, or the startup read for this
                // exact day is still on its way: there is nothing to drain and nothing to load.
                return;
            }
            await activateDate(newDate);
        },
        [activateDate],
    );

    const setSubjectsWrapped = useCallback(
        (updater: Subject[] | ((prev: Subject[]) => Subject[])) => {
            const previousSubjects = subjectsRef.current;
            const nextValue = typeof updater === 'function' ? updater(previousSubjects) : updater;
            const nextSubjects = nextValue.map(cloneSubject);
            const recurrenceUpdate = mergeRecurringTemplates(
                recurringTemplatesRef.current,
                previousSubjects,
                nextSubjects,
            );
            if (recurrenceUpdate.changed) {
                recurringTemplatesRef.current = recurrenceUpdate.templates;
                recurringDirtyRef.current = true;
            }
            subjectsRef.current = nextSubjects;
            setSubjectsState(nextSubjects);
            markDayDirty();
            scheduleAutosave();
        },
        [markDayDirty, scheduleAutosave],
    );

    const setChecklistItemsWrapped = useCallback(
        (updater: ChecklistItem[] | ((prev: ChecklistItem[]) => ChecklistItem[])) => {
            const nextValue = typeof updater === 'function' ? updater(checklistItemsRef.current) : updater;
            const nextItems = nextValue.map((item) => ({ ...item }));
            checklistItemsRef.current = nextItems;
            setChecklistItemsState(nextItems);
            markDayDirty();
            scheduleAutosave();
        },
        [markDayDirty, scheduleAutosave],
    );

    const setQualityChecksWrapped = useCallback(
        (updater: QualityCheckItem[] | ((prev: QualityCheckItem[]) => QualityCheckItem[])) => {
            const nextValue = typeof updater === 'function' ? updater(qualityChecksRef.current) : updater;
            const nextItems = nextValue.map((item) => ({ ...item }));
            qualityChecksRef.current = nextItems;
            setQualityChecksState(nextItems);
            markDayDirty();
            scheduleAutosave();
        },
        [markDayDirty, scheduleAutosave],
    );

    const setErrorsWrapped = useCallback(
        (updater: ErrorLogEntry[] | ((prev: ErrorLogEntry[]) => ErrorLogEntry[])) => {
            const nextValue = typeof updater === 'function' ? updater(errorsRef.current) : updater;
            const nextItems = nextValue.map((item) => ({ ...item }));
            errorsRef.current = nextItems;
            setErrorsState(nextItems);
            markDayDirty();
            scheduleAutosave();
        },
        [markDayDirty, scheduleAutosave],
    );

    const setTodosWrapped = useCallback(
        (updater: Todo[] | ((prev: Todo[]) => Todo[])) => {
            const nextValue = typeof updater === 'function' ? updater(todosRef.current) : updater;
            const nextTodos = cloneTodos(nextValue);
            todosRef.current = nextTodos;
            setTodosState(nextTodos);
            markTodoDirty();
            scheduleAutosave();
        },
        [markTodoDirty, scheduleAutosave],
    );

    const setDayRating = useCallback(
        (value: string) => {
            dayRatingRef.current = value;
            setDayRatingState(value);
            markDayDirty();
            scheduleAutosave();
        },
        [markDayDirty, scheduleAutosave],
    );

    const exportData = useCallback(async (): Promise<number> => {
        await flushDirtyData();
        return downloadBackup();
    }, [flushDirtyData]);

    const importData = useCallback(
        async (file: File): Promise<number> => {
            await flushDirtyData();
            // Storage's default conflict policy (`newest`) is deliberate: the file only wins for
            // days it is actually newer for, and a restore therefore never discards local work
            // that was recorded later. The `replace`/`keep` policies exist in storage but have no
            // reachable caller, so the provider passes none.
            const appliedDays = await handleFileImport(file);
            // The canonical store has been rewritten at this point, so the component-owned
            // mirrors are told to re-read now. The theme and the focus alarm list live in other
            // trees that read their value once, at mount; announcing only after the reloads below
            // would leave them showing pre-import values whenever a reload failed - the one case
            // where the screen is guaranteed to disagree with the store the user just restored.
            announceDataImported({ appliedDays });
            const currentDate = dateRef.current;
            // A failed reload leaves `loadedDate` null on purpose: the payload still in state
            // is the pre-import one, and claiming otherwise would gate notifications on data
            // that no longer matches the store.
            setLoadedDate(null);
            try {
                await loadDataForDateInternal(currentDate, false);
            } catch (error) {
                // Nothing was adopted, so the startup read is no longer competing with an import
                // and is free to load a coherent day itself.
                explicitLoadRequestedRef.current = false;
                throw error;
            }
            // Only now does the startup read have to stand down. Until this point it could still
            // load the day - and had it done so concurrently, its older request id would lose to
            // the one this import just took.
            explicitLoadRequestedRef.current = true;
            // The startup read is issued before the import, so it must be invalidated here or
            // it would resolve after this adopt and restore the pre-import list.
            const todoRequest = todoLoadRequestRef.current + 1;
            todoLoadRequestRef.current = todoRequest;
            const startingTodoRevision = todoRevisionRef.current;
            const storedTodos = await loadGlobalTodos();
            if (
                mountedRef.current &&
                todoRequest === todoLoadRequestRef.current &&
                storedTodos !== null &&
                !todoDirtyRef.current &&
                todoRevisionRef.current === startingTodoRevision
            ) {
                const nextTodos = cloneTodos(storedTodos);
                todoRevisionRef.current += 1;
                todosRef.current = nextTodos;
                setTodosState(nextTodos);
                // Only an adopted list is known to be persisted. Without one the pending todo
                // state has to stay dirty instead of being marked saved and then lost.
                todoDirtyRef.current = false;
            }
            syncDirtyState();
            return appliedDays;
        },
        [flushDirtyData, loadDataForDateInternal, setLoadedDate, syncDirtyState],
    );

    const downloadPDF = useCallback(async (): Promise<void> => {
        const { generatePDF } = await import('../services/export/pdfGenerator');
        await generatePDF({
            date: dateRef.current,
            subjects: subjectsRef.current,
            checklistItems: checklistItemsRef.current,
            qualityChecks: qualityChecksRef.current,
            dayRating: dayRatingRef.current,
            errors: errorsRef.current,
            todos: todosRef.current,
        });
    }, []);

    const downloadMD = useCallback(async (): Promise<void> => {
        const { generateMarkdown } = await import('../services/export/markdownGenerator');
        await generateMarkdown({
            date: dateRef.current,
            subjects: subjectsRef.current,
            checklistItems: checklistItemsRef.current,
            qualityChecks: qualityChecksRef.current,
            dayRating: dayRatingRef.current,
            errors: errorsRef.current,
            todos: todosRef.current,
        });
    }, []);

    const value: DataProviderValue = {
        date,
        loadedDate,
        isInitialized,
        subjects,
        checklistItems,
        qualityChecks,
        dayRating,
        errors,
        todos,
        hasUnsavedChanges,
        isSaving,
        lastSaved,
        setDate,
        setSubjects: setSubjectsWrapped,
        setChecklistItems: setChecklistItemsWrapped,
        setQualityChecks: setQualityChecksWrapped,
        setDayRating,
        setErrors: setErrorsWrapped,
        setTodos: setTodosWrapped,
        saveData: flushDirtyData,
        exportData,
        importData,
        downloadPDF,
        downloadMD,
        loadDataForDate,
        generateId,
    };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataProviderValue {
    const ctx = useContext(DataContext);
    if (!ctx) {
        throw new Error('useData must be used within a DataProvider');
    }
    return ctx;
}
