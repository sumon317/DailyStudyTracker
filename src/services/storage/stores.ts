import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import Dexie from 'dexie';
import type {
    BackupEnvelope,
    BackupSettings,
    DayData,
    FocusAlarm,
    GlobalSectionKey,
    GlobalSectionStamps,
    RecurringSubject,
    ThemeValue,
    Todo,
} from '../../types';
import {
    ADAPTIVE_COLOR_STORAGE_KEY,
    FOCUS_ALARMS_KEY,
    FOCUS_STORAGE_KEY,
    isNative,
    MAX_DAYS,
    METADATA_FOCUS_KEY,
    METADATA_RECURRING_KEY,
    METADATA_SETTINGS_KEY,
    METADATA_TODOS_KEY,
    RECURRING_KEY,
    SETTINGS_KEY,
    STORAGE_FILE,
    THEME_STORAGE_KEY,
    TODOS_KEY,
} from './constants';
import { fail, PersistenceError, UnsupportedSchemaError } from './errors';
import { importState } from './state';

/**
 * The queue every write on a platform goes through.
 *
 * Two writes that overlap - a save and an import, say - would otherwise interleave their reads
 * and writes and leave a record half old and half new. The queue runs them one after another,
 * and a failed operation does not block the ones behind it.
 */
let nativeOperationQueue: Promise<void> = Promise.resolve();
let webOperationQueue: Promise<void> = Promise.resolve();

import { cloneDay, cloneEnvelope, convertNativeValue, createEmptyEnvelope, defaultSettings } from './backup';
import {
    assertDateKey,
    assertNoDangerousKeys,
    assertTimestamp,
    assertUniqueDays,
    cloneSubject,
    isRecord,
    mapBoundedArray,
    validateDay,
    validateFocusAlarms,
    validateRecurringSubjects,
    validateSettings,
    validateTodos,
} from './validation';

/**
 * The storage backends: IndexedDB and localStorage in the browser, a JSON file through the
 * Capacitor Filesystem plugin on the device.
 *
 * The two platforms have to behave the same way, so the shape of a record, the order of the
 * writes and the handling of a failed one all live here rather than in the callers. What the
 * app asks for is a day or a global section; which backend answers is this module's problem.
 */

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

export const writeLocalValue = (key: string, value: unknown): void => {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    setLocalItem(storage, key, JSON.stringify(value));
};

export const writeLocalText = (key: string, value: string): void => {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    setLocalItem(storage, key, value);
};

export const removeLocalValue = (key: string): void => {
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

export const getDaysTable = (): Dexie.Table<DaysTable, string> | null => {
    const tables = Array.isArray(db.tables) ? db.tables : [];
    const table = tables.find((candidate) => candidate.name === 'days');
    return (table as Dexie.Table<DaysTable, string> | undefined) ?? null;
};

export interface WebGlobals {
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
    if (importState.authoritativeImportPending) {
        importState.authoritativeImportPending = false;
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

export const syncWebGlobalsToLocalStorage = (globals: WebGlobals): void => {
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

export const readWebGlobals = async (): Promise<WebGlobals> => {
    const table = getMetadataTable();
    // Claimed on every path, table or not: the flag means "the next read must not prefer the
    // component overlay", and a read that skips it would leave the flag to suppress an overlay
    // the *following* read legitimately needs.
    const authoritative = importState.authoritativeImportPending;
    if (authoritative) {
        importState.authoritativeImportPending = false;
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

export const writeWebMetadata = async (globals: WebGlobals): Promise<void> => {
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

export const readWebDays = async (): Promise<DayData[]> => {
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

export const writeWebEnvelope = async (envelope: BackupEnvelope): Promise<void> => {
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

export const enqueueNative = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = nativeOperationQueue.then(operation, operation);
    nativeOperationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
};

export const enqueueWeb = <T>(operation: () => Promise<T>): Promise<T> => {
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

export const readNativeEnvelopeUnqueued = async (): Promise<{
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

export const writeNativeEnvelopeUnqueued = async (envelope: BackupEnvelope): Promise<void> => {
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
export const ensureNativeEnvelope = async (): Promise<BackupEnvelope> => {
    const result = await readNativeEnvelopeUnqueued();
    if (result.migrated) {
        await writeNativeEnvelopeUnqueued(result.envelope);
    }
    return result.envelope;
};

export const readWebEnvelope = async (): Promise<BackupEnvelope> => {
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

export const readCurrentEnvelope = async (): Promise<BackupEnvelope> => {
    if (isNative) {
        return ensureNativeEnvelope();
    }
    return readWebEnvelope();
};
