import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestWrapper } from '../test-utils';
import { useTheme } from './ThemeProvider';

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
        document.documentElement.classList.remove(
            'dark',
            'theme-material-light',
            'theme-material-dark',
            'theme-adaptive',
        );
        document.documentElement.style.removeProperty('--adaptive-primary');
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
            const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            globalThis.matchMedia = mockMatchMedia;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('light');
        });

        it('resolves auto to dark when system prefers dark', async () => {
            const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('dark'),
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            globalThis.matchMedia = mockMatchMedia;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('dark');
        });
    });

    describe('DOM class manipulation', () => {
        it('adds dark class when effective theme is dark', async () => {
            const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('dark'),
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            globalThis.matchMedia = mockMatchMedia;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });

            expect(document.documentElement.classList.contains('dark')).toBe(true);
        });

        it('adds theme-material-light class when effective theme is material-light', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-light');
            });
            expect(document.documentElement.classList.contains('theme-material-light')).toBe(true);
        });

        it('adds theme-material-dark class when effective theme is material-dark', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('material-dark');
            });
            expect(document.documentElement.classList.contains('theme-material-dark')).toBe(true);
        });

        it('adds theme-adaptive class when effective theme is adaptive', async () => {
            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('adaptive');
            });
            expect(document.documentElement.classList.contains('theme-adaptive')).toBe(true);
        });

        it('removes dark class when switching from dark to light', async () => {
            const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('dark'),
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            globalThis.matchMedia = mockMatchMedia;

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
        it('returns color and palette when EyeDropper is available (mocked in setupTests)', async () => {
            const { result } = renderThemeHook();
            const eyeResult = await act(async () => {
                return result.current.pickAdaptiveColor();
            });

            expect(eyeResult).not.toBeNull();
            expect(eyeResult?.color).toBe('#ff0000');
            expect(eyeResult?.palette).toBeDefined();
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
    });

    describe('system theme changes', () => {
        it('updates effective theme when system preference changes', async () => {
            let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
            const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
                    changeHandler = handler;
                }),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));
            globalThis.matchMedia = mockMatchMedia;

            const { result } = renderThemeHook();
            act(() => {
                result.current.setTheme('auto');
            });
            expect(result.current.effectiveTheme).toBe('light');

            act(() => {
                if (changeHandler) {
                    changeHandler({ matches: true } as MediaQueryListEvent);
                }
            });

            expect(result.current.effectiveTheme).toBe('dark');
        });
    });

    describe('useTheme hook', () => {
        it('throws error when used outside ThemeProvider', () => {
            expect(() => {
                renderHook(() => useTheme());
            }).toThrow('useTheme must be used within a ThemeProvider');
        });
    });
});
