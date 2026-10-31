import { AnimatePresence, motion } from 'framer-motion';
import { Download, FileText, MoreVertical, RefreshCw, Save, Upload } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../providers/DataProvider';
import { useTheme } from '../../providers/ThemeProvider';
import type { HeaderProps } from '../../types';
import { formatHours } from '../charts/metrics';
import DatePicker from '../shared/DatePicker';
import { focusAfterContainer, getFocusableElements } from '../shared/focusOrder';
import ThemeSelector from './ThemeSelector';

/**
 * The app header: the date, the save state, the theme selector and the export actions.
 *
 * It lives in its own module because it is a component like every other one in the app, and
 * because the keyboard handling it owns - the menu's focus trap, the direction-aware Tab that
 * hands focus back to a control outside the panel - is long enough to bury the shell it was
 * written in.
 */

const headerAnimation = { opacity: 0, y: -20 };
const headerAnimateIn = { opacity: 1, y: 0 };

const FOCUSABLE_MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

const focusBeforeContainer = (container: HTMLElement | null, fallback?: HTMLElement | null): void => {
    if (!container) {
        fallback?.focus();
        return;
    }

    const focusable = getFocusableElements(document);
    const firstInside = focusable.find((element) => container.contains(element));
    const index = firstInside === undefined ? -1 : focusable.indexOf(firstInside);
    const previous =
        index > 0
            ? focusable[index - 1]
            : focusable.find(
                  (element) => (element.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              );

    (previous ?? fallback ?? container).focus();
};

const Header = memo(
    ({
        hasUnsavedChanges,
        isSaving,
        lastSaved,
        onSave,
        onDownloadPDF,
        onDownloadMD,
        onExport,
        onImportClick,
        onCheckForUpdates,
        isCheckingUpdate,
    }: HeaderProps) => {
        const { date, setDate, subjects } = useData();
        const { theme, setTheme } = useTheme();
        const [menuOpen, setMenuOpen] = useState(false);
        const menuRef = useRef<HTMLDivElement>(null);
        const menuButtonRef = useRef<HTMLButtonElement>(null);
        const menuPanelRef = useRef<HTMLDivElement>(null);

        // Activating a menu item unmounts the panel while it still holds focus,
        // which drops the caret on <body> and restarts the tab sequence from the
        // top of the page. Handing focus back to the trigger keeps the keyboard
        // where the user was.
        const closeMenu = useCallback((restoreFocus: boolean) => {
            setMenuOpen(false);
            if (restoreFocus) {
                menuButtonRef.current?.focus();
            }
        }, []);

        useEffect(() => {
            if (!menuOpen) {
                return;
            }
            const handleClickOutside = (e: Event) => {
                if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                    closeMenu(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
                document.removeEventListener('touchstart', handleClickOutside);
            };
        }, [closeMenu, menuOpen]);

        useEffect(() => {
            if (!menuOpen) {
                return;
            }
            const focusTimer = window.setTimeout(() => {
                menuPanelRef.current?.querySelector<HTMLButtonElement>(FOCUSABLE_MENU_ITEM_SELECTOR)?.focus();
            }, 0);
            return () => window.clearTimeout(focusTimer);
        }, [menuOpen]);

        const handleMenuKeyDown = useCallback(
            (event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Tab') {
                    // Let focus leave the menu, but hand it to a real control
                    // outside the panel rather than letting the panel disappear
                    // from under the caret. Direction matters: sending a
                    // backwards Tab *forwards* - which is what always calling
                    // `focusAfterContainer` did - dropped the user past the
                    // trigger they had just opened the menu from, so Shift+Tab
                    // was the one way out that moved the wrong way.
                    //
                    // The default is cancelled because focus is being moved by
                    // hand: leaving the browser's own Tab to run as well moved
                    // focus twice, once in each direction, and the second move
                    // won.
                    event.preventDefault();
                    closeMenu(false);
                    if (event.shiftKey) {
                        focusBeforeContainer(menuPanelRef.current, menuButtonRef.current);
                    } else {
                        focusAfterContainer(menuPanelRef.current, menuButtonRef.current);
                    }
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu(true);
                    return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    return;
                }
                const items = [
                    ...(menuPanelRef.current?.querySelectorAll<HTMLButtonElement>(FOCUSABLE_MENU_ITEM_SELECTOR) ?? []),
                ];
                if (items.length === 0) {
                    return;
                }
                event.preventDefault();
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : event.key === 'ArrowDown'
                            ? (currentIndex + 1 + items.length) % items.length
                            : (currentIndex - 1 + items.length) % items.length;
                items[nextIndex]?.focus();
            },
            [closeMenu],
        );

        return (
            <header className="sticky top-0 z-50 bg-app-bg/80 backdrop-blur-md w-full border-b border-app-border mb-2 sm:mb-6">
                <motion.div
                    initial={headerAnimation}
                    animate={headerAnimateIn}
                    transition={{ duration: 0.5 }}
                    className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-4"
                >
                    {/* Desktop: Title + Save */}
                    <div className="hidden sm:block min-w-0">
                        <p className="text-3xl font-bold tracking-tight text-app-primary truncate">
                            Daily Study Tracker
                        </p>
                        <div className="flex items-center gap-2 text-app-text-muted text-sm">
                            <span>
                                Target:{' '}
                                {formatHours(subjects.reduce((acc, s) => acc + (Number.parseFloat(s.planned) || 0), 0))}
                            </span>
                            <span>•</span>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={isSaving || !hasUnsavedChanges}
                                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg
                                ${
                                    hasUnsavedChanges
                                        ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                                        : 'bg-app-surface text-app-text-muted border border-app-border'
                                }
                                ${isSaving ? 'opacity-70 cursor-wait' : ''}
                            `}
                            >
                                {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
                            </button>
                            {lastSaved && !hasUnsavedChanges && (
                                <span className="text-xs text-app-text-muted">
                                    {new Date(lastSaved).toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Mobile: Date + Save */}
                    <div className="flex sm:hidden items-center gap-2 flex-1 min-w-0">
                        <div className="shrink-0">
                            <DatePicker date={date} setDate={setDate} compact />
                        </div>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={isSaving || !hasUnsavedChanges}
                            className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg
                            ${
                                hasUnsavedChanges
                                    ? 'bg-app-primary text-white hover:bg-app-primary-hover shadow-md'
                                    : 'bg-app-surface text-app-text-muted border border-app-border'
                            }
                            ${isSaving ? 'opacity-70 cursor-wait' : ''}
                        `}
                        >
                            <Save size={11} aria-hidden="true" />
                            {isSaving ? '...' : hasUnsavedChanges ? 'Save' : 'Saved'}
                        </button>
                    </div>

                    {/* Right: Theme + Actions */}
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <ThemeSelector theme={theme} setTheme={setTheme} />

                        {/* Desktop: show all buttons */}
                        <div className="hidden sm:flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onExport}
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                title="Backup"
                                aria-label="Download backup"
                            >
                                <Save size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Backup</span>
                            </button>
                            <button
                                type="button"
                                onClick={onImportClick}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                title="Restore"
                                aria-label="Restore backup"
                            >
                                <Upload size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Restore</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadPDF}
                                className="flex items-center gap-2 rounded-lg bg-app-primary px-3 py-2 font-medium text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="Export PDF"
                            >
                                <Download size={16} aria-hidden="true" />
                                <span className="hidden md:inline">PDF</span>
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadMD}
                                className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-medium text-app-text-main shadow-sm transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="Export Markdown"
                            >
                                <FileText size={16} aria-hidden="true" />
                                <span className="hidden md:inline">Markdown</span>
                            </button>
                        </div>

                        {/* Mobile: overflow menu */}
                        <div className="relative sm:hidden" ref={menuRef}>
                            <button
                                ref={menuButtonRef}
                                type="button"
                                onClick={() => setMenuOpen((prev) => !prev)}
                                className="p-2 rounded-lg border border-app-border bg-app-surface text-app-text-muted hover:text-app-text-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
                                aria-label="More options"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                aria-controls={menuOpen ? 'header-more-menu' : undefined}
                            >
                                <MoreVertical size={18} aria-hidden="true" />
                            </button>
                            <AnimatePresence>
                                {menuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                        transition={{ duration: 0.12 }}
                                        id="header-more-menu"
                                        ref={menuPanelRef}
                                        role="menu"
                                        aria-label="More options"
                                        aria-orientation="vertical"
                                        onKeyDown={handleMenuKeyDown}
                                        className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-app-border bg-app-surface shadow-xl overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onExport();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary"
                                        >
                                            <Save size={16} className="text-app-primary" aria-hidden="true" /> Backup
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onImportClick();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <Upload size={16} className="text-app-primary" aria-hidden="true" /> Restore
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onDownloadPDF();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <Download size={16} className="text-app-primary" aria-hidden="true" />{' '}
                                            Export PDF
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                onDownloadMD();
                                                closeMenu(true);
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border"
                                        >
                                            <FileText size={16} className="text-app-primary" aria-hidden="true" />{' '}
                                            Export MD
                                        </button>
                                        {onCheckForUpdates && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    onCheckForUpdates();
                                                    closeMenu(true);
                                                }}
                                                disabled={isCheckingUpdate}
                                                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-app-text-main hover:bg-app-bg transition-colors focus-visible:outline-none focus-visible:bg-app-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary border-t border-app-border disabled:opacity-50"
                                            >
                                                {isCheckingUpdate ? (
                                                    <>
                                                        <RefreshCw
                                                            size={16}
                                                            className="animate-spin text-app-primary"
                                                            aria-hidden="true"
                                                        />{' '}
                                                        Checking...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw
                                                            size={16}
                                                            className="text-app-primary"
                                                            aria-hidden="true"
                                                        />{' '}
                                                        Check Updates
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            </header>
        );
    },
);

Header.displayName = 'Header';

export default Header;
