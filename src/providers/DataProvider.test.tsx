import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestWrapper } from '../test-utils';
import { useData } from './DataProvider';

// Mock dependencies BEFORE importing the provider
const mockSaveToNativeStorage = vi.fn().mockResolvedValue(undefined);
const mockLoadFromNativeStorage = vi.fn().mockResolvedValue(null);
const mockLoadGlobalTodos = vi.fn().mockResolvedValue([]);
const mockSaveGlobalTodos = vi.fn().mockResolvedValue(undefined);
const mockLoadRecurringSubjects = vi.fn().mockResolvedValue([]);
const mockSaveRecurringSubjects = vi.fn().mockResolvedValue(undefined);
const mockDownloadBackup = vi.fn().mockResolvedValue(0);
const mockHandleFileImport = vi.fn().mockResolvedValue(null);

vi.mock('../db', () => ({
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

vi.mock('../utils/notificationService', () => ({
    NotificationService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        initListeners: vi.fn(),
        checkExactAlarmPermission: vi.fn().mockResolvedValue(true),
        openExactAlarmSettings: vi.fn(),
    },
}));

vi.mock('../utils/widgetBridge', () => ({
    updateWidget: vi.fn(),
}));

describe('DataProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoadFromNativeStorage.mockResolvedValue(null);
        mockLoadGlobalTodos.mockResolvedValue([]);
    });

    describe('initial state', () => {
        it('provides default subjects', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.subjects).toHaveLength(1);
            expect(result.current.subjects[0]?.name).toBe('New Subject');
        });

        it('provides default checklist items', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.checklistItems).toHaveLength(1);
            expect(result.current.checklistItems[0]?.label).toBe('Add your first checklist item here...');
        });

        it('provides default quality checks', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.qualityChecks).toHaveLength(1);
        });

        it('provides default errors', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.errors).toHaveLength(1);
        });

        it('starts with empty todos', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.todos).toEqual([]);
        });

        it('starts with empty day rating', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.dayRating).toBe('');
        });

        it('starts with no unsaved changes', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            expect(result.current.hasUnsavedChanges).toBe(false);
        });

        it('starts with today date', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            const today = new Date().toISOString().split('T')[0];
            expect(result.current.date).toBe(today);
        });
    });

    describe('state updates', () => {
        it('updates subjects and marks unsaved', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            act(() => {
                result.current.setSubjects([
                    { id: 1, name: 'Math', planned: '60', actual: '0', kpi: 'N', time: '', reminder: false },
                ]);
            });
            expect(result.current.subjects[0]?.name).toBe('Math');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });

        it('updates checklist items and marks unsaved', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            act(() => {
                result.current.setChecklistItems([{ id: 1, label: 'New item', checked: false }]);
            });
            expect(result.current.checklistItems[0]?.label).toBe('New item');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });

        it('updates day rating and marks unsaved', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            act(() => {
                result.current.setDayRating('Productive');
            });
            expect(result.current.dayRating).toBe('Productive');
            expect(result.current.hasUnsavedChanges).toBe(true);
        });

        it('updates errors and marks unsaved', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            act(() => {
                result.current.setErrors([{ id: 1, question: 'Q', mistake: 'M', correctLogic: 'C' }]);
            });
            expect(result.current.errors).toHaveLength(1);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });

        it('updates todos and marks unsaved', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            act(() => {
                result.current.setTodos([{ id: 1, text: 'Task', completed: false, time: '', reminder: false }]);
            });
            expect(result.current.todos).toHaveLength(1);
            expect(result.current.hasUnsavedChanges).toBe(true);
        });
    });

    describe('generateId', () => {
        it('returns unique incrementing IDs', () => {
            const { result } = renderHook(() => useData(), { wrapper: TestWrapper });
            const id1 = result.current.generateId();
            const id2 = result.current.generateId();
            expect(id2).toBeGreaterThan(id1);
        });
    });
});
