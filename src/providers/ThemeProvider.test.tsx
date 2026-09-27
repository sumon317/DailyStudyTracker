import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_IMPORTED_EVENT } from '../services/dataImportEvents';
import type { MatchMediaController } from '../test/matchMedia';
import { createMatchMediaController, DARK_SCHEME_QUERY } from '../test/matchMedia';
import { TestWrapper } from '../test/test-utils';
import { ADAPTIVE_COLOR_STORAGE_KEY, useTheme } from './ThemeProvider';

/** The palette the provider falls back to when nothing has been picked or stored. */
const DEFAULT_ADAPTIVE_COLOR = '#006e64';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false),
    },
}));

vi.mock('./DataProvider', () => ({
    default: ({ children }: { children: React.ReactNode }) => children,
    useData: () => ({
        date: '2024-01-01',
        subjects: [],
        checklistItems: [],
        qualityChecks: [],
        dayRating: '',
        errors: [],
        todos: [],
        hasUnsavedChanges: false,
        isSaving: false,
        lastSaved: null,
        setDate: vi.fn(),
        setSubjects: vi.fn(),
        setChecklistItems: vi.fn(),
        setQualityChecks: vi.fn(),
        setDayRating: vi.fn(),
        setErrors: vi.fn(),
        setTodos: vi.fn(),
        saveData: vi.fn(),
        exportData: vi.fn(),
        importData: vi.fn(),
        downloadPDF: vi.fn(),
        downloadMD: vi.fn(),
        loadDataForDate: vi.fn(),
        syncRecurringSubjects: vi.fn(),
        generateId: vi.fn(),
    }),
}));

vi.mock('./ToastProvider', () => ({
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn() }),
}));

function renderThemeHook() {
    return renderHook(() => useTheme(), { wrapper: TestWrapper });
}

let media: MatchMediaController | undefined;

const useSystemScheme = (prefersDark: boolean): MatchMediaController => {
    const controller = createMatchMediaController({ [DARK_SCHEME_QUERY]: prefersDark });
    controller.install();
    media = controller;
    return controller;
};

