import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FOCUS_ALARMS } from '../native/alarmLimits';
import type { BackupEnvelope, BackupSettings, DayData, RecurringSubject, Subject } from '../types';

const nativeState = vi.hoisted(() => ({
    fileData: null as string | null,
    temporaryData: null as string | null,
    preserved: new Map<string, string>(),
}));

const nativeFs = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    deleteFile: vi.fn(),
}));

/** Structural stand-in for a Dexie table, enough for the storage layer's own access patterns. */
const fakeDexie = vi.hoisted(() => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

    class FakeTable {
        rows = new Map<string, unknown>();

        constructor(
            readonly name: string,
            private readonly primaryKey: string,
        ) {}

        async put(row: Record<string, unknown>): Promise<string> {
            const key = String(row[this.primaryKey]);
            this.rows.set(key, clone(row));
            return key;
        }

        async get(key: string): Promise<unknown> {
            const row = this.rows.get(String(key));
            return row === undefined ? undefined : clone(row);
        }

        async toArray(): Promise<unknown[]> {
            return [...this.rows.values()].map((row) => clone(row));
        }

        async count(): Promise<number> {
            return this.rows.size;
        }

        async clear(): Promise<void> {
            this.rows.clear();
        }
    }

    return { FakeTable };
});

vi.mock('dexie', () => ({
    default: class FakeDexie {
        tables: Array<{ name: string }> = [];
        // Real Dexie publishes every table named by a version's `stores` spec as a property, and
        // `db.tables` lists the same objects. Without them the web platform silently runs a
        // degraded, table-less code path that asserts far less than it appears to.
        [name: string]: unknown;

        version() {
            return this;
        }

        stores(spec: Record<string, string>) {
            for (const name of Object.keys(spec)) {
                if (this[name] === undefined) {
                    const table = new fakeDexie.FakeTable(name, name === 'days' ? 'date' : 'key');
                    this[name] = table;
                    this.tables.push(table);
                }
            }
            return this;
        }

        async transaction(_mode: string, ...args: unknown[]) {
            const scope = args[args.length - 1];
            if (typeof scope === 'function') {
                await (scope as () => Promise<void> | void)();
            }
        }
    },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => true,
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: nativeFs,
}));

import type { ImportConflictPolicy } from './storage';
import {
    BACKUP_SCHEMA_VERSION,
    exportAllData,
    exportBackup,
    handleFileImport,
    importAllData,
    LEGACY_UPDATED_AT,
    loadFocusAlarms,
    loadFromNativeStorage,
    loadGlobalTodos,
    loadRecurringSubjects,
    loadSettings,
    MAX_FILE_BYTES,
    PersistenceError,
    readDaysInRange,
    STORAGE_FILE,
    saveFocusAlarms,
    saveGlobalTodos,
    saveRecurringSubjects,
    saveSettings,
    saveToNativeStorage,
    UnsupportedSchemaError,
    validateBackup,
} from './storage';

const makeSubject = (overrides: Partial<DayData['subjects'][number]> = {}): DayData['subjects'][number] => ({
    id: 1,
    name: 'Accounts',
    planned: '60',
    actual: '30',
    kpi: 'N',
    time: '',
    reminder: false,
    ...overrides,
});

const makeRecurringSubject = (overrides: Partial<Subject> = {}): RecurringSubject => ({
    ...makeSubject(overrides),
    recurring: true,
    recurringDays: overrides.recurringDays ?? [1],
});

const makeDay = (overrides: Partial<DayData> = {}): DayData => ({
    date: '2026-09-25',
    updatedAt: '2026-09-25T10:00:00.000Z',
    subjects: [makeSubject()],
    checklistItems: [{ id: 1, label: 'Read notes', checked: false }],
    qualityChecks: [{ id: 1, label: 'Understood', checked: true }],
    dayRating: 'Okayish',
    errors: [],
    ...overrides,
});

const makeEnvelope = (overrides: Partial<BackupEnvelope> = {}): BackupEnvelope => {
    const { globalStamps, ...rest } = overrides;
    return {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-09-25T10:00:00.000Z',
        days: [makeDay()],
        recurringSubjects: [],
        todos: [],
        focusAlarms: [],
        settings: { theme: 'light', adaptiveColor: null },
        ...rest,
        // An explicit `undefined` means "no stamps at all", which is what a backup
        // written before the field existed normalises to. It is spread last and
        // defaulted so a test that omits it is not accidentally claiming a recency.
        globalStamps: globalStamps ?? {},
    };
};

const emptyDayInput = (overrides: Partial<DayData> = {}): Omit<DayData, 'date' | 'updatedAt'> => ({
    subjects: [],
    checklistItems: [],
    qualityChecks: [],
    dayRating: '',
    errors: [],
    ...overrides,
});

const readStoredEnvelope = (): BackupEnvelope => JSON.parse(nativeState.fileData ?? '{}') as BackupEnvelope;

const quarantineTargets = (): string[] =>
    nativeFs.rename.mock.calls.map(([options]) => String(options.to)).filter((target) => target.includes('.corrupt-'));

/** Consecutive real days starting at 2000-01-01, each carrying the minimum a day record needs. */
const makeDayRange = (startIndex: number, count: number): DayData[] =>
    Array.from({ length: count }, (_value, offset) => {
        const date = new Date(Date.UTC(2000, 0, 1) + (startIndex + offset) * 86_400_000).toISOString().slice(0, 10);
        return makeDay({ date, subjects: [], checklistItems: [], qualityChecks: [], errors: [] });
    });

/** The same span of days, but carrying the payload an ordinary study day actually holds. */
const makeRealisticDayRange = (count: number): DayData[] =>
    makeDayRange(0, count).map((day) =>
        makeDay({
            date: day.date,
            updatedAt: `${day.date}T10:00:00.000Z`,
            subjects: Array.from({ length: 6 }, (_value, index) =>
                makeSubject({ id: index + 1, name: `Accounts and bookkeeping ${index + 1}` }),
            ),
            checklistItems: Array.from({ length: 3 }, (_value, index) => ({
                id: index + 1,
                label: 'Read the chapter notes',
                checked: false,
            })),
            qualityChecks: Array.from({ length: 3 }, (_value, index) => ({
                id: index + 1,
                label: 'Understood the topic',
                checked: true,
            })),
            errors: [
                {
                    id: 1,
                    question: 'Why does this balance not work',
                    mistake: 'Skipped the example',
                    correctLogic: 'Worked through it again',
                },
            ],
        }),
    );

const MAX_DAYS = 10_000;

beforeEach(() => {
    nativeState.fileData = null;
    nativeState.temporaryData = null;
    nativeState.preserved.clear();
    localStorage.clear();
    vi.clearAllMocks();

    nativeFs.readFile.mockImplementation(async () => {
        if (nativeState.fileData === null) {
            throw { code: 'ENOENT' };
        }
        return { data: nativeState.fileData };
    });
    nativeFs.writeFile.mockImplementation(async ({ path, data }: { path: string; data: string }) => {
        if (String(path).includes('.tmp-')) {
            nativeState.temporaryData = data;
            return;
        }
        nativeState.fileData = data;
    });
    nativeFs.rename.mockImplementation(async ({ from, to }: { from: string; to: string }) => {
        if (String(from).includes('.tmp-')) {
            if (nativeState.temporaryData === null) {
                throw { code: 'ENOENT', message: 'no temporary file to rename' };
            }
            nativeState.fileData = nativeState.temporaryData;
            nativeState.temporaryData = null;
            return;
        }
        const current = nativeState.fileData;
        if (current !== null) {
            nativeState.preserved.set(to, current);
        }
        nativeState.fileData = null;
    });
    // Mirrors the plugin: a delete really removes the file it names, so a test can tell an
    // implementation that cleans up a temp file from one that merely calls deleteFile.
    nativeFs.deleteFile.mockImplementation(async ({ path }: { path: string }) => {
        const target = String(path);
        if (target.includes('.tmp-')) {
            nativeState.temporaryData = null;
            return;
        }
        nativeState.preserved.delete(target);
        if (target === STORAGE_FILE) {
            nativeState.fileData = null;
        }
    });
});

