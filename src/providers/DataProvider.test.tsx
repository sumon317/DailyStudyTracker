import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_IMPORTED_EVENT } from '../services/dataImportEvents';
import { TestWrapper } from '../test/test-utils';
import type { DayData, Subject, Todo } from '../types';
import { addLocalDays, getTodayLocalDate, parseLocalDate } from '../utils/dateUtils';
import { useData } from './DataProvider';

// Mock dependencies BEFORE importing the provider
const mockGeneratePDF = vi.hoisted(() => vi.fn());
const mockGenerateMarkdown = vi.hoisted(() => vi.fn());
const mockUpdateWidget = vi.hoisted(() => vi.fn());
const mockSaveToNativeStorage = vi.fn().mockResolvedValue(undefined);
const mockLoadFromNativeStorage = vi.fn().mockResolvedValue(null);
const mockLoadGlobalTodos = vi.fn().mockResolvedValue([]);
const mockSaveGlobalTodos = vi.fn().mockResolvedValue(undefined);
const mockLoadRecurringSubjects = vi.fn().mockResolvedValue([]);
const mockSaveRecurringSubjects = vi.fn().mockResolvedValue(undefined);
const mockDownloadBackup = vi.fn().mockResolvedValue(0);
const mockHandleFileImport = vi.fn().mockResolvedValue(null);
const makeDay = (date: string, name: string): DayData => ({
    date,
    updatedAt: '2026-09-25T10:00:00.000Z',
    subjects: [
        {
            id: 1,
            name,
            planned: '60',
            actual: '30',
            kpi: 'N',
            time: '',
            reminder: false,
        },
    ],
    checklistItems: [],
    qualityChecks: [],
    dayRating: '',
    errors: [],
});
const makeSubject = (overrides: Partial<Subject> = {}): Subject => ({
    id: 1,
    name: 'Accounts',
    planned: '60',
    actual: '0',
    kpi: 'N',
    time: '',
    reminder: false,
    ...overrides,
});
/** * Every "switch to another day" test has to name a day that is *not* today, or the provider's * same-day short circuit turns the switch into a no-op and the test silently stops testing it. * These helpers are derived from the clock so the suite never depends on the day it runs. */ const dayFromToday =
    (offset: number): string => addLocalDays(getTodayLocalDate(), offset) ?? getTodayLocalDate();
/** The next date strictly after today that falls on `weekday`, for recurring-template tests. */ const dayWithWeekday =
    (weekday: number): string => {
        const today = parseLocalDate(getTodayLocalDate());
        const distance = today === null ? 1 : (weekday - today.getDay() + 7) % 7;
        return dayFromToday(distance === 0 ? 7 : distance);
    };
/** * `waitFor` polls the real clock, so it cannot be used while fake timers are installed. The * startup reads are plain promise chains, so draining microtasks is enough - and the bound * turns a genuine hang into a readable failure instead of a 5s timeout. */ const settleMicrotasks =
    async (isReady: () => boolean, bound = 25): Promise<void> => {
        for (let turn = 0; turn < bound && !isReady(); turn += 1) {
            await act(async () => {
                await Promise.resolve();
            });
        }
        expect(isReady()).toBe(true);
    };
/** * Renders the provider and waits for its startup read to finish. * * `DataProvider` adopts the stored day, the todo list and the recurring * templates through a promise chain that begins on mount, so a test that reads * the context while that chain is still in flight sees a half-built value: the * subjects, todos and dirty flag it asserts on are the pre-load defaults, and * the update that eventually replaces them lands between the assertion and the * test's teardown - outside any `act` scope, which React reports as a * "not wrapped in act" warning that has nothing to do with what is being * asserted. Waiting for `isInitialized` makes the value under test the one the * app actually renders. */ const renderDataProvider =
    async () => {
        const view = renderHook(() => useData(), {
            wrapper: TestWrapper,
        });
        await settleMicrotasks(() => view.result.current.isInitialized);
        return view;
    };
/** * Renders the provider *without* waiting for its startup read. * * A few tests are about the window in which that read is in flight - an edit * typed during it, a day it must not overwrite, a read that lands after an * import. Waiting for `isInitialized` would resolve exactly the state those * tests set up, so they render first and drive the deferred read themselves. */ const renderDataProviderWithPendingStartup =
    () =>
        renderHook(() => useData(), {
            wrapper: TestWrapper,
        });
