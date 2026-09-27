import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import Dexie from 'dexie';
import { MAX_FOCUS_ALARMS } from '../native/alarmLimits';
import type {
    BackupEnvelope,
    BackupSettings,
    ChecklistItem,
    DayData,
    ErrorLogEntry,
    FocusAlarm,
    GlobalSectionKey,
    GlobalSectionStamps,
    QualityCheckItem,
    RecurringSubject,
    Subject,
    ThemeValue,
    Todo,
} from '../types';
import { getTodayLocalDate, isValidDateKey } from '../utils/dateUtils';

interface DaysTable extends DayData {}

interface MetadataTable {
    key: string;
    value: unknown;
    updatedAt: string;
}

interface StudyTrackerDB extends Dexie {
    days: Dexie.Table<DaysTable, string>;
    metadata: Dexie.Table<MetadataTable, string>;
}

export const db = new Dexie('StudyTrackerDB') as StudyTrackerDB;

db.version(1).stores({
    days: 'date, updatedAt',
});

db.version(2).stores({
    days: 'date, updatedAt',
    metadata: 'key',
});

export const BACKUP_SCHEMA_VERSION = 1;
export const STORAGE_FILE = 'study-tracker-data.json';
export const RECURRING_KEY = '__recurring_subjects';
export const TODOS_KEY = '__global_todos';
export const FOCUS_ALARMS_KEY = '__focus_alarms';
export const SETTINGS_KEY = '__settings';

const LEGACY_FOCUS_KEYS = ['focusAlarms', '__focusAlarms'];
const FOCUS_STORAGE_KEY = 'focusAlarms';
const LEGACY_SETTINGS_KEYS = ['settings', '__backup_settings'];
const THEME_STORAGE_KEY = 'theme';
const ADAPTIVE_COLOR_STORAGE_KEY = 'adaptive-color';
const METADATA_RECURRING_KEY = 'recurringSubjects';
const METADATA_TODOS_KEY = 'todos';
const METADATA_FOCUS_KEY = 'focusAlarms';
const METADATA_SETTINGS_KEY = 'settings';

const MAX_DAYS = 10000;
const MAX_ITEMS = 2000;
const MAX_SUBJECTS = 1000;
const MAX_NESTED_ITEMS = 1000;
const MAX_STRING_LENGTH = 10000;
const MAX_DEPTH = 32;
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_MINUTES = 1440;
const MAX_NATIVE_ID = 2147483647;
/**
 * Reserved (non day) keys a legacy native map may carry: recurring, todos, focus (2 spellings)
 * and settings (2 spellings). Used to reject pathologically large maps before any day is parsed.
 */
const MAX_LEGACY_MAP_KEYS = MAX_DAYS + 8;
/**
 * Upper bound for a restore payload, in bytes.
 *
 * This is an import-side memory guard, not a bound the store is kept under: the theoretical
 * maximum export (MAX_DAYS days each holding the maximum subjects, checklist, quality and
 * error records at the maximum string length) is orders of magnitude larger than any cap a
 * phone could read into memory, so no cap can be above it. It is sized instead to stay above
 * what a *realistically* full store serialises to - a day limit's worth of days with a normal
 * payload is a couple of dozen MiB - and the restore-size test pins that headroom, so lowering
 * it past a store the app can actually hold would fail the suite rather than silently make
 * the user's own backup unrestorable.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Timestamp assigned to records that predate `DayData.updatedAt`. It must be deterministic:
 * a fabricated "now" would be re-generated on every read, so an explicit restore could lose to
 * the read timestamp instead of to the data's real age.
 */
export const LEGACY_UPDATED_AT = '1970-01-01T00:00:00.000Z';

const THEMES = new Set(['light', 'dark', 'auto', 'material-light', 'material-dark', 'adaptive']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isNative = Capacitor.isNativePlatform();

let nativeOperationQueue: Promise<void> = Promise.resolve();
let webOperationQueue: Promise<void> = Promise.resolve();
let authoritativeImportPending = false;

export class PersistenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PersistenceError';
    }
}

/**
 * Raised for a payload this build cannot interpret (for example a newer schema version).
 * It is deliberately distinct from corruption: the caller must not quarantine such a file.
 */