describe('backup validation', () => {
    it('round-trips every canonical backup section', () => {
        const envelope = makeEnvelope({
            recurringSubjects: [makeRecurringSubject({ id: 2, name: 'Economics', recurringDays: [1, 3] })],
            todos: [{ id: 3, text: 'Solve questions', completed: false, time: '18:30', reminder: true }],
            focusAlarms: [{ id: 'alarm-1', time: '07:00', active: true, nativeId: 42 }],
            settings: { theme: 'dark', adaptiveColor: '#123456' },
        });

        expect(validateBackup(envelope)).toEqual(envelope);
    });

    it('accepts legacy day arrays and a single legacy day', () => {
        const day = makeDay();
        expect(validateBackup([day]).days).toEqual([day]);
        expect(validateBackup({ date: day.date }).days[0]?.date).toBe(day.date);
    });

    it('rejects invalid fields and prototype-pollution keys', () => {
        expect(() => validateBackup(makeEnvelope({ days: [makeDay({ date: '2026-02-30' })] }))).toThrow();
        expect(() =>
            validateBackup(makeEnvelope({ days: [makeDay({ subjects: [makeSubject({ planned: 'Infinity' })] })] })),
        ).toThrow();
        expect(() =>
            validateBackup(makeEnvelope({ days: [makeDay({ subjects: [makeSubject({ time: '25:00' })] })] })),
        ).toThrow();
        expect(() =>
            validateBackup(makeEnvelope({ days: [makeDay({ subjects: [makeSubject({ id: 1.5 })] })] })),
        ).toThrow();

        const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
        expect(() => validateBackup(polluted)).toThrow();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('rejects dangerous keys and hidden keys that enumeration would skip', () => {
        const constructorKey = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as unknown;
        expect(() => validateBackup(constructorKey)).toThrow(/dangerous/i);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();

        const hiddenProtoDay = makeDay();
        Object.defineProperty(hiddenProtoDay, '__proto__', { value: { polluted: true }, enumerable: false });
        expect(() => validateBackup(makeEnvelope({ days: [hiddenProtoDay] }))).toThrow(/dangerous/i);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();

        const hiddenExtraDay = makeDay();
        Object.defineProperty(hiddenExtraDay, 'sneaky', { value: 1, enumerable: false });
        expect(() => validateBackup(makeEnvelope({ days: [hiddenExtraDay] }))).toThrow(/unexpected key/i);
    });

    it('rejects pathologically nested payloads as a persistence error', () => {
        let nested: unknown = 1;
        for (let index = 0; index < 50_000; index += 1) {
            nested = { nested };
        }

        expect(() => validateBackup(nested)).toThrow(PersistenceError);
        expect(() => validateBackup(nested)).toThrow(/nesting too deep/i);
    });

    it('rejects circular payloads instead of overflowing the stack', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(() => validateBackup(circular)).toThrow(/circular/i);
    });

    it('keeps array bounds inclusive and rejects oversize collections', () => {
        const subjects = Array.from({ length: 1000 }, (_value, index) => makeSubject({ id: index + 1 }));
        expect(validateBackup(makeEnvelope({ days: [makeDay({ subjects })] })).days[0]?.subjects).toHaveLength(1000);
        expect(() =>
            validateBackup(makeEnvelope({ days: [makeDay({ subjects: [...subjects, makeSubject({ id: 1001 })] })] })),
        ).toThrow(/invalid array/i);

        const todos = Array.from({ length: 2001 }, (_value, index) => ({
            id: index + 1,
            text: 'todo',
            completed: false,
            time: '',
            reminder: false,
        }));
        expect(() => validateBackup(makeEnvelope({ todos }))).toThrow(/invalid array/i);
    });

    it('keeps id, date and uniqueness rules on their exact boundaries', () => {
        expect(
            validateBackup(
                makeEnvelope({ days: [makeDay({ subjects: [makeSubject({ id: Number.MAX_SAFE_INTEGER })] })] }),
            ).days[0]?.subjects[0]?.id,
        ).toBe(Number.MAX_SAFE_INTEGER);
        expect(() =>
            validateBackup(makeEnvelope({ days: [makeDay({ subjects: [makeSubject({ id: -1 })] })] })),
        ).toThrow(/invalid id/i);
        expect(() =>
            validateBackup(
                makeEnvelope({ focusAlarms: [{ id: 'a', time: '07:00', active: true, nativeId: 2_147_483_648 }] }),
            ),
        ).toThrow(/invalid native id/i);
        expect(() =>
            validateBackup(
                makeEnvelope({ focusAlarms: [{ id: 'a', time: '07:00', active: true, nativeId: 2_147_483_647 }] }),
            ),
        ).not.toThrow();

        expect(validateBackup(makeEnvelope({ days: [makeDay({ date: '2024-02-29' })] })).days[0]?.date).toBe(
            '2024-02-29',
        );
        expect(() => validateBackup(makeEnvelope({ days: [makeDay({ date: '2023-02-29' })] }))).toThrow();
        expect(() => validateBackup(makeEnvelope({ days: [makeDay({ date: '2026-13-01' })] }))).toThrow();
        expect(() => validateBackup(makeEnvelope({ days: [makeDay(), makeDay()] }))).toThrow(/duplicate day/i);
    });

    it('stamps legacy days deterministically instead of with the read time', () => {
        const legacyDay = {
            date: '2026-09-25',
            subjects: [],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        };

        expect(validateBackup([legacyDay]).days[0]?.updatedAt).toBe(LEGACY_UPDATED_AT);
        expect(validateBackup([legacyDay]).days[0]?.updatedAt).toBe(LEGACY_UPDATED_AT);
        expect(validateBackup({ date: '2026-09-25' }).days[0]?.updatedAt).toBe(LEGACY_UPDATED_AT);
        expect(validateBackup(makeDay()).days[0]?.updatedAt).toBe('2026-09-25T10:00:00.000Z');
    });
});

describe('native persistence', () => {
    it('serializes concurrent whole-file writes and uses temp-file rename', async () => {
        const first = saveToNativeStorage('2026-09-25', {
            subjects: [makeSubject({ name: 'First' })],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        });
        const second = saveToNativeStorage('2026-09-26', {
            subjects: [makeSubject({ id: 2, name: 'Second' })],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        });

        await Promise.all([first, second]);

        expect(nativeFs.rename).toHaveBeenCalled();
        expect(nativeFs.writeFile.mock.calls.every(([options]) => String(options.path).includes('.tmp-'))).toBe(true);
        const stored = JSON.parse(nativeState.fileData ?? '{}') as BackupEnvelope;
        expect(stored.days.map((day) => day.date)).toEqual(['2026-09-25', '2026-09-26']);
    });

    it('quarantines corrupt native JSON instead of replacing it', async () => {
        nativeState.fileData = '{not-json';
        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved|corrupt/i);
        expect(nativeFs.rename).toHaveBeenCalledWith(
            expect.objectContaining({ from: STORAGE_FILE, to: expect.stringContaining(`${STORAGE_FILE}.corrupt-`) }),
        );
        expect(nativeState.fileData).toBeNull();
        expect(nativeState.preserved.size).toBe(1);
    });

    it('gives every quarantine its own path so repeated corruption keeps all copies', async () => {
        nativeState.fileData = '{not-json';
        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved/i);
        nativeState.fileData = '{not-json';
        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved/i);

        expect(nativeState.preserved.size).toBe(2);
        expect(new Set(nativeState.preserved.keys()).size).toBe(2);
    });

    it('never quarantines the canonical file when localStorage access throws', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Canonical' })] }));
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('storage is disabled', 'SecurityError');
        });

        const day = await loadFromNativeStorage('2026-09-25');

        expect(day?.dayRating).toBe('Canonical');
        expect(nativeFs.rename).not.toHaveBeenCalled();
        expect(nativeState.preserved.size).toBe(0);
        expect(nativeState.fileData).not.toBeNull();
    });

    it('commits the native write even when the localStorage mirror is full', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        });

        await expect(saveFocusAlarms([{ id: 'focus-quota', time: '06:15', active: true }])).resolves.toBe(true);

        expect(readStoredEnvelope().focusAlarms[0]?.id).toBe('focus-quota');
        expect(nativeFs.rename).toHaveBeenCalled();
    });

    it('keeps the settings mirror in step with the file it just wrote', async () => {
        await importAllData(makeEnvelope({ settings: { theme: 'dark', adaptiveColor: null } }));
        await saveSettings({ theme: 'material-dark', adaptiveColor: '#abcdef' });

        expect(JSON.parse(localStorage.getItem('__settings') ?? 'null')).toEqual({
            theme: 'material-dark',
            adaptiveColor: '#abcdef',
        });
        expect(await loadSettings()).toEqual({ theme: 'material-dark', adaptiveColor: '#abcdef' });
    });

    it('keeps the canonical setting that a partial overlay does not carry', async () => {
        nativeState.fileData = JSON.stringify(
            makeEnvelope({ settings: { theme: 'material-light', adaptiveColor: null } }),
        );
        localStorage.setItem('adaptive-color', '#0a0b0c');

        expect(await loadSettings()).toEqual({ theme: 'material-light', adaptiveColor: '#0a0b0c' });
    });

    it('lets an explicit restore win over timestamp-less legacy data', async () => {
        nativeState.fileData = JSON.stringify({
            '2026-09-25': { date: '2026-09-25', checklistItems: [], qualityChecks: [], errors: [] },
        });

        await loadFromNativeStorage('2026-09-25');
        expect(readStoredEnvelope().days[0]?.updatedAt).toBe(LEGACY_UPDATED_AT);

        const applied = await importAllData(
            makeEnvelope({ days: [makeDay({ updatedAt: '2020-05-05T08:00:00.000Z', dayRating: 'Restored' })] }),
        );

        expect(applied).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Restored');
    });

    it('persists globals in the canonical envelope and round-trips them', async () => {
        await saveToNativeStorage('2026-09-25', {
            subjects: [],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        });
        await saveRecurringSubjects([makeRecurringSubject({ id: 9, recurringDays: [1] })]);
        await saveGlobalTodos([{ id: 4, text: 'Read chapter', completed: false, time: '', reminder: false }]);
        await saveFocusAlarms([{ id: 'focus-1', time: '06:15', active: false }]);
        await saveSettings({ theme: 'material-dark', adaptiveColor: '#abcdef' });

        const envelope = await exportBackup();
        expect(envelope.recurringSubjects).toHaveLength(1);
        expect(envelope.todos[0]?.text).toBe('Read chapter');
        expect(envelope.focusAlarms[0]?.id).toBe('focus-1');
        expect(envelope.settings).toEqual({ theme: 'material-dark', adaptiveColor: '#abcdef' });
    });

    it('migrates the legacy native day map into the versioned envelope', async () => {
        nativeState.fileData = JSON.stringify({
            schemaVersion: BACKUP_SCHEMA_VERSION,
            exportedAt: '2026-09-25T10:00:00.000Z',
            days: {
                '2026-09-25': makeDay(),
            },
            recurringSubjects: [],
            todos: [],
            focusAlarms: [],
            settings: { theme: 'light', adaptiveColor: null },
        });

        const envelope = await exportBackup();
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.days[0]?.date).toBe('2026-09-25');
        expect(nativeFs.writeFile).toHaveBeenCalled();
    });

    it('keeps current component-owned settings and focus alarms in exports', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope());
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('focusAlarms', JSON.stringify([{ id: 'local-focus', time: '09:00', active: false }]));

        const envelope = await exportBackup();
        expect(envelope.settings.theme).toBe('dark');
        expect(envelope.focusAlarms[0]?.id).toBe('local-focus');

        localStorage.setItem('focusAlarms', '[]');
        expect((await exportBackup()).focusAlarms[0]?.id).toBe('local-focus');
    });

    it('uses the imported settings and focus alarm list as authoritative values', async () => {
        await importAllData(
            makeEnvelope({
                focusAlarms: [{ id: 'old-focus', time: '08:00', active: true }],
                settings: { theme: 'dark', adaptiveColor: '#123456' },
            }),
        );
        localStorage.setItem('focusAlarms', JSON.stringify([{ id: 'stale-local', time: '09:00', active: true }]));

        await importAllData(
            makeEnvelope({
                days: [],
                focusAlarms: [],
                settings: { theme: 'material-light', adaptiveColor: null },
            }),
        );

        const envelope = await exportBackup();
        expect(envelope.focusAlarms).toEqual([]);
        expect(envelope.settings).toEqual({ theme: 'material-light', adaptiveColor: null });
    });

    it('falls back to a direct native write when atomic rename is unavailable', async () => {
        const filesystem = nativeFs as unknown as { rename?: unknown };
        const originalRename = filesystem.rename;
        filesystem.rename = undefined;
        try {
            await saveToNativeStorage('2026-09-25', {
                subjects: [],
                checklistItems: [],
                qualityChecks: [],
                dayRating: '',
                errors: [],
            });
            expect(nativeFs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: STORAGE_FILE }));
            expect(readStoredEnvelope().days[0]?.date).toBe('2026-09-25');
        } finally {
            filesystem.rename = originalRename;
        }
    });

    it('falls back to a direct write when the rename stub is unimplemented at runtime', async () => {
        nativeFs.rename.mockImplementation(async () => {
            throw { code: 'UNIMPLEMENTED', message: 'not implemented' };
        });

        await saveToNativeStorage('2026-09-25', emptyDayInput());
        expect(nativeState.temporaryData).toBeNull();

        expect(nativeFs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: STORAGE_FILE }));
        expect(readStoredEnvelope().days[0]?.date).toBe('2026-09-25');
    });

    it('removes the temp file when the temp write itself fails', async () => {
        await saveToNativeStorage('2026-09-25', emptyDayInput());
        const committed = nativeState.fileData;

        // A rejected write can still have created the file: the orphan is what matters here.
        nativeFs.writeFile.mockImplementation(async ({ path, data }: { path: string; data: string }) => {
            if (String(path).includes('.tmp-')) {
                nativeState.temporaryData = data;
                throw { code: 'ENOSPC', message: 'no space left on device' };
            }
            nativeState.fileData = data;
        });

        await expect(saveToNativeStorage('2026-09-26', emptyDayInput())).rejects.toThrow(
            /unable to write native storage/i,
        );
        expect(nativeState.temporaryData).toBeNull();
        expect(nativeState.fileData).toBe(committed);
        expect(nativeFs.deleteFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: expect.stringContaining('.tmp-') }),
        );
    });

    it('keeps the finished temp file when the non-atomic fallback write fails', async () => {
        nativeFs.rename.mockImplementation(async () => {
            throw { code: 'UNIMPLEMENTED', message: 'not implemented' };
        });
        nativeFs.writeFile.mockImplementation(async ({ path, data }: { path: string; data: string }) => {
            if (String(path).includes('.tmp-')) {
                nativeState.temporaryData = data;
                return;
            }
            // The in-place write is not atomic: it truncates the canonical file and then fails.
            nativeState.fileData = null;
            throw { code: 'ENOSPC', message: 'no space left on device' };
        });

        await expect(saveToNativeStorage('2026-09-25', emptyDayInput())).rejects.toThrow(
            /unable to write native storage/i,
        );

        // The temp file holds the complete payload and the canonical file is now empty, so it is
        // the only recoverable copy of either and has to survive the failure.
        expect(nativeState.temporaryData).not.toBeNull();
        expect(JSON.parse(nativeState.temporaryData ?? '{}').days[0]?.date).toBe('2026-09-25');
        expect(nativeFs.deleteFile).not.toHaveBeenCalled();
    });

    it('reports a synchronous cleanup fault as a cleanup fault, not as the write failure', async () => {
        nativeFs.writeFile.mockImplementation(async ({ path, data }: { path: string; data: string }) => {
            if (String(path).includes('.tmp-')) {
                nativeState.temporaryData = data;
                throw { code: 'ENOSPC', message: 'no space left on device' };
            }
            nativeState.fileData = data;
        });
        // A proxy that throws instead of rejecting: the cleanup is best-effort and must not
        // replace the failure the caller is already being told about.
        nativeFs.deleteFile.mockImplementation(() => {
            throw new Error('delete is not callable');
        });

        await expect(saveToNativeStorage('2026-09-26', emptyDayInput())).rejects.toThrow(
            /unable to write native storage/i,
        );
    });

    it('never quarantines the canonical file when a read fails for a reason other than absence', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Canonical' })] }));
        nativeFs.readFile.mockImplementation(async () => {
            throw { code: 'EACCES', message: 'permission denied' };
        });

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/unable to read native storage/i);
        expect(quarantineTargets()).toEqual([]);
        expect(nativeState.fileData).not.toBeNull();
    });

    it('treats a missing-file rejection that carries no code as an empty store', async () => {
        nativeFs.readFile.mockImplementation(async () => {
            throw { message: 'ENOENT: no such file or directory' };
        });

        expect(await loadFromNativeStorage('2026-09-25')).toBeNull();
        expect(nativeFs.writeFile).not.toHaveBeenCalled();
        expect(quarantineTargets()).toEqual([]);
    });

    it('keeps the previous file when an atomic commit fails for a real reason', async () => {
        await saveToNativeStorage('2026-09-25', emptyDayInput());
        const committed = nativeState.fileData;

        nativeFs.rename.mockImplementation(async ({ from }: { from: string }) => {
            if (String(from).includes('.tmp-')) {
                throw { code: 'EACCES', message: 'permission denied' };
            }
        });

        await expect(saveToNativeStorage('2026-09-26', emptyDayInput())).rejects.toThrow(/atomically/i);
        expect(nativeState.fileData).toBe(committed);
        expect(nativeState.temporaryData).toBeNull();
    });

    it('refuses an unsupported schema version without quarantining the file', async () => {
        const payload = JSON.stringify(makeEnvelope({ schemaVersion: BACKUP_SCHEMA_VERSION + 1 }));
        nativeState.fileData = payload;

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toBeInstanceOf(UnsupportedSchemaError);
        expect(nativeFs.rename).not.toHaveBeenCalled();
        expect(nativeState.preserved.size).toBe(0);
        expect(nativeState.fileData).toBe(payload);
    });

    it('uses newest updatedAt for conflicts and does not count ignored days', async () => {
        const current = makeEnvelope({ days: [makeDay({ updatedAt: '2026-09-25T12:00:00.000Z' })] });
        await importAllData(current);

        const older = makeEnvelope({
            days: [makeDay({ updatedAt: '2026-09-25T11:00:00.000Z', dayRating: 'Older' })],
        });
        expect(await importAllData(older)).toBe(0);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Okayish');

        const newer = makeEnvelope({
            days: [makeDay({ updatedAt: '2026-09-25T13:00:00.000Z', dayRating: 'Newer' })],
        });
        expect(await importAllData(newer)).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Newer');
    });

    it('resolves an updatedAt tie deterministically in favour of the stored data', async () => {
        await importAllData(
            makeEnvelope({ days: [makeDay({ updatedAt: '2026-09-25T10:00:00.000Z', dayRating: 'Current' })] }),
        );
        const tie = makeEnvelope({
            days: [makeDay({ updatedAt: '2026-09-25T10:00:00.000Z', dayRating: 'Incoming' })],
        });

        expect(await importAllData(tie)).toBe(0);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Current');

        expect(await importAllData(tie, 'replace')).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Incoming');
    });

    it('rejects invalid file imports without writing a success result', async () => {
        const file = new File(['{"schemaVersion":1}'], 'backup.json', { type: 'application/json' });
        await expect(handleFileImport(file)).rejects.toThrow();
        expect(nativeState.fileData).toBeNull();
    });
});

