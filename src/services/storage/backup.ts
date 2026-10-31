import type {
    BackupEnvelope,
    BackupSettings,
    DayData,
    FocusAlarm,
    GlobalSectionStamps,
    RecurringSubject,
    Todo,
} from '../../types';
import { isValidDateKey } from '../../utils/dateUtils';
import {
    BACKUP_SCHEMA_VERSION,
    FOCUS_ALARMS_KEY,
    LEGACY_FOCUS_KEYS,
    LEGACY_SETTINGS_KEYS,
    MAX_DAYS,
    MAX_LEGACY_MAP_KEYS,
    RECURRING_KEY,
    SETTINGS_KEY,
    TODOS_KEY,
} from './constants';
import { fail, UnsupportedSchemaError } from './errors';
import {
    assertAllowedKeys,
    assertBoundedArray,
    assertNoDangerousKeys,
    assertTimestamp,
    assertUniqueDays,
    cloneSubject,
    hasOwn,
    isRecord,
    mapBoundedArray,
    validateDay,
    validateFocusAlarms,
    validateRecurringSubjects,
    validateSettings,
    validateTodos,
} from './validation';

/**
 * The backup format: what an envelope is, how a file is turned into one, and how two of them
 * are merged.
 *
 * Like the validators, everything here is pure. The format is the part of the storage layer
 * that has to keep working for files written by older builds, so it is kept apart from the
 * code that touches the disk.
 */

/**
 * A legacy backup root: a bare array of days, rather than an envelope.
 *
 * Every backup taken before the envelope existed has this shape, so it is still read.
 */
const parseLegacyDayArray = (value: unknown, path: string): DayData[] => {
    const days = mapBoundedArray(value, path, MAX_DAYS, (entry, entryPath) => validateDay(entry, entryPath, true));
    assertUniqueDays(days);
    return days.sort((first, second) => first.date.localeCompare(second.date));
};

export const defaultSettings = (): BackupSettings => ({ theme: 'light', adaptiveColor: null });

export const createEmptyEnvelope = (): BackupEnvelope => ({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    days: [],
    recurringSubjects: [],
    todos: [],
    focusAlarms: [],
    settings: defaultSettings(),
    globalStamps: {},
});

export const GLOBAL_SECTION_KEYS = ['recurringSubjects', 'todos', 'focusAlarms', 'settings'] as const;

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

export const parseBackupInput = (value: unknown): { envelope: BackupEnvelope; legacy: boolean } => {
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

export const convertNativeValue = (value: unknown): { envelope: BackupEnvelope; migrated: boolean } => {
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

export const cloneDay = (day: DayData): DayData => ({
    date: day.date,
    updatedAt: day.updatedAt,
    subjects: day.subjects.map(cloneSubject),
    checklistItems: day.checklistItems.map((item) => ({ ...item })),
    qualityChecks: day.qualityChecks.map((item) => ({ ...item })),
    dayRating: day.dayRating,
    errors: day.errors.map((item) => ({ ...item })),
});

export const cloneGlobalSections = (
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

export const cloneEnvelope = (envelope: BackupEnvelope): BackupEnvelope => ({
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    days: envelope.days.map(cloneDay),
    ...cloneGlobalSections(envelope),
});

export const daysToMap = (days: DayData[]): Map<string, DayData> => {
    return new Map(days.map((day) => [day.date, cloneDay(day)]));
};

export const mapToDays = (map: Map<string, DayData>): DayData[] => {
    return [...map.values()].map(cloneDay).sort((a, b) => a.date.localeCompare(b.date));
};

export const isNewer = (incoming: DayData, current: DayData): boolean => {
    return Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt);
};
