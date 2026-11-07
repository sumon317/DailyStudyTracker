import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_IMPORTED_EVENT } from '../services/dataImportEvents';
import { TestWrapper } from '../test/test-utils';
import { ADAPTIVE_COLOR_STORAGE_KEY, useTheme } from './ThemeProvider';

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

describe('ThemeProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        document.documentElement.className = '';
        document.documentElement.removeAttribute('style');
    });

    describe('default theme', () => {
        it('defaults to midnight theme when no stored preference', async () => {
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('midnight');
            expect(document.documentElement.classList.contains('dark')).toBe(true);
            expect(document.documentElement.classList.contains('theme-midnight')).toBe(true);
        });

        it('has effective theme as midnight by default', async () => {
            const { result } = renderThemeHook();
            expect(result.current.effectiveTheme).toBe('midnight');
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
                expect(result.current.theme).toBe('midnight');
                act(() => {
                    result.current.setTheme('daylight');
                });
                // The in-memory theme still drives the UI even when storage is dead.
                expect(result.current.theme).toBe('daylight');
                expect(document.documentElement.classList.contains('dark')).toBe(false);
                expect(document.documentElement.classList.contains('theme-daylight')).toBe(true);
            } finally {
                getItem.mockRestore();
                setItem.mockRestore();
            }
        });
    });

    describe('localStorage persistence', () => {
        it('reads stored theme for nord on init', async () => {
            localStorage.setItem('theme', 'nord');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('nord');
        });

        it('falls back to midnight if stored theme is invalid', async () => {
            localStorage.setItem('theme', 'invalid-theme');
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('midnight');
        });

        it('migrates legacy themes cleanly', async () => {
            localStorage.setItem('theme', 'light');
            const first = renderThemeHook();
            expect(first.result.current.theme).toBe('daylight');
            first.unmount();

            localStorage.setItem('theme', 'black');
            const second = renderThemeHook();
            expect(second.result.current.theme).toBe('ink');
            second.unmount();

            localStorage.setItem('theme', 'sage');
            const third = renderThemeHook();
            expect(third.result.current.theme).toBe('sepia');
            third.unmount();

            localStorage.setItem('theme', 'rose-pine');
            const fourth = renderThemeHook();
            expect(fourth.result.current.theme).toBe('rose');
            fourth.unmount();
        });

        it('picks up a theme a restore wrote after mount', async () => {
            const { result } = renderThemeHook();
            expect(result.current.theme).toBe('midnight');

            await act(async () => {
                localStorage.setItem('theme', 'rose');
                window.dispatchEvent(new CustomEvent(DATA_IMPORTED_EVENT, { detail: { appliedDays: 1 } }));
            });

            expect(result.current.theme).toBe('rose');
        });

        it('saves theme to localStorage when setTheme is called', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('sepia');
            });
            expect(localStorage.getItem('theme')).toBe('sepia');
        });
    });

    describe('switching themes', () => {
        it('switches across all 6 themes', async () => {
            const { result } = renderThemeHook();
            for (const theme of ['daylight', 'ink', 'sepia', 'nord', 'rose', 'midnight'] as const) {
                act(() => {
                    result.current.setTheme(theme);
                });
                expect(result.current.theme).toBe(theme);
                expect(result.current.effectiveTheme).toBe(theme);
            }
        });

        it('rejects invalid theme values', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('invalid' as 'midnight');
            });
            expect(result.current.theme).toBe('midnight');
        });
    });

    describe('DOM class manipulation', () => {
        it('applies dark and theme-specific classes for dark themes (midnight, ink, nord, rose)', async () => {
            const { result } = renderThemeHook();
            for (const darkTheme of ['midnight', 'ink', 'nord', 'rose'] as const) {
                act(() => {
                    result.current.setTheme(darkTheme);
                });

                expect(document.documentElement.classList.contains('dark')).toBe(true);
                expect(document.documentElement.classList.contains(`theme-${darkTheme}`)).toBe(true);
                expect(document.documentElement.style.colorScheme).toBe('dark');
            }
        });

        it('removes dark class when switching to light themes (daylight, sepia)', async () => {
            const { result } = renderThemeHook();
            expect(document.documentElement.classList.contains('dark')).toBe(true);

            for (const lightTheme of ['daylight', 'sepia'] as const) {
                act(() => {
                    result.current.setTheme(lightTheme);
                });
                expect(document.documentElement.classList.contains('dark')).toBe(false);
                expect(document.documentElement.classList.contains(`theme-${lightTheme}`)).toBe(true);
                expect(document.documentElement.style.colorScheme).toBe('light');
            }
        });
    });

    describe('pickAdaptiveColor', () => {
        it('canonicalises a shorthand hex without reformatting an already canonical value', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#ABC');
            const { unmount } = renderThemeHook();
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#aabbcc');
            unmount();

            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '#aabbcc');
            const setItem = vi.spyOn(Storage.prototype, 'setItem');
            renderThemeHook();
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#aabbcc');
            expect(setItem).not.toHaveBeenCalled();
            setItem.mockRestore();
        });

        it('migrates the legacy "r,g,b" format to canonical hex', () => {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, '18, 52, 86');
            renderThemeHook();
            expect(localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY)).toBe('#123456');
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