describe('native failure classification', () => {
    const storedDay = (): BackupEnvelope => JSON.parse(nativeState.fileData ?? '{}') as BackupEnvelope;

    it('never reads an unavailable plugin as an empty store', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Canonical' })] }));
        // Capacitor's real plugin-availability text. It contains "missing", so a read that trusted
        // the message alone would treat a store full of data as absent - and the next save would
        // then overwrite it.
        nativeFs.readFile.mockImplementation(async () => {
            throw {
                code: 'MISSING_METHOD',
                message: 'Method readFile is missing or unavailable. Check that the plugin is installed correctly.',
            };
        });

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/unable to read native storage/i);
        expect(quarantineTargets()).toEqual([]);
        expect(storedDay().days[0]?.dayRating).toBe('Canonical');
    });

    it('never reads a quota or permission fault as an empty store', async () => {
        for (const error of [
            { code: 'ENOSPC', message: 'No space left on device' },
            { code: 'EACCES', message: 'Permission denied' },
            { code: '', message: 'The requested file could not be opened' },
            { code: 'UNKNOWN', message: 'mount point is missing' },
            { code: 'UNKNOWN', message: 'Provider not found' },
        ]) {
            nativeState.fileData = JSON.stringify(makeEnvelope());
            nativeFs.readFile.mockImplementation(async () => {
                throw error;
            });

            await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/unable to read native storage/i);
            expect(quarantineTargets()).toEqual([]);
            expect(nativeFs.writeFile).not.toHaveBeenCalled();
        }
    });

    it('accepts the absence wording the platforms actually produce', async () => {
        for (const error of [
            { code: 'ENOENT', message: 'whatever the platform felt like saying' },
            { code: 'FILE_NOT_FOUND', message: '' },
            { message: 'The file at /data/user/0/app/files/study-tracker-data.json doesn\u2019t exist.' },
            { message: "ENOENT: no such file or directory, open 'study-tracker-data.json'" },
            { message: 'File not found' },
        ]) {
            nativeFs.readFile.mockImplementation(async () => {
                throw error;
            });

            expect(await loadFromNativeStorage('2026-09-25')).toBeNull();
        }
        expect(quarantineTargets()).toEqual([]);
    });

    it('names a non-text native payload instead of reporting a generic read failure', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope());
        nativeFs.readFile.mockImplementation(async () => ({ data: 42 }));

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/non-text/i);
        expect(quarantineTargets()).toEqual([]);
        expect(storedDay().days[0]?.date).toBe('2026-09-25');
    });

    it('does not downgrade a real commit fault to the non-atomic path', async () => {
        await saveToNativeStorage('2026-09-25', emptyDayInput());
        const committed = nativeState.fileData;
        // "unavailable" on its own is a storage fault, not an unimplemented method: falling back
        // would replace an atomic commit with an in-place overwrite of the only good copy.
        nativeFs.rename.mockImplementation(async () => {
            throw { code: 'UNKNOWN', message: 'The destination is temporarily unavailable' };
        });

        await expect(saveToNativeStorage('2026-09-26', emptyDayInput())).rejects.toThrow(/atomically/i);
        expect(nativeState.fileData).toBe(committed);
        expect(nativeState.temporaryData).toBeNull();
    });
});

