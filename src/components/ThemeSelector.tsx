import { AnimatePresence, motion } from 'framer-motion';
import { Droplets, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeSelectorProps, ThemeValue } from '../types';

interface ThemeOption {
    value: ThemeValue;
    label: string;
    icon: typeof Sun;
    description: string;
}

const THEMES: ThemeOption[] = [
    { value: 'light', label: 'Light', icon: Sun, description: 'Clean light theme' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes' },
    { value: 'auto', label: 'Auto', icon: Monitor, description: 'Follows system' },
    { value: 'material-light', label: 'Material', icon: Palette, description: 'Material You light' },
    { value: 'material-dark', label: 'Material Dark', icon: Palette, description: 'Material You dark' },
    { value: 'adaptive', label: 'Adaptive', icon: Droplets, description: 'Pick your color' },
];

const ThemeSelector = memo(({ theme, setTheme }: ThemeSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleAdaptivePick = useCallback(async () => {
        try {
            const EyeDropperClass = (
                window as unknown as Record<string, new () => { open: () => Promise<{ sRGBHex: string }> }>
            ).EyeDropper;
            if (!EyeDropperClass) {
                return;
            }
            const eyeDropper = new EyeDropperClass();
            const result = await eyeDropper.open();
            const hex = result.sRGBHex;
            const r = Number.parseInt(hex.slice(1, 3), 16);
            const g = Number.parseInt(hex.slice(3, 5), 16);
            const b = Number.parseInt(hex.slice(5, 7), 16);
            localStorage.setItem('adaptive-color', `${r},${g},${b}`);
            applyAdaptiveColors(r, g, b, document.documentElement.classList.contains('dark'));
        } catch (_e) {
            const r = 0;
            const g = 110;
            const b = 100;
            localStorage.setItem('adaptive-color', `${r},${g},${b}`);
            applyAdaptiveColors(r, g, b, document.documentElement.classList.contains('dark'));
        }
    }, []);

    const currentTheme = THEMES.find((t) => t.value === theme);
    if (!currentTheme) {
        return null;
    }
    const Icon = currentTheme.icon;

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text-muted hover:text-app-text-main transition-colors md-ripple"
                title="Change theme"
                aria-label="Change theme"
            >
                <Icon size={14} />
                <span className="hidden sm:inline">{currentTheme.label}</span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-2 z-50 w-56 rounded-2xl border border-app-outline-variant bg-app-surface shadow-xl overflow-hidden md-elevation-3"
                    >
                        <div className="p-2">
                            {THEMES.map((t) => {
                                const TIcon = t.icon;
                                const isActive = theme === t.value;
                                return (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => {
                                            if (t.value === 'adaptive') {
                                                handleAdaptivePick().then(() => {
                                                    setTheme('adaptive');
                                                    setIsOpen(false);
                                                });
                                            } else {
                                                setTheme(t.value);
                                                setIsOpen(false);
                                            }
                                        }}
                                        className={`flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all md-ripple
                                            ${
                                                isActive
                                                    ? 'bg-app-primary-container text-app-primary-container-text'
                                                    : 'text-app-text-main hover:bg-app-surface-variant'
                                            }
                                        `}
                                    >
                                        <TIcon size={16} className="shrink-0" />
                                        <div className="flex-1 text-left">
                                            <div className="font-medium">{t.label}</div>
                                            <div
                                                className={`text-[10px] ${isActive ? 'text-app-primary-container-text/70' : 'text-app-text-muted'}`}
                                            >
                                                {t.description}
                                            </div>
                                        </div>
                                        {isActive && <div className="w-2 h-2 rounded-full bg-app-primary" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

ThemeSelector.displayName = 'ThemeSelector';

function applyAdaptiveColors(r: number, g: number, b: number, isDark: boolean) {
    const palette = generateMaterialPalette(r, g, b, isDark);
    const root = document.documentElement;
    const style = root.style;
    style.setProperty('--color-app-bg', palette.bg.join(' '));
    style.setProperty('--color-app-surface', palette.surface.join(' '));
    style.setProperty('--color-app-surface-variant', palette.surfaceVariant.join(' '));
    style.setProperty('--color-app-text-main', palette.textMain.join(' '));
    style.setProperty('--color-app-text-muted', palette.textMuted.join(' '));
    style.setProperty('--color-app-border', palette.border.join(' '));
    style.setProperty('--color-app-primary', palette.primary.join(' '));
    style.setProperty('--color-app-primary-hover', palette.primaryHover.join(' '));
    style.setProperty('--color-app-primary-fg', palette.primaryFg.join(' '));
    style.setProperty('--color-app-primary-container', palette.primaryContainer.join(' '));
    style.setProperty('--color-app-primary-container-text', palette.primaryContainerText.join(' '));
    style.setProperty('--color-app-on-surface-variant', palette.onSurfaceVariant.join(' '));
    style.setProperty('--color-app-outline', palette.outline.join(' '));
    style.setProperty('--color-app-outline-variant', palette.outlineVariant.join(' '));
}

function generateMaterialPalette(seedR: number, seedG: number, seedB: number, isDark = false) {
    const r = seedR / 255;
    const g = seedG / 255;
    const b = seedB / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max === min) {
        h = 0;
        s = 0;
    } else {
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
                h = 0;
        }
    }

    const primaryS = isDark ? Math.max(s, 0.5) : Math.max(s, 0.6);
    const primaryL = isDark ? 0.65 : 0.45;
    const primary = hslToRgb(h, primaryS, primaryL);
    const pcS = isDark ? 0.5 : 0.7;
    const pcL = isDark ? 0.3 : 0.85;
    const primaryContainer = hslToRgb(h, pcS, pcL);

    if (isDark) {
        return {
            bg: [16, 18, 22],
            surface: [28, 30, 36],
            surfaceVariant: [56, 58, 66],
            textMain: [228, 228, 236],
            textMuted: [160, 162, 174],
            border: [60, 62, 70],
            primary,
            primaryHover: hslToRgb(h, primaryS, Math.min(primaryL + 0.1, 0.9)),
            primaryFg: hslToRgb(h, 0.6, 0.2),
            primaryContainer,
            primaryContainerText: hslToRgb(h, 0.6, 0.9),
            onSurfaceVariant: [188, 190, 198],
            outline: [128, 130, 138],
            outlineVariant: [56, 58, 66],
        };
    }

    return {
        bg: [247, 249, 252],
        surface: [255, 255, 255],
        surfaceVariant: [228, 230, 236],
        textMain: [28, 28, 32],
        textMuted: [92, 92, 108],
        border: [216, 218, 226],
        primary,
        primaryHover: hslToRgb(h, primaryS, Math.max(primaryL - 0.1, 0.2)),
        primaryFg: [255, 255, 255],
        primaryContainer,
        primaryContainerText: hslToRgb(h, 0.6, 0.2),
        onSurfaceVariant: [68, 70, 78],
        outline: [188, 190, 198],
        outlineVariant: [228, 230, 236],
    };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r = 0;
    let g = 0;
    let b = 0;

    if (s === 0) {
        r = l;
        g = l;
        b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            let tt = t;
            if (tt < 0) {
                tt += 1;
            }
            if (tt > 1) {
                tt -= 1;
            }
            if (tt < 1 / 6) {
                return p + (q - p) * 6 * tt;
            }
            if (tt < 1 / 2) {
                return q;
            }
            if (tt < 2 / 3) {
                return p + (q - p) * (2 / 3 - tt) * 6;
            }
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export default ThemeSelector;
