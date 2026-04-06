import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ThemeContextValue, ThemeValue } from '../types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = 'theme';
const ADAPTIVE_COLOR_STORAGE_KEY = 'adaptive-color';

const THEMES: ThemeValue[] = ['light', 'dark', 'auto', 'material-light', 'material-dark', 'adaptive'];

const DEFAULT_THEME: ThemeValue = 'light';

function hslToRgb(h: number, s: number, l: number) {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h >= 0 && h < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (h >= 120 && h < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (h >= 180 && h < 240) {
        r = 0;
        g = x;
        b = c;
    } else if (h >= 240 && h < 300) {
        r = x;
        g = 0;
        b = c;
    } else if (h >= 300 && h < 360) {
        r = c;
        g = 0;
        b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
    };
}

function rgbToHex(r: number, g: number, b: number) {
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function hexToHsl(hex: string) {
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
            default:
                break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

function generateMaterialPalette(baseHex: string) {
    const { h, s } = hexToHsl(baseHex);

    const tones = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const lightnessMap: Record<number, number> = {
        50: 95,
        100: 90,
        200: 80,
        300: 70,
        400: 60,
        500: 50,
        600: 40,
        700: 30,
        800: 20,
        900: 10,
    };

    const palette: Record<number, string> = {};

    for (const tone of tones) {
        const adjustedL = lightnessMap[tone] ?? 50;
        const adjustedS = tone <= 200 ? Math.max(s * 0.4, 10) : tone <= 400 ? Math.max(s * 0.7, 20) : s;
        const { r, g, b } = hslToRgb(h, adjustedS, adjustedL);
        const hex = rgbToHex(r, g, b);
        palette[tone] = hex;
    }

    return palette;
}

function getSystemPrefersDark() {
    if (typeof window === 'undefined') {
        return false;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getInitialTheme(): ThemeValue {
    if (typeof window === 'undefined') {
        return DEFAULT_THEME;
    }
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored && THEMES.includes(stored as ThemeValue)) {
            return stored as ThemeValue;
        }
    } catch {
        // localStorage not available
    }
    return DEFAULT_THEME;
}

function getAdaptiveColor(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const stored = localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY);
        if (stored) {
            return stored;
        }
    } catch {
        // localStorage not available
    }
    return null;
}

function useSystemTheme() {
    const [prefersDark, setPrefersDark] = useState(getSystemPrefersDark);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            setPrefersDark(e.matches);
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, []);

    return prefersDark;
}

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

interface ThemeProviderProps {
    children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<ThemeValue>(getInitialTheme);
    const prefersDark = useSystemTheme();

    const effectiveTheme = useMemo(() => {
        if (theme === 'auto') {
            return prefersDark ? 'dark' : 'light';
        }
        return theme;
    }, [theme, prefersDark]);

    const setTheme = useCallback((newTheme: ThemeValue) => {
        if (!THEMES.includes(newTheme)) {
            return;
        }
        setThemeState(newTheme);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        } catch {
            // localStorage not available
        }
    }, []);

    useEffect(() => {
        const root = document.documentElement;

        root.classList.remove('dark', 'theme-material-light', 'theme-material-dark', 'theme-adaptive');

        if (effectiveTheme === 'dark') {
            root.classList.add('dark');
        } else if (effectiveTheme === 'material-light') {
            root.classList.add('theme-material-light');
        } else if (effectiveTheme === 'material-dark') {
            root.classList.add('theme-material-dark');
        } else if (effectiveTheme === 'adaptive') {
            root.classList.add('theme-adaptive');

            const adaptiveColor = getAdaptiveColor();
            if (adaptiveColor) {
                const palette = generateMaterialPalette(adaptiveColor);

                root.style.setProperty('--adaptive-primary', palette[500] ?? '');
                root.style.setProperty('--adaptive-primary-light', palette[300] ?? '');
                root.style.setProperty('--adaptive-primary-dark', palette[700] ?? '');
                root.style.setProperty('--adaptive-50', palette[50] ?? '');
                root.style.setProperty('--adaptive-100', palette[100] ?? '');
                root.style.setProperty('--adaptive-200', palette[200] ?? '');
                root.style.setProperty('--adaptive-300', palette[300] ?? '');
                root.style.setProperty('--adaptive-400', palette[400] ?? '');
                root.style.setProperty('--adaptive-500', palette[500] ?? '');
                root.style.setProperty('--adaptive-600', palette[600] ?? '');
                root.style.setProperty('--adaptive-700', palette[700] ?? '');
                root.style.setProperty('--adaptive-800', palette[800] ?? '');
                root.style.setProperty('--adaptive-900', palette[900] ?? '');
                root.style.setProperty('--adaptive-base', adaptiveColor);
            }
        } else {
            root.style.removeProperty('--adaptive-primary');
            root.style.removeProperty('--adaptive-primary-light');
            root.style.removeProperty('--adaptive-primary-dark');
            root.style.removeProperty('--adaptive-50');
            root.style.removeProperty('--adaptive-100');
            root.style.removeProperty('--adaptive-200');
            root.style.removeProperty('--adaptive-300');
            root.style.removeProperty('--adaptive-400');
            root.style.removeProperty('--adaptive-500');
            root.style.removeProperty('--adaptive-600');
            root.style.removeProperty('--adaptive-700');
            root.style.removeProperty('--adaptive-800');
            root.style.removeProperty('--adaptive-900');
            root.style.removeProperty('--adaptive-base');
        }
    }, [effectiveTheme]);

    const pickAdaptiveColor = useCallback(async () => {
        if (typeof window === 'undefined' || !(window as unknown as Record<string, unknown>).EyeDropper) {
            return null;
        }

        try {
            const EyeDropperClass = (
                window as unknown as Record<string, new () => { open: () => Promise<{ sRGBHex: string }> }>
            ).EyeDropper;
            if (!EyeDropperClass) {
                return null;
            }
            const eyeDropper = new EyeDropperClass();
            const result = await eyeDropper.open();
            const color = result.sRGBHex;

            try {
                localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, color);
            } catch {
                // localStorage not available
            }

            const palette = generateMaterialPalette(color);
            return { color, palette };
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== 'AbortError') {
                // User cancelled the color picker
            }
            return null;
        }
    }, []);

    const value = useMemo(
        () => ({
            theme,
            setTheme,
            effectiveTheme,
            pickAdaptiveColor,
        }),
        [theme, setTheme, effectiveTheme, pickAdaptiveColor],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