describe('localStorage overlay resilience', () => {
    it('keeps the canonical backup when the focus-alarm overlay is not valid JSON', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Canonical' })] }));
        localStorage.setItem('focusAlarms', '{not-json');

        const day = await loadFromNativeStorage('2026-09-25');

        expect(day?.dayRating).toBe('Canonical');
        expect(nativeFs.rename).not.toHaveBeenCalled();
        expect(nativeState.preserved.size).toBe(0);
        expect(nativeState.fileData).not.toBeNull();
    });

    it('keeps the canonical backup when the focus-alarm overlay has a legacy shape', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Canonical' })] }));
        localStorage.setItem('focusAlarms', JSON.stringify([{ id: 12, time: 'not-a-time', active: true }]));

        const day = await loadFromNativeStorage('2026-09-25');

        expect(day?.dayRating).toBe('Canonical');
        expect(nativeFs.rename).not.toHaveBeenCalled();
    });

    it('keeps the canonical settings when the local theme overlay is not a known theme', async () => {
        nativeState.fileData = JSON.stringify(
            makeEnvelope({ days: [], settings: { theme: 'material-dark', adaptiveColor: '#112233' } }),
        );
        localStorage.setItem('theme', 'neon-hacker');

        const envelope = await exportBackup();

        expect(envelope.settings).toEqual({ theme: 'material-dark', adaptiveColor: '#112233' });
    });

    it('judges every component overlay field on its own', async () => {
        // The focus list, the theme and the adaptive colour belong to different components. An
        // unusable value in one used to suppress the others' valid values, because all three were
        // validated together behind a single guard.
        nativeState.fileData = JSON.stringify(
            makeEnvelope({ days: [], settings: { theme: 'material-dark', adaptiveColor: '#112233' } }),
        );
        localStorage.setItem('focusAlarms', '{not-json');
        localStorage.setItem('theme', 'neon-hacker');
        localStorage.setItem('adaptive-color', '#445566');

        expect((await exportBackup()).settings).toEqual({ theme: 'material-dark', adaptiveColor: '#445566' });
    });

    it('ignores an unusable overlay field without resetting the stored one', async () => {
        nativeState.fileData = JSON.stringify(
            makeEnvelope({ days: [], settings: { theme: 'material-dark', adaptiveColor: '#112233' } }),
        );
        localStorage.setItem('theme', 'auto');
        localStorage.setItem('adaptive-color', 'not-a-colour');

        expect((await exportBackup()).settings).toEqual({ theme: 'auto', adaptiveColor: '#112233' });
    });

    it('keeps a valid focus overlay alongside unusable settings overlays', async () => {
        nativeState.fileData = JSON.stringify(
            makeEnvelope({ days: [], settings: { theme: 'material-dark', adaptiveColor: '#112233' } }),
        );
        localStorage.setItem('focusAlarms', JSON.stringify([{ id: 'still-read', time: '06:00', active: true }]));
        localStorage.setItem('theme', 'neon-hacker');
        localStorage.setItem('adaptive-color', 'not-a-colour');

        const envelope = await exportBackup();
        expect(envelope.focusAlarms[0]?.id).toBe('still-read');
        expect(envelope.settings).toEqual({ theme: 'material-dark', adaptiveColor: '#112233' });
    });

    it('still quarantines a genuinely corrupt canonical backup', async () => {
        nativeState.fileData =
            '{"schemaVersion":1,"exportedAt":"not-a-timestamp","days":[],"recurringSubjects":[],"todos":[],"focusAlarms":[],"settings":{"theme":"light","adaptiveColor":null}}';

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved/i);
        expect(nativeFs.rename).toHaveBeenCalledWith(
            expect.objectContaining({ from: STORAGE_FILE, to: expect.stringContaining('.corrupt-') }),
        );
    });

    it('still quarantines a corrupt canonical backup when localStorage is unusable', async () => {
        nativeState.fileData =
            '{"schemaVersion":1,"exportedAt":"not-a-timestamp","days":[],"recurringSubjects":[],"todos":[],"focusAlarms":[],"settings":{"theme":"light","adaptiveColor":null}}';
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('storage is disabled', 'SecurityError');
        });

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved/i);
        expect(nativeFs.rename).toHaveBeenCalledWith(
            expect.objectContaining({ from: STORAGE_FILE, to: expect.stringContaining('.corrupt-') }),
        );
    });

    it('migrates app-owned localStorage data even when the component overlay is unusable', async () => {
        nativeState.fileData = null;
        localStorage.setItem('__recurring_subjects', JSON.stringify([makeRecurringSubject({ id: 5 })]));
        localStorage.setItem('theme', 'neon-hacker');
        localStorage.setItem('focusAlarms', '{not-json');

        const envelope = await exportBackup();

        expect(envelope.recurringSubjects[0]?.id).toBe(5);
        expect(envelope.settings).toEqual({ theme: 'light', adaptiveColor: null });
    });
});

describe('import conflict policies', () => {
    it('does not let the keep policy overwrite conflicting days or global data', async () => {
        await importAllData(
            makeEnvelope({
                days: [makeDay({ updatedAt: '2026-09-25T10:00:00.000Z', dayRating: 'Current' })],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                focusAlarms: [{ id: 'current-alarm', time: '06:00', active: true }],
                recurringSubjects: [makeRecurringSubject({ id: 1, name: 'Current template' })],
                settings: { theme: 'dark', adaptiveColor: null },
            }),
        );

        const applied = await importAllData(
            makeEnvelope({
                days: [makeDay({ updatedAt: '2026-09-25T23:00:00.000Z', dayRating: 'Incoming' })],
                todos: [{ id: 2, text: 'Incoming todo', completed: true, time: '', reminder: false }],
                focusAlarms: [{ id: 'incoming-alarm', time: '07:00', active: false }],
                recurringSubjects: [makeRecurringSubject({ id: 2, name: 'Incoming template' })],
                settings: { theme: 'material-light', adaptiveColor: '#654321' },
            }),
            'keep',
        );

        expect(applied).toBe(0);
        const envelope = await exportBackup();
        expect(envelope.days[0]?.dayRating).toBe('Current');
        expect(envelope.todos[0]?.text).toBe('Current todo');
        expect(envelope.focusAlarms[0]?.id).toBe('current-alarm');
        expect(envelope.recurringSubjects[0]?.name).toBe('Current template');
        expect(envelope.settings).toEqual({ theme: 'dark', adaptiveColor: null });
    });

    it('still adds brand new days under the keep policy', async () => {
        await importAllData(makeEnvelope({ days: [] }));

        expect(await importAllData(makeEnvelope({ days: [makeDay()] }), 'keep')).toBe(1);
    });

    it('still applies global data for the newest policy', async () => {
        await importAllData(makeEnvelope({ days: [], todos: [], settings: { theme: 'dark', adaptiveColor: null } }));

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Incoming todo', completed: false, time: '', reminder: false }],
                settings: { theme: 'material-light', adaptiveColor: null },
            }),
            'newest',
        );

        const envelope = await exportBackup();
        expect(envelope.todos[0]?.text).toBe('Incoming todo');
        expect(envelope.settings.theme).toBe('material-light');
    });
});

/**
 * The default `newest` policy decides each global section by its own recency stamp.
 *
 * Before the stamps, the global sections were applied unconditionally while the
 * *days* were compared by `updatedAt`. The result was an import that carefully
 * declined an older day and then overwrote the current todo list, theme and alarm
 * list from the same older file.
 */
