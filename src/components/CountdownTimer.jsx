import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Timer, Play, Pause, RotateCcw, X, Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CountdownTimer = memo(() => {
    const [timeLeft, setTimeLeft] = useState(1800); // Default 30 minutes (in seconds)
    const [isActive, setIsActive] = useState(false);
    const [initialTime, setInitialTime] = useState(1800);
    const [isEditing, setIsEditing] = useState(false);
    const [isOpen, setIsOpen] = useState(false); // Collapsed by default

    // Input state
    const [hoursInput, setHoursInput] = useState(0);
    const [minutesInput, setMinutesInput] = useState(30);
    const [secondsInput, setSecondsInput] = useState(0);

    const intervalRef = useRef(null);

    // Initial notification setup
    useEffect(() => {
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    }, []);

    const playAlarm = useCallback(() => {
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification("Time's Up!", { body: "Your focus session is complete." });
        } else {
            alert("Time's up! Great focus session.");
        }
    }, []);

    useEffect(() => {
        if (isActive && timeLeft > 0) {
            intervalRef.current = setInterval(() => {
                setTimeLeft((time) => {
                    if (time <= 1) {
                        clearInterval(intervalRef.current);
                        setIsActive(false);
                        playAlarm();
                        return 0;
                    }
                    return time - 1;
                });
            }, 1000);
        } else if (!isActive && intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isActive, timeLeft, playAlarm]);

    const toggleTimer = useCallback(() => {
        setIsActive(!isActive);
    }, [isActive]);

    const resetTimer = useCallback(() => {
        setIsActive(false);
        setTimeLeft(initialTime);
    }, [initialTime]);

    const openEditor = useCallback(() => {
        setIsActive(false);
        // Convert current timeLeft back to inputs
        const h = Math.floor(timeLeft / 3600);
        const m = Math.floor((timeLeft % 3600) / 60);
        const s = timeLeft % 60;
        setHoursInput(h);
        setMinutesInput(m);
        setSecondsInput(s);
        setIsEditing(true);
    }, [timeLeft]);

    const saveTime = useCallback(() => {
        const totalSeconds = (hoursInput * 3600) + (minutesInput * 60) + secondsInput;
        if (totalSeconds > 0) {
            setInitialTime(totalSeconds);
            setTimeLeft(totalSeconds);
            setIsEditing(false);
        }
    }, [hoursInput, minutesInput, secondsInput]);

    // Format time: HH:MM:SS
    const formatTimeDisplay = (totalSeconds) => {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleInputChange = (setter) => (e) => {
        const val = parseInt(e.target.value) || 0;
        setter(Math.max(0, val));
    };

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden">
            {/* Header / Toggle */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-app-bg/50 hover:bg-app-bg/80 transition-colors border-b border-app-border"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-app-primary/10 text-app-primary">
                        <Timer size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-app-text-main">Focus Timer</h3>
                        <p className="text-xs text-app-text-muted">
                            {isActive ? 'Running • ' + formatTimeDisplay(timeLeft) : 'Start a focus session'}
                        </p>
                    </div>
                </div>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-app-text-muted"
                >
                    <ChevronDown size={20} />
                </motion.div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="p-6 flex flex-col items-center justify-center gap-6 min-h-[200px]">
                            {/* Time Display or Editor */}
                            <div className="relative w-full flex justify-center">
                                {isEditing ? (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="flex flex-col items-center gap-4 bg-app-bg p-4 rounded-xl border border-app-primary/30 shadow-lg"
                                    >
                                        <div className="flex items-end gap-2 text-app-text-main">
                                            <div className="flex flex-col items-center gap-1">
                                                <label className="text-xs text-app-text-muted font-bold tracking-wider">HRS</label>
                                                <input
                                                    type="number"
                                                    value={hoursInput}
                                                    onChange={handleInputChange(setHoursInput)}
                                                    className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                    min="0"
                                                    max="23"
                                                />
                                            </div>
                                            <span className="text-2xl mb-2 font-bold">:</span>
                                            <div className="flex flex-col items-center gap-1">
                                                <label className="text-xs text-app-text-muted font-bold tracking-wider">MIN</label>
                                                <input
                                                    type="number"
                                                    value={minutesInput}
                                                    onChange={handleInputChange(setMinutesInput)}
                                                    className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                    min="0"
                                                    max="59"
                                                />
                                            </div>
                                            <span className="text-2xl mb-2 font-bold">:</span>
                                            <div className="flex flex-col items-center gap-1">
                                                <label className="text-xs text-app-text-muted font-bold tracking-wider">SEC</label>
                                                <input
                                                    type="number"
                                                    value={secondsInput}
                                                    onChange={handleInputChange(setSecondsInput)}
                                                    className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                    min="0"
                                                    max="59"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex gap-2 w-full">
                                            <button
                                                onClick={() => setIsEditing(false)}
                                                className="flex-1 py-2 px-4 rounded-lg bg-app-surface border border-app-border text-app-text-muted hover:bg-app-bg transition-colors flex items-center justify-center gap-1"
                                            >
                                                <X size={16} /> Cancel
                                            </button>
                                            <button
                                                onClick={saveTime}
                                                className="flex-1 py-2 px-4 rounded-lg bg-app-primary text-white hover:bg-app-primary-hover transition-colors flex items-center justify-center gap-1 font-medium shadow-sm"
                                            >
                                                <Check size={16} /> Set Timer
                                            </button>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <div
                                        onClick={openEditor}
                                        className={`cursor-pointer group flex flex-col items-center transition-all ${isActive ? 'scale-105 select-none' : 'hover:scale-105'}`}
                                        title="Click to edit time"
                                    >
                                        <div className={`text-6xl sm:text-7xl font-mono font-bold tracking-wider tabular-nums transition-colors ${isActive ? 'text-app-primary drop-shadow-sm' : 'text-app-text-main group-hover:text-app-primary'
                                            }`}>
                                            {formatTimeDisplay(timeLeft)}
                                        </div>
                                        {!isActive && (
                                            <span className="text-xs font-medium text-app-text-muted mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                <Timer size={12} /> Click numbers to edit
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {!isEditing && (
                                <>
                                    {/* Progress Bar */}
                                    <div className="w-full h-2 bg-app-bg rounded-full overflow-hidden max-w-xs ring-1 ring-app-border/50">
                                        <motion.div
                                            className="h-full bg-app-primary"
                                            initial={{ width: "100%" }}
                                            animate={{ width: `${(timeLeft / initialTime) * 100}%` }}
                                            transition={{ duration: 1, ease: "linear" }}
                                        />
                                    </div>

                                    {/* Controls */}
                                    <div className="flex items-center gap-6">
                                        <button
                                            onClick={toggleTimer}
                                            className={`flex items-center justify-center w-16 h-16 rounded-full shadow-lg transition-transform active:scale-95 ${isActive
                                                    ? 'bg-app-accent-warning text-white hover:bg-app-accent-warning/90'
                                                    : 'bg-app-primary text-white hover:bg-app-primary-hover'
                                                }`}
                                        >
                                            {isActive ? (
                                                <Pause size={28} fill="currentColor" />
                                            ) : (
                                                <Play size={28} fill="currentColor" className="ml-1" />
                                            )}
                                        </button>

                                        <button
                                            onClick={resetTimer}
                                            className="flex items-center justify-center w-12 h-12 rounded-full bg-app-bg text-app-text-muted border border-app-border hover:bg-app-surface hover:text-app-text-main transition-colors shadow-sm active:scale-95"
                                            title="Reset"
                                        >
                                            <RotateCcw size={20} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

CountdownTimer.displayName = 'CountdownTimer';

export default CountdownTimer;
