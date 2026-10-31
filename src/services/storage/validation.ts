import { MAX_FOCUS_ALARMS } from '../../native/alarmLimits';
import type {
    BackupSettings,
    ChecklistItem,
    DayData,
    ErrorLogEntry,
    FocusAlarm,
    QualityCheckItem,
    RecurringSubject,
    Subject,
    ThemeValue,
    Todo,
} from '../../types';
import { isValidDateKey } from '../../utils/dateUtils';
import {
    DANGEROUS_KEYS,
    LEGACY_UPDATED_AT,
    MAX_DAYS,
    MAX_DEPTH,
    MAX_ID,
    MAX_ITEMS,
    MAX_MINUTES,
    MAX_NATIVE_ID,
    MAX_NESTED_ITEMS,
    MAX_STRING_LENGTH,
    MAX_SUBJECTS,
    THEMES,
} from './constants';
import { fail } from './errors';

/**
 * The validators that stand between an untrusted file and the store.
 *
 * Everything here is pure: it takes a value and either returns a checked copy of it or fails.
 * Nothing reads or writes, so the rules can be read, tested and changed on their own.
 */

/** Whether a value is a plain object rather than an array or `null`. */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** Whether an object carries a key of its own. */
export const hasOwn = (value: object, key: string): boolean => Object.hasOwn(value, key);

const isDangerousKey = (key: string): boolean => DANGEROUS_KEYS.has(key) || DANGEROUS_KEYS.has(key.toLowerCase());

const ARRAY_INDEX_KEY = /^(?:0|[1-9]\d*)$/;

export const assertNoDangerousKeys = (value: unknown, path = 'root', depth = 0, seen = new WeakSet<object>()): void => {
    if (typeof value !== 'object' || value === null) {
        return;
    }
    if (depth > MAX_DEPTH) {
        fail(`Nesting too deep at ${path}`);
    }

    if (seen.has(value)) {
        fail(`Circular value at ${path}`);
    }
    seen.add(value);

    try {
        if (Array.isArray(value)) {
            // The elements are the payload: a day, a subject or a todo is exactly where a
            // hidden `__proto__` would hide, so they are walked in index order.
            for (let index = 0; index < value.length; index += 1) {
                assertNoDangerousKeys(value[index], `${path}[${index}]`, depth + 1, seen);
            }
            for (const key of Object.getOwnPropertyNames(value)) {
                if (key === 'length' || ARRAY_INDEX_KEY.test(key)) {
                    continue;
                }
                if (isDangerousKey(key)) {
                    fail(`Dangerous key ${key} at ${path}`);
                }
                assertNoDangerousKeys(
                    (value as unknown as Record<string, unknown>)[key],
                    `${path}.${key}`,
                    depth + 1,
                    seen,
                );
            }
            return;
        }

        let prototype: object | null = null;
        try {
            prototype = Object.getPrototypeOf(value);
        } catch {
            fail(`Unable to inspect ${path}`);
        }
        if (prototype !== Object.prototype && prototype !== null) {
            fail(`Invalid object at ${path}`);
        }

        for (const key of Object.getOwnPropertyNames(value)) {
            if (isDangerousKey(key)) {
                fail(`Dangerous key ${key} at ${path}`);
            }
            assertNoDangerousKeys((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, seen);
        }
    } finally {
        seen.delete(value);
    }
};

export const assertAllowedKeys = (
    value: Record<string, unknown>,
    path: string,
    allowed: readonly string[],
    required: readonly string[] = [],
): void => {
    const allowedSet = new Set(allowed);
    for (const key of Object.getOwnPropertyNames(value)) {
        if (!allowedSet.has(key)) {
            fail(`Unexpected key ${key} at ${path}`);
        }
    }
    for (const key of required) {
        if (!hasOwn(value, key)) {
            fail(`Missing key ${key} at ${path}`);
        }
    }
};

export function assertBoundedArray(value: unknown, path: string, max: number): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > max) {
        fail(`Invalid array at ${path}`);
    }
}

/**
 * Bounds an externally supplied array and validates every element in a single indexed pass.
 * `Array.prototype.map` skips holes, so a sparse payload would otherwise reach the caller as an
 * array of `undefined` and only fail later - with a `TypeError`, and from wherever the first
 * element happened to be read - instead of as a `PersistenceError` about this array.
 */
