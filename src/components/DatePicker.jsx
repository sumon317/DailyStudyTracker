import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DatePicker = ({ date, setDate }) => {
    const [isOpen, setIsOpen] = useState(false);
    // View date tracks which month we are looking at (defaults to selected date)
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

    // Sync view date check when opening, or when date prop changes externally
    useEffect(() => {
        if (!isOpen) {
            setViewDate(new Date(date));
        }
    }, [date, isOpen]);

    const handlePrevMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    };

    const handleNextMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
    };

    const handleDayClick = (day) => {
        // Construct new date in local time string "YYYY-MM-DD"
        // Note: We need to be careful with timezones. 
        // Best way: Create date object from viewDate year/month and selected day, 
        // then format as YYYY-MM-DD manually to avoid UTC shifts.
        const year = viewDate.getFullYear();
        const month = String(viewDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const newDateStr = `${year}-${month}-${dayStr}`;

        setDate(newDateStr);
        setIsOpen(false);
    };

    // Calendar generation logic
    const getDaysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const getFirstDayOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1).getDay(); // 0 = Sunday

    const daysInMonth = getDaysInMonth(viewDate);
    const firstDay = getFirstDayOfMonth(viewDate);

    // Array of empty slots for padding
    const blanks = Array(firstDay).fill(null);
    // Array of days
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const isSelected = (day) => {
        const current = new Date(date);
        return (
            current.getDate() === day &&
            current.getMonth() === viewDate.getMonth() &&
            current.getFullYear() === viewDate.getFullYear()
        );
    };

    const isToday = (day) => {
        const today = new Date();
        return (
            today.getDate() === day &&
            today.getMonth() === viewDate.getMonth() &&
            today.getFullYear() === viewDate.getFullYear()
        );
    };

    const formatDate = (dateString) => {
        const d = new Date(dateString);
        return d.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <div className="relative w-full flex-1" ref={containerRef}>
            {/* Trigger Card */}
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={`group flex w-full cursor-pointer items-center justify-between overflow-hidden rounded-xl border bg-app-surface p-4 sm:p-6 shadow-sm transition-all hover:shadow-md
                    ${isOpen ? 'border-app-primary ring-1 ring-app-primary' : 'border-app-border hover:border-app-primary'}
                `}
            >
                <div className="flex flex-col gap-0.5 sm:gap-1">
                    <label className="text-xs sm:text-sm font-medium text-app-text-muted">Study Date</label>
                    <div className="text-base sm:text-xl font-bold text-app-text-main group-hover:text-app-primary transition-colors">
                        {formatDate(date)}
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
                        transition={{ duration: 0.2 }}
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
                                {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                                <div key={day} className="text-xs font-medium uppercase text-app-text-muted py-2">
                                    {day}
                                </div>
                            ))}

                            {/* Empty Slots */}
                            {blanks.map((_, i) => (
                                <div key={`blank-${i}`} />
                            ))}

                            {/* Days */}
                            {days.map(day => (
                                <button
                                    key={day}
                                    onClick={() => handleDayClick(day)}
                                    className={`
                                        flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-xs sm:text-sm font-medium transition-all
                                        ${isSelected(day)
                                            ? 'bg-app-primary text-app-primary-fg shadow-sm'
                                            : isToday(day)
                                                ? 'bg-app-primary/10 text-app-primary font-bold'
                                                : 'text-app-text-main hover:bg-app-bg'
                                        }
                                    `}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default DatePicker;
