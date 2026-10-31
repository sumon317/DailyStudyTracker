import type {
    BackupEnvelope,
    BackupSettings,
    DayData,
    FocusAlarm,
    GlobalSectionKey,
    GlobalSectionStamps,
    RecurringSubject,
    Todo,
} from '../../types';
import { getTodayLocalDate } from '../../utils/dateUtils';
import {
    cloneDay,
    cloneEnvelope,
    cloneGlobalSections,
    daysToMap,
    GLOBAL_SECTION_KEYS,
    isNewer,
    mapToDays,
    parseBackupInput,
    validateBackupEnvelope,
} from './backup';
import {
    ADAPTIVE_COLOR_STORAGE_KEY,
    FOCUS_ALARMS_KEY,
    FOCUS_STORAGE_KEY,
    isNative,
    MAX_FILE_BYTES,
    RECURRING_KEY,
    SETTINGS_KEY,
    THEME_STORAGE_KEY,
    TODOS_KEY,
} from './constants';
import { fail, PersistenceError } from './errors';
import { importState } from './state';
import type { WebGlobals } from './stores';
import {
    db,
    enqueueNative,
    enqueueWeb,
    ensureNativeEnvelope,
    getDaysTable,
    readCurrentEnvelope,
    readWebEnvelope,
    readWebGlobals,
    removeLocalValue,
    syncWebGlobalsToLocalStorage,
    writeLocalText,
    writeLocalValue,
    writeNativeEnvelopeUnqueued,
    writeWebEnvelope,
    writeWebMetadata,
} from './stores';
import {
    assertDateKey,
    assertDayCountWithinLimit,
    cloneSubject,
    validateDay,
    validateFocusAlarms,
    validateRecurringSubjects,
    validateSettings,
    validateTodos,
} from './validation';

/**
 * The public surface of the storage layer.
 *
 * The app asks this module for a day, a global section or a backup, and this module decides
 * what that means for the platform it is running on. Everything below is an implementation
 * detail of a backend or of the backup format, and is re-exported only where another part of
 * the app already depends on it.
 */

export { validateBackupEnvelope } from './backup';
export {
    BACKUP_SCHEMA_VERSION,
    FOCUS_ALARMS_KEY,
    LEGACY_UPDATED_AT,
    MAX_FILE_BYTES,
    RECURRING_KEY,
    SETTINGS_KEY,
    STORAGE_FILE,
    TODOS_KEY,
} from './constants';
export { PersistenceError, UnsupportedSchemaError } from './errors';
export { db, readDaysInRange } from './stores';

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
        importState.authoritativeImportPending = true;
        return;
    }
    await writeWebEnvelope(envelope);
    importState.authoritativeImportPending = true;
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