describe('global section recency stamps', () => {
    const OLDER = '2026-01-01T00:00:00.000Z';
    const NEWER = '2026-06-01T00:00:00.000Z';

    it('refuses an older backup over a section the store has written since', async () => {
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: NEWER },
            }),
        );

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Stale todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: OLDER },
            }),
            'newest',
        );

        expect((await exportBackup()).todos[0]?.text).toBe('Current todo');
    });

    it('applies a newer backup section over an older one, per section', async () => {
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                settings: { theme: 'dark', adaptiveColor: null },
                globalStamps: { todos: NEWER, settings: OLDER },
            }),
        );

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Stale todo', completed: false, time: '', reminder: false }],
                settings: { theme: 'material-light', adaptiveColor: null },
                globalStamps: { todos: OLDER, settings: NEWER },
            }),
            'newest',
        );

        const envelope = await exportBackup();
        // Decided independently: the theme moves, the todo list does not.
        expect(envelope.settings.theme).toBe('material-light');
        expect(envelope.todos[0]?.text).toBe('Current todo');
        // The store keeps the recency it now has, per section.
        expect(envelope.globalStamps).toEqual({ todos: NEWER, settings: NEWER });
    });

    it('leaves a stamped store alone when the backup records no recency at all', async () => {
        // This is the case the stamps exist for. A file written by a build that
        // recorded no recency would otherwise overwrite a store that recorded its
        // own, and the user would watch their current todo list disappear into an
        // older backup they were only trying to recover a day from.
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                settings: { theme: 'dark', adaptiveColor: null },
                globalStamps: { todos: NEWER, settings: NEWER },
            }),
        );

        // No `globalStamps` at all - exactly the shape of every backup taken
        // before the field existed, and it still imports.
        await importAllData({
            schemaVersion: BACKUP_SCHEMA_VERSION,
            exportedAt: NEWER,
            days: [],
            recurringSubjects: [],
            todos: [{ id: 2, text: 'Unstamped todo', completed: false, time: '', reminder: false }],
            focusAlarms: [],
            settings: { theme: 'material-dark', adaptiveColor: null },
        });

        const envelope = await exportBackup();
        expect(envelope.todos[0]?.text).toBe('Current todo');
        expect(envelope.settings.theme).toBe('dark');
        // The store keeps the recency it had; the rejected import does not replace
        // it with a timestamp for a value that was never written.
        expect(envelope.globalStamps).toEqual({ todos: NEWER, settings: NEWER });
    });

    it('applies an unstamped section onto a store that has no stamp either', async () => {
        // Documented semantics for a pre-stamp backup: the import is an explicit act
        // by the user and there is no recency information to be conservative with,
        // so it wins. A first restore must not be refused.
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
            }),
        );

        await importAllData({
            schemaVersion: BACKUP_SCHEMA_VERSION,
            exportedAt: OLDER,
            days: [],
            recurringSubjects: [],
            todos: [{ id: 2, text: 'Restored todo', completed: false, time: '', reminder: false }],
            focusAlarms: [],
            settings: { theme: 'light', adaptiveColor: null },
        });

        expect((await exportBackup()).todos[0]?.text).toBe('Restored todo');
    });

    it('applies a stamped backup onto a store left by a build that recorded nothing', async () => {
        await importAllData(makeEnvelope({ days: [], todos: [] }));

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Restored todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: NEWER },
            }),
        );

        expect((await exportBackup()).todos[0]?.text).toBe('Restored todo');
    });

    it('ignores a backup whose stamp for a section is exactly the store own', async () => {
        // A tie keeps the current copy, so importing the same file twice is a
        // no-op the second time rather than a rewrite.
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: NEWER },
            }),
        );

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Tie todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: NEWER },
            }),
        );

        expect((await exportBackup()).todos[0]?.text).toBe('Current todo');
    });

    it('applies every section when the policy is replace, stamps and all', async () => {
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: NEWER },
            }),
        );

        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 2, text: 'Forced todo', completed: false, time: '', reminder: false }],
                globalStamps: { todos: OLDER },
            }),
            'replace',
        );

        const envelope = await exportBackup();
        expect(envelope.todos[0]?.text).toBe('Forced todo');
        // The store's own idea of recency moves with the value it committed.
        expect(envelope.globalStamps.todos).toBe(OLDER);
    });

    it('stamps only the section a write actually changed', async () => {
        const before = await exportBackup();
        const stampedAt = Date.now();

        await saveGlobalTodos([{ id: 5, text: 'Edited', completed: false, time: '', reminder: false }]);

        const after = await exportBackup();
        expect(after.todos[0]?.text).toBe('Edited');
        // A fresh write claims its own time, and the sections it did not touch keep
        // whatever the last import or save left them with.
        expect(Date.parse(after.globalStamps.todos ?? '')).toBeGreaterThanOrEqual(stampedAt);
        expect(after.globalStamps.settings).toBe(before.globalStamps.settings);
        expect(after.globalStamps.recurringSubjects).toBe(before.globalStamps.recurringSubjects);
    });

    it('round-trips the stamps through an export and a re-import', async () => {
        await saveSettings({ theme: 'material-dark', adaptiveColor: '#0a0b0c' });
        const exported = await exportBackup();
        expect(exported.globalStamps.settings).toBeTypeOf('string');

        // The app's own export is a faithful record: re-importing it applies
        // nothing, day or section, and the stamps that made that true survive the
        // round trip unchanged.
        expect(await importAllData(JSON.parse(JSON.stringify(exported)))).toBe(0);
        const reimported = await exportBackup();
        expect(reimported.globalStamps.settings).toBe(exported.globalStamps.settings);
        expect(reimported.settings).toEqual({ theme: 'material-dark', adaptiveColor: '#0a0b0c' });
    });

    it('rejects a stamp that is present but not a timestamp', async () => {
        // Absent means "unknown" and is accepted; present-but-malformed is
        // corruption, and treating it as unknown would hand the decision to
        // whichever side happened to omit it.
        expect(() => validateBackup({ ...makeEnvelope(), globalStamps: { todos: 'yesterday' } })).toThrow(/timestamp/i);
        expect(() => validateBackup({ ...makeEnvelope(), globalStamps: { todos: 1_700_000_000 } })).toThrow(
            /timestamp/i,
        );
        expect(() => validateBackup({ ...makeEnvelope(), globalStamps: { unknownSection: NEWER } })).toThrow(
            /unexpected key/i,
        );
        expect(validateBackup({ ...makeEnvelope(), globalStamps: {} }).globalStamps).toEqual({});
    });
});

describe('restore size and legacy bounds', () => {
    it('restores a large but valid backup that an older, smaller cap would reject', async () => {
        const oversized = {
            ...new File(['{}'], 'backup.json'),
            size: MAX_FILE_BYTES,
            text: async () => JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Restored' })] })),
        } as unknown as File;

        expect(await handleFileImport(oversized)).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Restored');
    });

    it('rejects a payload beyond the restore size limit', async () => {
        const tooLarge = {
            size: MAX_FILE_BYTES + 1,
            text: async () => JSON.stringify(makeEnvelope()),
        } as unknown as File;

        await expect(handleFileImport(tooLarge)).rejects.toThrow(/too large/i);
        expect(nativeState.fileData).toBeNull();
    });

    it('leaves the restore limit above a store the app can actually hold', () => {
        // `MAX_FILE_BYTES` cannot be above the theoretical maximum export - the per-record bounds
        // multiply out to far more than any phone can read into memory - so the invariant that
        // matters is the practical one: a day limit's worth of days with an ordinary payload has
        // to stay restorable. Lowering the cap past this fails here instead of quietly making the
        // user's own backup unrestorable.
        const serialized = JSON.stringify(makeEnvelope({ days: makeRealisticDayRange(MAX_DAYS) }), null, 2);

        // The payload is ASCII, so its UTF-16 length is its byte length.
        expect(serialized.length).toBeLessThan(MAX_FILE_BYTES);
    });

    it('bounds the number of days accepted from a legacy native day map', async () => {
        const legacyDays: Record<string, DayData> = {};
        for (let index = 0; index <= 10000; index += 1) {
            const date = new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
            legacyDays[date] = makeDay({ date, subjects: [], checklistItems: [], qualityChecks: [], errors: [] });
        }
        nativeState.fileData = JSON.stringify(legacyDays);

        await expect(loadFromNativeStorage('2000-01-01')).rejects.toThrow(/preserved|array|days/i);
    });

    it('rejects an oversized legacy native map before parsing any day', async () => {
        const legacyDays: Record<string, unknown> = { '2000-01-01': { date: 'not-a-date' } };
        for (let index = 1; index <= 10_008; index += 1) {
            const date = new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
            legacyDays[date] = { date };
        }
        nativeState.fileData = JSON.stringify(legacyDays);

        await expect(loadFromNativeStorage('2000-01-02')).rejects.toThrow(/invalid native storage root/i);
    });

    it('bounds a versioned native day map before validating every entry', async () => {
        const legacyDays: Record<string, unknown> = { '2000-01-01': { date: 'not-a-date' } };
        for (let index = 1; index <= 10_000; index += 1) {
            const date = new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
            legacyDays[date] = { date };
        }
        nativeState.fileData = JSON.stringify({
            schemaVersion: BACKUP_SCHEMA_VERSION,
            exportedAt: '2026-09-25T10:00:00.000Z',
            days: legacyDays,
            recurringSubjects: [],
            todos: [],
            focusAlarms: [],
            settings: { theme: 'light', adaptiveColor: null },
        });

        await expect(loadFromNativeStorage('2000-01-02')).rejects.toThrow(/invalid array at native\.days/i);
    });
});

