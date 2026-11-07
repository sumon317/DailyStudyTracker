import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeToDataImported } from '../services/dataImportEvents';
import type { ThemeContextValue, ThemeValue } from '../types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = 'theme';
export const ADAPTIVE_COLOR_STORAGE_KEY = 'adaptive-color';

const THEMES: ThemeValue[] = ['midnight', 'daylight', 'ink', 'sepia', 'nord', 'rose'];
const DARK_THEMES = new Set<ThemeValue>(['midnight', 'ink', 'nord', 'rose']);
const DEFAULT_THEME: ThemeValue = 'midnight';
const THEME_CLASSES = [
    'dark',
    'theme-midnight',
    'theme-daylight',
    'theme-ink',
    'theme-sepia',
    'theme-nord',
    'theme-rose',
] as const;

const COLOR_VARIABLES = [
    'bg',
    'surface',
    'surface-variant',
    'text-main',
    'text-muted',
    'border',
    'primary',
    'primary-hover',
    'primary-fg',
    'primary-container',
    'primary-container-text',
    'on-surface-variant',
    'outline',
    'outline-variant',
    'inverse-surface',
    'inverse-text',
    'accent-success',
    'accent-warning',
    'accent-error',
    'scrim',
] as const;

type ColorToken = (typeof COLOR_VARIABLES)[number];
void (null as ColorToken | null);

interface EyeDropperInstance {
    open: () => Promise<{ sRGBHex: string }>;
}

interface EyeDropperConstructor {
    new (): EyeDropperInstance;
}

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
    return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`;
}

function normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
    if (shortMatch?.[1]) {
        return `#${shortMatch[1]
            .split('')
            .map((character) => `${character}${character}`)
            .join('')
            .toLowerCase()}`;
    }

    return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
        return null;
    }
    return {
        r: Number.parseInt(normalized.slice(1, 3), 16),
        g: Number.parseInt(normalized.slice(3, 5), 16),
        b: Number.parseInt(normalized.slice(5, 7), 16),
    };
}

function hexToHsl(hex: string) {
    const rgb = hexToRgb(hex);
    if (!rgb) {
        return { h: 0, s: 0, l: 0 };
    }

    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
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
        palette[tone] = rgbToHex(r, g, b);
    }

    return palette;
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
        switch (stored) {
            case 'light':
            case 'material-light':
                return 'daylight';
            case 'sage':
                return 'sepia';
            case 'black':
                return 'ink';
            case 'rose-pine':
                return 'rose';
            case 'dark':
            case 'mocha':
            case 'tokyo-night':
            case 'material-dark':
                return 'midnight';
            default:
                return DEFAULT_THEME;
        }
    } catch {
        return DEFAULT_THEME;
    }
}

/**
 * Reads the persisted adaptive colour, accepting both the canonical `#rrggbb`
 * form and the legacy `"r,g,b"` triple that earlier builds wrote.
 */
function readAdaptiveColor(): { color: string | null; needsRewrite: boolean } {
    if (typeof window === 'undefined') {
        return { color: null, needsRewrite: false };
    }
    try {
        const stored = localStorage.getItem(ADAPTIVE_COLOR_STORAGE_KEY);
        if (!stored) {
            return { color: null, needsRewrite: false };
        }

        const normalized = normalizeHexColor(stored);
        if (normalized) {
            return { color: normalized, needsRewrite: normalized !== stored };
        }

        const legacyParts = stored.split(',').map((part) => Number.parseInt(part.trim(), 10));
        if (
            legacyParts.length === 3 &&
            legacyParts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
        ) {
            const [r, g, b] = legacyParts;
            if (r !== undefined && g !== undefined && b !== undefined) {
                return { color: rgbToHex(r, g, b), needsRewrite: true };
            }
        }
    } catch {
        return { color: null, needsRewrite: false };
    }
    return { color: null, needsRewrite: false };
}

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

function clearAdaptiveStyles(root: HTMLElement) {
    for (const token of COLOR_VARIABLES) {
        root.style.removeProperty(`--color-app-${token}`);
    }
    for (const mode of ['light', 'dark'] as const) {
        for (const token of COLOR_VARIABLES) {
            root.style.removeProperty(`--adaptive-${mode}-${token}`);
        }
    }
    for (const tone of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
        root.style.removeProperty(`--adaptive-${tone}`);
    }
    root.style.removeProperty('--adaptive-primary');
    root.style.removeProperty('--adaptive-primary-light');
    root.style.removeProperty('--adaptive-primary-dark');
    root.style.removeProperty('--adaptive-base');
}

interface ThemeProviderProps {
    children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<ThemeValue>(getInitialTheme);
    const [adaptiveState, setAdaptiveState] = useState(readAdaptiveColor);
    const [adaptiveColorOverride, setAdaptiveColorOverride] = useState<string | null>(null);
    void adaptiveColorOverride;

    useEffect(() => {
        return subscribeToDataImported(() => {
            setThemeState(getInitialTheme());
            const restored = readAdaptiveColor();
            setAdaptiveState(restored);
            if (restored.color) {
                setAdaptiveColorOverride(null);
            }
        });
    }, []);

    useEffect(() => {
        if (!adaptiveState.needsRewrite || !adaptiveState.color) {
            return;
        }
        try {
            localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, adaptiveState.color);
        } catch {
            // Storage is unavailable; the in-memory colour still drives the theme.
        }
    }, [adaptiveState]);

    const effectiveTheme = theme;

    const setTheme = useCallback((newTheme: ThemeValue) => {
        if (!THEMES.includes(newTheme)) {
            return;
        }
        setThemeState(newTheme);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        } catch {
            return;
        }
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        const isDark = DARK_THEMES.has(theme);

        root.classList.remove(...THEME_CLASSES);
        clearAdaptiveStyles(root);

        if (isDark) {
            root.classList.add('dark');
        }
        root.classList.add(`theme-${theme}`);

        root.style.colorScheme = isDark ? 'dark' : 'light';

        return () => {
            root.classList.remove(...THEME_CLASSES);
            clearAdaptiveStyles(root);
            root.style.removeProperty('color-scheme');
        };
    }, [theme]);

    const pickAdaptiveColor = useCallback(async () => {
        if (typeof window === 'undefined') {
            return null;
        }

        const EyeDropperClass = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
        if (!EyeDropperClass) {
            return null;
        }

        try {
            const eyeDropper = new EyeDropperClass();
            const result = await eyeDropper.open();
            const color = normalizeHexColor(result.sRGBHex);
            if (!color) {
                return null;
            }

            setAdaptiveColorOverride(color);
            try {
                localStorage.setItem(ADAPTIVE_COLOR_STORAGE_KEY, color);
            } catch {
                // Storage is unavailable, but the picked colour still applies for
                // this session, so the result is reported either way.
            }
            return { color, palette: generateMaterialPalette(color) };
        } catch {
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
        [effectiveTheme, pickAdaptiveColor, setTheme, theme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