export class UnsupportedSchemaError extends PersistenceError {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedSchemaError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const hasOwn = (value: object, key: string): boolean => Object.hasOwn(value, key);

function fail(message: string): never {
    throw new PersistenceError(message);
}

const isDangerousKey = (key: string): boolean => DANGEROUS_KEYS.has(key) || DANGEROUS_KEYS.has(key.toLowerCase());

const ARRAY_INDEX_KEY = /^(?:0|[1-9]\d*)$/;

const assertNoDangerousKeys = (value: unknown, path = 'root', depth = 0, seen = new WeakSet<object>()): void => {
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

const assertAllowedKeys = (
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

function assertBoundedArray(value: unknown, path: string, max: number): asserts value is unknown[] {
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
const mapBoundedArray = <T>(
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

function assertTimestamp(value: unknown, path: string): string {
    if (!isValidTimestamp(value)) {
        fail(`Invalid timestamp at ${path}`);
    }
    return value;
}

function assertDateKey(value: unknown, path: string): string {
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

const cloneSubject = (subject: Subject): Subject => ({
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

const validateSettings = (value: unknown, path: string): BackupSettings => {
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

const validateDay = (value: unknown, path: string, legacy = false): DayData => {
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

const validateRecurringSubjects = (value: unknown, path: string): RecurringSubject[] => {
    return mapBoundedArray(value, path, MAX_ITEMS, validateRecurringSubject);
};

const validateTodos = (value: unknown, path: string): Todo[] => {
    return mapBoundedArray(value, path, MAX_ITEMS, validateTodo);
};

const validateFocusAlarms = (value: unknown, path: string): FocusAlarm[] => {
    // The shared native store holds `MAX_NATIVE_ALARM_DEFINITIONS` entries and
    // the countdown timer owns one of them, so a list longer than that cannot be
    // armed - and the native reader would refuse the whole payload on the next
    // load, quarantining good day data with it. Bounding it here means the limit
    // is enforced where the list is written, not where it is read.
    return mapBoundedArray(value, path, MAX_FOCUS_ALARMS, validateFocusAlarm);
};

const assertUniqueDays = (days: DayData[]): void => {
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
const parseLegacyDayArray = (value: unknown, path: string): DayData[] => {
    const days = mapBoundedArray(value, path, MAX_DAYS, (entry, entryPath) => validateDay(entry, entryPath, true));
    assertUniqueDays(days);
    return days.sort((first, second) => first.date.localeCompare(second.date));
};

/**
 * Every write path must keep the day count inside the bound the readers enforce. A file (or a
 * Dexie table) that exceeds it cannot be read back, and an unreadable canonical file is
 * quarantined - so the write has to be refused while the previous copy is still intact.
 */
const assertDayCountWithinLimit = (count: number, action: string): void => {
    if (count > MAX_DAYS) {
        fail(`Refusing to ${action} ${count} days; the limit is ${MAX_DAYS}`);
    }
};

const defaultSettings = (): BackupSettings => ({ theme: 'light', adaptiveColor: null });

const createEmptyEnvelope = (): BackupEnvelope => ({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    days: [],
    recurringSubjects: [],
    todos: [],
    focusAlarms: [],
    settings: defaultSettings(),
    globalStamps: {},
});

const GLOBAL_SECTION_KEYS = ['recurringSubjects', 'todos', 'focusAlarms', 'settings'] as const;

/**
 * The per-section recency stamps, normalised to a complete object with the
 * unrecorded sections absent.
 *
 * A file with no `globalStamps` at all is every backup taken before this field
 * existed, and stays readable: it normalises to `{}`, which reads as "this build
 * cannot know when any of these sections were written" rather than as a
 * rejection. A stamp that *is* present must be a real timestamp, though - a
 * malformed one is corruption, and treating it as "unknown" would quietly hand
 * the import decision to whichever side happened to omit it.
 */
const validateGlobalStamps = (value: unknown, path: string): GlobalSectionStamps => {
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        fail(`Invalid global stamps at ${path}`);
    }
    assertAllowedKeys(value, path, GLOBAL_SECTION_KEYS);
    const stamps: GlobalSectionStamps = {};
    for (const key of GLOBAL_SECTION_KEYS) {
        if (hasOwn(value, key) && value[key] !== undefined) {
            stamps[key] = assertTimestamp(value[key], `${path}.${key}`);
        }
    }
    return stamps;
};

export const validateBackupEnvelope = (value: unknown, path = 'backup'): BackupEnvelope => {
    assertNoDangerousKeys(value, path);
    if (!isRecord(value)) {
        fail(`Invalid backup root at ${path}`);
    }
    assertAllowedKeys(
        value,
        path,
        [
            'schemaVersion',
            'exportedAt',
            'days',
            'recurringSubjects',
            'todos',
            'focusAlarms',
            'settings',
            'globalStamps',
        ],
        ['schemaVersion', 'exportedAt', 'days', 'recurringSubjects', 'todos', 'focusAlarms', 'settings'],
    );
    if (value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
        throw new UnsupportedSchemaError(`Unsupported backup schema at ${path}`);
    }
    const exportedAt = assertTimestamp(value.exportedAt, `${path}.exportedAt`);
    const daysValue = value.days;
    const days = mapBoundedArray(daysValue, `${path}.days`, MAX_DAYS, validateDay);
    assertUniqueDays(days);
    return {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt,
        days,
        recurringSubjects: validateRecurringSubjects(value.recurringSubjects, `${path}.recurringSubjects`),
        todos: validateTodos(value.todos, `${path}.todos`),
        focusAlarms: validateFocusAlarms(value.focusAlarms, `${path}.focusAlarms`),
        settings: validateSettings(value.settings, `${path}.settings`),
        globalStamps: validateGlobalStamps(value.globalStamps, `${path}.globalStamps`),
    };
};

const envelopeFromLegacyDays = (days: DayData[]): BackupEnvelope => {
    return {
        ...createEmptyEnvelope(),
        days,
    };
};

const parseBackupInput = (value: unknown): { envelope: BackupEnvelope; legacy: boolean } => {
    assertNoDangerousKeys(value);
    if (Array.isArray(value)) {
        return { envelope: envelopeFromLegacyDays(parseLegacyDayArray(value, 'backup')), legacy: true };
    }

    if (!isRecord(value)) {
        fail('Invalid backup root');
    }

    if (hasOwn(value, 'schemaVersion')) {
        return { envelope: validateBackupEnvelope(value), legacy: false };
    }

    if (hasOwn(value, 'date')) {
        return { envelope: envelopeFromLegacyDays([validateDay(value, 'backup', true)]), legacy: true };
    }

    fail('Unrecognized backup format');
};

const convertLegacyMap = (value: Record<string, unknown>): BackupEnvelope => {
    const keys = Object.keys(value);
    if (keys.length > MAX_LEGACY_MAP_KEYS) {
        fail('Invalid native storage root');
    }

    const days: DayData[] = [];
    let recurringSubjects: RecurringSubject[] | undefined;
    let todos: Todo[] | undefined;
    let focusAlarms: FocusAlarm[] | undefined;
    let settings: BackupSettings | undefined;

    for (const [key, entry] of Object.entries(value)) {
        if (key === RECURRING_KEY) {
            recurringSubjects = validateRecurringSubjects(entry, RECURRING_KEY);
        } else if (key === TODOS_KEY) {
            todos = validateTodos(entry, TODOS_KEY);
        } else if (key === FOCUS_ALARMS_KEY || LEGACY_FOCUS_KEYS.includes(key)) {
            focusAlarms = validateFocusAlarms(entry, key);
        } else if (key === SETTINGS_KEY || LEGACY_SETTINGS_KEYS.includes(key)) {
            settings = validateSettings(entry, key);
        } else if (key.startsWith('__')) {
            fail(`Unexpected native storage key ${key}`);
        } else {
            if (!isValidDateKey(key)) {
                fail(`Unexpected native storage key ${key}`);
            }
            const day = validateDay(entry, key, true);
            if (day.date !== key) {
                fail(`Native day key mismatch for ${key}`);
            }
            days.push(day);
        }
    }

    assertBoundedArray(days, 'backup.days', MAX_DAYS);
    assertUniqueDays(days);
    return {
        ...createEmptyEnvelope(),
        days: days.sort((a, b) => a.date.localeCompare(b.date)),
        recurringSubjects: recurringSubjects ?? [],
        todos: todos ?? [],
        focusAlarms: focusAlarms ?? [],
        settings: settings ?? defaultSettings(),
    };
};

const convertNativeValue = (value: unknown): { envelope: BackupEnvelope; migrated: boolean } => {
    assertNoDangerousKeys(value, 'native');
    if (Array.isArray(value)) {
        // The store and the importer accept the same roots. A day array is readable data, so it
        // is migrated rather than quarantined.
        return { envelope: envelopeFromLegacyDays(parseLegacyDayArray(value, 'native')), migrated: true };
    }
    if (!isRecord(value)) {
        fail('Invalid native storage root');
    }

    if (hasOwn(value, 'schemaVersion')) {
        if (hasOwn(value, 'days') && isRecord(value.days)) {
            const map = value.days;
            const mapKeys = Object.keys(map);
            if (mapKeys.length > MAX_DAYS) {
                fail('Invalid array at native.days');
            }
            const days = mapKeys.map((date) => {
                if (!isValidDateKey(date)) {
                    fail(`Invalid native day key ${date}`);
                }
                const normalized = validateDay(map[date], date, true);
                if (normalized.date !== date) {
                    fail(`Native day key mismatch for ${date}`);
                }
                return normalized;
            });
            return {
                envelope: validateBackupEnvelope({
                    schemaVersion: value.schemaVersion,
                    exportedAt: value.exportedAt,
                    days,
                    recurringSubjects: value.recurringSubjects,
                    todos: value.todos,
                    focusAlarms: value.focusAlarms,
                    settings: value.settings,
                    // Carried through verbatim: the day-map shape is the native
                    // store's own, and the per-section stamps live beside it. Dropping
                    // them here would make the app forget when every global section
                    // was written, which is exactly what the next import compares.
                    globalStamps: value.globalStamps,
                }),
                migrated: true,
            };
        }
        return { envelope: validateBackupEnvelope(value), migrated: false };
    }

    if (hasOwn(value, 'days') || hasOwn(value, 'todos')) {
        fail('Invalid native backup envelope');
    }
    return { envelope: convertLegacyMap(value), migrated: true };
};

const cloneDay = (day: DayData): DayData => ({
    date: day.date,
    updatedAt: day.updatedAt,
    subjects: day.subjects.map(cloneSubject),
    checklistItems: day.checklistItems.map((item) => ({ ...item })),
    qualityChecks: day.qualityChecks.map((item) => ({ ...item })),
    dayRating: day.dayRating,
    errors: day.errors.map((item) => ({ ...item })),
});

const cloneGlobalSections = (
    envelope: BackupEnvelope,
): Omit<BackupEnvelope, 'days' | 'exportedAt' | 'schemaVersion'> => {
    return {
        recurringSubjects: envelope.recurringSubjects.map((subject) => ({
            ...cloneSubject(subject),
            recurring: true,
            recurringDays: [...subject.recurringDays],
        })),
        todos: envelope.todos.map((todo) => ({ ...todo })),
        focusAlarms: envelope.focusAlarms.map((alarm) => ({ ...alarm })),
        settings: { ...envelope.settings },
        globalStamps: { ...envelope.globalStamps },
    };
};

const cloneEnvelope = (envelope: BackupEnvelope): BackupEnvelope => ({
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    days: envelope.days.map(cloneDay),
    ...cloneGlobalSections(envelope),
});

const daysToMap = (days: DayData[]): Map<string, DayData> => {
    return new Map(days.map((day) => [day.date, cloneDay(day)]));
};

const mapToDays = (map: Map<string, DayData>): DayData[] => {
    return [...map.values()].map(cloneDay).sort((a, b) => a.date.localeCompare(b.date));
};

const isNewer = (incoming: DayData, current: DayData): boolean => {
    return Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt);
};

const getLocalStorage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

/**
 * localStorage is a best-effort mirror, never the canonical store. Private-mode, sandboxed and
 * quota-exhausted origins can throw from any access, so every single call is guarded: a storage
 * fault must not fail an already committed write nor quarantine good canonical data.
 */
const getLocalItem = (storage: Storage, key: string): string | null => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

const setLocalItem = (storage: Storage, key: string, value: string): void => {
    try {
        storage.setItem(key, value);
    } catch {
        // Mirror write dropped; the canonical store already holds the value.
    }
};

const deleteLocalItem = (storage: Storage, key: string): void => {
    try {
        storage.removeItem(key);
    } catch {
        // Mirror delete dropped; nothing downstream depends on it.
    }
};

const readLocalValue = (key: string): unknown => {
    const storage = getLocalStorage();
    if (!storage) {
        return undefined;
    }
    const raw = getLocalItem(storage, key);
    if (raw === null) {
        return undefined;
    }
    try {
        return JSON.parse(raw);
    } catch (_error) {
        throw new PersistenceError(`Invalid JSON in local storage key ${key}`);
    }
};

/**
 * Reads a localStorage value that is only a best-effort overlay on top of the canonical
 * store. A malformed or legacy-shaped overlay must never propagate, otherwise callers that
 * treat the read as authoritative (notably the native reader) would destroy good data.
 */
const readLocalOverlayValue = (key: string): unknown => {
    try {
        return readLocalValue(key);
    } catch {
        return undefined;
    }
};

/** Validates a component-owned overlay value, returning undefined when it is unusable. */
const readValidatedOverlay = <T>(key: string, validate: (value: unknown, path: string) => T): T | undefined => {
    const value = readLocalOverlayValue(key);
    if (value === undefined) {
        return undefined;
    }
    try {
        return validate(value, key);
    } catch {
        return undefined;
    }
};

const readLocalText = (key: string): string | undefined => {
    const storage = getLocalStorage();
    if (!storage) {
        return undefined;
    }
    const raw = getLocalItem(storage, key);
    if (raw === null) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : raw;
    } catch {
        return raw;
    }
};

const writeLocalValue = (key: string, value: unknown): void => {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    setLocalItem(storage, key, JSON.stringify(value));
};

const writeLocalText = (key: string, value: string): void => {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    setLocalItem(storage, key, value);
};

const removeLocalValue = (key: string): void => {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    deleteLocalItem(storage, key);
};

const hasLocalStorageKey = (key: string): boolean => {
    const storage = getLocalStorage();
    return storage !== null && getLocalItem(storage, key) !== null;
};

const getMetadataTable = (): Dexie.Table<MetadataTable, string> | null => {
    const tables = Array.isArray(db.tables) ? db.tables : [];
    const table = tables.find((candidate) => candidate.name === 'metadata');
    return (table as Dexie.Table<MetadataTable, string> | undefined) ?? null;
};

const getDaysTable = (): Dexie.Table<DaysTable, string> | null => {
    const tables = Array.isArray(db.tables) ? db.tables : [];
    const table = tables.find((candidate) => candidate.name === 'days');
    return (table as Dexie.Table<DaysTable, string> | undefined) ?? null;
};

interface WebGlobals {
    recurringSubjects: RecurringSubject[];
    todos: Todo[] | null;
    focusAlarms: FocusAlarm[];
    settings: BackupSettings;
    /**
     * When each section was last written, read straight off the metadata records'
     * own `updatedAt`.
     *
     * The web store has carried those timestamps since the metadata table was
     * introduced; what was missing was carrying them into the envelope an export
     * produces, so an import could not compare them. A section the table does not
     * hold - a mirror-only install, a section only a component has written - has
     * no record and therefore no stamp, which is the honest answer.
     */
    stamps: GlobalSectionStamps;
}

/**
 * Reads one component-owned overlay field, returning undefined when the key is absent or its
 * value is not one this build can interpret.
 *
 * Every overlay field is judged on its own. These keys belong to different components, and a
 * component writing something unrecognisable must not cost a *different* component's valid
 * value: a bad theme once cost the adaptive colour too, because both were validated together
 * behind the same guard as the focus-alarm list.
 */
const readOverlayTheme = (): ThemeValue | undefined => {
    const stored = readLocalText(THEME_STORAGE_KEY);
    if (stored === undefined) {
        return undefined;
    }
    try {
        return validateSettings({ theme: stored, adaptiveColor: null }, 'localStorage').theme;
    } catch {
        return undefined;
    }
};

const readOverlayAdaptiveColor = (): string | null | undefined => {
    const stored = readLocalText(ADAPTIVE_COLOR_STORAGE_KEY);
    if (stored === undefined) {
        return undefined;
    }
    try {
        return validateSettings({ theme: 'light', adaptiveColor: stored }, 'localStorage').adaptiveColor;
    } catch {
        return undefined;
    }
};

/**
 * Reads the app-owned localStorage keys a pre-metadata build wrote.
 *
 * `tolerateCorrupt` decides what a broken key means. Where the mirror is the only copy of that
 * section - the native store has no file at all - a corrupt key is reported, because dropping it
 * silently would throw away data the user has no other copy of. Where a canonical table already
 * holds the section, the mirror is only a migration source and a fallback, so a corrupt key
 * degrades to that section's default: it must not be able to fail reads the canonical store can
 * already satisfy, and a user who cannot open the app cannot re-import a good backup either.
 */
const readLegacyWebGlobals = (tolerateCorrupt = false): WebGlobals => {
    const readSection = <T>(read: () => T, fallback: T): T => {
        try {
            return read();
        } catch (error) {
            if (tolerateCorrupt) {
                return fallback;
            }
            throw error;
        }
    };

    const legacyRecurring = readSection(() => {
        const value = readLocalValue(RECURRING_KEY);
        return value === undefined ? [] : validateRecurringSubjects(value, RECURRING_KEY);
    }, []);
    const legacyTodos = readSection(() => {
        const value = readLocalValue(TODOS_KEY);
        return value === undefined ? null : validateTodos(value, TODOS_KEY);
    }, null);
    const legacySettings = readSection(() => {
        const value = readLocalValue(SETTINGS_KEY);
        return value === undefined ? defaultSettings() : validateSettings(value, SETTINGS_KEY);
    }, defaultSettings());

    let legacyFocus: FocusAlarm[] = [];
    // Copied, not aliased: the theme overlay below writes into it, and the tolerant path may
    // have handed back the shared default.
    const overlaySettings: BackupSettings = { ...legacySettings };
    try {
        const storedFocusValue = readLocalValue(FOCUS_STORAGE_KEY);
        const focusValue = storedFocusValue === undefined ? readLocalValue(FOCUS_ALARMS_KEY) : storedFocusValue;
        legacyFocus = focusValue === undefined ? [] : validateFocusAlarms(focusValue, FOCUS_ALARMS_KEY);
    } catch {
        // The focus-alarm key is owned by the focus component; an unreadable value there must
        // not reach the app-owned migration data, and must not affect the settings overlay.
    }

    const theme = readOverlayTheme();
    if (theme !== undefined) {
        overlaySettings.theme = theme;
    }
    const adaptiveColor = readOverlayAdaptiveColor();
    if (adaptiveColor !== undefined) {
        overlaySettings.adaptiveColor = adaptiveColor;
    }

    return {
        recurringSubjects: legacyRecurring.map((subject) => ({
            ...cloneSubject(subject),
            recurring: true,
            recurringDays: [...subject.recurringDays],
        })),
        todos: legacyTodos?.map((todo) => ({ ...todo })) ?? null,
        focusAlarms: legacyFocus.map((alarm) => ({ ...alarm })),
        settings: overlaySettings,
        // The mirror is a migration source and a fallback, not a canonical store:
        // nothing stamps it, so nothing claims to know when it was written.
        stamps: {},
    };
};

const mergeFocusAlarms = (canonical: FocusAlarm[], local: FocusAlarm[], hasLocal: boolean): FocusAlarm[] => {
    if (!hasLocal) {
        return canonical;
    }
    if (canonical.length > 0 && local.length === 0) {
        return canonical;
    }
    return local;
};

const readNativeOverlay = (
    canonicalSettings: BackupSettings,
): { focusAlarms?: FocusAlarm[]; settings?: BackupSettings } => {
    if (authoritativeImportPending) {
        authoritativeImportPending = false;
        return {};
    }
    const currentFocus = readLocalOverlayValue(FOCUS_STORAGE_KEY);
    const focusAlarms = readValidatedOverlay(
        currentFocus === undefined ? FOCUS_ALARMS_KEY : FOCUS_STORAGE_KEY,
        validateFocusAlarms,
    );
    const storedSettings = readValidatedOverlay(SETTINGS_KEY, validateSettings);

    const theme = readOverlayTheme();
    const adaptiveColor = readOverlayAdaptiveColor();
    if (theme === undefined && adaptiveColor === undefined) {
        return { focusAlarms, settings: storedSettings };
    }

    // A partial overlay must not reset the field it does not carry, so the canonical value
    // (not the default) is the base for whichever key the component did not write - and a key
    // this build cannot interpret is treated as one the component did not write.
    const base = canonicalSettings;
    try {
        return {
            focusAlarms,
            settings: validateSettings(
                {
                    theme: theme ?? base.theme,
                    adaptiveColor: adaptiveColor === undefined ? base.adaptiveColor : adaptiveColor,
                },
                'localStorage',
            ),
        };
    } catch {
        return { focusAlarms, settings: storedSettings };
    }
};

const METADATA_KEY_BY_SECTION: Record<GlobalSectionKey, string> = {
    recurringSubjects: METADATA_RECURRING_KEY,
    todos: METADATA_TODOS_KEY,
    focusAlarms: METADATA_FOCUS_KEY,
    settings: METADATA_SETTINGS_KEY,
};

const metadataRecordsToGlobals = (records: MetadataTable[], legacy: WebGlobals): WebGlobals => {
    const allowedKeys = new Set([
        METADATA_RECURRING_KEY,
        METADATA_TODOS_KEY,
        METADATA_FOCUS_KEY,
        METADATA_SETTINGS_KEY,
    ]);
    for (const record of records) {
        assertNoDangerousKeys(record, 'metadata');
        if (!isRecord(record) || typeof record.key !== 'string' || !allowedKeys.has(record.key)) {
            fail('Invalid metadata record');
        }
        assertTimestamp(record.updatedAt, `metadata.${record.key}.updatedAt`);
    }
    const byKey = new Map(records.map((record) => [record.key, record.value]));
    const stampsByMetadataKey = new Map(records.map((record) => [record.key, record.updatedAt]));
    const stampFor = (section: GlobalSectionKey): string | undefined =>
        stampsByMetadataKey.get(METADATA_KEY_BY_SECTION[section]);
    const recurringValue = byKey.get(METADATA_RECURRING_KEY);
    const todosValue = byKey.get(METADATA_TODOS_KEY);
    const focusValue = byKey.get(METADATA_FOCUS_KEY);
    const settingsValue = byKey.get(METADATA_SETTINGS_KEY);

    return {
        recurringSubjects:
            recurringValue === undefined
                ? legacy.recurringSubjects
                : validateRecurringSubjects(recurringValue, `metadata.${METADATA_RECURRING_KEY}`),
        todos: todosValue === undefined ? legacy.todos : validateTodos(todosValue, `metadata.${METADATA_TODOS_KEY}`),
        focusAlarms:
            focusValue === undefined
                ? legacy.focusAlarms
                : validateFocusAlarms(focusValue, `metadata.${METADATA_FOCUS_KEY}`),
        settings:
            settingsValue === undefined
                ? legacy.settings
                : validateSettings(settingsValue, `metadata.${METADATA_SETTINGS_KEY}`),
        stamps: {
            // Only a section the table actually holds a record for has a stamp. A
            // section that fell back to the localStorage mirror inherits the
            // mirror's "unknown" rather than borrowing another section's time.
            ...(recurringValue === undefined ? {} : { recurringSubjects: stampFor('recurringSubjects') }),
            ...(todosValue === undefined ? {} : { todos: stampFor('todos') }),
            ...(focusValue === undefined ? {} : { focusAlarms: stampFor('focusAlarms') }),
            ...(settingsValue === undefined ? {} : { settings: stampFor('settings') }),
        },
    };
};

const globalsToRecords = (globals: WebGlobals): MetadataTable[] => {
    const now = new Date().toISOString();
    // A section the globals carry no stamp for is being written *now*, so it is
    // stamped now. A section that carries a stamp keeps it: this write may be an
    // import of an older file, and stamping it fresh would claim a recency the
    // imported value does not have - which is how the next import would compare
    // against a lie.
    const stampFor = (section: GlobalSectionKey): string => globals.stamps[section] ?? now;
    const records: MetadataTable[] = [
        { key: METADATA_RECURRING_KEY, value: globals.recurringSubjects, updatedAt: stampFor('recurringSubjects') },
        { key: METADATA_FOCUS_KEY, value: globals.focusAlarms, updatedAt: stampFor('focusAlarms') },
        { key: METADATA_SETTINGS_KEY, value: globals.settings, updatedAt: stampFor('settings') },
    ];
    if (globals.todos !== null) {
        records.push({ key: METADATA_TODOS_KEY, value: globals.todos, updatedAt: stampFor('todos') });
    }
    return records;
};

const syncWebGlobalsToLocalStorage = (globals: WebGlobals): void => {
    writeLocalValue(RECURRING_KEY, globals.recurringSubjects);
    if (globals.todos !== null) {
        writeLocalValue(TODOS_KEY, globals.todos);
    }
    writeLocalValue(FOCUS_ALARMS_KEY, globals.focusAlarms);
    writeLocalValue(FOCUS_STORAGE_KEY, globals.focusAlarms);
    writeLocalValue(SETTINGS_KEY, globals.settings);
    writeLocalText(THEME_STORAGE_KEY, globals.settings.theme);
    if (globals.settings.adaptiveColor === null) {
        removeLocalValue(ADAPTIVE_COLOR_STORAGE_KEY);
    } else {
        writeLocalText(ADAPTIVE_COLOR_STORAGE_KEY, globals.settings.adaptiveColor);
    }
};

const readWebGlobals = async (): Promise<WebGlobals> => {
    const table = getMetadataTable();
    // Claimed on every path, table or not: the flag means "the next read must not prefer the
    // component overlay", and a read that skips it would leave the flag to suppress an overlay
    // the *following* read legitimately needs.
    const authoritative = authoritativeImportPending;
    if (authoritative) {
        authoritativeImportPending = false;
    }
    if (!table) {
        // No canonical table to fall back on, so the mirror is the whole store and a broken
        // app-owned key in it is still worth reporting.
        return readLegacyWebGlobals();
    }
    // The mirror is only a migration source and a per-section fallback here, so it is read
    // leniently: a corrupt key degrades to that section's default instead of failing every read.
    const legacy = readLegacyWebGlobals(true);
    const records = await table.toArray();
    const globals = metadataRecordsToGlobals(records, legacy);
    const hasLocalFocus = hasLocalStorageKey(FOCUS_ALARMS_KEY) || hasLocalStorageKey(FOCUS_STORAGE_KEY);
    // Whether an overlay *value* is usable, not whether the key exists: a theme this build
    // cannot interpret must leave the stored theme alone rather than reset it to a default.
    const overlayTheme = readOverlayTheme();
    const overlayAdaptiveColor = readOverlayAdaptiveColor();
    const resolvedGlobals: WebGlobals = authoritative
        ? globals
        : {
              ...globals,
              focusAlarms: mergeFocusAlarms(globals.focusAlarms, legacy.focusAlarms, hasLocalFocus),
              settings: {
                  ...globals.settings,
                  ...(overlayTheme === undefined ? {} : { theme: overlayTheme }),
                  ...(overlayAdaptiveColor === undefined ? {} : { adaptiveColor: overlayAdaptiveColor }),
              },
              // A section the overlay just supplied a value for was written by a
              // component, not by this store, and this build has no timestamp for
              // that write. Stamping it with the canonical section's time would
              // claim a recency for a value that may be newer *or* older, and the
              // next import decides on exactly that number.
              stamps: {
                  ...globals.stamps,
                  ...(hasLocalFocus && legacy.focusAlarms.length > 0 ? { focusAlarms: undefined } : {}),
                  ...(overlayTheme !== undefined || overlayAdaptiveColor !== undefined ? { settings: undefined } : {}),
              },
          };
    const legacyKeysPresent = [
        RECURRING_KEY,
        TODOS_KEY,
        FOCUS_ALARMS_KEY,
        FOCUS_STORAGE_KEY,
        SETTINGS_KEY,
        THEME_STORAGE_KEY,
        ADAPTIVE_COLOR_STORAGE_KEY,
    ].some((key) => hasLocalStorageKey(key));
    if (legacyKeysPresent && records.length === 0) {
        await writeWebMetadata(resolvedGlobals);
    }
    return resolvedGlobals;
};

const writeWebMetadata = async (globals: WebGlobals): Promise<void> => {
    const table = getMetadataTable();
    const records = globalsToRecords(globals);
    if (table) {
        if (typeof db.transaction === 'function') {
            await db.transaction('rw', table, async () => {
                for (const record of records) {
                    await table.put(record);
                }
            });
        } else {
            for (const record of records) {
                await table.put(record);
            }
        }
    }
    syncWebGlobalsToLocalStorage(globals);
};

const readWebDays = async (): Promise<DayData[]> => {
    const rows = await db.days.toArray();
    const days = mapBoundedArray(rows, 'db.days', MAX_DAYS, (row, rowPath) => validateDay(row, rowPath, true));
    assertUniqueDays(days);
    return days.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * A bounded read of the days in `[from, to]`, inclusive.
 *
 * Same validation as the whole-store read - `validateDay` per row, the same
 * `MAX_DAYS` bound, the same duplicate rejection, the same date ordering - and the
 * same queue, so it cannot interleave with a write. The only difference is that it
 * refuses to look at rows outside the window on the web path, where the day key is
 * the table's primary key and Dexie can serve a `between` range straight off it.
 *
 * On the native path the whole file is one JSON document, so the file is parsed in
 * full either way; the saving there is the deep clone, which is what scales with
 * the number of days outside the window.
 */
const readDaysInRangeUnqueued = async (from: string, to: string): Promise<DayData[]> => {
    assertDateKey(from, 'from');
    assertDateKey(to, 'to');
    if (from > to) {
        fail(`Invalid range ${from}..${to}`);
    }
    if (isNative) {
        const envelope = await ensureNativeEnvelope();
        return envelope.days
            .filter((day) => day.date >= from && day.date <= to)
            .map((day) => cloneDay(day))
            .sort((a, b) => a.date.localeCompare(b.date));
    }
    const days = getDaysTable();
    // `where('date')` is only usable when Dexie actually opened the table. A
    // storage-less runtime has no index to query, and the plain read is still
    // correct - just not cheaper.
    const rows =
        days && typeof days.where === 'function'
            ? await days.where('date').between(from, to, true, true).toArray()
            : (await db.days.toArray()).filter((row) => isRecord(row) && row.date >= from && row.date <= to);
    const selected = mapBoundedArray(rows, 'db.days', MAX_DAYS, (row, rowPath) => validateDay(row, rowPath, true));
    assertUniqueDays(selected);
    return selected.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * The days in `[from, to]`, inclusive, cloned.
 *
 * Use this instead of `exportAllData()` when only a window of the history is
 * wanted. `exportAllData` is a full backup read: it parses the whole store,
 * validates every day and deep-clones it, twice - once inside the envelope read and
 * once again on the way out - and it then carries `MAX_DAYS` (10 000) days' worth
 * of rows through all of that. At the day limit that is on the order of 20 000
 * full deep clones for a caller that wanted seven days.
 */
export const readDaysInRange = async (from: string, to: string): Promise<DayData[]> => {
    return isNative
        ? enqueueNative(() => readDaysInRangeUnqueued(from, to))
        : enqueueWeb(() => readDaysInRangeUnqueued(from, to));
};

const writeWebEnvelope = async (envelope: BackupEnvelope): Promise<void> => {
    const metadataTable = getMetadataTable();
    const globals: WebGlobals = {
        recurringSubjects: envelope.recurringSubjects.map((subject) => ({
            ...cloneSubject(subject),
            recurring: true,
            recurringDays: [...subject.recurringDays],
        })),
        todos: envelope.todos,
        focusAlarms: envelope.focusAlarms,
        settings: envelope.settings,
        // The envelope's own stamps, not "now": this write may be committing an
        // import of a file older than the store, and a fresh timestamp would make
        // the next import compare against a claim the value does not support.
        stamps: envelope.globalStamps,
    };
    const records = globalsToRecords(globals);
    if (metadataTable && typeof db.transaction === 'function') {
        await db.transaction('rw', db.days, metadataTable, async () => {
            for (const day of envelope.days) {
                await db.days.put(cloneDay(day));
            }
            for (const record of records) {
                await metadataTable.put(record);
            }
        });
    } else {
        for (const day of envelope.days) {
            await db.days.put(cloneDay(day));
        }
        for (const record of records) {
            if (metadataTable) {
                await metadataTable.put(record);
            }
        }
    }
    syncWebGlobalsToLocalStorage(globals);
};

const enqueueNative = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = nativeOperationQueue.then(operation, operation);
    nativeOperationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
};

const enqueueWeb = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = webOperationQueue.then(operation, operation);
    webOperationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
};

const getErrorCode = (error: unknown): string => {
    return isRecord(error) && typeof error.code === 'string' ? error.code : '';
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return isRecord(error) && typeof error.message === 'string' ? error.message : '';
};

const UNSUPPORTED_CODE = /^(?:UNIMPLEMENTED|NOT_IMPLEMENTED|UNAVAILABLE|MISSING_METHOD|METHOD_NOT_FOUND)$/i;
/**
 * Phrases that mean "this API does not exist on this runtime". A bare "unavailable" is
 * deliberately absent: a storage fault that reports itself that way ("device unavailable")
 * is a real failure, and treating it as an unimplemented method would silently downgrade an
 * atomic commit to an in-place overwrite of the only good copy.
 */
const UNSUPPORTED_MESSAGE =
    /\b(?:not implemented|unimplemented|is not available|not available on|unrecognized (?:function|method)|missing method|method not found|is not registered|no implementation)\b/i;

const MISSING_FILE_CODE = /^(?:ENOENT|FILE_NOT_FOUND|FILE_NOT_EXIST|ERR_FILE_NOT_FOUND)$/i;
/**
 * Phrases a rejection uses to report that something is absent. On their own they are far too
 * permissive: Capacitor's own plugin-availability text ("Method readFile is missing or
 * unavailable") matches `missing`, and a read misreported that way is treated as an empty
 * store - after which the next save overwrites the real file. So the phrase is only trusted
 * together with a reference to the file, and never for an unsupported-plugin rejection.
 */
const ABSENCE_MESSAGE =
    /\b(?:no such file|not found|does not exist|doesn't exist|doesn\u2019t exist|missing|cannot find|can't find|can\u2019t find|unable to find|could not find)\b/i;
/** Standalone words only: `readFile` and `filesystem` must not count as a mention of a file. */
const FILE_REFERENCE = /\b(?:file|files|path|paths|directory|folder|entry|entries)\b/i;

/**
 * Detects plugin calls that exist on the JS proxy but have no native implementation. Capacitor
 * exposes every plugin method lazily, so a missing `rename` must be discovered from the rejection,
 * not from the property lookup.
 */
const isUnsupportedFilesystemError = (error: unknown): boolean => {
    return UNSUPPORTED_CODE.test(getErrorCode(error)) || UNSUPPORTED_MESSAGE.test(getErrorMessage(error));
};

const isMissingFileError = (error: unknown): boolean => {
    if (MISSING_FILE_CODE.test(getErrorCode(error))) {
        return true;
    }
    if (isUnsupportedFilesystemError(error)) {
        return false;
    }
    // The messages a device actually produces carry a curly apostrophe, so the quote is
    // normalised before the phrase is matched.
    const message = getErrorMessage(error).replace(/[\u2018\u2019]/g, "'");
    return ABSENCE_MESSAGE.test(message) && FILE_REFERENCE.test(message);
};

const readNativeFile = async (): Promise<string | null> => {
    let data: unknown;
    try {
        const result = await Filesystem.readFile({
            path: STORAGE_FILE,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        data = result.data;
    } catch (error) {
        if (isMissingFileError(error)) {
            return null;
        }
        throw new PersistenceError('Unable to read native storage');
    }
    // Deliberately outside the guarded block: a plugin answering with something other than text
    // is a readable-but-wrong payload, and the generic read failure would hide which one it was.
    if (typeof data !== 'string') {
        fail('Native storage returned non-text data');
    }
    return data;
};

let quarantineSequence = 0;

const quarantineNativeFile = async (reason: string): Promise<never> => {
    quarantineSequence += 1;
    const quarantinePath = `${STORAGE_FILE}.corrupt-${Date.now()}-${quarantineSequence}`;
    try {
        const rename = (Filesystem as unknown as Record<string, unknown>).rename;
        if (typeof rename !== 'function') {
            throw new Error('Atomic rename is unavailable');
        }
        await (rename as (options: { from: string; to: string; directory: Directory }) => Promise<void>).call(
            Filesystem,
            { from: STORAGE_FILE, to: quarantinePath, directory: Directory.Data },
        );
        throw new PersistenceError(`${reason}; native data preserved at ${quarantinePath}`);
    } catch (error) {
        if (error instanceof PersistenceError) {
            throw error;
        }
        throw new PersistenceError(`${reason}; native data was preserved but could not be quarantined`);
    }
};

/** Reads the localStorage overlay so a storage fault can never be mistaken for corrupt data. */
const readNativeOverlaySafely = (
    canonicalSettings: BackupSettings,
): {
    focusAlarms?: FocusAlarm[];
    settings?: BackupSettings;
} => {
    try {
        return readNativeOverlay(canonicalSettings);
    } catch {
        return {};
    }
};

const readNativeEnvelopeUnqueued = async (): Promise<{
    envelope: BackupEnvelope;
    migrated: boolean;
    exists: boolean;
}> => {
    const text = await readNativeFile();
    if (text === null) {
        // No file at all, so the app-owned mirror keys hold the only copy of these sections and
        // a broken one is reported rather than dropped.
        const legacy = readLegacyWebGlobals();
        const hasLegacyData =
            legacy.recurringSubjects.length > 0 ||
            legacy.todos !== null ||
            legacy.focusAlarms.length > 0 ||
            legacy.settings.theme !== 'light' ||
            legacy.settings.adaptiveColor !== null;
        return {
            envelope: {
                ...createEmptyEnvelope(),
                recurringSubjects: legacy.recurringSubjects,
                todos: legacy.todos ?? [],
                focusAlarms: legacy.focusAlarms,
                settings: legacy.settings,
            },
            migrated: hasLegacyData,
            exists: false,
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (_error) {
        return quarantineNativeFile('Corrupt native JSON');
    }

    let converted: { envelope: BackupEnvelope; migrated: boolean };
    try {
        converted = convertNativeValue(parsed);
    } catch (error) {
        if (error instanceof UnsupportedSchemaError) {
            // Not corruption: leave the file untouched so a newer build can still read it.
            throw error;
        }
        return quarantineNativeFile(error instanceof Error ? error.message : 'Invalid native storage data');
    }

    const result = converted;
    const overlay = readNativeOverlaySafely(result.envelope.settings);
    const focusAlarms =
        overlay.focusAlarms === undefined
            ? result.envelope.focusAlarms
            : mergeFocusAlarms(result.envelope.focusAlarms, overlay.focusAlarms, true);
    const settings = overlay.settings ?? result.envelope.settings;
    const overlayChanged =
        JSON.stringify(focusAlarms) !== JSON.stringify(result.envelope.focusAlarms) ||
        JSON.stringify(settings) !== JSON.stringify(result.envelope.settings);
    return {
        envelope: { ...result.envelope, focusAlarms, settings },
        migrated: result.migrated || overlayChanged,
        exists: true,
    };
};

const deleteNativeFileQuietly = async (path: string): Promise<void> => {
    const deleteFile = (Filesystem as unknown as Record<string, unknown>).deleteFile;
    if (typeof deleteFile !== 'function') {
        return;
    }
    try {
        // A proxy that throws instead of rejecting must not turn a cleanup best-effort into the
        // failure the caller is already reporting: this is only ever called on a path whose
        // contents are disposable.
        await (deleteFile as (options: { path: string; directory: Directory }) => Promise<void>).call(Filesystem, {
            path,
            directory: Directory.Data,
        });
    } catch {
        // The file may already be gone, or the device may refuse the delete; neither matters.
    }
};

const writeNativeData = async (path: string, data: string): Promise<void> => {
    await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
    });
};

const writeNativeEnvelopeUnqueued = async (envelope: BackupEnvelope): Promise<void> => {
    const data = JSON.stringify(cloneEnvelope(envelope), null, 2);
    const temporaryPath = `${STORAGE_FILE}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rename = (Filesystem as unknown as Record<string, unknown>).rename;
    if (typeof rename !== 'function') {
        try {
            await writeNativeData(STORAGE_FILE, data);
        } catch (_error) {
            throw new PersistenceError('Unable to write native storage');
        }
        return;
    }

    try {
        await writeNativeData(temporaryPath, data);
    } catch (_error) {
        // A rejected write can still leave a partial file behind. Every write uses a unique temp
        // name, so on a full device those orphans accumulate until no save can succeed at all.
        await deleteNativeFileQuietly(temporaryPath);
        throw new PersistenceError('Unable to write native storage');
    }

    try {
        await (rename as (options: { from: string; to: string; directory: Directory }) => Promise<void>).call(
            Filesystem,
            { from: temporaryPath, to: STORAGE_FILE, directory: Directory.Data },
        );
        return;
    } catch (error) {
        if (!isUnsupportedFilesystemError(error)) {
            await deleteNativeFileQuietly(temporaryPath);
            throw new PersistenceError('Unable to commit native storage atomically');
        }
    }

    // `rename` is present on the proxy but unimplemented natively: keep saving instead of
    // discarding the only good copy. Atomicity is lost for this runtime, not correctness.
    try {
        await writeNativeData(STORAGE_FILE, data);
    } catch (_error) {
        // The in-place write may have truncated the canonical file, and the temp file holds the
        // complete new payload, so it is now the only recoverable copy of either. It is left on
        // disk and named in the failure instead of being deleted with the last good data.
        throw new PersistenceError(
            `Unable to write native storage; the stored data may be incomplete and the last complete copy is at ${temporaryPath}`,
        );
    }
    await deleteNativeFileQuietly(temporaryPath);
};

const ensureNativeEnvelope = async (): Promise<BackupEnvelope> => {
    const result = await readNativeEnvelopeUnqueued();
    if (result.migrated) {
        await writeNativeEnvelopeUnqueued(result.envelope);
    }
    return result.envelope;
};

const readWebEnvelope = async (): Promise<BackupEnvelope> => {
    const [days, globals] = await Promise.all([readWebDays(), readWebGlobals()]);
    return {
        ...createEmptyEnvelope(),
        days,
        recurringSubjects: globals.recurringSubjects,
        todos: globals.todos ?? [],
        focusAlarms: globals.focusAlarms,
        settings: globals.settings,
        globalStamps: globals.stamps,
    };
};

const readCurrentEnvelope = async (): Promise<BackupEnvelope> => {
    if (isNative) {
        return ensureNativeEnvelope();
    }
    return readWebEnvelope();
};

const getTodayUpdatedAt = (): string => new Date().toISOString();

/**
 * Stamps the one global section a write is about to change.
 *
 * Per section, not per store: a user who edits the theme and the todo list seconds
 * apart must not have one of the two decided by which section happened to be
 * written last. Every global `save*` path goes through this, so the stamp the next
 * import compares is always the moment that section's value last changed.
 */
const withStampedSection = <T extends WebGlobals>(globals: T, section: GlobalSectionKey): T => ({
    ...globals,
    stamps: { ...globals.stamps, [section]: getTodayUpdatedAt() },
});

const normalizeDayForSave = (date: string, data: Omit<DayData, 'date' | 'updatedAt'>): DayData => {
    const normalized = validateDay(
        {
            date,
            updatedAt: getTodayUpdatedAt(),
            subjects: data.subjects,
            checklistItems: data.checklistItems,
            qualityChecks: data.qualityChecks,
            dayRating: data.dayRating,
            errors: data.errors,
        },
        `save.${date}`,
        false,
    );
    return normalized;
};

export const validateBackup = (value: unknown): BackupEnvelope => {
    return parseBackupInput(value).envelope;
};

export const saveToNativeStorage = async (date: string, data: Omit<DayData, 'date' | 'updatedAt'>): Promise<void> => {
    assertDateKey(date, 'date');
    const day = normalizeDayForSave(date, data);
    if (isNative) {
        await enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            const days = daysToMap(envelope.days);
            days.set(day.date, day);
            // The whole file is re-read on the next load and any file this build cannot parse is
            // quarantined, so a store that is already at the day limit must fail the save instead
            // of committing a file the app would then reject as its own.
            const merged = mapToDays(days);
            assertDayCountWithinLimit(merged.length, 'save');
            await writeNativeEnvelopeUnqueued({ ...envelope, days: merged, exportedAt: getTodayUpdatedAt() });
        });
        return;
    }

    await enqueueWeb(async () => {
        // The same guard the native path applies, for the same reason: a
        // `db.days` table past the limit cannot be read back (`readWebDays`
        // bounds the array), so the write has to be refused while the previous
        // copy is still intact. `put` is a single upsert, so the count only grows
        // when the day being saved is not already stored - which is exactly the
        // case that can cross the limit.
        //
        // Looked up the same defensive way as the metadata table: a runtime where
        // Dexie never opened (private mode, a quota fault, a storage-less test
        // harness) must fall through to the plain write rather than fail a save
        // the previous code performed.
        const days = getDaysTable();
        if (days) {
            const existing = await days.get(day.date);
            if (existing === undefined) {
                assertDayCountWithinLimit((await days.count()) + 1, 'save');
            }
        }
        await db.days.put(cloneDay(day));
    });
};

export const loadFromNativeStorage = async (date: string): Promise<DayData | null> => {
    assertDateKey(date, 'date');
    if (isNative) {
        return enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            const day = envelope.days.find((entry) => entry.date === date);
            return day ? cloneDay(day) : null;
        });
    }

    return enqueueWeb(async () => {
        const day = await db.days.get(date);
        return day ? cloneDay(validateDay(day, `db.days.${date}`, true)) : null;
    });
};

export const saveRecurringSubjects = async (recurringSubjects: RecurringSubject[]): Promise<boolean> => {
    const templates = validateRecurringSubjects(recurringSubjects, 'recurringSubjects');
    if (isNative) {
        await enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            await writeNativeEnvelopeUnqueued({
                ...envelope,
                recurringSubjects: templates,
                globalStamps: { ...envelope.globalStamps, recurringSubjects: getTodayUpdatedAt() },
                exportedAt: getTodayUpdatedAt(),
            });
            writeLocalValue(RECURRING_KEY, templates);
        });
        return true;
    }
    await enqueueWeb(async () => {
        const globals = await readWebGlobals();
        await writeWebMetadata(withStampedSection({ ...globals, recurringSubjects: templates }, 'recurringSubjects'));
    });
    return true;
};

export const loadRecurringSubjects = async (): Promise<RecurringSubject[]> => {
    if (isNative) {
        return enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            return envelope.recurringSubjects.map((subject) => ({
                ...cloneSubject(subject),
                recurring: true,
                recurringDays: [...subject.recurringDays],
            }));
        });
    }
    return enqueueWeb(async () => {
        const globals = await readWebGlobals();
        return globals.recurringSubjects.map((subject) => ({
            ...cloneSubject(subject),
            recurring: true,
            recurringDays: [...subject.recurringDays],
        }));
    });
};

export const saveGlobalTodos = async (todos: Todo[]): Promise<boolean> => {
    const validated = validateTodos(todos, 'todos');
    if (isNative) {
        await enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            await writeNativeEnvelopeUnqueued({
                ...envelope,
                todos: validated,
                globalStamps: { ...envelope.globalStamps, todos: getTodayUpdatedAt() },
                exportedAt: getTodayUpdatedAt(),
            });
            writeLocalValue(TODOS_KEY, validated);
        });
        return true;
    }
    await enqueueWeb(async () => {
        const globals = await readWebGlobals();
        await writeWebMetadata(withStampedSection({ ...globals, todos: validated }, 'todos'));
    });
    return true;
};

export const loadGlobalTodos = async (): Promise<Todo[] | null> => {
    if (isNative) {
        return enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            return envelope.todos.map((todo) => ({ ...todo }));
        });
    }
    return enqueueWeb(async () => {
        const globals = await readWebGlobals();
        return globals.todos?.map((todo) => ({ ...todo })) ?? null;
    });
};

export const saveFocusAlarms = async (focusAlarms: FocusAlarm[]): Promise<boolean> => {
    const alarms = validateFocusAlarms(focusAlarms, 'focusAlarms');
    if (isNative) {
        await enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            await writeNativeEnvelopeUnqueued({
                ...envelope,
                focusAlarms: alarms,
                globalStamps: { ...envelope.globalStamps, focusAlarms: getTodayUpdatedAt() },
                exportedAt: getTodayUpdatedAt(),
            });
            writeLocalValue(FOCUS_ALARMS_KEY, alarms);
            writeLocalValue(FOCUS_STORAGE_KEY, alarms);
        });
        return true;
    }
    await enqueueWeb(async () => {
        const globals = await readWebGlobals();
        await writeWebMetadata(withStampedSection({ ...globals, focusAlarms: alarms }, 'focusAlarms'));
    });
    return true;
};

export const loadFocusAlarms = async (): Promise<FocusAlarm[]> => {
    if (isNative) {
        return enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            return envelope.focusAlarms.map((alarm) => ({ ...alarm }));
        });
    }
    return enqueueWeb(async () => {
        const globals = await readWebGlobals();
        return globals.focusAlarms.map((alarm) => ({ ...alarm }));
    });
};

export const saveSettings = async (settings: BackupSettings): Promise<boolean> => {
    const validated = validateSettings(settings, 'settings');
    if (isNative) {
        await enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            await writeNativeEnvelopeUnqueued({
                ...envelope,
                settings: validated,
                globalStamps: { ...envelope.globalStamps, settings: getTodayUpdatedAt() },
                exportedAt: getTodayUpdatedAt(),
            });
            // `__settings` is read back as an authoritative overlay, so it must never keep a
            // stale value after the canonical file has been updated.
            writeLocalValue(SETTINGS_KEY, validated);
            writeLocalText(THEME_STORAGE_KEY, validated.theme);
            if (validated.adaptiveColor === null) {
                removeLocalValue(ADAPTIVE_COLOR_STORAGE_KEY);
            } else {
                writeLocalText(ADAPTIVE_COLOR_STORAGE_KEY, validated.adaptiveColor);
            }
        });
        return true;
    }
    await enqueueWeb(async () => {
        const globals = await readWebGlobals();
        await writeWebMetadata(withStampedSection({ ...globals, settings: validated }, 'settings'));
    });
    return true;
};

export const loadSettings = async (): Promise<BackupSettings> => {
    if (isNative) {
        return enqueueNative(async () => {
            const envelope = await ensureNativeEnvelope();
            return { ...envelope.settings };
        });
    }
    return enqueueWeb(async () => {
        const globals = await readWebGlobals();
        return { ...globals.settings };
    });
};

export const saveGlobalSettings = saveSettings;
export const loadGlobalSettings = loadSettings;

const buildExportBackup = async (): Promise<BackupEnvelope> => {
    const envelope = await readCurrentEnvelope();
    const result = cloneEnvelope(envelope);
    result.exportedAt = getTodayUpdatedAt();
    result.days.sort((a, b) => a.date.localeCompare(b.date));
    return validateBackupEnvelope(result);
};

export const exportBackup = async (): Promise<BackupEnvelope> => {
    return isNative ? enqueueNative(buildExportBackup) : enqueueWeb(buildExportBackup);
};

export const exportAllData = async (): Promise<DayData[]> => {
    const days = (await exportBackup()).days;
    // `buildExportBackup` already cloned every day, so handing the caller that array
    // directly saves a second full deep clone of the whole store. The caller is
    // free to mutate it: nothing else holds a reference to it.
    return days;
};

export type ImportConflictPolicy = 'newest' | 'replace' | 'keep';

export interface ImportOptions {
    conflictPolicy?: ImportConflictPolicy;
}

interface MergeResult {
    envelope: BackupEnvelope;
    appliedDays: number;
    changed: boolean;
}

/**
 * Whether one global section of an incoming backup may replace the current one.
 *
 * The `newest` policy compares the two recency stamps, and the four cases are
 * each a decision rather than a default:
 *
 * - **both stamped** - the strictly newer one wins. A tie keeps the current copy,
 *   so re-importing the same file twice is a no-op the second time.
 * - **incoming stamped, current not** - the incoming one applies. A store that
 *   knows when it was written is never older than one that does not, and the
 *   alternative is refusing every first restore onto a pre-stamp store.
 * - **incoming not stamped, current stamped** - the incoming one is *rejected*.
 *   This is the case the stamps exist for: a backup written by a build that
 *   recorded no recency would otherwise overwrite a store that recorded its own,
 *   which is how an older file silently clobbered the current todo list.
 * - **neither stamped** - the incoming one applies, the pre-stamp behaviour. A
 *   first restore has no recency information to be conservative with, and the
 *   import is an explicit act by the user.
 */
const shouldApplyGlobalSection = (incoming: string | undefined, current: string | undefined): boolean => {
    if (incoming === undefined) {
        return current === undefined;
    }
    if (current === undefined) {
        return true;
    }
    return Date.parse(incoming) > Date.parse(current);
};

const sectionValuesEqual = (first: BackupEnvelope, second: BackupEnvelope, key: GlobalSectionKey): boolean =>
    JSON.stringify(first[key]) === JSON.stringify(second[key]);

const mergeEnvelopes = (
    current: BackupEnvelope,
    incoming: BackupEnvelope,
    legacy: boolean,
    conflictPolicy: ImportConflictPolicy,
): MergeResult => {
    const currentDays = daysToMap(current.days);
    let appliedDays = 0;
    let daysChanged = false;

    for (const incomingDay of incoming.days) {
        const currentDay = currentDays.get(incomingDay.date);
        const shouldApply =
            !currentDay ||
            conflictPolicy === 'replace' ||
            (conflictPolicy === 'newest' && isNewer(incomingDay, currentDay));
        if (shouldApply) {
            currentDays.set(incomingDay.date, cloneDay(incomingDay));
            appliedDays += 1;
            daysChanged = true;
        }
    }

    // A legacy payload is a bare day array (or a single day). It carries no global
    // sections at all, and `keep` says the user does not want them touched, so in
    // both cases every section stays exactly as the store has it.
    const globalsMayApply = !legacy && conflictPolicy !== 'keep';
    const applied: Partial<Record<GlobalSectionKey, true>> = {};
    const globalStamps: GlobalSectionStamps = { ...current.globalStamps };
    if (globalsMayApply) {
        for (const key of GLOBAL_SECTION_KEYS) {
            if (
                conflictPolicy === 'replace' ||
                shouldApplyGlobalSection(incoming.globalStamps[key], current.globalStamps[key])
            ) {
                applied[key] = true;
                const incomingStamp = incoming.globalStamps[key];
                if (incomingStamp === undefined) {
                    // Applied with nothing to record. Keeping the current stamp would
                    // claim a recency neither side has; dropping it says exactly what
                    // is true, and the section falls back to the "neither stamped"
                    // case on the next import.
                    delete globalStamps[key];
                } else {
                    globalStamps[key] = incomingStamp;
                }
            }
        }
    }
    const globalsChanged = GLOBAL_SECTION_KEYS.some(
        (key) => applied[key] === true && !sectionValuesEqual(current, incoming, key),
    );
    const changed = daysChanged || globalsChanged;
    // A merge can be larger than either side: two full-size backups of disjoint days would
    // otherwise be committed as a store the next read quarantines, losing both copies.
    if (changed) {
        assertDayCountWithinLimit(currentDays.size, 'import');
    }
    const days = mapToDays(currentDays);

    const mergedCurrent = cloneGlobalSections(current);
    const mergedIncoming = cloneGlobalSections(incoming);
    mergedCurrent.recurringSubjects = applied.recurringSubjects
        ? mergedIncoming.recurringSubjects
        : mergedCurrent.recurringSubjects;
    mergedCurrent.todos = applied.todos ? mergedIncoming.todos : mergedCurrent.todos;
    mergedCurrent.focusAlarms = applied.focusAlarms ? mergedIncoming.focusAlarms : mergedCurrent.focusAlarms;
    mergedCurrent.settings = applied.settings ? mergedIncoming.settings : mergedCurrent.settings;
    mergedCurrent.globalStamps = globalStamps;

    return {
        envelope: {
            // Only the global sections are cloned from `current`: its days are always replaced by
            // the merged list, and deep-cloning a store-sized day array to throw it away again is
            // the single most expensive thing this merge used to do.
            ...mergedCurrent,
            schemaVersion: current.schemaVersion,
            exportedAt: getTodayUpdatedAt(),
            days,
        },
        appliedDays,
        changed,
    };
};

const writeImportedEnvelope = async (envelope: BackupEnvelope): Promise<void> => {
    if (isNative) {
        await writeNativeEnvelopeUnqueued(envelope);
        syncWebGlobalsToLocalStorage({
            recurringSubjects: envelope.recurringSubjects,
            todos: envelope.todos,
            focusAlarms: envelope.focusAlarms,
            settings: envelope.settings,
            stamps: envelope.globalStamps,
        });
        authoritativeImportPending = true;
        return;
    }
    await writeWebEnvelope(envelope);
    authoritativeImportPending = true;
};

export const importAllData = async (
    importedData: unknown,
    options: ImportOptions | ImportConflictPolicy = {},
): Promise<number> => {
    const parsed = parseBackupInput(importedData);
    const conflictPolicy = typeof options === 'string' ? options : (options.conflictPolicy ?? 'newest');
    if (!['newest', 'replace', 'keep'].includes(conflictPolicy)) {
        fail('Invalid import conflict policy');
    }

    if (isNative) {
        return enqueueNative(async () => {
            const current = await ensureNativeEnvelope();
            const merged = mergeEnvelopes(current, parsed.envelope, parsed.legacy, conflictPolicy);
            if (merged.changed) {
                await writeImportedEnvelope(merged.envelope);
            }
            return merged.appliedDays;
        });
    }

    return enqueueWeb(async () => {
        const current = await readWebEnvelope();
        const merged = mergeEnvelopes(current, parsed.envelope, parsed.legacy, conflictPolicy);
        if (merged.changed) {
            await writeImportedEnvelope(merged.envelope);
        }
        return merged.appliedDays;
    });
};

const readFileText = async (file: File): Promise<string> => {
    if (file.size > MAX_FILE_BYTES) {
        fail('Backup file is too large');
    }
    if (typeof file.text === 'function') {
        const text = await file.text();
        if (text.length > MAX_FILE_BYTES) {
            fail('Backup file is too large');
        }
        return text;
    }

    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result ?? '');
            if (text.length > MAX_FILE_BYTES) {
                reject(new PersistenceError('Backup file is too large'));
                return;
            }
            resolve(text);
        };
        reader.onerror = () => reject(new PersistenceError('Failed to read file'));
        reader.onabort = () => reject(new PersistenceError('Failed to read file'));
        reader.readAsText(file);
    });
};

export const downloadBackup = async (): Promise<number> => {
    const data = await exportBackup();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `study-tracker-backup-${getTodayLocalDate()}.json`;
    document.body.appendChild(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        // Revoking in the same task cancels the download in Firefox and Safari: they resolve the
        // blob asynchronously, so the URL has to outlive the click handler.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return data.days.length;
};

export const handleFileImport = async (
    file: File,
    options: ImportOptions | ImportConflictPolicy = {},
): Promise<number> => {
    const text = await readFileText(file);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (_error) {
        throw new PersistenceError('Invalid JSON file');
    }
    return importAllData(parsed, options);
};

export const migrateLegacyWebStorage = async (): Promise<void> => {
    if (isNative) {
        return;
    }
    await enqueueWeb(async () => {
        const globals = await readWebGlobals();
        await writeWebMetadata(globals);
    });
};