describe('web platform mirror', () => {
    const importWebStorage = async () => {
        vi.resetModules();
        vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
        return import('./storage');
    };

    /** The rows the web store is holding, straight out of the table the module wrote them to. */
    const storedWebDays = async (web: Awaited<ReturnType<typeof importWebStorage>>): Promise<string[]> => {
        const rows = (await (web.db.days as unknown as { toArray: () => Promise<{ date: string }[]> }).toArray()) ?? [];
        return rows.map((row) => row.date);
    };

    it('round-trips globals through the metadata table', async () => {
        const web = await importWebStorage();

        await web.saveRecurringSubjects([makeRecurringSubject({ id: 11 })]);

        expect((await web.loadRecurringSubjects())[0]?.id).toBe(11);
        expect(await storedWebDays(web)).toEqual([]);
        // The canonical table - not the mirror - is what the next read has to come back from.
        const metadata = (await (
            web.db.metadata as unknown as { toArray: () => Promise<{ key: string; value: unknown }[]> }
        ).toArray()) as { key: string; value: unknown }[];
        expect(metadata.map((record) => record.key).sort()).toEqual(['focusAlarms', 'recurringSubjects', 'settings']);
    });

    describe('readDaysInRange', () => {
        const webDay = (date: string): DayData => makeDay({ date, updatedAt: `${date}T10:00:00.000Z` });

        it('returns only the days inside an inclusive window, in date order', async () => {
            const web = await importWebStorage();
            for (const date of ['2026-09-20', '2026-09-22', '2026-09-24', '2026-09-26']) {
                await web.saveToNativeStorage(date, emptyDayInput());
            }

            const window = await web.readDaysInRange('2026-09-22', '2026-09-24');

            expect(window.map((day) => day.date)).toEqual(['2026-09-22', '2026-09-24']);
        });

        it('includes both endpoints of a single-day window', async () => {
            const web = await importWebStorage();
            await web.saveToNativeStorage('2026-09-22', emptyDayInput());
            await web.saveToNativeStorage('2026-09-23', emptyDayInput());

            expect((await web.readDaysInRange('2026-09-22', '2026-09-22')).map((day) => day.date)).toEqual([
                '2026-09-22',
            ]);
        });

        it('returns nothing for a window with no days in it', async () => {
            const web = await importWebStorage();
            await web.saveToNativeStorage('2026-09-20', emptyDayInput());

            expect(await web.readDaysInRange('2026-10-01', '2026-10-07')).toEqual([]);
        });

        it('hands back clones, so a caller cannot edit the store through the result', async () => {
            const web = await importWebStorage();
            await web.saveToNativeStorage('2026-09-22', {
                ...emptyDayInput(),
                subjects: [makeSubject({ id: 1, name: 'Original' })],
            });

            const [first] = await web.readDaysInRange('2026-09-22', '2026-09-22');
            expect(first?.subjects[0]?.name).toBe('Original');
            (first?.subjects ?? []).forEach((subject) => {
                subject.name = 'Mutated';
            });

            const [second] = await web.readDaysInRange('2026-09-22', '2026-09-22');
            expect(second?.subjects[0]?.name).toBe('Original');
        });

        it('rejects a malformed bound and an inverted range before reading anything', async () => {
            const web = await importWebStorage();
            await expect(web.readDaysInRange('2026-02-30', '2026-03-01')).rejects.toThrow(/date/i);
            await expect(web.readDaysInRange('2026-09-24', '2026-09-20')).rejects.toThrow(/range/i);
        });

        it('reads the same window off a native store', async () => {
            nativeState.fileData = JSON.stringify(
                makeEnvelope({ days: ['2026-09-20', '2026-09-22', '2026-09-24'].map((date) => webDay(date)) }),
            );

            expect((await readDaysInRange('2026-09-21', '2026-09-24')).map((day) => day.date)).toEqual([
                '2026-09-22',
                '2026-09-24',
            ]);
        });

        it('agrees with the whole-store read inside the same window', async () => {
            // The range reader is only worth having if it is the same data. Compared
            // through the public readers so the assertion is about behaviour rather
            // than about the two implementations sharing a helper.
            nativeState.fileData = JSON.stringify(
                makeEnvelope({ days: ['2026-09-20', '2026-09-22', '2026-09-24'].map((date) => webDay(date)) }),
            );
            const from = '2026-09-20';
            const to = '2026-09-24';

            const ranged = await readDaysInRange(from, to);
            const everything = await exportAllData();

            expect(ranged).toEqual(everything.filter((day) => day.date >= from && day.date <= to));
        });
    });

    it('keeps a corrupt app-owned mirror key from failing a read the metadata table can satisfy', async () => {
        const web = await importWebStorage();
        await web.saveGlobalTodos([{ id: 1, text: 'canonical todo', completed: false, time: '', reminder: false }]);
        localStorage.setItem('__global_todos', '{not-json');
        localStorage.setItem('__recurring_subjects', JSON.stringify([{ id: 1 }]));
        localStorage.setItem('__settings', '[]');

        // The mirror is only a migration source and a fallback once the table exists, so a broken
        // key there degrades that one section instead of bricking every read - a user who cannot
        // open the app cannot re-import a good backup either.
        expect(await web.loadGlobalTodos()).toEqual([
            { id: 1, text: 'canonical todo', completed: false, time: '', reminder: false },
        ]);
        expect(await web.loadRecurringSubjects()).toEqual([]);
        expect(await web.loadSettings()).toEqual({ theme: 'light', adaptiveColor: null });
    });

    it('keeps the stored settings when the local theme overlay is not a known theme', async () => {
        const web = await importWebStorage();
        await web.saveSettings({ theme: 'material-dark', adaptiveColor: '#112233' });
        // Key presence alone must not decide authority: a value this build cannot interpret is
        // the same as the component never having written it.
        localStorage.setItem('theme', 'neon-hacker');
        localStorage.setItem('adaptive-color', '#445566');

        expect(await web.loadSettings()).toEqual({ theme: 'material-dark', adaptiveColor: '#445566' });
    });

    it('reports success for a web save even when the mirror write is rejected', async () => {
        const web = await importWebStorage();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        });

        await expect(
            web.saveGlobalTodos([{ id: 1, text: 'todo', completed: false, time: '', reminder: false }]),
        ).resolves.toBe(true);
    });

    it('saves and reloads a day through the web day table', async () => {
        const web = await importWebStorage();

        await web.saveToNativeStorage('2026-09-25', emptyDayInput({ dayRating: 'Web day' }));

        expect(await storedWebDays(web)).toEqual(['2026-09-25']);
        expect((await web.loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Web day');
        expect((await web.exportAllData()).map((day) => day.date)).toEqual(['2026-09-25']);
    });

    it('refuses a web save that would push the day table past the limit, but still allows an overwrite', async () => {
        const web = await importWebStorage();
        expect(await web.importAllData(makeEnvelope({ days: makeDayRange(0, MAX_DAYS) }))).toBe(MAX_DAYS);

        // `put` is an upsert, so only a date the table does not hold can cross the limit - which
        // is exactly the case the guard has to catch, since a read past it is refused outright.
        await expect(web.saveToNativeStorage('2030-01-01', emptyDayInput())).rejects.toThrow(/limit is 10000/i);
        await expect(web.saveToNativeStorage('2000-01-01', emptyDayInput({ dayRating: 'Overwritten' }))).resolves.toBe(
            undefined,
        );
        expect((await web.loadFromNativeStorage('2000-01-01'))?.dayRating).toBe('Overwritten');
    });

    it('refuses a web import whose merge would exceed the day limit the readers enforce', async () => {
        const web = await importWebStorage();
        expect(await web.importAllData(makeEnvelope({ days: makeDayRange(0, MAX_DAYS) }))).toBe(MAX_DAYS);

        // Unlike an oversize *incoming* payload, this one parses cleanly: it is the merge that
        // would commit a store the next read refuses, so the write has to be refused too.
        await expect(web.importAllData(makeEnvelope({ days: [makeDay({ date: '2030-01-01' })] }))).rejects.toThrow(
            /limit is 10000/i,
        );
        expect(await storedWebDays(web)).toHaveLength(MAX_DAYS);
    });

    it('keeps the web save path working when the day table lookup fails', async () => {
        // The day-count guard looks its table up defensively, the same way the metadata table is:
        // a runtime where Dexie cannot enumerate its tables (private mode, a quota fault, a
        // storage-less harness) must fall through to the plain write rather than fail a save.
        const web = await importWebStorage();
        (web.db.tables as unknown as unknown[]).length = 0;

        await expect(web.saveToNativeStorage('2030-01-01', emptyDayInput())).resolves.toBe(undefined);
        expect((await web.loadFromNativeStorage('2030-01-01'))?.date).toBe('2030-01-01');
    });

    it('refuses a web import that would push the store past the day limit', async () => {
        const web = await importWebStorage();

        await expect(
            web.importAllData(makeEnvelope({ days: [...makeDayRange(0, MAX_DAYS), makeDay({ date: '2030-01-01' })] })),
        ).rejects.toThrow(/invalid array at backup\.days/i);
    });
});

describe('schema versioning and legacy migration', () => {
    it('refuses every schema version this build cannot interpret, without writing', async () => {
        for (const schemaVersion of [0, 2, 999, -1]) {
            await expect(importAllData(makeEnvelope({ schemaVersion }))).rejects.toBeInstanceOf(UnsupportedSchemaError);
        }

        expect(nativeState.fileData).toBeNull();
        expect(quarantineTargets()).toEqual([]);
    });

    it('rejects an import with an unknown conflict policy before it can write', async () => {
        await expect(importAllData(makeEnvelope(), 'merge' as ImportConflictPolicy)).rejects.toThrow(
            /invalid import conflict policy/i,
        );
        expect(nativeState.fileData).toBeNull();
    });

    it('migrates a bare day-array native file instead of quarantining readable data', async () => {
        nativeState.fileData = JSON.stringify([makeDay({ date: '2026-09-25' }), makeDay({ date: '2026-09-24' })]);

        const envelope = await exportBackup();

        expect(envelope.days.map((day) => day.date)).toEqual(['2026-09-24', '2026-09-25']);
        expect(quarantineTargets()).toEqual([]);
        expect(readStoredEnvelope().days.map((day) => day.date)).toEqual(['2026-09-24', '2026-09-25']);
    });

    it('quarantines a native file whose JSON is not a storage shape at all', async () => {
        for (const payload of ['null', '42', '"text"', 'true', '[1,2]']) {
            nativeState.fileData = payload;
            await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved|corrupt/i);
            expect(nativeState.fileData).toBeNull();
        }
    });

    it('carries every reserved section of a legacy native map into the migrated envelope', async () => {
        nativeState.fileData = JSON.stringify({
            '2026-09-25': makeDay(),
            __recurring_subjects: [makeRecurringSubject({ id: 7, name: 'Physics' })],
            __global_todos: [{ id: 1, text: 'legacy todo', completed: false, time: '', reminder: false }],
            __focus_alarms: [{ id: 'legacy-focus', time: '05:30', active: true }],
            __settings: { theme: 'material-dark', adaptiveColor: '#0a0b0c' },
        });

        const envelope = await exportBackup();

        expect(envelope.recurringSubjects[0]?.id).toBe(7);
        expect(envelope.todos[0]?.text).toBe('legacy todo');
        expect(envelope.focusAlarms[0]?.id).toBe('legacy-focus');
        expect(envelope.settings).toEqual({ theme: 'material-dark', adaptiveColor: '#0a0b0c' });
        expect(quarantineTargets()).toEqual([]);
    });

    it('fills every envelope section when a legacy map carries days only', async () => {
        nativeState.fileData = JSON.stringify({ '2026-09-25': { date: '2026-09-25' } });

        await loadFromNativeStorage('2026-09-25');

        const stored = readStoredEnvelope();
        expect(Object.keys(stored).sort()).toEqual([
            'days',
            'exportedAt',
            'focusAlarms',
            // A legacy map records no recency for anything, and the migrated
            // envelope says so explicitly rather than implying a stamp it does not
            // have. An empty object is what every pre-stamp backup normalises to.
            'globalStamps',
            'recurringSubjects',
            'schemaVersion',
            'settings',
            'todos',
        ]);
        expect(stored.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(stored.globalStamps).toEqual({});
        expect(stored.settings).toEqual({ theme: 'light', adaptiveColor: null });
        expect(stored.todos).toEqual([]);
        expect(stored.focusAlarms).toEqual([]);
        expect(stored.recurringSubjects).toEqual([]);
    });
});

