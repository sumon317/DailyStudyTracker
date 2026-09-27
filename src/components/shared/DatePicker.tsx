import { AnimatePresence, motion } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { announcePersistenceError } from '../../services/persistenceEvents';
import type { DatePickerProps } from '../../types';
import {
    addLocalDays,
    getDaysInLocalMonth,
    getMonthKey,
    getTodayLocalDate,
    isValidDateKey,
    localDateKeyFromParts,
    parseLocalDate,
    shiftMonthKey,
} from '../../utils/dateUtils';

const GRID_ROLE = 'grid' as const;
const GRID_CELL_ROLE = 'gridcell' as const;
const WEEKS_IN_MAX_MONTH = 6;

// The three label shapes are fixed, so the formatters are built once instead of
// once per rendered day (31 per month).
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
});
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

const WEEKDAYS = [
    { short: 'Su', long: 'Sunday' },
    { short: 'Mo', long: 'Monday' },
    { short: 'Tu', long: 'Tuesday' },
    { short: 'We', long: 'Wednesday' },
    { short: 'Th', long: 'Thursday' },
    { short: 'Fr', long: 'Friday' },
    { short: 'Sa', long: 'Saturday' },
];

const formatDateLabel = (dateKey: string, formatter: Intl.DateTimeFormat): string => {
    const parsed = parseLocalDate(dateKey);
    return parsed ? formatter.format(parsed) : '';
};

