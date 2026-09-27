import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
// The media-query resolution and its three-surface subscription fallback live in
// one place. This file used to carry a byte-identical private copy of both,
// which meant the fallback order the comment here described and the order the
// code actually used were free to drift apart.
import { resolveMediaQuery, subscribeToMediaQuery } from '../app/reducedMotion';
import { subscribeToDataImported } from '../services/dataImportEvents';
import type { ThemeContextValue, ThemeValue } from '../types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = 'theme';
export const ADAPTIVE_COLOR_STORAGE_KEY = 'adaptive-color';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

const THEMES: ThemeValue[] = ['light', 'dark', 'auto', 'material-light', 'material-dark', 'adaptive'];
const DEFAULT_THEME: ThemeValue = 'light';
const DEFAULT_ADAPTIVE_COLOR = '#006e64';
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
type AdaptiveTokenSet = Record<ColorToken, string>;

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

function relativeLuminance(hex: string): number {
    const rgb = hexToRgb(hex);
    if (!rgb) {
        return 0;
    }
    const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function contrastColor(background: string, light = '#ffffff', dark = '#1c1c20'): string {
    return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

function rgbString(hex: string): string {
    const rgb = hexToRgb(hex);
    return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : '0 0 0';
}

function buildAdaptiveTokens(color: string): { light: AdaptiveTokenSet; dark: AdaptiveTokenSet } {
    const palette = generateMaterialPalette(color);
    const lightPrimary = palette[600] ?? color;
    const darkPrimary = palette[300] ?? color;
    const lightContainer = palette[100] ?? color;
    const darkContainer = palette[700] ?? color;

    const light: AdaptiveTokenSet = {
        bg: '247 249 252',
        surface: '255 255 255',
        'surface-variant': rgbString(palette[100] ?? '#e4e6ec'),
        'text-main': '28 28 32',
        'text-muted': '80 88 96',
        border: '200 211 214',
        primary: rgbString(lightPrimary),
        'primary-hover': rgbString(palette[700] ?? lightPrimary),
        'primary-fg': rgbString(contrastColor(lightPrimary)),
        'primary-container': rgbString(lightContainer),
        'primary-container-text': rgbString(contrastColor(lightContainer, '#102a2a', '#ffffff')),
        'on-surface-variant': '68 70 78',
        outline: '160 178 181',
        'outline-variant': rgbString(palette[200] ?? '#e4e6ec'),
        'inverse-surface': '48 48 54',
        'inverse-text': '236 236 242',
        'accent-success': '0 128 64',
        'accent-warning': '146 92 0',
        'accent-error': '186 26 26',
        scrim: '0 0 0',
    };

    const dark: AdaptiveTokenSet = {
        bg: '16 20 22',
        surface: '24 30 32',
        'surface-variant': rgbString(palette[800] ?? '#343a40'),
        'text-main': '228 235 234',
        'text-muted': '164 177 175',
        border: rgbString(palette[700] ?? '#384042'),
        primary: rgbString(darkPrimary),
        'primary-hover': rgbString(palette[200] ?? darkPrimary),
        'primary-fg': rgbString(contrastColor(darkPrimary, '#102a2a', '#ffffff')),
        'primary-container': rgbString(darkContainer),
        'primary-container-text': rgbString(contrastColor(darkContainer, '#ffffff', '#102a2a')),
        'on-surface-variant': '188 198 196',
        outline: '116 132 130',
        'outline-variant': rgbString(palette[700] ?? '#343a40'),
        'inverse-surface': '228 235 234',
        'inverse-text': '24 30 32',
        'accent-success': '100 200 140',
        'accent-warning': '245 190 70',
        'accent-error': '255 140 140',
        scrim: '0 0 0',
    };

    return { light, dark };
}

function getSystemPrefersDark() {
    return resolveMediaQuery(DARK_SCHEME_QUERY)?.matches ?? false;
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
        return DEFAULT_THEME;
    }
    return DEFAULT_THEME;
}

/**
 * Reads the persisted adaptive colour, accepting both the canonical `#rrggbb`
 * form and the legacy `"r,g,b"` triple that earlier builds wrote.
 *
 * Returns the value *and* whether storage still needs rewriting. The rewrite is
 * deliberately not done here: this runs from a `useState` initialiser, and a
 * render must not mutate anything outside React. The effect that consumes
 * `needsRewrite` performs the write once per mount.
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

function useSystemTheme() {
    const [prefersDark, setPrefersDark] = useState(getSystemPrefersDark);

    useEffect(() => {
        const mediaQuery = resolveMediaQuery(DARK_SCHEME_QUERY);
        const unsubscribe = subscribeToMediaQuery(mediaQuery, (event) => setPrefersDark(event.matches));
        if (mediaQuery) {
            setPrefersDark(mediaQuery.matches);
        }
        return unsubscribe;
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

function applyAdaptiveStyles(root: HTMLElement, color: string, isDark: boolean) {
    const tokens = buildAdaptiveTokens(color);
    const palette = generateMaterialPalette(color);

    for (const mode of ['light', 'dark'] as const) {
        for (const token of COLOR_VARIABLES) {
            root.style.setProperty(`--adaptive-${mode}-${token}`, tokens[mode][token]);
        }
    }

    for (const tone of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
        root.style.setProperty(`--adaptive-${tone}`, palette[tone] ?? color);
    }

    root.style.setProperty('--adaptive-primary', isDark ? (palette[300] ?? color) : (palette[600] ?? color));
    root.style.setProperty('--adaptive-primary-light', palette[200] ?? color);
    root.style.setProperty('--adaptive-primary-dark', palette[700] ?? color);
    root.style.setProperty('--adaptive-base', color);

    const activeTokens = isDark ? tokens.dark : tokens.light;
    for (const token of COLOR_VARIABLES) {
        root.style.setProperty(`--color-app-${token}`, activeTokens[token]);
    }
}

interface ThemeProviderProps {
    children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<ThemeValue>(getInitialTheme);
    const [adaptiveState, setAdaptiveState] = useState(readAdaptiveColor);
    const [adaptiveColorOverride, setAdaptiveColorOverride] = useState<string | null>(null);
    const prefersDark = useSystemTheme();
    const adaptiveColor = adaptiveColorOverride ?? adaptiveState.color;

    // A restore can carry a different theme. This provider reads its value once,
    // at mount, so without this the backup's theme was applied to the store and
    // then ignored on screen until the app was closed and reopened.
    useEffect(() => {
        return subscribeToDataImported(() => {
            setThemeState(getInitialTheme());
            const restored = readAdaptiveColor();
            setAdaptiveState(restored);
            // A colour picked earlier in this session outranks the store, which
            // is exactly what keeps the *picked* colour on screen across a
            // restore that changed nothing. It also meant a restore that *did*
            // carry a different colour was applied to the store and then ignored
            // for the rest of the session - the same bug this effect already
            // fixed for the theme. A colour in the restored store is the newer
            // intent and takes over; a restore that carries none is not an
            // instruction to throw away a choice the user made this session.
            if (restored.color) {
                setAdaptiveColorOverride(null);
            }
        });
    }, []);

    // A legacy `"r,g,b"` value is migrated to the canonical hex form here
    // rather than during the render that read it.
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

    const effectiveTheme = useMemo(() => {
        if (theme === 'auto') {
            return prefersDark ? 'dark' : 'light';
        }
        return theme;
    }, [prefersDark, theme]);

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
        const isDark =
            effectiveTheme === 'dark' ||
            effectiveTheme === 'material-dark' ||
            (effectiveTheme === 'adaptive' && prefersDark);

        root.classList.remove('dark', 'theme-material-light', 'theme-material-dark', 'theme-adaptive');
        clearAdaptiveStyles(root);

        if (isDark) {
            root.classList.add('dark');
        }
        if (theme === 'material-light') {
            root.classList.add('theme-material-light');
        } else if (theme === 'material-dark') {
            root.classList.add('theme-material-dark');
        } else if (theme === 'adaptive') {
            root.classList.add('theme-adaptive');
            applyAdaptiveStyles(root, adaptiveColor ?? DEFAULT_ADAPTIVE_COLOR, isDark);
        }

        root.style.colorScheme = isDark ? 'dark' : 'light';

        // `<html>` outlives the provider whenever the provider is mounted
        // conditionally, so the classes and the ~200 inline adaptive variables
        // have to be taken back off on the way out. Without this the next
        // provider to mount - or the next test in the same document - inherits a
        // palette and a colour scheme that nothing chose.
        return () => {
            root.classList.remove('dark', 'theme-material-light', 'theme-material-dark', 'theme-adaptive');
            clearAdaptiveStyles(root);
            root.style.removeProperty('color-scheme');
        };
    }, [adaptiveColor, effectiveTheme, prefersDark, theme]);

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