describe('legacy day array and map limits', () => {
    it('returns legacy day arrays in date order regardless of file order', () => {
        const days = [
            makeDay({ date: '2026-09-26' }),
            makeDay({ date: '2026-09-24' }),
            makeDay({ date: '2026-09-25' }),
        ];

        expect(validateBackup(days).days.map((day) => day.date)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    });

    it('rejects a legacy map whose stored day does not match its own key', async () => {
        nativeState.fileData = JSON.stringify({ '2026-09-25': { date: '2026-09-26' } });

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/native day key mismatch for 2026-09-25/i);
    });

    it('rejects an unrecognised reserved key in a legacy map', async () => {
        nativeState.fileData = JSON.stringify({ __mystery: [] });

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/unexpected native storage key/i);
    });

    it('accepts a legacy array at the day limit and rejects one entry more', () => {
        expect(validateBackup(makeDayRange(0, MAX_DAYS)).days).toHaveLength(MAX_DAYS);
        expect(() => validateBackup(makeDayRange(0, MAX_DAYS + 1))).toThrow(/invalid array at backup/i);
    });
});

describe('day-limit guard on the write paths', () => {
    it('accepts a backup at exactly the day limit', async () => {
        expect(await importAllData(makeEnvelope({ days: makeDayRange(0, MAX_DAYS) }))).toBe(MAX_DAYS);
        expect((await exportBackup()).days).toHaveLength(MAX_DAYS);
    });

    it('refuses an import that would push the store past the limit the readers enforce', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: makeDayRange(0, MAX_DAYS) }));

        await expect(importAllData(makeEnvelope({ days: [makeDay({ date: '2030-01-01' })] }))).rejects.toThrow(
            /limit is 10000/i,
        );

        expect(quarantineTargets()).toEqual([]);
        expect(readStoredEnvelope().days).toHaveLength(MAX_DAYS);
        expect((await exportBackup()).days).toHaveLength(MAX_DAYS);
    });

    it('refuses a single-day save that would push a full store past the limit', async () => {
        nativeState.fileData = JSON.stringify(makeEnvelope({ days: makeDayRange(0, MAX_DAYS) }));

        await expect(saveToNativeStorage('2030-01-01', emptyDayInput())).rejects.toThrow(/limit is 10000/i);

        expect(quarantineTargets()).toEqual([]);
        expect(readStoredEnvelope().days).toHaveLength(MAX_DAYS);
    });
});

describe('envelope completeness and field rules', () => {
    it('requires every envelope section and refuses unknown ones', () => {
        for (const key of ['exportedAt', 'days', 'recurringSubjects', 'todos', 'focusAlarms', 'settings']) {
            const incomplete = { ...makeEnvelope() } as Record<string, unknown>;
            delete incomplete[key];
            expect(() => validateBackup(incomplete)).toThrow(new RegExp(`missing key ${key}`, 'i'));
        }

        // An unversioned root is a legacy shape candidate, not an envelope: it must be refused
        // rather than silently accepted with a default schema version.
        const unversioned = { ...makeEnvelope() } as Record<string, unknown>;
        Reflect.deleteProperty(unversioned, 'schemaVersion');
        expect(() => validateBackup(unversioned)).toThrow(/unrecognized backup format/i);

        expect(() => validateBackup({ ...makeEnvelope(), extra: 1 })).toThrow(/unexpected key extra/i);
    });

    it('rejects a sparse collection as a persistence error rather than a type error', () => {
        // A hole: the slot exists for `length` but no index owns it.
        const days = new Array(1);
        expect(days).toHaveLength(1);

        expect(() => validateBackup(makeEnvelope({ days }))).toThrow(PersistenceError);
        expect(() => validateBackup(makeEnvelope({ days }))).toThrow(/invalid array at backup\.days/i);
    });

    it('keeps the nested collection bounds inclusive', () => {
        const errors = Array.from({ length: 1000 }, (_value, index) => ({
            id: index + 1,
            question: 'q',
            mistake: 'm',
            correctLogic: 'c',
        }));
        expect(validateBackup(makeEnvelope({ days: [makeDay({ errors })] })).days[0]?.errors).toHaveLength(1000);
        expect(() =>
            validateBackup(
                makeEnvelope({
                    days: [makeDay({ errors: [...errors, { id: 1001, question: '', mistake: '', correctLogic: '' }] })],
                }),
            ),
        ).toThrow(/invalid array/i);

        // The focus list is bounded by what the shared native alarm store can
        // actually hold, not by the generic nested-collection cap: a list past
        // that cannot be armed, and the native reader would refuse the whole
        // payload on the next load.
        const alarms = Array.from({ length: MAX_FOCUS_ALARMS }, (_value, index) => ({
            id: `alarm-${index}`,
            time: '07:00',
            active: false,
        }));
        expect(validateBackup(makeEnvelope({ focusAlarms: alarms })).focusAlarms).toHaveLength(MAX_FOCUS_ALARMS);
        expect(() =>
            validateBackup(
                makeEnvelope({
                    focusAlarms: [...alarms, { id: 'alarm-over-cap', time: '07:00', active: false }],
                }),
            ),
        ).toThrow(/invalid array/i);
    });

    it('enforces the numeric, clock and text rules on the fields it accepts', () => {
        const withSubject = (overrides: Partial<Subject>): BackupEnvelope =>
            makeEnvelope({ days: [makeDay({ subjects: [makeSubject(overrides)] })] });

        expect(withSubject({ planned: '1440', actual: '0.5' }).days[0]?.subjects[0]).toMatchObject({
            planned: '1440',
            actual: '0.5',
        });
        expect(() => validateBackup(withSubject({ planned: '1440.01' }))).toThrow(/invalid minutes/i);
        expect(() => validateBackup(withSubject({ actual: '-1' }))).toThrow(/invalid minutes/i);
        expect(() => validateBackup(withSubject({ actual: '1e3' }))).toThrow(/invalid minutes/i);
        expect(() => validateBackup(withSubject({ actual: 'NaN' }))).toThrow(/invalid minutes/i);

        expect(withSubject({ time: '23:59' }).days[0]?.subjects[0]?.time).toBe('23:59');
        expect(() => validateBackup(withSubject({ time: '24:00' }))).toThrow(/invalid time/i);
        expect(() => validateBackup(withSubject({ time: '7:00' }))).toThrow(/invalid time/i);
        expect(() => validateBackup(withSubject({ time: '07:60' }))).toThrow(/invalid time/i);

        expect(() => validateBackup(withSubject({ kpi: 'y' }))).toThrow(/invalid kpi/i);
        expect(() => validateBackup(withSubject({ kpi: 'YES' }))).toThrow(/invalid string/i);

        expect(withSubject({ name: 'a'.repeat(10_000) }).days[0]?.subjects[0]?.name).toHaveLength(10_000);
        expect(() => validateBackup(withSubject({ name: 'a'.repeat(10_001) }))).toThrow(/invalid string/i);
    });

    it('enforces the recurring template, alarm identity and settings rules', () => {
        expect(() =>
            validateBackup(makeEnvelope({ recurringSubjects: [makeRecurringSubject({ recurringDays: [] })] })),
        ).toThrow(/invalid recurring template/i);
        expect(() =>
            validateBackup(makeEnvelope({ recurringSubjects: [makeRecurringSubject({ recurringDays: [1, 1] })] })),
        ).toThrow(/duplicate recurring day/i);
        expect(() =>
            validateBackup(
                makeEnvelope({
                    recurringSubjects: [makeRecurringSubject({ recurringDays: [0, 1, 2, 3, 4, 5, 6, 0] })],
                }),
            ),
        ).toThrow(/invalid array/i);
        expect(() =>
            validateBackup(
                makeEnvelope({
                    recurringSubjects: [{ ...makeSubject(), recurring: true } as unknown as RecurringSubject],
                }),
            ),
        ).toThrow(/missing recurring days/i);

        expect(
            validateBackup(makeEnvelope({ focusAlarms: [{ id: 'focus.a-1:2_x', time: '06:00', active: true }] }))
                .focusAlarms[0]?.id,
        ).toBe('focus.a-1:2_x');
        expect(() =>
            validateBackup(makeEnvelope({ focusAlarms: [{ id: 'focus alarm', time: '06:00', active: true }] })),
        ).toThrow(/invalid focus alarm id/i);
        expect(() => validateBackup(makeEnvelope({ focusAlarms: [{ id: '', time: '06:00', active: true }] }))).toThrow(
            /invalid string/i,
        );

        expect(() => validateBackup(makeEnvelope({ settings: { theme: 'light', adaptiveColor: '#abc' } }))).toThrow(
            /invalid adaptive color/i,
        );
        expect(() =>
            validateBackup(makeEnvelope({ settings: { theme: 'auto', adaptiveColor: '#ABCDEF' } })),
        ).not.toThrow();
        expect(() =>
            validateBackup(makeEnvelope({ settings: { theme: 'auto' } as unknown as BackupSettings })),
        ).toThrow(/missing key adaptivecolor/i);
    });

    it('rejects calendar dates that do not exist and stamps deterministically', () => {
        for (const date of [
            '2026-02-30',
            '2026-13-01',
            '2026-00-10',
            '2026-01-00',
            '2026-04-31',
            '1900-02-29',
            '0000-01-01',
            '2026-9-25',
            '20260925',
        ]) {
            expect(() => validateBackup(makeEnvelope({ days: [makeDay({ date })] }))).toThrow(/invalid date/i);
        }

        for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
            expect(validateBackup(makeEnvelope({ days: [makeDay({ date })] })).days[0]?.date).toBe(date);
        }
    });

    it('rejects a save for a date that is not a real day, without touching the store', async () => {
        await expect(saveToNativeStorage('2026-02-30', emptyDayInput())).rejects.toThrow(/invalid date/i);
        expect(nativeState.fileData).toBeNull();
        expect(nativeFs.writeFile).not.toHaveBeenCalled();
    });

    it('treats a rolled-over timestamp as invalid and keeps offset forms comparable', () => {
        for (const exportedAt of [
            '2026-02-30T10:00:00.000Z',
            '2026-09-25T24:00:00Z',
            '2026-09-25T10:00:00.000+99:00',
            '2026-09-25T10:00:00.1234Z',
            '2026-09-25 10:00:00Z',
        ]) {
            expect(() => validateBackup(makeEnvelope({ exportedAt }))).toThrow(/invalid timestamp/i);
        }

        expect(validateBackup(makeEnvelope({ exportedAt: '2026-09-25T15:30:00+05:30' })).exportedAt).toBe(
            '2026-09-25T15:30:00+05:30',
        );
        expect(validateBackup(makeEnvelope({ exportedAt: '2026-02-28T23:59:59.999Z' })).exportedAt).toBe(
            '2026-02-28T23:59:59.999Z',
        );
    });

    it('orders conflicting days by instant, not by the text of the timestamp', async () => {
        await importAllData(
            makeEnvelope({ days: [makeDay({ updatedAt: '2026-09-25T10:00:00.000Z', dayRating: 'Current' })] }),
        );

        // The same instant written with an offset: a string comparison would call this newer.
        expect(
            await importAllData(
                makeEnvelope({ days: [makeDay({ updatedAt: '2026-09-25T15:30:00.000+05:30', dayRating: 'Offset' })] }),
            ),
        ).toBe(0);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Current');

        expect(
            await importAllData(
                makeEnvelope({ days: [makeDay({ updatedAt: '2026-09-25T10:00:00.001Z', dayRating: 'Later' })] }),
            ),
        ).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Later');
    });
});

