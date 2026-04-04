import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock matchMedia for theme system
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock IndexedDB
const mockIDBRequest = {
    result: null,
    error: null,
    transaction: null,
    readyState: 'done',
    onsuccess: null,
    onerror: null,
};

const mockIDBDatabase = {
    close: vi.fn(),
    createObjectStore: vi.fn(),
    deleteObjectStore: vi.fn(),
    transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
            add: vi.fn().mockReturnValue(mockIDBRequest),
            put: vi.fn().mockReturnValue(mockIDBRequest),
            get: vi.fn().mockReturnValue(mockIDBRequest),
            delete: vi.fn().mockReturnValue(mockIDBRequest),
            clear: vi.fn().mockReturnValue(mockIDBRequest),
            openCursor: vi.fn().mockReturnValue(mockIDBRequest),
            index: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(mockIDBRequest),
                openCursor: vi.fn().mockReturnValue(mockIDBRequest),
            }),
        }),
        commit: vi.fn(),
        abort: vi.fn(),
    }),
};

Object.defineProperty(window, 'indexedDB', {
    writable: true,
    value: {
        open: vi.fn().mockReturnValue({
            ...mockIDBRequest,
            result: mockIDBDatabase,
        }),
        deleteDatabase: vi.fn().mockReturnValue(mockIDBRequest),
        databases: vi.fn().mockResolvedValue([]),
        cmp: vi.fn(),
    },
});

// Mock EyeDropper
class MockEyeDropper {
    open = vi.fn().mockResolvedValue({ sRGBHex: '#ff0000' });
}
Object.defineProperty(window, 'EyeDropper', {
    writable: true,
    configurable: true,
    value: MockEyeDropper,
});

// Mock AudioContext
class MockAudioContext {
    createGain = vi.fn().mockReturnValue({ gain: { value: 1 }, connect: vi.fn() });
    createMediaElementSource = vi.fn().mockReturnValue({ connect: vi.fn() });
    close = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
    state = 'running';
    destination = {};
}
Object.defineProperty(window, 'AudioContext', {
    writable: true,
    value: MockAudioContext,
});
Object.defineProperty(window, 'webkitAudioContext', {
    writable: true,
    value: MockAudioContext,
});

// Mock navigator.vibrate
Object.defineProperty(navigator, 'vibrate', {
    writable: true,
    value: vi.fn(),
});
