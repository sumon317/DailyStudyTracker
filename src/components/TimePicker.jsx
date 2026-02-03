import React, { useState, useRef, useEffect, memo } from 'react';
import { Clock, Check, X, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TimePicker = memo(({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    // Parse value (HH:MM) to manageable state
    const parseTime = (timeStr) => {
        if (!timeStr) return { h: 10, m: 0, period: 'AM' }; // Default
        const [h, m] = timeStr.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 || 12;
        return { h: displayH, m, period };
    };

    const [tempTime, setTempTime] = useState(parseTime(value));

    useEffect(() => {
        if (!isOpen) {
            setTempTime(parseTime(value));
        }
    }, [isOpen, value]);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSave = () => {
        let { h, m, period } = tempTime;
        let hours24 = h;
        if (period === 'PM' && h !== 12) hours24 += 12;
        if (period === 'AM' && h === 12) hours24 = 0;

        const timeStr = `${hours24.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        onChange(timeStr);
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange('');
        setIsOpen(false);
    };

    const adjust = (field, amount) => {
        setTempTime(prev => {
            let newVal = prev[field];
            if (field === 'h') {
                newVal += amount;
                if (newVal > 12) newVal = 1;
                if (newVal < 1) newVal = 12;
            } else if (field === 'm') {
                newVal += amount;
                if (newVal > 59) newVal = 0;
                if (newVal < 0) newVal = 59;
            }
            return { ...prev, [field]: newVal };
        });
    };

    const togglePeriod = () => {
        setTempTime(prev => ({ ...prev, period: prev.period === 'AM' ? 'PM' : 'AM' }));
    };

    // Format for display
    const displayValue = value ? (() => {
        const { h, m, period } = parseTime(value);
        return `${h}:${m.toString().padStart(2, '0')} ${period}`;
    })() : '';

    const [position, setPosition] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (isOpen && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            // Position to the left of the button, centered vertically if possible, or just below
            // Since it's inside a table, fixed is safest.
            const screenW = window.innerWidth;
            const popoverW = 256; // w-64

            let left = rect.right - popoverW;
            if (left < 10) left = rect.left; // if too far left, align left

            // Check bottom edge
            const popoverH = 300;
            let top = rect.bottom + 5;
            if (top + popoverH > window.innerHeight) {
                top = rect.top - popoverH - 5; // flip up
            }

            setPosition({ top, left });
        }
    }, [isOpen]);

    return (
        <div className="relative" ref={containerRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs sm:text-sm font-medium w-full min-w-[110px] justify-center ${value
                    ? 'bg-app-primary/10 border-app-primary text-app-primary'
                    : 'bg-app-surface border-app-border text-app-text-muted hover:border-app-primary/50'
                    }`}
            >
                <Clock size={14} />
                {displayValue || 'Set Time'}
            </button>

            {/* Popover - Fixed Position */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        style={{
                            position: 'fixed',
                            top: position.top,
                            left: position.left,
                            zIndex: 9999
                        }}
                        className="w-64 rounded-xl border border-app-border bg-app-surface shadow-xl p-4"
                    >
                        <div className="flex items-center justify-center gap-2 mb-6">
                            {/* Hours */}
                            <div className="flex flex-col items-center">
                                <button onClick={() => adjust('h', 1)} className="p-1 hover:text-app-primary text-app-text-muted transition-colors"><ChevronUp size={20} /></button>
                                <div className="text-3xl font-mono font-bold text-app-text-main w-16 text-center select-none">
                                    {tempTime.h}
                                </div>
                                <button onClick={() => adjust('h', -1)} className="p-1 hover:text-app-primary text-app-text-muted transition-colors"><ChevronDown size={20} /></button>
                                <span className="text-[10px] font-bold text-app-text-muted tracking-wide">HR</span>
                            </div>

                            <div className="text-2xl font-bold text-app-text-muted mb-4">:</div>

                            {/* Minutes */}
                            <div className="flex flex-col items-center">
                                <button onClick={() => adjust('m', 1)} className="p-1 hover:text-app-primary text-app-text-muted transition-colors"><ChevronUp size={20} /></button>
                                <div className="text-3xl font-mono font-bold text-app-text-main w-16 text-center select-none">
                                    {tempTime.m.toString().padStart(2, '0')}
                                </div>
                                <button onClick={() => adjust('m', -1)} className="p-1 hover:text-app-primary text-app-text-muted transition-colors"><ChevronDown size={20} /></button>
                                <span className="text-[10px] font-bold text-app-text-muted tracking-wide">MIN</span>
                            </div>

                            {/* Period */}
                            <div className="flex flex-col items-center ml-2">
                                <button
                                    onClick={togglePeriod}
                                    className={`px-2 py-4 rounded-lg font-bold text-sm transition-colors border ${tempTime.period === 'AM'
                                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                                        : 'bg-indigo-100 text-indigo-700 border-indigo-200'
                                        }`}
                                >
                                    {tempTime.period}
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleClear}
                                className="flex-1 py-2 rounded-lg border border-app-border text-app-text-muted hover:bg-app-bg transition-colors text-xs font-medium"
                            >
                                Clear
                            </button>
                            <button
                                onClick={handleSave}
                                className="flex-1 py-2 rounded-lg bg-app-primary text-app-primary-fg hover:bg-app-primary-hover transition-colors text-xs font-bold shadow-sm flex items-center justify-center gap-1"
                            >
                                <Check size={14} /> Set
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

TimePicker.displayName = 'TimePicker';

export default TimePicker;