describe('ThemeProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        document.documentElement.classList.remove(
            'dark',
            'theme-material-light',
            'theme-material-dark',
            'theme-adaptive',
        );
        document.documentElement.removeAttribute('style');
    });

    // Every test that needs a system preference installs its own controller.
    // Leaving one behind used to make later tests read whatever the previous
    // test happened to leave in `globalThis.matchMedia`.
    afterEach(() => {
        media?.restore();
        media = undefined;
    });

    describe('default theme', () => {
        it('defaults to light theme when no stored preference', async () => {
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('light');
        });

        it('has effective theme as light by default', async () => {
            const { result } = renderThemeHook();
            expect(result.current.effectiveTheme).toBe('light');
        });

        it('survives a localStorage that throws on every access', () => {
            const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new DOMException('SecurityError');
            });
            const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('SecurityError');
            });
            try {
                const { result } = renderThemeHook();
                expect(result.current.theme).toBe('light');
                act(() => {
                    result.current.setTheme('dark');
                });
                // The in-memory theme still drives the UI even when storage is dead.
                expect(result.current.theme).toBe('dark');
                expect(document.documentElement.classList.contains('dark')).toBe(true);
            } finally {
                getItem.mockRestore();
                setItem.mockRestore();
            }
        });
    });

    describe('localStorage persistence', () => {
        it('reads stored theme from localStorage on init', async () => {
            localStorage.setItem('theme', 'dark');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('dark');
        });

        it('reads stored theme for material-light', async () => {
            localStorage.setItem('theme', 'material-light');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('material-light');
        });

        it('reads stored theme for auto', async () => {
            localStorage.setItem('theme', 'auto');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('auto');
        });

        it('falls back to light if stored theme is invalid', async () => {
            localStorage.setItem('theme', 'invalid-theme');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('light');
        });

        it('picks up a theme a restore wrote after mount', async () => {
            // The value is read once, at mount, so a backup that carried a
            // different theme was applied to the store and then ignored on screen
            // until the app was closed and reopened.
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('light');

            await act(async () => {
                localStorage.setItem('theme', 'dark');
                window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 1 } }));
            });

            expect(result.current.theme).toBe('dark');
        });

        it('leaves the theme alone when the restore did not carry one', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-dark');
            });
            expect(result.current.theme).toBe('material-dark');

            await act(async () => {
                // A restore that changes nothing re-reads the same value, so the
                // user's choice survives it.
                window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 0 } }));
            });

            expect(result.current.theme).toBe('material-dark');
        });

        it('lets a restore replace a colour picked earlier in the session', async () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            await act(async () => {
                await result.current.pickAdaptiveColor();
            });
            expect(document.documentElement.style.getPropertyValue('--adaptive-base')).toBe('#ff0000');

            // The picked colour outranks the store, which is what keeps a
            // restore that changed nothing from resetting it. A restore that
            // *did* change it has to win, or the backup's palette is applied to
            // the store and then ignored on screen for the rest of the session.
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#123456');
            await act(async () => {
                window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 1 } }));
            });

            expect(document.documentElement.style.getPropertyValue('--adaptive-base')).toBe('#123456');
        });

        it('keeps the picked colour when a restore carries none', async () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            await act(async () => {
                await result.current.pickAdaptiveColor();
            });
            localStorage.removeItem(ADAPTIVE_COLOR_STORAGE_KEY);

            await act(async () => {
                window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 0 } }));
            });

            // Nothing to restore is not an instruction to drop the choice the
            // user made in this session, and not an instruction to fall back to
            // the built-in default either.
            expect(document.documentElement.style.getPropertyValue('--adaptive-base')).toBe('#ff0000');
        });

        it('saves theme to localStorage when setTheme is called', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('dark');
            });
            expect(localStorage.getItem('theme')).toBe('dark');
        });
    });

    describe('switching themes', () => {
        it('switches to dark theme', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('dark');
            });
            expect(result.current.theme).toBe('dark');
            expect(result.current.effectiveTheme).toBe('dark');
        });

        it('switches to material-light theme', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-light');
            });
            expect(result.current.theme).toBe('material-light');
            expect(result.current.effectiveTheme).toBe('material-light');
        });

        it('switches to material-dark theme', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-dark');
            });
            expect(result.current.theme).toBe('material-dark');
            expect(result.current.effectiveTheme).toBe('material-dark');
        });

        it('rejects invalid theme values', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('invalid' as 'light');
            });
            expect(result.current.theme).toBe('light');
        });
    });

    describe('auto mode resolution', () => {
        it('resolves auto to light when system prefers light', async () => {
            useSystemScheme(false);

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('light');
        });

        it('resolves auto to dark when system prefers dark', async () => {
            useSystemScheme(true);

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('dark');
        });

        it('keeps a fixed theme when the system preference flips', async () => {
            const controller = useSystemScheme(false);
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('light');
            });

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, true);
            });

            expect(result.current.theme).toBe('light');
            expect(result.current.effectiveTheme).toBe('light');
            expect(document.documentElement.classList.contains('dark')).toBe(false);
        });
    });

    describe('DOM class manipulation', () => {
        it('adds dark class when effective theme is dark', async () => {
            useSystemScheme(true);

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });

            expect(document.documentElement.classList.contains('dark')).toBe(true);
            expect(document.documentElement.style.colorScheme).toBe('dark');
        });

        it('adds theme-material-light class when effective theme is material-light', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-light');
            });
            expect(document.documentElement.classList.contains('theme-material-light')).toBe(true);
            expect(document.documentElement.style.colorScheme).toBe('light');
        });

        it('adds theme-material-dark class when effective theme is material-dark', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-dark');
            });
            expect(document.documentElement.classList.contains('theme-material-dark')).toBe(true);
            // Material Dark is dark even though `theme` is not literally 'dark'.
            expect(document.documentElement.classList.contains('dark')).toBe(true);
        });

        it('adds theme-adaptive class when effective theme is adaptive', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            expect(document.documentElement.classList.contains('theme-adaptive')).toBe(true);
        });

        it('replaces the previous theme class instead of stacking them', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-dark');
            });
            act(() => {
                result.current.setTheme('adaptive');
            });
            act(() => {
                result.current.setTheme('light');
            });

            const root = document.documentElement;
            expect(root.classList.contains('theme-material-dark')).toBe(false);
            expect(root.classList.contains('theme-adaptive')).toBe(false);
            expect(root.classList.contains('dark')).toBe(false);
        });

        it('removes dark class when switching from dark to light', async () => {
            useSystemScheme(true);

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(document.documentElement.classList.contains('dark')).toBe(true);

            act(() => {
                result.current.setTheme('light');
            });
            expect(document.documentElement.classList.contains('dark')).toBe(false);
        });
    });

    describe('pickAdaptiveColor', () => {
        it('persists one adaptive color format and applies final CSS variables', async () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#ABC');
            const { result } = renderThemeHook();

            act(() => {
                result.current.setTheme('adaptive');
            });
            await act(async () => {
                await result.current.pickAdaptiveColor();
            });

            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#ff0000');
            expect(document.documentElement.style.getPropertyValue('--color-app-primary')).not.toBe('');

            act(() => {
                result.current.setTheme('light');
            });
            expect(document.documentElement.style.getPropertyValue('--color-app-primary')).toBe('');
        });

        it('canonicalises a shorthand hex without reformatting an already canonical value', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#ABC');
            const { unmount } = renderThemeHook();
            // The migration runs in an effect, never during render.
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#aabbcc');
            unmount();

            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#aabbcc');
            const setItem = vi.spyOn(Storage.prototype, 'setItem');
            renderThemeHook();
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#aabbcc');
            // Canonical lowercase hex needs no rewrite, so storage is left alone.
            expect(setItem).not.toHaveBeenCalled();
            setItem.mockRestore();
        });

        it('migrates the legacy "r,g,b" format to canonical hex', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '18, 52, 86');
            renderThemeHook();
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#123456');
        });

        it('rejects an out-of-range legacy triple instead of writing a broken colour', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '300, 0, 0');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            // Nothing canonical was stored, so the provider falls back to its default.
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('300, 0, 0');
            expect(document.documentElement.style.getPropertyValue('--color-app-primary')).not.toBe('');
        });

        it('publishes both light and dark token sets so a scheme flip needs no re-pick', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });

            const root = document.documentElement;
            const lightPrimary = root.style.getPropertyValue('--adaptive-light-primary');
            const darkPrimary = root.style.getPropertyValue('--adaptive-dark-primary');
            expect(lightPrimary).not.toBe('');
            expect(darkPrimary).not.toBe('');
            expect(lightPrimary).not.toBe(darkPrimary);
        });

        it('swaps the active token set when the system scheme changes under the adaptive theme', () => {
            const controller = useSystemScheme(false);
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });

            const root = document.documentElement;
            const before = root.style.getPropertyValue('--color-app-bg');
            expect(before).toBe(root.style.getPropertyValue('--adaptive-light-bg'));
            expect(document.documentElement.classList.contains('dark')).toBe(false);

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, true);
            });

            expect(root.style.getPropertyValue('--color-app-bg')).toBe(
                root.style.getPropertyValue('--adaptive-dark-bg'),
            );
            expect(root.style.getPropertyValue('--color-app-bg')).not.toBe(before);
            expect(document.documentElement.classList.contains('dark')).toBe(true);
            expect(document.documentElement.style.colorScheme).toBe('dark');
        });

        it('removes every inline variable it added when adaptive is left behind', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            expect(document.documentElement.style.getPropertyValue('--adaptive-600')).not.toBe('');

            act(() => {
                result.current.setTheme('dark');
            });

            const style = document.documentElement.style;
            expect(style.getPropertyValue('--adaptive-600')).toBe('');
            expect(style.getPropertyValue('--adaptive-light-primary')).toBe('');
            expect(style.getPropertyValue('--adaptive-dark-primary')).toBe('');
            expect(style.getPropertyValue('--adaptive-base')).toBe('');
            expect(style.getPropertyValue('--color-app-primary')).toBe('');
        });

        it('takes every class and inline variable back off <html> when it unmounts', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#006e64');
            const { result, unmount } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            expect(document.documentElement.style.getPropertyValue('--adaptive-600')).not.toBe('');

            unmount();

            // `<html>` outlives the provider. A palette, a theme class or a
            // colour scheme left behind would be inherited by whatever mounts
            // next - a second provider in the same document, or the next test.
            const root = document.documentElement;
            expect(root.classList.contains('theme-adaptive')).toBe(false);
            expect(root.classList.contains('dark')).toBe(false);
            expect(root.style.getPropertyValue('--adaptive-600')).toBe('');
            expect(root.style.getPropertyValue('--adaptive-light-primary')).toBe('');
            expect(root.style.getPropertyValue('--color-app-primary')).toBe('');
            expect(root.style.colorScheme).toBe('');
        });

        it('returns color and palette when EyeDropper is available (mocked in test/setup.ts)', async () => {
            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).not.toBeNull();
            expect(eyeResult?.color).toBe('#ff0000');
            expect(eyeResult?.palette).toBeDefined();
        });

        it('restores a picked colour on the next mount, not just for this session', async () => {
            const first = renderThemeHook();
            await act(async () => {
                await first.result.current.pickAdaptiveColor();
            });
            first.unmount();

            // A fresh provider reads storage again, so the choice survives a
            // reload rather than resetting to the built-in default.
            const second = renderThemeHook();
            act(() => {
                second.result.current.setTheme('adaptive');
            });

            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#ff0000');
            expect(document.documentElement.style.getPropertyValue('--adaptive-base')).toBe('#ff0000');
            expect(document.documentElement.style.getPropertyValue('--color-app-primary')).not.toBe(
                document.documentElement.style.getPropertyValue('--adaptive-600'),
            );
        });

        it('falls back to the built-in default when adaptive is chosen with nothing stored', () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });

            // No stored colour and no picker result must still produce a
            // complete palette, not a theme with undefined custom properties.
            const style = document.documentElement.style;
            expect(style.getPropertyValue('--adaptive-base')).toBe(DEFAULT_ADAPTIVE_COLOR);
            expect(style.getPropertyValue('--color-app-primary')).not.toBe('');
            expect(style.getPropertyValue('--color-app-bg')).toBe(style.getPropertyValue('--adaptive-light-bg'));
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBeNull();
        });

        it('returns the picked colour even when storage refuses the write', async () => {
            const { result } = renderThemeHook();
            const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('QuotaExceededError');
            });
            try {
                const eyeResult = await act(async () => {
                    return result.current.pickAdaptiveColor();
                });
                expect(eyeResult?.color).toBe('#ff0000');
            } finally {
                setItem.mockRestore();
            }
        });

        it('returns null in a browser without the EyeDropper API', async () => {
            Object.defineProperty(window, 'EyeDropper', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).toBeNull();
        });

        it('returns null when EyeDropper open is cancelled', async () => {
            const mockEyeDropper = vi.fn().mockImplementation(() => ({
                open: vi.fn().mockRejectedValue(new DOMException('User cancelled', 'AbortError')),
            }));
            Object.defineProperty(window, 'EyeDropper', {
                value: mockEyeDropper,
                writable: true,
                configurable: true,
            });

            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).toBeNull();
        });

        it('returns null when EyeDropper open fails with non-AbortError', async () => {
            const mockEyeDropper = vi.fn().mockImplementation(() => ({
                open: vi.fn().mockRejectedValue(new Error('Some error')),
            }));
            Object.defineProperty(window, 'EyeDropper', {
                value: mockEyeDropper,
                writable: true,
                configurable: true,
            });

            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).toBeNull();
        });

        it('ignores a colour the picker reports in an unusable format', async () => {
            Object.defineProperty(window, 'EyeDropper', {
                value: class {
                    open = vi.fn().mockResolvedValue({ sRGBHex: 'not-a-colour' });
                },
                writable: true,
                configurable: true,
            });

            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).toBeNull();
        });
    });

    describe('system theme changes', () => {
        it('updates effective theme when system preference changes', async () => {
            const controller = useSystemScheme(false);

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('light');
            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBe(1);

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, true);
            });

            expect(result.current.effectiveTheme).toBe('dark');
        });

        it('unsubscribes from the system scheme on unmount', () => {
            const controller = useSystemScheme(false);
            const { unmount } = renderThemeHook();
            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBe(1);

            unmount();

            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBe(0);
        });

        it('falls back to the deprecated addListener surface on older WebViews', () => {
            const controller = createMatchMediaController({ [DARK_SCHEME_QUERY]: false }, { surface: 'legacy' });
            controller.install();
            media = controller;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBe(1);

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, true);
            });
            expect(result.current.effectiveTheme).toBe('dark');
        });

        it('does not subscribe at all when the media list exposes no listener API', () => {
            const controller = createMatchMediaController({ [DARK_SCHEME_QUERY]: true }, { surface: 'none' });
            controller.install();
            media = controller;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });

            // The initial read still resolves; only the live subscription is absent.
            expect(result.current.effectiveTheme).toBe('dark');
            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBe(0);
        });

        it('treats a throwing matchMedia as a light system instead of failing the mount', () => {
            window.matchMedia = vi.fn().mockImplementation(() => {
                throw new Error('unsupported');
            }) as unknown as typeof window.matchMedia;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('light');
        });

        it('resolves the system scheme through the one shared media-query resolver', () => {
            // `ThemeProvider` used to carry a byte-identical private copy of the
            // resolution and the three-surface subscription that
            // `src/app/reducedMotion.ts` already owned. The copy is gone, so the
            // only remaining thing to pin is that the shared resolver is what
            // this provider actually calls - and that it asks for the scheme and
            // nothing else. (The call *count* is not asserted: `TestWrapper`
            // renders under `StrictMode`, which double-invokes both the state
            // initialiser and the effect.)
            const controller = useSystemScheme(false);
            renderThemeHook();

            expect([...new Set(controller.calls)]).toEqual([DARK_SCHEME_QUERY]);
            expect(controller.listenerCount(DARK_SCHEME_QUERY)).toBeGreaterThan(0);
        });

        it('keeps working when the system flips twice in a row', () => {
            const controller = useSystemScheme(false);
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, true);
            });
            expect(result.current.effectiveTheme).toBe('dark');

            act(() => {
                controller.setMatches(DARK_SCHEME_QUERY, false);
            });

            expect(result.current.effectiveTheme).toBe('light');
            expect(document.documentElement.classList.contains('dark')).toBe(false);
            expect(document.documentElement.style.colorScheme).toBe('light');
        });
    });

    describe('useTheme hook', () => {
        it('throws error when used outside ThemeProvider', async () => {
            const suppressExpectedError = (event: ErrorEvent) => {
                if (
                    event.error instanceof Error &&
                    event.error.message === 'useTheme must be used within a ThemeProvider'
                ) {
                    event.preventDefault();
                }
            };
            window.addEventListener('error', suppressExpectedError);
            const consoleError = vi.spyOn(window.console, 'error').mockImplementation(() => undefined);
            try {
                expect(() => {
                    renderHook(() => useTheme());
                }).toThrow('useTheme must be used within a ThemeProvider');
                await act(async () => {
                    await Promise.resolve();
                });
                expect(
                    consoleError.mock.calls.some((args) =>
                        args.some((arg) => String(arg).includes('useTheme must be used within a ThemeProvider')),
                    ),
                ).toBe(true);
            } finally {
                window.removeEventListener('error', suppressExpectedError);
                consoleError.mockRestore();
            }
        });
    });
});
