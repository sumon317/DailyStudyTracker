import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// React Testing Library's stock `asyncWrapper` is used unchanged. A custom one
// that kept `IS_REACT_ACT_ENVIRONMENT` on while an `act` scope was open silenced
// two act warnings, and paid for it with `NotFoundError: The node to be removed
// is not a child of this node` in every test that closed a framer-motion portal.
// The two suites that really did poll a mock from inside an `act` were rewritten
// instead; see `src/providers/DataProvider.test.tsx`.

// Mock matchMedia for theme system
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
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

const defaultEyeDropper = MockEyeDropper;
const defaultMatchMedia = window.matchMedia;

/**
 * `EyeDropper` is not in the DOM lib's `Window` yet, so every reference to it
 * needs the cast a browser would not. Declared once here rather than repeated at
 * each of the call sites.
 */
const eyeDropperWindow = window as Window & { EyeDropper?: unknown };

// Mock AudioContext. `configurable: true` so a test can swap in its own
// constructor (or remove it entirely) to exercise the no-WebAudio fallback in
// src/services/alarmAudio.ts, the same way `EyeDropper` above already can.
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
    configurable: true,
    value: MockAudioContext,
});
Object.defineProperty(window, 'webkitAudioContext', {
    writable: true,
    configurable: true,
    value: MockAudioContext,
});

// Mock navigator.vibrate
Object.defineProperty(navigator, 'vibrate', {
    writable: true,
    value: vi.fn(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(),
});

// `play` is the noisier half of the same problem: jsdom logs a "Not implemented"
// error for every call, which buries real React warnings in the output. Resolving
// is also the honest stub - nothing in these tests asserts on playback.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
});

Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
});

/**
 * Globals that outlive a single test are the main source of order-dependent
 * suites in this project, so they are reset centrally rather than in each file:
 * theme/reduced-motion listeners, the DOM writes both providers perform on
 * `<html>`, and the pending timers a fake-timer test may have left behind.
 *
 * `console` is deliberately *not* touched. Suppressing it globally would hide
 * the React warnings a test is supposed to surface; the few tests that assert on
 * a logged error spy it locally and restore it in a `finally`.
 */
afterEach(() => {
    /**
     * Unmount first, and do it here rather than leaving it to React Testing
     * Library's own auto-cleanup.
     *
     * Vitest runs `afterEach` hooks in reverse registration order. This file is
     * evaluated before any test file, so its hook is registered first and
     * therefore runs *first* - which meant the `document.body.innerHTML = ''` at
     * the bottom of this function wiped the containers out from under the
     * library's cleanup. React then unmounted into a detached tree, and the
     * components' effect teardowns never ran: their `document` and Capacitor
     * listeners survived into the next test. That is not a cosmetic leak. A
     * `resume` listener left behind by one test's dialog re-ran another test's
     * install-permission probe, so an assertion on an exact call count passed
     * or failed depending on which test happened to run before it - and the same
     * ordering is what produced `NotFoundError: The node to be removed is not a
     * child of this node` in every test that closed a framer-motion portal.
     *
     * Calling `cleanup()` first makes the ordering irrelevant. The library's own
     * registered hook still runs afterwards and finds nothing left to unmount,
     * because `cleanup` drains its container list.
     */
    cleanup();

    if (vi.isFakeTimers()) {
        vi.clearAllTimers();
        vi.useRealTimers();
    }

    // Any controller a test installed through `installMatchMedia` restores
    // itself, so a leftover controller is only possible when a test installed one
    // without restoring. Reset to the file-level default in that case.
    if (window.matchMedia !== defaultMatchMedia) {
        window.matchMedia = defaultMatchMedia;
    }
    if (eyeDropperWindow.EyeDropper !== defaultEyeDropper) {
        Object.defineProperty(window, 'EyeDropper', {
            writable: true,
            configurable: true,
            value: defaultEyeDropper,
        });
    }
    const root = document.documentElement;
    root.className = '';
    root.removeAttribute('style');

    localStorage.clear();
    document.body.innerHTML = '';
});