const lastDayPayload = (): {
    subjects: Subject[];
} => {
    const calls = mockSaveToNativeStorage.mock.calls;
    return (calls[calls.length - 1]?.[1] ?? {
        subjects: [],
    }) as {
        subjects: Subject[];
    };
};
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {
        promise,
        resolve,
        reject,
    };
};
vi.mock('../services/export/pdfGenerator', () => ({
    generatePDF: mockGeneratePDF,
}));
vi.mock('../services/export/markdownGenerator', () => ({
    generateMarkdown: mockGenerateMarkdown,
}));
vi.mock('../services/storage', () => ({
    get loadFromNativeStorage() {
        return mockLoadFromNativeStorage;
    },
    get saveToNativeStorage() {
        return mockSaveToNativeStorage;
    },
    get loadGlobalTodos() {
        return mockLoadGlobalTodos;
    },
    get saveGlobalTodos() {
        return mockSaveGlobalTodos;
    },
    get loadRecurringSubjects() {
        return mockLoadRecurringSubjects;
    },
    get saveRecurringSubjects() {
        return mockSaveRecurringSubjects;
    },
    get downloadBackup() {
        return mockDownloadBackup;
    },
    get handleFileImport() {
        return mockHandleFileImport;
    },
    get exportAllData() {
        return vi.fn().mockResolvedValue([]);
    },
}));
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false),
    },
}));
vi.mock('../services/notificationService', () => ({
    NotificationService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        initListeners: vi.fn(),
        checkExactAlarmPermission: vi.fn().mockResolvedValue(true),
        openExactAlarmSettings: vi.fn(),
    },
}));
vi.mock('../services/widgetService', () => ({
    updateWidget: mockUpdateWidget,
    // The widget renders the stored day only when it is today, so the provider is
    // responsible for never publishing another one. `publishAll` opens that gate
    // for the one test that has to observe a *missing* publication - there, the
    // service's own policy would hide the provider's decision.
    shouldPublishWidget: (date: string) => mockToday.publishAll || date === mockToday.value,
}));
const mockToday = vi.hoisted(() => ({
    value: '',
    publishAll: false,
}));
describe('DataProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockToday.value = getTodayLocalDate();
        mockToday.publishAll = false;
        mockLoadFromNativeStorage.mockResolvedValue(null);
        mockLoadGlobalTodos.mockResolvedValue([]);
        mockLoadRecurringSubjects.mockResolvedValue([]);
        mockSaveToNativeStorage.mockResolvedValue(undefined);
        mockSaveGlobalTodos.mockResolvedValue(true);
        mockSaveRecurringSubjects.mockResolvedValue(true);
        mockDownloadBackup.mockResolvedValue(0);
        mockHandleFileImport.mockResolvedValue(0);
        mockGeneratePDF.mockResolvedValue(undefined);
        mockGenerateMarkdown.mockResolvedValue(undefined);
        mockUpdateWidget.mockResolvedValue(undefined);
    });
    describe('initial state', () => {
        it('provides default subjects', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.subjects).toHaveLength(1);
            expect(result.current.subjects[0]?.name).toBe('New Subject');
        });
        it('provides default checklist items', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.checklistItems).toHaveLength(1);
            expect(result.current.checklistItems[0]?.label).toBe('Add your first checklist item here...');
        });
        it('provides default quality checks', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.qualityChecks).toHaveLength(1);
        });
        it('provides default errors', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.errors).toHaveLength(1);
        });
        it('starts with empty todos', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.todos).toEqual([]);
        });
        it('starts with empty day rating', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.dayRating).toBe('');
        });
        it('starts with no unsaved changes', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('starts with today date', async () => {
            const { result } = await renderDataProvider();
            expect(result.current.date).toBe(getTodayLocalDate());
        });
    });
    describe('state updates', () => {
        it('updates subjects and marks unsaved', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setSubjects([
                    {
                        id: 1,
                        name: 'Math',
                        planned: '60',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            expect(result.current.subjects[0]?.name).toBe('Math');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('updates checklist items and marks unsaved', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setChecklistItems([
                    {
                        id: 1,
                        label: 'New item',
                        checked: false,
                    },
                ]);
            });
            expect(result.current.checklistItems[0]?.label).toBe('New item');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('updates day rating and marks unsaved', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setDayRating('Productive');
            });
            expect(result.current.dayRating).toBe('Productive');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('updates errors and marks unsaved', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setErrors([
                    {
                        id: 1,
                        question: 'Q',
                        mistake: 'M',
                        correctLogic: 'C',
                    },
                ]);
            });
            expect(result.current.errors).toHaveLength(1);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('updates todos and marks unsaved', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setTodos([
                    {
                        id: 1,
                        text: 'Task',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            expect(result.current.todos).toHaveLength(1);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
    });
    describe('persistence coordination', () => {
        it('does not save the empty todo state during startup', async () => {
            await renderDataProvider();
            await waitFor(() => expect(mockLoadGlobalTodos).toHaveBeenCalled());
            expect(mockSaveGlobalTodos).not.toHaveBeenCalled();
        });
        it('flushes the dirty day before backup and passes the selected date to the widget', async () => {
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setSubjects([
                    {
                        id: 1,
                        name: 'Before backup',
                        planned: '60',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.exportData();
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalled();
            expect(mockDownloadBackup).toHaveBeenCalled();
            expect(mockUpdateWidget).toHaveBeenCalledWith(expect.any(Array), result.current.date);
        });
        it('does not reload an already initialized date', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            const initialLoadCount = mockLoadFromNativeStorage.mock.calls.length;
            await act(async () => {
                await result.current.setDate(result.current.date);
            });
            expect(mockLoadFromNativeStorage).toHaveBeenCalledTimes(initialLoadCount);
            expect(result.current.loadedDate).toBe(result.current.date);
        });
        it('returns the number of day records applied by an import', async () => {
            mockHandleFileImport.mockResolvedValueOnce(2);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await result.current.importData(
                    new File(['{}'], 'backup.json', {
                        type: 'application/json',
                    }),
                );
            });
            expect(appliedDays).toBe(2);
        });
        it('ignores a stale date load after a newer load completes', async () => {
            const firstDay = dayFromToday(-2);
            const secondDay = dayFromToday(-1);
            const firstLoad = deferred<DayData | null>();
            const secondLoad = deferred<DayData | null>();
            mockLoadFromNativeStorage.mockImplementation((targetDate: string) => {
                if (targetDate === firstDay) {
                    return firstLoad.promise;
                }
                if (targetDate === secondDay) {
                    return secondLoad.promise;
                }
                return Promise.resolve(null);
            });
            const { result } = await renderDataProvider();
            await waitFor(() => expect(mockLoadFromNativeStorage).toHaveBeenCalled());
            let firstRequest: Promise<void> = Promise.resolve();
            let secondRequest: Promise<void> = Promise.resolve();
            await act(async () => {
                firstRequest = result.current.loadDataForDate(firstDay);
                secondRequest = result.current.loadDataForDate(secondDay);
                secondLoad.resolve(makeDay(secondDay, 'Newer'));
                await secondRequest;
                firstLoad.resolve(makeDay(firstDay, 'Older'));
                await firstRequest;
            });
            expect(result.current.subjects[0]?.name).toBe('Newer');
            expect(result.current.loadedDate).toBe(secondDay);
        });
        it('keeps a newer revision dirty until its serialized save completes', async () => {
            const firstSave = deferred<void>();
            mockSaveToNativeStorage.mockImplementationOnce(() => firstSave.promise).mockResolvedValue(undefined);
            const { result } = await renderDataProvider();
            act(() => {
                result.current.setSubjects([
                    {
                        id: 1,
                        name: 'First revision',
                        planned: '60',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            let firstRequest: Promise<void> = Promise.resolve();
            await act(async () => {
                firstRequest = result.current.saveData();
                await waitFor(() => expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1));
            });
            act(() => {
                result.current.setSubjects([
                    {
                        id: 1,
                        name: 'Second revision',
                        planned: '60',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            const secondRequest = result.current.saveData();
            expect(result.current.hasUnsavedChanges).toBe(true);
            await act(async () => {
                firstSave.resolve();
                await firstRequest;
                await waitFor(() => expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(2));
                await secondRequest;
            });
            const lastPayload = mockSaveToNativeStorage.mock.calls[
                mockSaveToNativeStorage.mock.calls.length - 1
            ]?.[1] as {
                subjects: Array<{
                    name: string;
                }>;
            };
            expect(lastPayload.subjects[0]?.name).toBe('Second revision');
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('applies matching recurring templates without duplicate mutable records', async () => {
            const template = {
                id: 77,
                name: 'Economics',
                planned: '45',
                actual: '45',
                kpi: 'Y',
                time: '08:00',
                reminder: true,
                recurring: true as const,
                recurringDays: [1],
            };
            const templateDay = dayWithWeekday(1);
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(mockLoadRecurringSubjects).toHaveBeenCalled());
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            expect(result.current.subjects.filter((subject) => subject.id === template.id)).toHaveLength(1);
            expect(result.current.subjects.find((subject) => subject.id === template.id)).toMatchObject({
                actual: '0',
                kpi: 'N',
                reminder: false,
            });
            mockSaveRecurringSubjects.mockClear();
            act(() => {
                result.current.setSubjects((previous) => [
                    ...previous,
                    {
                        id: 78,
                        name: 'One-off task',
                        planned: '15',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveRecurringSubjects).not.toHaveBeenCalled();
            result.current.subjects.find((subject) => subject.id === template.id)?.recurringDays?.push(3);
            expect(template.recurringDays).toEqual([1]);
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            expect(result.current.subjects.filter((subject) => subject.id === template.id)).toHaveLength(1);
        });
        it('propagates asynchronous PDF and Markdown failures', async () => {
            const { result } = await renderDataProvider();
            const pdfError = new Error('PDF failed');
            const markdownError = new Error('Markdown failed');
            mockGeneratePDF.mockRejectedValueOnce(pdfError);
            mockGenerateMarkdown.mockRejectedValueOnce(markdownError);
            await expect(result.current.downloadPDF()).rejects.toBe(pdfError);
            await expect(result.current.downloadMD()).rejects.toBe(markdownError);
        });
    });
    describe('widget publication', () => {
        it('refreshes the widget after loading a day without requiring an edit', async () => {
            const today = getTodayLocalDate();
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === today ? makeDay(today, 'Loaded subject') : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockUpdateWidget.mockClear();
            await act(async () => {
                await result.current.loadDataForDate(today);
            });
            expect(mockUpdateWidget).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'Loaded subject',
                    }),
                ]),
                today,
            );
        });
        it('never publishes a non-today record, which would blank the today-only widget', async () => {
            const pastDate = '2020-01-02';
            expect(getTodayLocalDate()).not.toBe(pastDate);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === pastDate ? makeDay(pastDate, 'Past subject') : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockUpdateWidget.mockClear();
            await act(async () => {
                await result.current.loadDataForDate(pastDate);
            });
            act(() => {
                result.current.setSubjects([
                    {
                        id: 9,
                        name: 'Edited past subject',
                        planned: '10',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledWith(
                pastDate,
                expect.objectContaining({
                    subjects: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'Edited past subject',
                        }),
                    ]),
                }),
            );
            expect(mockUpdateWidget).not.toHaveBeenCalled();
        });
    });
    describe('date and payload synchronisation', () => {
        it('keeps the selected date and the loaded payload in lockstep', async () => {
            const otherDay = dayFromToday(3);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === otherDay ? makeDay(otherDay, 'Other day') : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(otherDay);
            });
            expect(result.current.date).toBe(otherDay);
            expect(result.current.subjects[0]?.name).toBe('Other day');
            act(() => {
                result.current.setSubjects([
                    {
                        id: 4,
                        name: 'Edited other day',
                        planned: '10',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).toHaveBeenLastCalledWith(
                otherDay,
                expect.objectContaining({
                    subjects: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'Edited other day',
                        }),
                    ]),
                }),
            );
        });
        it('flushes pending edits under the previous date before switching', async () => {
            const nextDay = dayFromToday(2);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockSaveToNativeStorage.mockClear();
            act(() => {
                result.current.setSubjects([
                    {
                        id: 5,
                        name: 'Saved before switch',
                        planned: '10',
                        actual: '0',
                        kpi: 'N',
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.loadDataForDate(nextDay);
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1);
            expect(mockSaveToNativeStorage.mock.calls[0]?.[0]).toBe(getTodayLocalDate());
            expect(result.current.date).toBe(nextDay);
            expect(result.current.loadedDate).toBe(nextDay);
        });
        it('never writes an edit typed during a switch under the incoming date', async () => {
            const nextDay = dayFromToday(4);
            const slowLoad = deferred<DayData | null>();
            // Publication is opened for any day so that a *missing* call can be
            // observed: with the service's own policy in place, no publication at
            // all would look identical to the provider refusing to make one.
            mockToday.publishAll = true;
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === nextDay ? slowLoad.promise : makeDay(targetDate, 'Outgoing day'),
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockSaveToNativeStorage.mockClear();
            mockUpdateWidget.mockClear();
            let switchRequest: Promise<void> = Promise.resolve();
            await act(async () => {
                switchRequest = result.current.loadDataForDate(nextDay);
                await Promise.resolve();
            });
            // The payload still belongs to the outgoing day, so the save must not run at all
            // rather than persist those rows against the date that was just selected.
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Typed mid-switch',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
            // The store never received those rows, so the widget must not show them either.
            expect(mockUpdateWidget).not.toHaveBeenCalled();
            await act(async () => {
                slowLoad.resolve(makeDay(nextDay, 'Incoming day'));
                await switchRequest;
            });
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
            expect(result.current.date).toBe(nextDay);
            expect(result.current.loadedDate).toBe(nextDay);
            expect(result.current.subjects[0]?.name).toBe('Incoming day');
            // Publication resumes with the adopted payload, so the widget tracks the
            // day the store actually holds.
            expect(mockUpdateWidget).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'Incoming day',
                    }),
                ]),
                nextDay,
            );
        });
        it('rejects an invalid date without mutating the selection', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await expect(result.current.loadDataForDate('2026-02-30')).rejects.toThrow(/Invalid date/);
            expect(result.current.date).toBe(getTodayLocalDate());
        });
        it('refuses a stored record that names another day instead of adopting or overwriting it', async () => {
            // A record filed under one day that claims another breaks the invariant the whole
            // provider rests on: the payload is expected to describe the selected day, and a
            // save keys its write on that day. Adopting it would show a day the app believes it
            // loaded, and the next edit would write over data the app never showed.
            const otherDay = dayFromToday(1);
            const mislabelled = { ...makeDay(otherDay, 'Mislabelled'), date: dayFromToday(2) };
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === otherDay ? mislabelled : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockSaveToNativeStorage.mockClear();
            await act(async () => {
                await expect(result.current.loadDataForDate(otherDay)).rejects.toThrow(/does not describe/);
            });
            expect(result.current.date).toBe(getTodayLocalDate());
            expect(result.current.loadedDate).toBe(getTodayLocalDate());
            // Nothing was written, so the record is still exactly as the store held it.
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
        });
    });
    describe('save failure handling', () => {
        it('propagates a failed save to a caller that waited on the same flush', async () => {
            const firstSave = deferred<void>();
            mockSaveToNativeStorage.mockImplementationOnce(() => firstSave.promise).mockResolvedValue(undefined);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'First revision',
                    }),
                ]);
            });
            let first: Promise<void> = Promise.resolve();
            let second: Promise<void> = Promise.resolve();
            await act(async () => {
                first = result.current.saveData();
                // The second save has to be issued after the first one has actually
                // reached the store, or both callers join the same flush and only
                // one of them ever sees the rejection. Draining microtasks inside
                // `act` is what waits for that without `waitFor` - which switches
                // the act environment off for the whole of its own poll, and
                // cannot run inside a scope that is already open.
                await settleMicrotasks(() => mockSaveToNativeStorage.mock.calls.length >= 1);
                second = result.current.saveData();
                firstSave.reject(new Error('Disk full'));
                await expect(first).rejects.toThrow('Disk full');
            });
            // The waiting caller must not report a clean save: it retries the still-dirty data.
            await act(async () => {
                await second;
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(2);
            expect(lastDayPayload().subjects[0]?.name).toBe('First revision');
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('keeps the day dirty after a failed lifecycle flush and recovers on a later save', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full'));
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Retry me',
                    }),
                ]);
            });
            await act(async () => {
                window.dispatchEvent(new Event('pagehide'));
            });
            window.removeEventListener('study-data-error', onError);
            expect(onError).toHaveBeenCalledTimes(1);
            expect(result.current.hasUnsavedChanges).toBe(true);
            expect(result.current.isSaving).toBe(false);
            await act(async () => {
                await result.current.saveData();
            });
            expect(result.current.hasUnsavedChanges).toBe(false);
            expect(result.current.lastSaved).not.toBeNull();
        });
        it('does not switch dates when the pending edit cannot be saved', async () => {
            mockSaveToNativeStorage.mockRejectedValue(new Error('Disk full'));
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Unsaved',
                    }),
                ]);
            });
            await act(async () => {
                await expect(result.current.setDate(dayFromToday(2))).rejects.toThrow('Disk full');
            });
            expect(result.current.date).toBe(getTodayLocalDate());
            expect(result.current.subjects[0]?.name).toBe('Unsaved');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('keeps the day dirty when only the template write fails, and recovers on the next save', async () => {
            mockSaveRecurringSubjects.mockRejectedValueOnce(new Error('Template store offline'));
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        id: 3,
                        recurring: true,
                        recurringDays: [2],
                    }),
                ]);
            });
            await act(async () => {
                await expect(result.current.saveData()).rejects.toThrow('Template store offline');
            });
            // The day write already committed, but reporting the day as saved would be a lie:
            // the next save has to carry the template again.
            expect(result.current.hasUnsavedChanges).toBe(true);
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveRecurringSubjects).toHaveBeenLastCalledWith([
                expect.objectContaining({
                    id: 3,
                    recurring: true,
                    recurringDays: [2],
                }),
            ]);
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('rolls the selection back when the incoming day cannot be loaded', async () => {
            const keptDay = dayFromToday(2);
            const failingDay = dayFromToday(3);
            let failingDate: string | null = null;
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) => {
                if (targetDate === failingDate) {
                    throw new Error('Read failed');
                }
                return targetDate === keptDay ? makeDay(keptDay, 'Kept day') : null;
            });
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.setDate(keptDay);
            });
            expect(result.current.loadedDate).toBe(keptDay);
            failingDate = failingDay;
            await act(async () => {
                await expect(result.current.setDate(failingDay)).rejects.toThrow('Read failed');
            });
            // Leaving the new date selected while the payload still belongs to the old day
            // would let the next save overwrite the wrong record.
            expect(result.current.date).toBe(keptDay);
            expect(result.current.loadedDate).toBe(keptDay);
            expect(result.current.subjects[0]?.name).toBe('Kept day');
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'After rollback',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).toHaveBeenLastCalledWith(keptDay, expect.anything());
        });
        it('rejects an invalid date through setDate without changing the selection', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await expect(result.current.setDate('2026-02-30')).rejects.toThrow(/Invalid date/);
            expect(result.current.date).toBe(getTodayLocalDate());
            expect(result.current.loadedDate).toBe(getTodayLocalDate());
        });
    });
    describe('separate day and todo persistence', () => {
        it('writes only the todo list when only todos changed', async () => {
            const todo = {
                id: 1,
                text: 'Task',
                completed: false,
                time: '',
                reminder: false,
            };
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setTodos([todo]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
            expect(mockSaveRecurringSubjects).not.toHaveBeenCalled();
            expect(mockSaveGlobalTodos).toHaveBeenCalledWith([todo]);
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('writes only the day when only the day changed', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Day only',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1);
            expect(mockSaveGlobalTodos).not.toHaveBeenCalled();
        });
    });
    describe('recurring templates', () => {
        const template = {
            id: 77,
            name: 'Economics',
            planned: '45',
            actual: '0',
            kpi: 'N',
            time: '08:00',
            reminder: false,
            recurring: true as const,
            recurringDays: [1],
        };
        it('deletes a template once its subject stops repeating', async () => {
            const templateDay = dayWithWeekday(1);
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            expect(result.current.subjects.filter((subject) => subject.id === 77)).toHaveLength(1);
            act(() => {
                result.current.setSubjects((previous) =>
                    previous.map((subject) =>
                        subject.id === 77 ? { ...subject, recurring: false, recurringDays: [] } : subject,
                    ),
                );
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveRecurringSubjects).toHaveBeenCalledTimes(1);
            expect(mockSaveRecurringSubjects).toHaveBeenCalledWith([]);
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('keeps a template intact when it only appears in an untouched subject', async () => {
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(dayWithWeekday(1));
            });
            act(() => {
                result.current.setSubjects((previous) => [
                    ...previous,
                    makeSubject({
                        id: 5,
                        name: 'One-off',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveRecurringSubjects).not.toHaveBeenCalled();
        });
        it('carries a template that the loaded day never showed into the next save', async () => {
            // The template only repeats on Monday, so loading a Tuesday day leaves it stored
            // but untouched. An edit on that day must not be read as "the user stopped it".
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            const awayDay = dayWithWeekday(2);
            await act(async () => {
                await result.current.loadDataForDate(awayDay);
            });
            expect(result.current.subjects.some((subject) => subject.id === template.id)).toBe(false);
            act(() => {
                result.current.setSubjects((previous) => [
                    ...previous,
                    makeSubject({
                        id: 9,
                        name: 'Tuesday task',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveRecurringSubjects).not.toHaveBeenCalled();
            expect(mockSaveToNativeStorage).toHaveBeenLastCalledWith(
                awayDay,
                expect.objectContaining({
                    subjects: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'Tuesday task',
                        }),
                    ]),
                }),
            );
        });
        it('normalises recurring days so an un-saveable template is never written', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        id: 3,
                        recurring: true,
                        recurringDays: [1, 1, 3],
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            window.removeEventListener('study-data-error', onError);
            // Storage rejects duplicate days, which would make the whole day record un-writable.
            expect(mockSaveRecurringSubjects).toHaveBeenCalledWith([
                expect.objectContaining({
                    id: 3,
                    recurring: true,
                    recurringDays: [1, 3],
                }),
            ]);
            expect(lastDayPayload().subjects[0]?.recurringDays).toEqual([1, 3]);
            expect(onError).not.toHaveBeenCalled();
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('does not turn a subject with no recurring day into a template', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        id: 4,
                        recurring: true,
                        recurringDays: [],
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            window.removeEventListener('study-data-error', onError);
            // An empty day list is not a valid template: persisting it would fail the whole
            // flush and leave the day and the todo list unsaved.
            expect(mockSaveRecurringSubjects).not.toHaveBeenCalled();
            expect(lastDayPayload().subjects[0]).toMatchObject({
                id: 4,
                recurring: true,
                recurringDays: [],
            });
            expect(onError).not.toHaveBeenCalled();
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('keeps the stored progress of a day that already contains the template', async () => {
            const templateDay = dayWithWeekday(1);
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === templateDay
                    ? { ...makeDay(templateDay, template.name), subjects: [{ ...template, actual: '45' }] }
                    : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            const matches = result.current.subjects.filter((subject) => subject.id === template.id);
            expect(matches).toHaveLength(1);
            expect(matches[0]?.actual).toBe('45');
        });
        it('does not add a template a stored day already tracks under the same name', async () => {
            const templateDay = dayWithWeekday(1);
            const storedSubject = { ...template, id: 401 };
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === templateDay
                    ? { ...makeDay(templateDay, template.name), subjects: [storedSubject] }
                    : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            // Renaming a day subject to match the template must not produce a second row for
            // the same study, whichever id the stored record happens to carry.
            expect(
                result.current.subjects.filter((subject) => subject.name.trim() === template.name.trim()),
            ).toHaveLength(1);
        });
        it('does not add a template a stored day already tracks under a padded name', async () => {
            const templateDay = dayWithWeekday(1);
            const storedSubject = { ...template, id: 402, name: `  ${template.name} ` };
            mockLoadRecurringSubjects.mockResolvedValue([template]);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === templateDay
                    ? { ...makeDay(templateDay, template.name), subjects: [storedSubject] }
                    : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            // Surrounding spaces are the kind of thing a typed name picks up, and the stored
            // row is still the same study, so it must not be duplicated.
            expect(
                result.current.subjects.filter((subject) => subject.name.trim() === template.name.trim()),
            ).toHaveLength(1);
        });
        it('adds one row for two templates that share a name', async () => {
            const templateDay = dayWithWeekday(1);
            // A duplicated subject stores two templates that differ only by id. They describe
            // one study, so the day must not grow a row for each of them.
            mockLoadRecurringSubjects.mockResolvedValue([template, { ...template, id: 78 }]);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.loadDataForDate(templateDay);
            });
            expect(
                result.current.subjects.filter((subject) => subject.name.trim() === template.name.trim()),
            ).toHaveLength(1);
        });
    });
    describe('autosave and lifecycle', () => {
        it('coalesces a burst of edits into a single debounced save', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            vi.useFakeTimers();
            try {
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'One',
                        }),
                    ]);
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Two',
                        }),
                    ]);
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Three',
                        }),
                    ]);
                });
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(1000);
                });
                expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1);
                expect(lastDayPayload().subjects[0]?.name).toBe('Three');
                expect(result.current.hasUnsavedChanges).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
        it('flushes on pagehide, then stops flushing once unmounted', async () => {
            const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
            const { result, unmount } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockSaveToNativeStorage.mockClear();
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Pagehide',
                    }),
                ]);
            });
            await act(async () => {
                window.dispatchEvent(new Event('pagehide'));
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1);
            expect(result.current.hasUnsavedChanges).toBe(false);
            act(() => {
                result.current.setTodos([
                    {
                        id: 1,
                        text: 'Unmount flush',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                unmount();
            });
            expect(clearIntervalSpy).toHaveBeenCalled();
            // The unmount drain covers the edit that the debounce timer never got to fire.
            expect(mockSaveGlobalTodos).toHaveBeenCalledWith([
                {
                    id: 1,
                    text: 'Unmount flush',
                    completed: false,
                    time: '',
                    reminder: false,
                },
            ]);
            mockSaveToNativeStorage.mockClear();
            mockSaveGlobalTodos.mockClear();
            await act(async () => {
                window.dispatchEvent(new Event('pagehide'));
            });
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
            expect(mockSaveGlobalTodos).not.toHaveBeenCalled();
        });
        it('does not republish the widget for a todo-only change', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockUpdateWidget.mockClear();
            act(() => {
                result.current.setTodos([
                    {
                        id: 1,
                        text: 'No widget',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveGlobalTodos).toHaveBeenCalled();
            expect(mockUpdateWidget).not.toHaveBeenCalled();
        });
        it('retries a failed background flush on the next periodic tick', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full'));
            vi.useFakeTimers();
            try {
                // Fake timers are installed before the mount, so the periodic flush is a fake
                // timer too and can be driven deterministically.
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Retry on the interval',
                        }),
                    ]);
                });
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(1000);
                });
                expect(onError).toHaveBeenCalledTimes(1);
                expect(result.current.hasUnsavedChanges).toBe(true);
                expect(result.current.lastSaved).toBeNull();
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(10_000);
                });
                expect(lastDayPayload().subjects[0]?.name).toBe('Retry on the interval');
                expect(result.current.hasUnsavedChanges).toBe(false);
                expect(onError).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
                window.removeEventListener('study-data-error', onError);
            }
        });
        it('reports a failing store once per cooldown, not once per failed flush', async () => {
            // Every background flush that fails reports through the same window event the
            // shell turns into a toast: the debounce, the periodic tick, a pagehide and the
            // unmount drain. Without a cooldown a store that is down for a minute produces a
            // toast per pause in typing.
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockSaveToNativeStorage.mockRejectedValue(new Error('Disk full'));
            vi.useFakeTimers();
            try {
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Never lands',
                        }),
                    ]);
                });
                // The debounced flush fails first, and is reported.
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(1000);
                });
                expect(onError).toHaveBeenCalledTimes(1);
                // Two more failures inside the same window - a lifecycle flush and the
                // periodic tick - are the same fault, not three of them.
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(5000);
                    window.dispatchEvent(new Event('pagehide'));
                });
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(20_000);
                });
                expect(onError).toHaveBeenCalledTimes(1);
                // The window has passed, so the next failure is worth reporting again.
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(10_000);
                    window.dispatchEvent(new Event('pagehide'));
                });
                expect(onError).toHaveBeenCalledTimes(2);
                expect(result.current.hasUnsavedChanges).toBe(true);
            } finally {
                window.removeEventListener('study-data-error', onError);
                vi.useRealTimers();
            }
        });
        it('reports a later failure again once a save has proved the store healthy', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
            vi.useFakeTimers();
            try {
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'First',
                        }),
                    ]);
                });
                await act(async () => {
                    window.dispatchEvent(new Event('pagehide'));
                });
                expect(onError).toHaveBeenCalledTimes(1);
                // The cooldown is open, but the retry lands - which ends the failure episode.
                await act(async () => {
                    await result.current.saveData();
                });
                expect(result.current.hasUnsavedChanges).toBe(false);
                // The *same* fault within the same window is therefore reported, so the
                // cooldown cannot silently mute a store that failed again after recovering.
                mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full'));
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Second',
                        }),
                    ]);
                });
                await act(async () => {
                    window.dispatchEvent(new Event('pagehide'));
                });
                expect(onError).toHaveBeenCalledTimes(2);
                expect(result.current.hasUnsavedChanges).toBe(true);
            } finally {
                window.removeEventListener('study-data-error', onError);
                vi.useRealTimers();
            }
        });
        it('announces a recovery so the shell can re-arm its own window too', async () => {
            // The provider re-armed its event window on a successful write, but the
            // shell keeps a *second*, shorter presentation window and used to
            // re-arm only on data change. It cannot infer recovery from the failure
            // events: it hears that something broke, never that something worked
            // afterwards. So a store that failed, recovered and failed again inside
            // the shell's window was reported as nothing at all.
            const onError = vi.fn();
            const onRecovered = vi.fn();
            window.addEventListener('study-data-error', onError);
            window.addEventListener('study-data-recovered', onRecovered);
            mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
            vi.useFakeTimers();
            try {
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                act(() => {
                    result.current.setSubjects([makeSubject({ name: 'First' })]);
                });
                await act(async () => {
                    window.dispatchEvent(new Event('pagehide'));
                });
                expect(onError).toHaveBeenCalledTimes(1);
                // No failure episode is in progress, so there is nothing to end - and
                // announcing one anyway would clear the shell's window on every
                // successful save, which is exactly the rate limit it provides.
                expect(onRecovered).not.toHaveBeenCalled();

                await act(async () => {
                    await result.current.saveData();
                });
                expect(onRecovered).toHaveBeenCalledTimes(1);
            } finally {
                window.removeEventListener('study-data-error', onError);
                window.removeEventListener('study-data-recovered', onRecovered);
                vi.useRealTimers();
            }
        });
        it('reports a second, different failure inside the same cooldown', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockSaveToNativeStorage.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
            mockSaveRecurringSubjects.mockRejectedValue(new Error('Template store offline'));
            vi.useFakeTimers();
            const reported = () =>
                onError.mock.calls.map((call) => ((call[0] as CustomEvent<unknown>).detail as Error).message);
            try {
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Day fault',
                        }),
                    ]);
                });
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(1000);
                });
                expect(reported()).toEqual(['Disk full']);
                // A different fault, moments later, is not a repeat of the first and is
                // therefore reported immediately however short the window left is.
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            id: 3,
                            recurring: true,
                            recurringDays: [2],
                        }),
                    ]);
                });
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(1000);
                });
                expect(reported()).toEqual(['Disk full', 'Template store offline']);
                // The fault that keeps recurring is announced again once its own window has
                // lapsed, so a cooldown delays a repeat and never silences one.
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(40_000);
                });
                expect(reported()).toEqual(['Disk full', 'Template store offline', 'Template store offline']);
                expect(result.current.hasUnsavedChanges).toBe(true);
            } finally {
                window.removeEventListener('study-data-error', onError);
                vi.useRealTimers();
            }
        });
        it('spends its retry budget on its own writes, not on waiting for another caller', async () => {
            // The first caller's writes keep being re-dirtied from inside the store write, so
            // it can never converge and spends its whole budget. The second caller only ever
            // *joins* those writes; joining is not an attempt, so it must still get to write
            // itself rather than report a save failure for a save that is being made.
            vi.useFakeTimers();
            try {
                const { result } = await renderDataProvider();
                await settleMicrotasks(() => result.current.isInitialized);
                let writes = 0;
                mockSaveToNativeStorage.mockImplementation(async () => {
                    writes += 1;
                    if (writes < 4) {
                        result.current.setSubjects([
                            makeSubject({
                                name: `Re-dirty ${writes}`,
                            }),
                        ]);
                    }
                });
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Starved',
                        }),
                    ]);
                });
                let first: Promise<void> = Promise.resolve();
                let second: Promise<void> = Promise.resolve();
                await act(async () => {
                    first = result.current.saveData();
                    second = result.current.saveData();
                    await first.catch(() => undefined);
                    await second;
                });
                // Three writes from the caller that never converged, one from the caller that
                // only joined them.
                expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(4);
                expect(result.current.hasUnsavedChanges).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
        it('drains a pending day edit through the unmount flush', async () => {
            const { result, unmount } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockSaveToNativeStorage.mockClear();
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Unmount day',
                    }),
                ]);
            });
            // The debounce has not fired yet, so unmounting is the only thing that can land it.
            await act(async () => {
                unmount();
            });
            expect(mockSaveToNativeStorage).toHaveBeenCalledTimes(1);
            expect(mockSaveToNativeStorage.mock.calls[0]?.[0]).toBe(getTodayLocalDate());
            expect(mockSaveToNativeStorage.mock.calls[0]?.[1]).toMatchObject({
                subjects: [
                    expect.objectContaining({
                        name: 'Unmount day',
                    }),
                ],
            });
        });
        it('shows isSaving only while a write is actually in flight', async () => {
            const save = deferred<void>();
            mockSaveToNativeStorage.mockImplementationOnce(() => save.promise).mockResolvedValue(undefined);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'In flight',
                    }),
                ]);
            });
            // `waitFor` has to run outside the act that started the write, or the outer act
            // keeps the `isSaving` update unflushed for the whole poll.
            let request: Promise<void> = Promise.resolve();
            act(() => {
                request = result.current.saveData();
            });
            await waitFor(() => expect(result.current.isSaving).toBe(true));
            await act(async () => {
                save.resolve();
                await request;
            });
            expect(result.current.isSaving).toBe(false);
        });
        it('leaves lastSaved alone when a flush had nothing to write', async () => {
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            await act(async () => {
                await result.current.saveData();
            });
            expect(mockSaveToNativeStorage).not.toHaveBeenCalled();
            expect(result.current.lastSaved).toBeNull();
        });
        it('settles three concurrent saves on the latest revision without losing it', async () => {
            const firstSave = deferred<void>();
            mockSaveToNativeStorage.mockImplementationOnce(() => firstSave.promise).mockResolvedValue(undefined);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Revision one',
                    }),
                ]);
            });
            await act(async () => {
                const first = result.current.saveData();
                // The edit below has to be typed after the first write reached the
                // store, or all three callers join one flush and "the latest
                // revision wins" is never exercised. Microtask drains inside `act`
                // wait for that without the act-environment switch `waitFor` needs.
                await settleMicrotasks(() => mockSaveToNativeStorage.mock.calls.length >= 1);
                act(() => {
                    result.current.setSubjects([
                        makeSubject({
                            name: 'Revision two',
                        }),
                    ]);
                });
                const second = result.current.saveData();
                const third = result.current.saveData();
                await act(async () => {
                    firstSave.resolve();
                });
                await first;
                await second;
                await third;
            });
            expect(mockSaveToNativeStorage.mock.calls.length).toBeLessThanOrEqual(3);
            expect(lastDayPayload().subjects[0]?.name).toBe('Revision two');
            expect(result.current.hasUnsavedChanges).toBe(false);
            expect(result.current.isSaving).toBe(false);
        });
    });
    describe('startup state', () => {
        it('keeps a todo edit made while the initial todo read is in flight', async () => {
            const storedTodos =
                deferred<
                    Array<{
                        id: number;
                        text: string;
                        completed: boolean;
                    }>
                >();
            mockLoadGlobalTodos.mockImplementationOnce(() => storedTodos.promise as never);
            const { result } = renderDataProviderWithPendingStartup();
            act(() => {
                result.current.setTodos([
                    {
                        id: 5,
                        text: 'Typed early',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            storedTodos.resolve([
                {
                    id: 9,
                    text: 'Stored',
                    completed: false,
                    time: '',
                    reminder: false,
                },
            ] as never);
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            expect(result.current.todos.map((todo) => todo.text)).toEqual(['Typed early']);
        });
        it('does not replace a day edited while the initial read is in flight, and marks it unloaded', async () => {
            const storedDay = deferred<DayData | null>();
            mockLoadFromNativeStorage.mockImplementation(() => storedDay.promise);
            const { result } = renderDataProviderWithPendingStartup();
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Typed during startup',
                    }),
                ]);
            });
            storedDay.resolve(makeDay(getTodayLocalDate(), 'Stored subject'));
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            expect(result.current.subjects[0]?.name).toBe('Typed during startup');
            expect(result.current.loadedDate).toBeNull();
            // Re-selecting the same day is the documented recovery path for a skipped load.
            await act(async () => {
                await result.current.setDate(getTodayLocalDate());
            });
            expect(result.current.loadedDate).toBe(getTodayLocalDate());
            expect(result.current.subjects[0]?.name).toBe('Stored subject');
        });
        it('still persists a day edit made before the first read resolved', async () => {
            const storedDay = deferred<DayData | null>();
            mockLoadFromNativeStorage.mockImplementation(() => storedDay.promise);
            const { result } = renderDataProviderWithPendingStartup();
            act(() => {
                result.current.setSubjects([
                    makeSubject({
                        name: 'Typed before the first read',
                    }),
                ]);
            });
            await act(async () => {
                await result.current.saveData();
            });
            storedDay.resolve(null);
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            // Refusing the load already decided the in-memory edit outranks the stored record,
            // so the save must be allowed to land rather than leaving the edit unwritable.
            expect(mockSaveToNativeStorage).toHaveBeenCalledWith(
                getTodayLocalDate(),
                expect.objectContaining({
                    subjects: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'Typed before the first read',
                        }),
                    ]),
                }),
            );
        });
        it('reports a failing startup day read and still initialises', async () => {
            const onError = vi.fn();
            window.addEventListener('study-data-error', onError);
            mockLoadFromNativeStorage.mockRejectedValue(new Error('Store unavailable'));
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            window.removeEventListener('study-data-error', onError);
            expect(onError).toHaveBeenCalledTimes(1);
            expect(result.current.loadedDate).toBeNull();
            expect(result.current.date).toBe(getTodayLocalDate());
        });
    });
    describe('import reload', () => {
        it('reloads the imported day and todo list', async () => {
            mockHandleFileImport.mockResolvedValueOnce(1);
            mockLoadGlobalTodos.mockResolvedValueOnce([]).mockResolvedValue([
                {
                    id: 42,
                    text: 'Imported todo',
                    completed: false,
                    time: '',
                    reminder: false,
                },
            ]);
            let imported = false;
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) =>
                targetDate === getTodayLocalDate()
                    ? makeDay(targetDate, imported ? 'Imported subject' : 'Stored subject')
                    : null,
            );
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            imported = true;
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await result.current.importData(
                    new File(['{}'], 'backup.json', {
                        type: 'application/json',
                    }),
                );
            });
            expect(appliedDays).toBe(1);
            expect(result.current.date).toBe(getTodayLocalDate());
            expect(result.current.loadedDate).toBe(getTodayLocalDate());
            expect(result.current.subjects[0]?.name).toBe('Imported subject');
            expect(result.current.todos.map((todo) => todo.text)).toEqual(['Imported todo']);
            expect(result.current.hasUnsavedChanges).toBe(false);
        });
        it('keeps a todo edit made during an import dirty when the store has no todo list', async () => {
            const importing = deferred<number>();
            mockHandleFileImport.mockImplementationOnce(() => importing.promise);
            mockLoadGlobalTodos.mockResolvedValueOnce([]).mockResolvedValue(null);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            let applied: Promise<number> = Promise.resolve(0);
            await act(async () => {
                applied = result.current.importData(
                    new File(['{}'], 'backup.json', {
                        type: 'application/json',
                    }),
                );
                await Promise.resolve();
            });
            act(() => {
                result.current.setTodos([
                    {
                        id: 2,
                        text: 'Typed during import',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            importing.resolve(1);
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await applied;
            });
            // Nothing was adopted, so the edit is still unsaved rather than silently dropped.
            expect(appliedDays).toBe(1);
            expect(result.current.todos.map((todo) => todo.text)).toEqual(['Typed during import']);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('keeps a todo edit made during the post-import reload dirty', async () => {
            const reload = deferred<Todo[] | null>();
            mockHandleFileImport.mockResolvedValueOnce(1);
            mockLoadGlobalTodos.mockResolvedValueOnce([]).mockImplementationOnce(() => reload.promise);
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            let applied: Promise<number> = Promise.resolve(0);
            await act(async () => {
                applied = result.current.importData(
                    new File(['{}'], 'backup.json', {
                        type: 'application/json',
                    }),
                );
            });
            // The import has to reach its own todo read - the call after the startup one -
            // before the edit lands, or the edit would simply be a pre-import edit. Draining
            // microtasks (rather than `waitFor` inside this `act`) is what keeps the act
            // environment intact for the provider's updates.
            await settleMicrotasks(() => mockLoadGlobalTodos.mock.calls.length >= 2);
            act(() => {
                result.current.setTodos([
                    {
                        id: 3,
                        text: 'Typed during reload',
                        completed: false,
                        time: '',
                        reminder: false,
                    },
                ]);
            });
            reload.resolve([
                {
                    id: 42,
                    text: 'Imported todo',
                    completed: false,
                    time: '',
                    reminder: false,
                },
            ]);
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await applied;
            });
            // The imported list is real, but overwriting the edit that landed while it was
            // being read would silently drop it, so the edit wins and stays dirty.
            expect(appliedDays).toBe(1);
            expect(result.current.todos.map((todo) => todo.text)).toEqual(['Typed during reload']);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
        it('announces the completed restore so the component-owned mirrors re-read', async () => {
            // The theme and the focus alarm list are owned by other trees that
            // mirror the same store and read their value once, at mount. Without
            // the announcement a restore left the screen showing the pre-import
            // values with no visible reason.
            const announced: number[] = [];
            const record = (event: Event) => {
                const detail = (event as CustomEvent<{ appliedDays: number }>).detail;
                announced.push(detail.appliedDays);
            };
            window.addEventListener(DATA_IMPORTED_EVENT, record);
            mockHandleFileImport.mockResolvedValueOnce(3);
            try {
                const { result } = await renderDataProvider();
                await act(async () => {
                    await result.current.importData(new File(['{}'], 'backup.json', { type: 'application/json' }));
                });

                expect(announced).toEqual([3]);
            } finally {
                window.removeEventListener(DATA_IMPORTED_EVENT, record);
            }
        });
        it('does not let a startup todo read that lands after the import undo it', async () => {
            const startupRead = deferred<Todo[]>();
            mockLoadGlobalTodos.mockImplementationOnce(() => startupRead.promise as never).mockResolvedValueOnce([]);
            mockHandleFileImport.mockResolvedValueOnce(1);

            const { result } = renderDataProviderWithPendingStartup();
            let applied: Promise<number> = Promise.resolve(0);
            await act(async () => {
                applied = result.current.importData(
                    new File(['{}'], 'backup.json', {
                        type: 'application/json',
                    }),
                );
            });
            // The import is past its own todo read while the startup read is still the one
            // in flight, which is the race this is about.
            await settleMicrotasks(() => mockLoadGlobalTodos.mock.calls.length >= 2);
            startupRead.resolve([
                {
                    id: 7,
                    text: 'Pre-import todo',
                    completed: false,
                    time: '',
                    reminder: false,
                },
            ] as never);
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await applied;
            });
            await act(async () => {
                await Promise.resolve();
            });
            // The import drained and reloaded first; a read issued before it must not win.
            expect(appliedDays).toBe(1);
            expect(result.current.todos).toEqual([]);
        });
        it('imports with the storage default conflict policy and never overrides it', async () => {
            // Storage also knows `replace` and `keep`. The provider reaches neither: a restore
            // keeps local work the file is older than, which is the one policy a user who
            // restores "their own" backup can safely be given. Pinning the arity here is what
            // keeps a future call from silently picking a different policy.
            const { result } = await renderDataProvider();
            await waitFor(() => expect(result.current.isInitialized).toBe(true));
            mockHandleFileImport.mockResolvedValueOnce(4);
            let appliedDays = 0;
            await act(async () => {
                appliedDays = await result.current.importData(
                    new File(['{}'], 'backup.json', { type: 'application/json' }),
                );
            });
            expect(appliedDays).toBe(4);
            expect(mockHandleFileImport).toHaveBeenCalledTimes(1);
            expect(mockHandleFileImport.mock.calls[0]).toHaveLength(1);
        });
        it('announces the restore even when the day cannot be read back afterwards', async () => {
            // The store was rewritten the moment the file was applied, so a failure in the
            // reload that follows changes what the screen shows, not whether the restore
            // happened. The mirrors that read the store once at mount still have to be told.
            const announced: number[] = [];
            const record = (event: Event) => {
                const detail = (event as CustomEvent<{ appliedDays: number }>).detail;
                announced.push(detail.appliedDays);
            };
            window.addEventListener(DATA_IMPORTED_EVENT, record);
            const today = getTodayLocalDate();
            let imported = false;
            mockHandleFileImport.mockResolvedValueOnce(2);
            mockLoadFromNativeStorage.mockImplementation(async (targetDate: string) => {
                if (imported && targetDate === today) {
                    throw new Error('Store unavailable');
                }
                return targetDate === today ? makeDay(today, 'Pre-import subject') : null;
            });
            try {
                const { result } = await renderDataProvider();
                await waitFor(() => expect(result.current.isInitialized).toBe(true));
                imported = true;
                await act(async () => {
                    await expect(
                        result.current.importData(new File(['{}'], 'backup.json', { type: 'application/json' })),
                    ).rejects.toThrow('Store unavailable');
                });
                expect(announced).toEqual([2]);
                // The payload still in state is the pre-import one, so the provider must not
                // claim to be in step with the store it just wrote.
                expect(result.current.loadedDate).toBeNull();
                expect(result.current.subjects[0]?.name).toBe('Pre-import subject');
            } finally {
                window.removeEventListener(DATA_IMPORTED_EVENT, record);
            }
        });
    });
    describe('generateId', () => {
        it('returns unique IDs', async () => {
            const { result } = await renderDataProvider();
            const id1 = result.current.generateId();
            const id2 = result.current.generateId();
            expect(id1).not.toBe(id2);
        });
        it('stays unique for calls made in the same millisecond', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
            const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
            try {
                const { result } = await renderDataProvider();
                // A frozen clock and a frozen draw: only the internal counter can separate
                // these, and a repeat id would merge two subjects into one row.
                const ids = Array.from(
                    {
                        length: 5,
                    },
                    () => result.current.generateId(),
                );
                expect(new Set(ids).size).toBe(5);
                expect(ids.every((id) => Number.isSafeInteger(id) && id >= 0)).toBe(true);
            } finally {
                randomSpy.mockRestore();
                nowSpy.mockRestore();
            }
        });
        it('keeps ids saveable when the clock sits at the safe-integer ceiling', async () => {
            // Storage rejects a whole day record over one id outside the non-negative safe
            // integer range, so an id the clock pushed past that range would make every save
            // from here on fail rather than just this one subject.
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
            const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
            try {
                const { result } = await renderDataProvider();
                const id = result.current.generateId();
                expect(Number.isSafeInteger(id)).toBe(true);
                expect(id).toBeGreaterThanOrEqual(0);
            } finally {
                randomSpy.mockRestore();
                nowSpy.mockRestore();
            }
        });
    });
});
