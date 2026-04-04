import { AnimatePresence, motion } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DatePickerProps } from '../types';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const DayButton = memo(
    ({
        day,
        isSelected,
        isToday,
        onClick,
    }: {
        day: number;
        isSelected: boolean;
        isToday: boolean;
        onClick: () => void;
    }) => (
        <button
            type="button"
            onClick={onClick}
            className={`
            flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-xs sm:text-sm font-medium transition-all
            ${
                isSelected
                    ? 'bg-app-primary text-app-primary-fg shadow-sm'
                    : isToday
                      ? 'bg-app-primary/10 text-app-primary font-bold'
                      : 'text-app-text-main hover:bg-app-bg'
            }
        `}
        >
            {day}
        </button>
    ),
);

DayButton.displayName = 'DayButton';

const DatePicker = memo(({ date, setDate, compact = false }: DatePickerProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState(() => new Date(date));
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setViewDate(new Date(date));
        }
    }, [date, isOpen]);

    const handlePrevMonth = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    }, []);

    const handleNextMonth = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    }, []);

    const handleDayClick = useCallback(
        (day: number) => {
            const year = viewDate.getFullYear();
            const month = String(viewDate.getMonth() + 1).padStart(2, '0');
            const dayStr = String(day).padStart(2, '0');
            setDate(`${year}-${month}-${dayStr}`);
            setIsOpen(false);
        },
        [viewDate, setDate],
    );

    const toggleOpen = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const calendarData = useMemo(() => {
        const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
        const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
        const blanks = Array(firstDay).fill(null);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        return { blanks, days };
    }, [viewDate]);

    const currentDate = useMemo(() => new Date(date), [date]);
    const today = useMemo(() => new Date(), []);

    const isSelected = useCallback(
        (day: number) => {
            return (
                currentDate.getDate() === day &&
                currentDate.getMonth() === viewDate.getMonth() &&
                currentDate.getFullYear() === viewDate.getFullYear()
            );
        },
        [currentDate, viewDate],
    );

    const isToday = useCallback(
        (day: number) => {
            return (
                today.getDate() === day &&
                today.getMonth() === viewDate.getMonth() &&
                today.getFullYear() === viewDate.getFullYear()
            );
        },
        [today, viewDate],
    );

    const formattedDate = useMemo(() => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
    }, [date]);

    const compactFormattedDate = useMemo(() => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        });
    }, [date]);

    const monthYearLabel = useMemo(() => {
        return viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [viewDate]);

    return (
        <div className="relative w-full flex-1" ref={containerRef}>
            {/* Trigger Card */}
            <button
                type="button"
                onClick={toggleOpen}
                className={`group flex w-full cursor-pointer items-center justify-between overflow-hidden rounded-xl border bg-app-surface shadow-sm transition-all hover:shadow-md
                    ${compact ? 'px-3 py-2' : 'p-4 sm:p-6'}
                    ${isOpen ? 'border-app-primary ring-1 ring-app-primary' : 'border-app-border hover:border-app-primary'}
                `}
            >
                <div className="flex flex-col gap-0.5 sm:gap-1">
                    {!compact && (
                        <label
                            htmlFor="date-picker-input"
                            className="text-xs sm:text-sm font-medium text-app-text-muted"
                        >
                            Study Date
                        </label>
                    )}
                    <div
                        className={`font-bold text-app-text-main group-hover:text-app-primary transition-colors ${compact ? 'text-sm' : 'text-base sm:text-xl'}`}
                    >
                        {compact ? compactFormattedDate : formattedDate}
                    </div>
                </div>

                <div
                    className={`flex items-center justify-center rounded-lg transition-colors
                    ${compact ? 'h-7 w-7' : 'h-8 w-8 sm:h-10 sm:w-10'}
                    ${isOpen ? 'bg-app-primary text-app-primary-fg' : 'bg-app-primary/10 text-app-primary group-hover:bg-app-primary group-hover:text-app-primary-fg'}
                `}
                >
                    <CalendarIcon size={compact ? 14 : 18} className={compact ? '' : 'sm:w-5 sm:h-5'} />
                </div>
            </button>

            {/* Dropdown Popup */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-app-border bg-app-surface p-3 sm:p-4 shadow-xl ring-1 ring-black/5
                            ${compact ? 'left-0 w-[280px]' : 'left-0 right-0 sm:right-auto w-full sm:min-w-[300px]'}
                        `}
                    >
                        {/* Header */}
                        <div className="mb-3 sm:mb-4 flex items-center justify-between">
                            <button
                                type="button"
                                onClick={handlePrevMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="font-semibold text-app-text-main">{monthYearLabel}</span>
                            <button
                                type="button"
                                onClick={handleNextMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-7 gap-1 text-center">
                            {/* Weekday Labels */}
                            {WEEKDAYS.map((day) => (
                                <div key={day} className="text-xs font-medium uppercase text-app-text-muted py-2">
                                    {day}
                                </div>
                            ))}

                            {/* Empty Slots */}
                            {calendarData.blanks.map((_, i) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: Empty spacer divs in calendar grid never reorder
                                <div key={`blank-${i}`} />
                            ))}

                            {/* Days */}
                            {calendarData.days.map((day) => (
                                <DayButton
                                    key={day}
                                    day={day}
                                    isSelected={isSelected(day)}
                                    isToday={isToday(day)}
                                    onClick={() => handleDayClick(day)}
                                />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

DatePicker.displayName = 'DatePicker';

export default DatePicker;