export const mapBoundedArray = <T>(
    value: unknown,
    path: string,
    max: number,
    validate: (entry: unknown, entryPath: string) => T,
): T[] => {
    assertBoundedArray(value, path, max);
    const result: T[] = [];
    for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, String(index))) {
            fail(`Invalid array at ${path}`);
        }
        result.push(validate(value[index], `${path}[${index}]`));
    }
    return result;
};

function assertString(value: unknown, path: string, maxLength = MAX_STRING_LENGTH, allowEmpty = true): string {
    if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.length === 0)) {
        fail(`Invalid string at ${path}`);
    }
    return value;
}

function assertBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
        fail(`Invalid boolean at ${path}`);
    }
    return value;
}

function assertId(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_ID) {
        fail(`Invalid id at ${path}`);
    }
    return value;
}

function assertNativeId(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_NATIVE_ID) {
        fail(`Invalid native id at ${path}`);
    }
    return value;
}

/**
 * Strict ISO-8601 instant. `Date.parse` rolls impossible fields forward instead of rejecting
 * them (`2026-02-30T10:00:00Z` parses to 2 March), which would let a corrupt `updatedAt` win an
 * import conflict on a timestamp that never existed, so the calendar and clock fields are
 * checked before the value is trusted as a date.
 */
const TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const isValidTimestamp = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 64) {
        return false;
    }
    const match = TIMESTAMP_PATTERN.exec(value);
    if (!match) {
        return false;
    }
    const [, year, month, day] = match;
    if (!isValidDateKey(`${year}-${month}-${day}`)) {
        return false;
    }
    return Number.isFinite(Date.parse(value));
};

export function assertTimestamp(value: unknown, path: string): string {
    if (!isValidTimestamp(value)) {
        fail(`Invalid timestamp at ${path}`);
    }
    return value;
}

export function assertDateKey(value: unknown, path: string): string {
    if (!isValidDateKey(value)) {
        fail(`Invalid date at ${path}`);
    }
    return value;
}

function assertTime(value: unknown, path: string): string {
    const time = assertString(value, path, 5);
    if (time.length > 0 && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        fail(`Invalid time at ${path}`);
    }
    return time;
}

function assertMinutes(value: unknown, path: string): string {
    const minutes = assertString(value, path, 32, false);
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d+)$/.test(minutes)) {
        fail(`Invalid minutes at ${path}`);
    }
    const numeric = Number(minutes);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_MINUTES) {
        fail(`Invalid minutes at ${path}`);
    }
    return minutes;
}

const normalizeRecurringDays = (value: unknown, path: string): number[] => {
    const days = mapBoundedArray(value, path, 7, (entry, entryPath) => {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 6) {
            fail(`Invalid recurring day at ${entryPath}`);
        }
        return entry;
    });
    if (new Set(days).size !== days.length) {
        fail(`Duplicate recurring day at ${path}`);
    }
    return [...days].sort((a, b) => a - b);
};

export const cloneSubject = (subject: Subject): Subject => ({
    id: subject.id,
    name: subject.name,
    planned: subject.planned,
    actual: subject.actual,
    kpi: subject.kpi,
    time: subject.time,
    reminder: subject.reminder,
    ...(subject.recurring === undefined ? {} : { recurring: subject.recurring }),
    ...(subject.recurringDays === undefined ? {} : { recurringDays: [...subject.recurringDays] }),
});

const validateSubject = (value: unknown, path: string): Subject => {
    if (!isRecord(value)) {
        fail(`Invalid subject at ${path}`);
    }
    assertAllowedKeys(
        value,
        path,
        ['id', 'name', 'planned', 'actual', 'kpi', 'time', 'reminder', 'recurring', 'recurringDays'],
        ['id', 'name', 'planned', 'actual', 'kpi', 'time', 'reminder'],
    );

    const recurring = value.recurring === undefined ? undefined : assertBoolean(value.recurring, `${path}.recurring`);
    const recurringDays =
        value.recurringDays === undefined
            ? undefined
            : normalizeRecurringDays(value.recurringDays, `${path}.recurringDays`);
    if (recurring === true && recurringDays === undefined) {
        fail(`Missing recurring days at ${path}`);
    }

    const kpi = assertString(value.kpi, `${path}.kpi`, 1, false);
    if (kpi !== 'Y' && kpi !== 'N') {
        fail(`Invalid KPI at ${path}`);
    }

    return {
        id: assertId(value.id, `${path}.id`),
        name: assertString(value.name, `${path}.name`),
        planned: assertMinutes(value.planned, `${path}.planned`),
        actual: assertMinutes(value.actual, `${path}.actual`),
        kpi,
        time: assertTime(value.time, `${path}.time`),
        reminder: assertBoolean(value.reminder, `${path}.reminder`),
        ...(recurring === undefined ? {} : { recurring }),
        ...(recurringDays === undefined ? {} : { recurringDays }),
    };
};