describe('prototype and dangerous keys inside collections', () => {
    const withHiddenProto = <T>(target: T): T => {
        Object.defineProperty(target, '__proto__', { value: { polluted: true }, enumerable: false });
        return target;
    };

    it('rejects a dangerous key on an element of every accepted collection', () => {
        const day = withHiddenProto(makeDay());
        const todo = withHiddenProto({
            id: 1,
            text: 'todo',
            completed: false,
            time: '',
            reminder: false,
        });
        const alarm = withHiddenProto({ id: 'a', time: '06:00', active: true });
        const template = withHiddenProto(makeRecurringSubject({ id: 3 }));

        for (const envelope of [
            makeEnvelope({ days: [day] }),
            makeEnvelope({ todos: [todo] }),
            makeEnvelope({ focusAlarms: [alarm] }),
            makeEnvelope({ recurringSubjects: [template] }),
        ]) {
            expect(() => validateBackup(envelope)).toThrow(/dangerous key/i);
        }

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('rejects a dangerous own property attached to the collection itself', () => {
        const days = [makeDay()];
        Object.defineProperty(days, 'constructor', { value: { prototype: { polluted: true } }, enumerable: false });

        // The key is reported on the array, not on the nested value it points at.
        expect(() => validateBackup(makeEnvelope({ days }))).toThrow(/dangerous key constructor at root\.days$/i);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});

describe('import conflict policy and overlay authority', () => {
    it('leaves globals untouched for a legacy import and for the keep policy', async () => {
        await importAllData(
            makeEnvelope({
                days: [],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                recurringSubjects: [makeRecurringSubject({ id: 1, name: 'Current template' })],
                focusAlarms: [{ id: 'current-alarm', time: '06:00', active: true }],
                settings: { theme: 'dark', adaptiveColor: null },
            }),
        );

        expect(await importAllData([makeDay({ date: '2026-10-01' })])).toBe(1);

        const envelope = await exportBackup();
        expect(envelope.days.map((day) => day.date)).toEqual(['2026-10-01']);
        expect(envelope.todos[0]?.text).toBe('Current todo');
        expect(envelope.recurringSubjects[0]?.name).toBe('Current template');
        expect(envelope.focusAlarms[0]?.id).toBe('current-alarm');
        expect(envelope.settings).toEqual({ theme: 'dark', adaptiveColor: null });
    });

    it('replaces global data as well as days for the replace policy', async () => {
        await importAllData(
            makeEnvelope({
                days: [makeDay({ updatedAt: '2026-09-25T23:00:00.000Z', dayRating: 'Current' })],
                todos: [{ id: 1, text: 'Current todo', completed: false, time: '', reminder: false }],
                settings: { theme: 'dark', adaptiveColor: null },
            }),
        );

        expect(
            await importAllData(
                makeEnvelope({
                    days: [makeDay({ updatedAt: '2026-09-25T01:00:00.000Z', dayRating: 'Incoming' })],
                    todos: [{ id: 2, text: 'Incoming todo', completed: true, time: '', reminder: false }],
                    settings: { theme: 'material-light', adaptiveColor: '#654321' },
                }),
                'replace',
            ),
        ).toBe(1);

        const envelope = await exportBackup();
        expect(envelope.days[0]?.dayRating).toBe('Incoming');
        expect(envelope.todos[0]?.text).toBe('Incoming todo');
        expect(envelope.settings).toEqual({ theme: 'material-light', adaptiveColor: '#654321' });
    });

    it('ignores a stale component overlay once after a restore, then honours it', async () => {
        await importAllData(makeEnvelope({ focusAlarms: [{ id: 'restored-alarm', time: '08:00', active: true }] }));
        localStorage.setItem('focusAlarms', JSON.stringify([{ id: 'component-alarm', time: '09:00', active: false }]));

        expect((await loadFocusAlarms()).map((alarm) => alarm.id)).toEqual(['restored-alarm']);
        expect((await loadFocusAlarms()).map((alarm) => alarm.id)).toEqual(['component-alarm']);
    });

    it('keeps the canonical focus list when the component clears its own', async () => {
        await importAllData(makeEnvelope({ focusAlarms: [{ id: 'restored-alarm', time: '08:00', active: true }] }));
        localStorage.setItem('focusAlarms', '[]');

        expect((await loadFocusAlarms()).map((alarm) => alarm.id)).toEqual(['restored-alarm']);
    });

    it('round-trips todos, recurring templates and focus alarms through the mirror keys', async () => {
        await saveGlobalTodos([{ id: 5, text: 'Mirror todo', completed: false, time: '21:00', reminder: true }]);
        await saveRecurringSubjects([makeRecurringSubject({ id: 6, recurringDays: [0, 6] })]);
        await saveFocusAlarms([{ id: 'mirror-alarm', time: '06:45', active: true, nativeId: 2_147_483_647 }]);

        expect(JSON.parse(localStorage.getItem('__global_todos') ?? 'null')).toEqual([
            { id: 5, text: 'Mirror todo', completed: false, time: '21:00', reminder: true },
        ]);
        expect(await loadGlobalTodos()).toEqual([
            { id: 5, text: 'Mirror todo', completed: false, time: '21:00', reminder: true },
        ]);
        expect((await loadRecurringSubjects())[0]?.recurringDays).toEqual([0, 6]);
        expect((await loadFocusAlarms())[0]?.nativeId).toBe(2_147_483_647);
    });
});

describe('storage fault isolation', () => {
    it('commits a settings save even when the mirror cannot be cleaned', async () => {
        await importAllData(makeEnvelope());
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });

        await expect(saveSettings({ theme: 'dark', adaptiveColor: null })).resolves.toBe(true);
        expect(readStoredEnvelope().settings).toEqual({ theme: 'dark', adaptiveColor: null });
    });

    it('reports a corrupt app-owned mirror key instead of treating it as corrupt canonical data', async () => {
        localStorage.setItem('__global_todos', '{not-json');

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(
            /invalid json in local storage key __global_todos/i,
        );
        expect(quarantineTargets()).toEqual([]);
        expect(nativeState.fileData).toBeNull();
    });

    it('reads an absent store as empty when localStorage is unusable', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('storage is disabled', 'SecurityError');
        });

        expect(await loadFromNativeStorage('2026-09-25')).toBeNull();
        expect(nativeFs.writeFile).not.toHaveBeenCalled();
        expect(quarantineTargets()).toEqual([]);
    });

    it('keeps the corrupt file content when it quarantines', async () => {
        nativeState.fileData = '{"schemaVersion":1,"exportedAt":"nope"}';

        await expect(loadFromNativeStorage('2026-09-25')).rejects.toThrow(/preserved/i);
        expect([...nativeState.preserved.values()]).toEqual(['{"schemaVersion":1,"exportedAt":"nope"}']);
    });
});

describe('file import reading', () => {
    it('imports through the FileReader fallback when the file has no text() method', async () => {
        const file = new File(
            [JSON.stringify(makeEnvelope({ days: [makeDay({ dayRating: 'Reader' })] }))],
            'backup.json',
            { type: 'application/json' },
        );
        Object.defineProperty(file, 'text', { value: undefined, configurable: true });

        expect(await handleFileImport(file)).toBe(1);
        expect((await loadFromNativeStorage('2026-09-25'))?.dayRating).toBe('Reader');
    });

    it('surfaces a FileReader failure instead of importing nothing as a success', async () => {
        class BrokenReader {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            onabort: (() => void) | null = null;
            readAsText(): void {
                this.onerror?.();
            }
        }
        vi.stubGlobal('FileReader', BrokenReader);

        try {
            const file = new File(['{}'], 'backup.json');
            Object.defineProperty(file, 'text', { value: undefined, configurable: true });

            await expect(handleFileImport(file)).rejects.toThrow(/failed to read file/i);
            expect(nativeState.fileData).toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('exports only the stored days through the days-only helper', async () => {
        await importAllData(makeEnvelope({ days: [makeDay({ date: '2026-09-24' }), makeDay({ date: '2026-09-26' })] }));

        const days = await exportAllData();
        expect(days.map((day) => day.date)).toEqual(['2026-09-24', '2026-09-26']);
    });
});
