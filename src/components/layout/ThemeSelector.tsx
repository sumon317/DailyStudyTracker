import { AnimatePresence, motion } from 'framer-motion';
import { Droplets, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../../providers/ThemeProvider';
import type { ThemeSelectorProps, ThemeValue } from '../../types';
import { focusAfterContainer } from '../shared/focusOrder';

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
    const { pickAdaptiveColor } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [isPicking, setIsPicking] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const triggerId = useId();

    const closeMenu = useCallback((restoreFocus = true) => {
        setIsOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus();
        }
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const focusTimer = window.setTimeout(() => {
            menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
        }, 0);
        const handleOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                closeMenu(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
                return;
            }
            if (event.key === 'Tab') {
                // Focus must be able to leave the menu, so hand it to the next
                // control outside the panel instead of dropping it on <body>.
                closeMenu(false);
                focusAfterContainer(menuRef.current, triggerRef.current);
            }
        };

        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenu, isOpen]);

    const handleSelect = useCallback(
        async (value: ThemeValue) => {
            if (value === 'adaptive') {
                setIsPicking(true);
                let result: Awaited<ReturnType<typeof pickAdaptiveColor>> = null;
                try {
                    result = await pickAdaptiveColor();
                } catch {
                    result = null;
                }
                setIsPicking(false);
                if (!result) {
                    // Cancelling the picker is a normal outcome, but a browser
                    // without the EyeDropper API needs an explanation.
                    setStatusMessage(
                        typeof window !== 'undefined' && 'EyeDropper' in window
                            ? 'No colour was picked. Your theme is unchanged.'
                            : 'Colour picking is not supported in this browser. Pick another theme.',
                    );
                    closeMenu();
                    return;
                }
            }
            setTheme(value);
            closeMenu();
        },
        [closeMenu, pickAdaptiveColor, setTheme],
    );

    const currentTheme = THEMES.find((option) => option.value === theme) ?? THEMES[0];
    if (!currentTheme) {
        return null;
    }
    const CurrentIcon = currentTheme.icon;

    return (
        <div className="relative" ref={containerRef}>
            <button
                ref={triggerRef}
                id={triggerId}
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text-muted transition-colors hover:text-app-text-main md-ripple"
                title="Change theme"
                aria-label={`Change theme. Current theme: ${currentTheme.label}`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={isOpen ? menuId : undefined}
            >
                <CurrentIcon size={14} aria-hidden="true" />
                <span className="hidden sm:inline">{currentTheme.label}</span>
            </button>

            <span role="status" aria-live="polite" className="sr-only">
                {statusMessage ?? ''}
            </span>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        ref={menuRef}
                        id={menuId}
                        role="menu"
                        aria-busy={isPicking}
                        aria-label="Theme options"
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-app-outline-variant bg-app-surface shadow-xl md-elevation-3"
                    >
                        <div className="p-2">
                            {THEMES.map((option) => {
                                const OptionIcon = option.icon;
                                const isActive = theme === option.value;
                                const isDisabled = isPicking && option.value === 'adaptive';
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={isActive}
                                        disabled={isDisabled}
                                        onClick={() => void handleSelect(option.value)}
                                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all md-ripple disabled:cursor-wait disabled:opacity-60 ${
                                            isActive
                                                ? 'bg-app-primary-container text-app-primary-container-text'
                                                : 'text-app-text-main hover:bg-app-surface-variant'
                                        }`}
                                    >
                                        <OptionIcon size={16} className="shrink-0" aria-hidden="true" />
                                        <span className="flex-1">
                                            <span className="block font-medium">{option.label}</span>
                                            <span
                                                className={`block text-[10px] ${
                                                    isActive
                                                        ? 'text-app-primary-container-text/80'
                                                        : 'text-app-text-muted'
                                                }`}
                                            >
                                                {isPicking && option.value === 'adaptive'
                                                    ? 'Choosing color…'
                                                    : option.description}
                                            </span>
                                        </span>
                                        {isActive && (
                                            <span className="h-2 w-2 rounded-full bg-app-primary" aria-hidden="true" />
                                        )}
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

export default ThemeSelector;