const validateRecurringSubject = (value: unknown, path: string): RecurringSubject => {
    const subject = validateSubject(value, path);
    if (subject.recurring !== true || !subject.recurringDays || subject.recurringDays.length === 0) {
        fail(`Invalid recurring template at ${path}`);
    }
    return {
        ...subject,
        recurring: true,
        recurringDays: [...subject.recurringDays],
    };
};

const validateChecklistItem = (value: unknown, path: string): ChecklistItem => {
    if (!isRecord(value)) {
        fail(`Invalid checklist item at ${path}`);
    }
    assertAllowedKeys(value, path, ['id', 'label', 'checked'], ['id', 'label', 'checked']);
    return {
        id: assertId(value.id, `${path}.id`),
        label: assertString(value.label, `${path}.label`),
        checked: assertBoolean(value.checked, `${path}.checked`),
    };
};

const validateQualityCheckItem = (value: unknown, path: string): QualityCheckItem => {
    if (!isRecord(value)) {
        fail(`Invalid quality check at ${path}`);
    }
    assertAllowedKeys(value, path, ['id', 'label', 'checked'], ['id', 'label', 'checked']);
    return {
        id: assertId(value.id, `${path}.id`),
        label: assertString(value.label, `${path}.label`),
        checked: assertBoolean(value.checked, `${path}.checked`),
    };
};

const validateErrorLogEntry = (value: unknown, path: string): ErrorLogEntry => {
    if (!isRecord(value)) {
        fail(`Invalid error log entry at ${path}`);
    }
    assertAllowedKeys(
        value,
        path,
        ['id', 'question', 'mistake', 'correctLogic'],
        ['id', 'question', 'mistake', 'correctLogic'],
    );
    return {
        id: assertId(value.id, `${path}.id`),
        question: assertString(value.question, `${path}.question`),
        mistake: assertString(value.mistake, `${path}.mistake`),
        correctLogic: assertString(value.correctLogic, `${path}.correctLogic`),
    };
};

const validateTodo = (value: unknown, path: string): Todo => {
    if (!isRecord(value)) {
        fail(`Invalid todo at ${path}`);
    }
    assertAllowedKeys(
        value,
        path,
        ['id', 'text', 'completed', 'time', 'reminder'],
        ['id', 'text', 'completed', 'time', 'reminder'],
    );
    return {
        id: assertId(value.id, `${path}.id`),
        text: assertString(value.text, `${path}.text`),
        completed: assertBoolean(value.completed, `${path}.completed`),
        time: assertTime(value.time, `${path}.time`),
        reminder: assertBoolean(value.reminder, `${path}.reminder`),
    };
};

const validateFocusAlarm = (value: unknown, path: string): FocusAlarm => {
    if (!isRecord(value)) {
        fail(`Invalid focus alarm at ${path}`);
    }
    assertAllowedKeys(value, path, ['id', 'time', 'active', 'nativeId'], ['id', 'time', 'active']);
    const id = assertString(value.id, `${path}.id`, 128, false);
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
        fail(`Invalid focus alarm id at ${path}`);
    }
    return {
        id,
        time: assertTime(value.time, `${path}.time`),
        active: assertBoolean(value.active, `${path}.active`),
        ...(value.nativeId === undefined ? {} : { nativeId: assertNativeId(value.nativeId, `${path}.nativeId`) }),
    };
};

