import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Eclipse, Flower2, Moon, Snowflake, Sun } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ThemeSelectorProps, ThemeValue } from '../../types';
import { focusAfterContainer } from '../shared/focusOrder';

interface ThemeOption {
    value: ThemeValue;
    label: string;
    icon: typeof Sun;
    description: string;
    swatchBg: string;
    swatchAccent: string;
    isLightIcon?: boolean;
}

const THEMES: ThemeOption[] = [
    {
        value: 'midnight',
        label: 'Midnight',
        icon: Moon,
        description: 'Classic dark palette',
        swatchBg: 'bg-[#101216] border-[#3C3E46]',
        swatchAccent: 'bg-[#8CC6FF]',
    },
    {
        value: 'daylight',
        label: 'Daylight',
        icon: Sun,
        description: 'Clean light & blue accent',
        swatchBg: 'bg-[#F7F9FC] border-[#D8DAE2]',
        swatchAccent: 'bg-[#0062A0]',
        isLightIcon: true,
    },
    {
        value: 'ink',
        label: 'Ink',
        icon: Eclipse,
        description: 'True-black OLED & crisp sans',
        swatchBg: 'bg-[#000000] border-[#22242A]',
        swatchAccent: 'bg-[#70B8FF]',
    },
    {
        value: 'sepia',
        label: 'Sepia',
        icon: BookOpen,
        description: 'Warm paper & bookish serif',
        swatchBg: 'bg-[#F6EFE0] border-[#DACAEE]',
        swatchAccent: 'bg-[#B45309]',
        isLightIcon: true,
    },
    {
        value: 'nord',
        label: 'Nord',
        icon: Snowflake,
        description: 'Cool frost blue-gray & cyan',
        swatchBg: 'bg-[#2E3440] border-[#4C566A]',
        swatchAccent: 'bg-[#88C0D0]',
    },
    {
        value: 'rose',
        label: 'Rose',
        icon: Flower2,
        description: 'Deep plum dark & rose pink',
        swatchBg: 'bg-[#191724] border-[#403D52]',
        swatchAccent: 'bg-[#EB6F92]',
    },
];

const ThemeSelector = memo(({ theme, setTheme }: ThemeSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
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
        (value: ThemeValue) => {
            setTheme(value);
            closeMenu();
        },
        [closeMenu, setTheme],
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
                className="flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-xs font-medium text-app-text-muted transition-colors hover:text-app-text-main md-ripple"
                title="Change theme"
                aria-label={`Change theme. Current theme: ${currentTheme.label}`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={isOpen ? menuId : undefined}
            >
                <CurrentIcon size={14} className="text-app-primary" aria-hidden="true" />
                <span className="hidden sm:inline">{currentTheme.label}</span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        ref={menuRef}
                        id={menuId}
                        role="menu"
                        aria-label="Theme options"
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-app-outline-variant bg-app-surface shadow-xl md-elevation-3"
                    >
                        <div className="p-2 space-y-0.5">
                            {THEMES.map((option) => {
                                const OptionIcon = option.icon;
                                const isActive = theme === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={isActive}
                                        onClick={() => handleSelect(option.value)}
                                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all md-ripple ${
                                            isActive
                                                ? 'bg-app-primary-container text-app-primary-container-text font-medium'
                                                : 'text-app-text-main hover:bg-app-surface-variant'
                                        }`}
                                    >
                                        <span
                                            className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${option.swatchBg}`}
                                            aria-hidden="true"
                                        >
                                            <OptionIcon
                                                size={14}
                                                className={option.isLightIcon ? 'text-stone-800' : 'text-slate-100'}
                                            />
                                            <span
                                                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-app-surface ${option.swatchAccent}`}
                                            />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block font-medium leading-tight">{option.label}</span>
                                            <span
                                                className={`block truncate text-[10px] ${
                                                    isActive
                                                        ? 'text-app-primary-container-text/80'
                                                        : 'text-app-text-muted'
                                                }`}
                                            >
                                                {option.description}
                                            </span>
                                        </span>
                                        {isActive && (
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-full bg-app-primary"
                                                aria-hidden="true"
                                            />
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
