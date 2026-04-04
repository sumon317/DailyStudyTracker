import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { TestWrapper } from './test-utils';

beforeAll(() => {
    globalThis.matchMedia =
        globalThis.matchMedia ||
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
});

vi.mock('./db', () => ({
    loadFromNativeStorage: vi.fn().mockResolvedValue(null),
    saveToNativeStorage: vi.fn().mockResolvedValue(undefined),
    loadGlobalTodos: vi.fn().mockResolvedValue([]),
    saveGlobalTodos: vi.fn().mockResolvedValue(undefined),
    loadRecurringSubjects: vi.fn().mockResolvedValue([]),
    saveRecurringSubjects: vi.fn().mockResolvedValue(undefined),
    downloadBackup: vi.fn().mockResolvedValue(0),
    handleFileImport: vi.fn().mockResolvedValue(null),
    exportAllData: vi.fn().mockResolvedValue([]),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false),
    },
}));

vi.mock('./utils/notificationService', () => ({
    NotificationService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        initListeners: vi.fn(),
        checkExactAlarmPermission: vi.fn().mockResolvedValue(true),
        openExactAlarmSettings: vi.fn(),
    },
}));

vi.mock('./utils/widgetBridge', () => ({
    updateWidget: vi.fn(),
}));

vi.mock('./utils/checkForUpdate', () => ({
    checkForUpdate: vi.fn().mockResolvedValue(null),
}));

afterAll(() => {
    vi.restoreAllMocks();
});

describe('Daily Study Tracker App', () => {
    it('renders the main title', async () => {
        render(<App />, { wrapper: TestWrapper });
        expect(await screen.findByText(/Daily Study Tracker/i)).toBeInTheDocument();
    });

    it('renders the Target display', async () => {
        render(<App />, { wrapper: TestWrapper });
        expect(await screen.findByText(/Target:/i)).toBeInTheDocument();
    });

    it('renders the DatePicker', async () => {
        render(<App />, { wrapper: TestWrapper });
        expect(await screen.findByText(/Study Date/i)).toBeInTheDocument();
    });

    it('renders all subject inputs', async () => {
        render(<App />, { wrapper: TestWrapper });
        const subjectInputs = await screen.findAllByDisplayValue('New Subject');
        expect(subjectInputs.length).toBeGreaterThan(0);
    });

    it('updates subject actual time', async () => {
        render(<App />, { wrapper: TestWrapper });
        const inputs = await screen.findAllByPlaceholderText('0');
        const actualInput = inputs[0];
        if (!actualInput) return;
        fireEvent.change(actualInput, { target: { value: '45' } });
        expect((actualInput as HTMLInputElement).value).toBe('45');
    });

    it('renders the Review page with checklist', async () => {
        render(<App />, { wrapper: TestWrapper });
        const reviewLink = await screen.findByText(/Review/i);
        fireEvent.click(reviewLink);
        expect(await screen.findByText(/Output Checklist/i)).toBeInTheDocument();
    });
});