export const validateSettings = (value: unknown, path: string): BackupSettings => {
    if (!isRecord(value)) {
        fail(`Invalid settings at ${path}`);
    }
    assertAllowedKeys(value, path, ['theme', 'adaptiveColor'], ['theme', 'adaptiveColor']);
    const theme = assertString(value.theme, `${path}.theme`, 32, false);
    if (!THEMES.has(theme)) {
        fail(`Invalid theme at ${path}`);
    }
    const adaptiveColor =
        value.adaptiveColor === null ? null : assertString(value.adaptiveColor, `${path}.adaptiveColor`, 128, false);
    if (adaptiveColor !== null && !/^#[0-9a-f]{6}$/i.test(adaptiveColor)) {
        fail(`Invalid adaptive color at ${path}`);
    }
    return { theme: theme as ThemeValue, adaptiveColor };
};

export const validateDay = (value: unknown, path: string, legacy = false): DayData => {
    if (!isRecord(value)) {
        fail(`Invalid day at ${path}`);
    }
    assertAllowedKeys(
        value,
        path,
        ['date', 'updatedAt', 'subjects', 'checklistItems', 'qualityChecks', 'dayRating', 'errors'],
        legacy ? ['date'] : ['date', 'updatedAt', 'subjects', 'checklistItems', 'qualityChecks', 'dayRating', 'errors'],
    );

    const date = assertDateKey(value.date, `${path}.date`);
    const updatedAt =
        legacy && value.updatedAt === undefined
            ? LEGACY_UPDATED_AT
            : assertTimestamp(value.updatedAt, `${path}.updatedAt`);

    const subjectsValue = legacy && value.subjects === undefined ? [] : value.subjects;
    const subjects = mapBoundedArray(subjectsValue, `${path}.subjects`, MAX_SUBJECTS, validateSubject);

    const checklistValue = legacy && value.checklistItems === undefined ? [] : value.checklistItems;
    const checklistItems = mapBoundedArray(
        checklistValue,
        `${path}.checklistItems`,
        MAX_NESTED_ITEMS,
        validateChecklistItem,
    );

    const qualityValue = legacy && value.qualityChecks === undefined ? [] : value.qualityChecks;
    const qualityChecks = mapBoundedArray(
        qualityValue,
        `${path}.qualityChecks`,
        MAX_NESTED_ITEMS,
        validateQualityCheckItem,
    );

    const errorsValue = legacy && value.errors === undefined ? [] : value.errors;
    const errors = mapBoundedArray(errorsValue, `${path}.errors`, MAX_NESTED_ITEMS, validateErrorLogEntry);

    const dayRating = legacy && value.dayRating === undefined ? '' : assertString(value.dayRating, `${path}.dayRating`);

    return {
        date,
        updatedAt,
        subjects,
        checklistItems,
        qualityChecks,
        dayRating,
        errors,
    };
};

export const validateRecurringSubjects = (value: unknown, path: string): RecurringSubject[] => {
    return mapBoundedArray(value, path, MAX_ITEMS, validateRecurringSubject);
};

export const validateTodos = (value: unknown, path: string): Todo[] => {
    return mapBoundedArray(value, path, MAX_ITEMS, validateTodo);
};

export const validateFocusAlarms = (value: unknown, path: string): FocusAlarm[] => {
    // The shared native store holds `MAX_NATIVE_ALARM_DEFINITIONS` entries and
    // the countdown timer owns one of them, so a list longer than that cannot be
    // armed - and the native reader would refuse the whole payload on the next
    // load, quarantining good day data with it. Bounding it here means the limit
    // is enforced where the list is written, not where it is read.
    return mapBoundedArray(value, path, MAX_FOCUS_ALARMS, validateFocusAlarm);
};

export const assertUniqueDays = (days: DayData[]): void => {
    const dates = new Set<string>();
    for (const day of days) {
        if (dates.has(day.date)) {
            fail(`Duplicate day ${day.date}`);
        }
        dates.add(day.date);
    }
};

/**
 * The bare `DayData[]` legacy root, shared by the importer and the native reader so both accept
 * exactly the same shapes. The result is sorted: file order is caller-controlled and must not
 * decide the order days come back in.
 */

/**
 * Every write path must keep the day count inside the bound the readers enforce. A file (or a
 * Dexie table) that exceeds it cannot be read back, and an unreadable canonical file is
 * quarantined - so the write has to be refused while the previous copy is still intact.
 */
export const assertDayCountWithinLimit = (count: number, action: string): void => {
    if (count > MAX_DAYS) {
        fail(`Refusing to ${action} ${count} days; the limit is ${MAX_DAYS}`);
    }
};
