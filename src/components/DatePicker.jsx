import React, { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const DayButton = memo(({ day, isSelected, isToday, onClick }) => (
    <button
        onClick={onClick}
        className={`
            flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-xs sm:text-sm font-medium transition-all
            ${isSelected
                ? 'bg-app-primary text-app-primary-fg shadow-sm'
                : isToday
                    ? 'bg-app-primary/10 text-app-primary font-bold'
                    : 'text-app-text-main hover:bg-app-bg'
            }
        `}
    >
        {day}
    </button>
));

DayButton.displayName = 'DayButton';

const DatePicker = memo(({ date, setDate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState(() => new Date(date));
    const containerRef = useRef(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync view date when opening or date changes
    useEffect(() => {
        if (!isOpen) {
            setViewDate(new Date(date));
        }
    }, [date, isOpen]);

    const handlePrevMonth = useCallback((e) => {
        e.stopPropagation();
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    }, []);

    const handleNextMonth = useCallback((e) => {
        e.stopPropagation();
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    }, []);

    const handleDayClick = useCallback((day) => {
        const year = viewDate.getFullYear();
        const month = String(viewDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        setDate(`${year}-${month}-${dayStr}`);
        setIsOpen(false);
    }, [viewDate, setDate]);

    const toggleOpen = useCallback(() => {
        setIsOpen(prev => !prev);
    }, []);

    // Memoize calendar data
    const calendarData = useMemo(() => {
        const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
        const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
        const blanks = Array(firstDay).fill(null);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        return { blanks, days };
    }, [viewDate]);

    const currentDate = useMemo(() => new Date(date), [date]);
    const today = useMemo(() => new Date(), []);

    const isSelected = useCallback((day) => {
        return (
            currentDate.getDate() === day &&
            currentDate.getMonth() === viewDate.getMonth() &&
            currentDate.getFullYear() === viewDate.getFullYear()
        );
    }, [currentDate, viewDate]);

    const isToday = useCallback((day) => {
        return (
            today.getDate() === day &&
            today.getMonth() === viewDate.getMonth() &&
            today.getFullYear() === viewDate.getFullYear()
        );
    }, [today, viewDate]);

    const formattedDate = useMemo(() => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }, [date]);

    const monthYearLabel = useMemo(() => {
        return viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [viewDate]);

    return (
        <div className="relative w-full flex-1" ref={containerRef}>
            {/* Trigger Card */}
            <div
                onClick={toggleOpen}
                className={`group flex w-full cursor-pointer items-center justify-between overflow-hidden rounded-xl border bg-app-surface p-4 sm:p-6 shadow-sm transition-all hover:shadow-md
                    ${isOpen ? 'border-app-primary ring-1 ring-app-primary' : 'border-app-border hover:border-app-primary'}
                `}
            >
                <div className="flex flex-col gap-0.5 sm:gap-1">
                    <label className="text-xs sm:text-sm font-medium text-app-text-muted">Study Date</label>
                    <div className="text-base sm:text-xl font-bold text-app-text-main group-hover:text-app-primary transition-colors">
                        {formattedDate}
                    </div>
                </div>

                <div className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg transition-colors
                    ${isOpen ? 'bg-app-primary text-app-primary-fg' : 'bg-app-primary/10 text-app-primary group-hover:bg-app-primary group-hover:text-app-primary-fg'}
                `}>
                    <CalendarIcon size={18} className="sm:w-5 sm:h-5" />
                </div>
            </div>

            {/* Dropdown Popup */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 sm:right-auto top-full z-50 mt-2 w-full sm:min-w-[300px] overflow-hidden rounded-xl border border-app-border bg-app-surface p-3 sm:p-4 shadow-xl ring-1 ring-black/5"
                    >
                        {/* Header */}
                        <div className="mb-3 sm:mb-4 flex items-center justify-between">
                            <button
                                onClick={handlePrevMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="font-semibold text-app-text-main">
                                {monthYearLabel}
                            </span>
                            <button
                                onClick={handleNextMonth}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg hover:text-app-text-main"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-7 gap-1 text-center">
                            {/* Weekday Labels */}
                            {WEEKDAYS.map(day => (
                                <div key={day} className="text-xs font-medium uppercase text-app-text-muted py-2">
                                    {day}
                                </div>
                            ))}

                            {/* Empty Slots */}
                            {calendarData.blanks.map((_, i) => (
                                <div key={`blank-${i}`} />
                            ))}

                            {/* Days */}
                            {calendarData.days.map(day => (
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