interface DayButtonProps {
    dateKey: string;
    day: number;
    fullDateLabel: string;
    isSelected: boolean;
    isToday: boolean;
    isFocused: boolean;
    buttonRef: (element: HTMLButtonElement | null) => void;
    onSelect: (dateKey: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const DayButton = memo(
    ({
        dateKey,
        day,
        fullDateLabel,
        isSelected,
        isToday,
        isFocused,
        buttonRef,
        onSelect,
        onKeyDown,
    }: DayButtonProps) => (
        <button
            ref={buttonRef}
            type="button"
            data-date={dateKey}
            tabIndex={isFocused ? 0 : -1}
            onClick={() => onSelect(dateKey)}
            onKeyDown={onKeyDown}
            aria-label={`${fullDateLabel}${isToday ? ', today' : ''}${isSelected ? ', selected' : ''}`}
            aria-current={isToday ? 'date' : undefined}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-app-primary focus-visible:ring-offset-1 sm:h-9 sm:w-9 sm:text-sm ${
                isSelected
                    ? 'bg-app-primary text-app-primary-fg shadow-sm'
                    : isToday
                      ? 'bg-app-primary/10 font-bold text-app-primary'
                      : 'text-app-text-main hover:bg-app-bg'
            }`}
        >
            {day}
        </button>
    ),
);

DayButton.displayName = 'DayButton';

const DatePicker = memo(({ date, setDate, compact = false }: DatePickerProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [todayKey, setTodayKey] = useState(getTodayLocalDate);
    const initialDateKey = isValidDateKey(date) ? date : todayKey;
    const [viewDateKey, setViewDateKey] = useState(() => getMonthKey(initialDateKey) ?? getTodayLocalDate());
    const [focusedDateKey, setFocusedDateKey] = useState(initialDateKey);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const dayRefCallbacks = useRef<Map<string, (element: HTMLButtonElement | null) => void>>(new Map());
    const shouldMoveFocusRef = useRef(true);
    const pickerId = useId();
    const labelId = `${pickerId}-label`;
    const valueId = `${pickerId}-value`;
    const dialogTitleId = `${pickerId}-dialog-title`;
    const monthLabelId = `${pickerId}-month-label`;
    const instructionsId = `${pickerId}-instructions`;

    const selectedDateKey = isValidDateKey(date) ? date : todayKey;

    const closePicker = useCallback((restoreFocus = true) => {
        setIsOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus();
        }
    }, []);

    /**
     * "Today" is a moving target for an installed app that can stay open for
     * days, so the highlighted day and the `, today` label are re-read when the
     * tab comes back to the foreground and just after local midnight.
     */
    useEffect(() => {
        let cancelled = false;
        let midnightTimer = 0;

        const syncToday = () => {
            setTodayKey(getTodayLocalDate());
        };
        const handleForeground = () => {
            if (document.visibilityState === 'visible') {
                syncToday();
            }
        };
        /**
         * Re-armed after every midnight rather than scheduled once: a dashboard
         * left open on a tablet can run through several nights, and a one-shot
         * timer would freeze the highlight on whichever day it first crossed.
         */
        const scheduleNextMidnight = () => {
            if (cancelled) {
                return;
            }
            const now = new Date();
            const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
            // The extra second keeps the read on the far side of the rollover, so
            // a timer that fires a few milliseconds early cannot land on the
            // day that has just ended.
            midnightTimer = window.setTimeout(
                () => {
                    syncToday();
                    scheduleNextMidnight();
                },
                nextMidnight - now.getTime() + 1000,
            );
        };

        scheduleNextMidnight();
        document.addEventListener('visibilitychange', handleForeground);
        window.addEventListener('focus', handleForeground);
        return () => {
            cancelled = true;
            window.clearTimeout(midnightTimer);
            document.removeEventListener('visibilitychange', handleForeground);
            window.removeEventListener('focus', handleForeground);
        };
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setViewDateKey(getMonthKey(selectedDateKey) ?? todayKey);
            setFocusedDateKey(selectedDateKey);
        }
    }, [isOpen, selectedDateKey, todayKey]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleOutside = (event: Event) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                closePicker(false);
            }
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePicker();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }
            // The day grid uses a roving tabindex, so the browser only ever
            // sees a single tab stop inside the calendar and can move focus on
            // by itself. The calendar is closed (without reclaiming focus, so
            // the browser's own move still wins) to avoid leaving an open panel
            // stranded behind the newly focused element.
            closePicker(false);
        };

        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePicker, isOpen]);

    const calendarData = useMemo(() => {
        const viewKey = getMonthKey(viewDateKey) ?? getMonthKey(selectedDateKey) ?? getMonthKey(todayKey) ?? todayKey;
        const view = parseLocalDate(viewKey) ?? new Date();
        const year = view.getFullYear();
        const month = view.getMonth();
        const daysInMonth = getDaysInLocalMonth(year, month);
        // `viewKey` is always the first of a month, so its weekday is the number
        // of leading blank cells the grid needs.
        const leadingBlanks = view.getDay();
        const weekCount = Math.min(Math.ceil((leadingBlanks + daysInMonth) / 7), WEEKS_IN_MAX_MONTH);
        const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
            const day = index - leadingBlanks + 1;
            const dateKey = day < 1 || day > daysInMonth ? null : localDateKeyFromParts(year, month, day);
            // The label is built here rather than during the row render: the
            // whole grid re-renders on every arrow key, and 31-42 fresh `Date`
            // constructions plus `Intl` formats per keystroke is the one part of
            // a keystroke that does not depend on the key at all.
            return {
                key: dateKey ?? `empty-${year}-${month}-${index}`,
                day,
                dateKey,
                fullDateLabel: dateKey ? formatDateLabel(dateKey, FULL_DATE_FORMATTER) : '',
            };
        });
        return { year, month, weekCount, cells };
    }, [selectedDateKey, todayKey, viewDateKey]);

    useEffect(() => {
        if (!isOpen) {
            shouldMoveFocusRef.current = true;
            return;
        }

        const targetKey = calendarData.cells.some((cell) => cell.dateKey === focusedDateKey)
            ? focusedDateKey
            : (calendarData.cells.find((cell) => cell.dateKey !== null)?.dateKey ?? null);
        if (!targetKey || !shouldMoveFocusRef.current) {
            return;
        }
        shouldMoveFocusRef.current = false;
        dayRefs.current[targetKey]?.focus({ preventScroll: true });
    }, [calendarData, focusedDateKey, isOpen]);

    const moveFocus = useCallback((targetKey: string | null) => {
        if (!targetKey) {
            return;
        }
        const monthKey = getMonthKey(targetKey);
        if (!monthKey) {
            return;
        }
        shouldMoveFocusRef.current = true;
        setFocusedDateKey(targetKey);
        setViewDateKey(monthKey);
    }, []);

    /**
     * Pages by whole months while keeping the day of the month, clamped to the
     * last day of a shorter target month (Jan 31 -> Feb 29). Keyboard paging and
     * the header buttons go through the same path so the two cannot drift apart.
     */
    const moveToMonth = useCallback(
        (amount: number, fromGrid: boolean) => {
            const targetKey = shiftMonthKey(focusedDateKey, amount);
            const monthKey = targetKey ? getMonthKey(targetKey) : null;
            if (!targetKey || !monthKey) {
                return;
            }
            shouldMoveFocusRef.current = fromGrid;
            setViewDateKey(monthKey);
            setFocusedDateKey(targetKey);
        },
        [focusedDateKey],
    );

    const handleDayKeyDown = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>) => {
            const current = parseLocalDate(focusedDateKey);
            if (!current) {
                return;
            }

            switch (event.key) {
                case 'ArrowLeft':
                    moveFocus(addLocalDays(focusedDateKey, -1));
                    break;
                case 'ArrowRight':
                    moveFocus(addLocalDays(focusedDateKey, 1));
                    break;
                case 'ArrowUp':
                    moveFocus(addLocalDays(focusedDateKey, -7));
                    break;
                case 'ArrowDown':
                    moveFocus(addLocalDays(focusedDateKey, 7));
                    break;
                case 'Home':
                    moveFocus(addLocalDays(focusedDateKey, -current.getDay()));
                    break;
                case 'End':
                    moveFocus(addLocalDays(focusedDateKey, 6 - current.getDay()));
                    break;
                case 'PageUp':
                    moveToMonth(event.shiftKey ? -12 : -1, true);
                    break;
                case 'PageDown':
                    moveToMonth(event.shiftKey ? 12 : 1, true);
                    break;
                case 'Enter':
                case ' ':
                    return;
                default:
                    return;
            }

            event.preventDefault();
        },
        [focusedDateKey, moveFocus, moveToMonth],
    );

    // A day switch writes through the provider's `setDate`, which the calendar
    // drives directly, so a failure here is announced through the same shared
    // event the provider uses. It has no rate-limit window of its own - the
    // shell's presentation window is what keeps one refused switch from
    // producing a stack of toasts.
    const reportError = useCallback((error: unknown) => {
        announcePersistenceError(error);
    }, []);

    const handleDayClick = useCallback(
        (dateKey: string) => {
            try {
                void Promise.resolve(setDate(dateKey)).catch(reportError);
            } catch (error) {
                reportError(error);
            }
            closePicker();
        },
        [closePicker, reportError, setDate],
    );

    /**
     * Stable per-day ref callbacks: without them every parent render hands all
     * 31 memoised day buttons a new function and the memo never hits.
     */
    const getDayRefCallback = useCallback((dateKey: string) => {
        const cached = dayRefCallbacks.current.get(dateKey);
        if (cached) {
            return cached;
        }
        const callback = (element: HTMLButtonElement | null) => {
            dayRefs.current[dateKey] = element;
        };
        dayRefCallbacks.current.set(dateKey, callback);
        return callback;
    }, []);

    const toggleOpen = useCallback(() => {
        if (isOpen) {
            closePicker();
        } else {
            setIsOpen(true);
        }
    }, [closePicker, isOpen]);

    const formattedDate = useMemo(() => formatDateLabel(selectedDateKey, FULL_DATE_FORMATTER), [selectedDateKey]);
    const compactFormattedDate = useMemo(
        () => formatDateLabel(selectedDateKey, SHORT_DATE_FORMATTER),
        [selectedDateKey],
    );
    const monthYearLabel = useMemo(() => {
        const parsed = parseLocalDate(viewDateKey);
        return parsed ? MONTH_YEAR_FORMATTER.format(parsed) : '';
    }, [viewDateKey]);

    /**
     * The calendar only holds years 1-9999, so paging past either end has no
     * target. Reporting that on the buttons keeps a dead control from looking
     * live: without it the header arrow is pressed, nothing happens, and the
     * grid simply stays put.
     */
    const canShowPreviousMonth = useMemo(() => shiftMonthKey(focusedDateKey, -1) !== null, [focusedDateKey]);
    const canShowNextMonth = useMemo(() => shiftMonthKey(focusedDateKey, 1) !== null, [focusedDateKey]);

    return (
        <div className="relative w-full flex-1" ref={containerRef}>
            <button
                ref={triggerRef}
                type="button"
                onClick={toggleOpen}
                className={`group flex w-full cursor-pointer items-center justify-between overflow-hidden rounded-xl border bg-app-surface shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary ${
                    compact ? 'px-3 py-2' : 'p-4 sm:p-6'
                } ${isOpen ? 'border-app-primary ring-1 ring-app-primary' : 'border-app-border hover:border-app-primary'}`}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `${pickerId}-dialog` : undefined}
                aria-labelledby={`${labelId} ${valueId}`}
            >
                <span className="flex flex-col gap-0.5 text-left sm:gap-1">
                    <span
                        id={labelId}
                        className={compact ? 'sr-only' : 'text-xs font-medium text-app-text-muted sm:text-sm'}
                    >
                        Study Date
                    </span>
                    <span
                        id={valueId}
                        className={`font-bold text-app-text-main transition-colors group-hover:text-app-primary ${compact ? 'text-sm' : 'text-base sm:text-xl'}`}
                    >
                        {compact ? compactFormattedDate : formattedDate}
                    </span>
                </span>
                <span
                    className={`flex items-center justify-center rounded-lg transition-colors ${compact ? 'h-7 w-7' : 'h-8 w-8 sm:h-10 sm:w-10'} ${
                        isOpen
                            ? 'bg-app-primary text-app-primary-fg'
                            : 'bg-app-primary/10 text-app-primary group-hover:bg-app-primary group-hover:text-app-primary-fg'
                    }`}
                    aria-hidden="true"
                >
                    <CalendarIcon size={compact ? 14 : 18} className={compact ? '' : 'sm:h-5 sm:w-5'} />
                </span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id={`${pickerId}-dialog`}
                        role="dialog"
                        aria-modal="false"
                        aria-labelledby={`${dialogTitleId} ${monthLabelId}`}
                        aria-describedby={instructionsId}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-app-border bg-app-surface p-3 shadow-xl ring-1 ring-black/5 sm:p-4 ${
                            compact ? 'left-0 w-[280px]' : 'left-0 right-0 w-full sm:right-auto sm:min-w-[300px]'
                        } max-w-[calc(100vw-1.5rem)]`}
                    >
                        <h2 id={dialogTitleId} className="sr-only">
                            Choose study date
                        </h2>
                        <p id={instructionsId} className="sr-only">
                            Use the arrow keys to move between dates, Home and End jump to the start and end of the
                            week, Page Up and Page Down change month, then press Enter to choose a date.
                        </p>
                        <div className="mb-3 flex items-center justify-between sm:mb-4">
                            <button
                                type="button"
                                onClick={() => moveToMonth(-1, false)}
                                disabled={!canShowPreviousMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-app-text-muted"
                                aria-label="Show previous month"
                            >
                                <ChevronLeft size={20} aria-hidden="true" />
                            </button>
                            <span id={monthLabelId} className="font-semibold text-app-text-main">
                                {monthYearLabel}
                            </span>
                            <button
                                type="button"
                                onClick={() => moveToMonth(1, false)}
                                disabled={!canShowNextMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-app-text-muted"
                                aria-label="Show next month"
                            >
                                <ChevronRight size={20} aria-hidden="true" />
                            </button>
                        </div>

                        <table
                            role={GRID_ROLE}
                            aria-label="Study date calendar"
                            aria-rowcount={calendarData.weekCount + 1}
                            aria-colcount={7}
                            className="w-full table-fixed border-separate border-spacing-1 text-center"
                        >
                            <thead>
                                <tr>
                                    {WEEKDAYS.map((weekday) => (
                                        <th
                                            key={weekday.long}
                                            scope="col"
                                            aria-label={weekday.long}
                                            className="py-2 text-xs font-medium uppercase text-app-text-muted"
                                        >
                                            <span aria-hidden="true">{weekday.short}</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Array.from({ length: calendarData.weekCount }, (_, rowIndex) => {
                                    const rowCells = calendarData.cells.slice(rowIndex * 7, rowIndex * 7 + 7);
                                    return (
                                        <tr key={rowCells.map((cell) => cell.key).join('-')}>
                                            {rowCells.map((cell) => {
                                                if (!cell.dateKey) {
                                                    return <td key={cell.key} aria-hidden="true" />;
                                                }
                                                const isSelected = cell.dateKey === selectedDateKey;
                                                const isToday = cell.dateKey === todayKey;
                                                const isFocused = cell.dateKey === focusedDateKey;
                                                return (
                                                    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: gridcell is the ARIA role that carries selection state inside a grid; aria-pressed on the inner button is not a valid substitute
                                                    <td
                                                        key={cell.key}
                                                        role={GRID_CELL_ROLE}
                                                        aria-selected={isSelected}
                                                        className="p-0 align-middle"
                                                    >
                                                        <DayButton
                                                            dateKey={cell.dateKey}
                                                            day={cell.day}
                                                            fullDateLabel={cell.fullDateLabel}
                                                            isSelected={isSelected}
                                                            isToday={isToday}
                                                            isFocused={isFocused}
                                                            buttonRef={getDayRefCallback(cell.dateKey)}
                                                            onSelect={handleDayClick}
                                                            onKeyDown={handleDayKeyDown}
                                                        />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

DatePicker.displayName = 'DatePicker';

export default DatePicker;
