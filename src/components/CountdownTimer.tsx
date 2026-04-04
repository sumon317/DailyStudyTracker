import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import NativeAlarm from '../plugins/NativeAlarm';
import type { CountdownTimerProps } from '../types';

const CountdownTimer = memo(({ globalAlarmSource, stopGlobalAlarm }: CountdownTimerProps) => {
    const [timeLeft, setTimeLeft] = useState(1800);
    const [isActive, setIsActive] = useState(false);
    const [initialTime, setInitialTime] = useState(1800);
    const [isEditing, setIsEditing] = useState(false);
    const [isOpen, setIsOpen] = useState(true);

    const [hoursInput, setHoursInput] = useState(0);
    const [minutesInput, setMinutesInput] = useState(30);
    const [secondsInput, setSecondsInput] = useState(0);

    const intervalRef = useRef<number | null>(null);
    const endTimeRef = useRef<number | null>(null);

    const [isAlarmPlaying, setIsAlarmPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

    useEffect(() => {
        const audio = new Audio('/alarm_loop.mp3');
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        audioRef.current = audio;

        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }

        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (audioCtxRef.current) {
                audioCtxRef.current.close().catch(() => {
                    // Silently ignore audio context close errors
                });
                audioCtxRef.current = null;
            }
        };
    }, []);

    const playAlarm = useCallback(async () => {
        setIsAlarmPlaying(true);

        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000, 500, 1000]);

        if (audioRef.current) {
            try {
                if (!audioCtxRef.current) {
                    const CtxClass =
                        window.AudioContext ||
                        (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
                    audioCtxRef.current = new CtxClass();
                    gainNodeRef.current = audioCtxRef.current.createGain();
                    gainNodeRef.current.gain.value = 5.0;
                    gainNodeRef.current.connect(audioCtxRef.current.destination);

                    sourceNodeRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current);
                    sourceNodeRef.current.connect(gainNodeRef.current);
                }

                if (audioCtxRef.current.state === 'suspended') {
                    await audioCtxRef.current.resume();
                }

                audioRef.current.currentTime = 0;
                await audioRef.current.play();
            } catch (_e) {
                audioRef.current.play().catch((_err) => {
                    // Silently ignore playback errors
                });
            }
        }

        if (!Capacitor.isNativePlatform()) {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification("Time's Up!", { body: 'Your focus session is complete.' });
            }
        }
    }, []);

    const formatTimeDisplay = useCallback((totalSeconds: number) => {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, []);

    useEffect(() => {
        const manageServices = async () => {
            if (isActive) {
                await KeepAwake.keepAwake();
                if (Capacitor.getPlatform() === 'android') {
                    try {
                        const status = await ForegroundService.checkPermissions();
                        if (status.display !== 'granted') {
                            const request = await ForegroundService.requestPermissions();
                            if (request.display !== 'granted') {
                                return;
                            }
                        }

                        const overlayStatus = await ForegroundService.checkManageOverlayPermission();
                        if (!overlayStatus.granted) {
                            await ForegroundService.requestManageOverlayPermission().catch(() => {
                                // Silently ignore overlay permission request failures
                            });
                        }

                        await ForegroundService.startForegroundService({
                            id: 111,
                            title: 'Focus Timer',
                            body: `Time remaining: ${formatTimeDisplay(timeLeft)}`,
                            smallIcon: 'ic_timer_icon',
                            serviceType: 1073741824 as never,
                            silent: true,
                        });
                    } catch (_e) {
                        // Silently ignore foreground service errors
                    }
                }
            } else {
                await KeepAwake.allowSleep();
                if (Capacitor.getPlatform() === 'android') {
                    try {
                        await ForegroundService.stopForegroundService();
                    } catch (_e) {
                        // Silently ignore foreground service errors
                    }
                }
            }
        };

        manageServices();

        if (isActive && timeLeft > 0) {
            intervalRef.current = window.setInterval(() => {
                if (!endTimeRef.current) return;

                const now = Date.now();
                const remaining = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));

                setTimeLeft(remaining);

                if (remaining <= 0) {
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    setIsActive(false);
                    playAlarm();
                } else {
                    if (Capacitor.getPlatform() === 'android') {
                        ForegroundService.updateForegroundService({
                            id: 111,
                            title: 'Focus Timer',
                            body: `Time remaining: ${formatTimeDisplay(remaining)}`,
                            smallIcon: 'ic_timer_icon',
                            silent: true,
                        }).catch(() => {
                            // Silently ignore foreground service update errors
                        });
                    }
                }
            }, 1000);
        } else if (!isActive && intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            KeepAwake.allowSleep();
        };
    }, [isActive, playAlarm, timeLeft, formatTimeDisplay]);

    const stopAlarm = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setIsAlarmPlaying(false);
    }, []);

    const addTenSeconds = useCallback(() => {
        if (isActive && endTimeRef.current) {
            endTimeRef.current += 10000;
        }
        setTimeLeft((prev) => prev + 10);
    }, [isActive]);

    const addThirtySeconds = useCallback(() => {
        if (isActive && endTimeRef.current) {
            endTimeRef.current += 30000;
        }
        setTimeLeft((prev) => prev + 30);
    }, [isActive]);

    const toggleTimer = useCallback(async () => {
        if (!isActive && timeLeft > 0) {
            const end = Date.now() + timeLeft * 1000;
            endTimeRef.current = end;
            setIsActive(true);
            stopAlarm();

            if (Capacitor.isNativePlatform()) {
                try {
                    await NativeAlarm.scheduleAlarm({
                        id: 101,
                        time: new Date(end).getTime(),
                        title: 'Focus Time Complete!',
                        body: 'Your study session has finished. Take a break!',
                    });
                } catch (_e) {
                    await LocalNotifications.schedule({
                        notifications: [
                            {
                                title: "Time's Up!",
                                body: 'Your focus session is complete.',
                                id: 101,
                                schedule: { at: new Date(end), allowWhileIdle: true },
                                smallIcon: 'ic_timer_icon',
                                channelId: 'study-alarms-v3',
                            },
                        ],
                    });
                }
            }
        } else if (isActive) {
            const remaining = Math.max(0, Math.ceil(((endTimeRef.current ?? 0) - Date.now()) / 1000));
            setTimeLeft(remaining);
            endTimeRef.current = null;
            setIsActive(false);

            if (Capacitor.isNativePlatform()) {
                NativeAlarm.cancelAlarm({ id: 101 }).catch(() => {
                    // Silently ignore alarm cancel errors
                });
                LocalNotifications.cancel({ notifications: [{ id: 101 }] }).catch(() => {
                    // Silently ignore notification cancel errors
                });
            }
        }
    }, [isActive, timeLeft, stopAlarm]);

    const resetTimer = useCallback(() => {
        setIsActive(false);
        endTimeRef.current = null;
        setTimeLeft(initialTime);
        stopAlarm();

        if (Capacitor.isNativePlatform()) {
            NativeAlarm.cancelAlarm({ id: 101 }).catch(() => {
                // Silently ignore alarm cancel errors
            });
            LocalNotifications.cancel({ notifications: [{ id: 101 }] }).catch(() => {
                // Silently ignore notification cancel errors
            });
        }
    }, [initialTime, stopAlarm]);

    const openEditor = useCallback(() => {
        setIsActive(false);
        endTimeRef.current = null;
        stopAlarm();
        const h = Math.floor(timeLeft / 3600);
        const m = Math.floor((timeLeft % 3600) / 60);
        const s = timeLeft % 60;
        setHoursInput(h);
        setMinutesInput(m);
        setSecondsInput(s);
        setIsEditing(true);
    }, [timeLeft, stopAlarm]);

    const saveTime = useCallback(() => {
        const totalSeconds = hoursInput * 3600 + minutesInput * 60 + secondsInput;
        if (totalSeconds > 0) {
            setInitialTime(totalSeconds);
            setTimeLeft(totalSeconds);
            setIsEditing(false);
        }
    }, [hoursInput, minutesInput, secondsInput]);

    const handleInputChange =
        (setter: React.Dispatch<React.SetStateAction<number>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
            const val = parseInt(e.target.value, 10) || 0;
            setter(Math.max(0, val));
        };

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden">
            {/* Header / Toggle */}
            <button
                type="button"
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
                            {isActive ? `Running • ${formatTimeDisplay(timeLeft)}` : 'Start a focus session'}
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
                        <div className="p-5 flex flex-col items-center justify-center gap-6 min-h-[200px] relative">
                            {/* Alarm Overlay */}
                            <AnimatePresence>
                                {(isAlarmPlaying || globalAlarmSource === 'FOCUS_ALARM') && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-app-bg/95 backdrop-blur-sm rounded-xl border border-app-accent-warning/50 p-6"
                                    >
                                        <motion.div
                                            animate={{ scale: [1, 1.1, 1] }}
                                            transition={{ repeat: Infinity, duration: 1.5 }}
                                            className="text-app-accent-warning mb-4"
                                        >
                                            <Timer size={48} />
                                        </motion.div>
                                        <h3 className="text-xl font-bold text-app-text-main mb-6">Time&apos;s Up!</h3>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                stopAlarm();
                                                if (stopGlobalAlarm) stopGlobalAlarm();
                                            }}
                                            className="w-full py-3 px-6 rounded-xl bg-app-accent-warning text-white font-bold text-lg shadow-lg shadow-app-accent-warning/20 hover:bg-app-accent-warning/90 transition-all active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            <X size={24} /> Stop Alarm
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Time Display or Editor */}
                            <div className="relative w-full flex justify-center">
                                {isEditing ? (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="flex flex-col items-center gap-4 bg-app-bg p-4 rounded-xl border border-app-primary/30 shadow-lg w-full"
                                    >
                                        <div className="flex items-end gap-2 text-app-text-main">
                                            <div className="flex flex-col items-center gap-1">
                                                <label
                                                    htmlFor="timer-hrs"
                                                    className="text-xs text-app-text-muted font-bold tracking-wider"
                                                >
                                                    HRS
                                                </label>
                                                <input
                                                    id="timer-hrs"
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
                                                <label
                                                    htmlFor="timer-min"
                                                    className="text-xs text-app-text-muted font-bold tracking-wider"
                                                >
                                                    MIN
                                                </label>
                                                <input
                                                    id="timer-min"
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
                                                <label
                                                    htmlFor="timer-sec"
                                                    className="text-xs text-app-text-muted font-bold tracking-wider"
                                                >
                                                    SEC
                                                </label>
                                                <input
                                                    id="timer-sec"
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
                                                type="button"
                                                onClick={() => setIsEditing(false)}
                                                className="flex-1 py-2 px-4 rounded-lg bg-app-surface border border-app-border text-app-text-muted hover:bg-app-bg transition-colors flex items-center justify-center gap-1"
                                            >
                                                <X size={16} /> Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={saveTime}
                                                className="flex-1 py-2 px-4 rounded-lg bg-app-primary text-white hover:bg-app-primary-hover transition-colors flex items-center justify-center gap-1 font-medium shadow-sm"
                                            >
                                                <Check size={16} /> Set Timer
                                            </button>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={openEditor}
                                        className={`cursor-pointer group flex flex-col items-center transition-all ${isActive ? 'scale-105 select-none' : 'hover:scale-105'}`}
                                        title="Click to edit time"
                                    >
                                        <div
                                            className={`text-6xl sm:text-7xl font-mono font-bold tracking-wider tabular-nums transition-colors ${
                                                isActive
                                                    ? 'text-app-primary drop-shadow-sm'
                                                    : 'text-app-text-main group-hover:text-app-primary'
                                            }`}
                                        >
                                            {formatTimeDisplay(timeLeft)}
                                        </div>
                                        {!isActive && (
                                            <span className="text-xs font-medium text-app-text-muted mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                <Timer size={12} /> Click numbers to edit
                                            </span>
                                        )}
                                    </button>
                                )}
                            </div>

                            {!isEditing && (
                                <>
                                    {/* Progress Bar */}
                                    <div className="w-full h-2 bg-app-bg rounded-full overflow-hidden ring-1 ring-app-border/50">
                                        <motion.div
                                            className="h-full bg-app-primary"
                                            initial={{ width: '100%' }}
                                            animate={{ width: `${(timeLeft / initialTime) * 100}%` }}
                                            transition={{ duration: 1, ease: 'linear' }}
                                        />
                                    </div>

                                    {/* Controls */}
                                    <div className="flex flex-col items-center gap-6">
                                        {/* Main Play/Pause Button */}
                                        <button
                                            type="button"
                                            onClick={toggleTimer}
                                            className={`flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all active:scale-95 ${
                                                isActive
                                                    ? 'bg-app-accent-warning text-white hover:bg-app-accent-warning/90 ring-4 ring-app-accent-warning/20'
                                                    : 'bg-app-primary text-white hover:bg-app-primary-hover ring-4 ring-app-primary/20'
                                            }`}
                                        >
                                            {isActive ? (
                                                <Pause size={32} fill="currentColor" />
                                            ) : (
                                                <Play size={32} fill="currentColor" className="ml-1" />
                                            )}
                                        </button>

                                        {/* Secondary Controls - Centered Row */}
                                        <div className="flex items-center gap-3 bg-app-bg/50 p-2 rounded-2xl border border-app-border/50 backdrop-blur-sm">
                                            <button
                                                type="button"
                                                onClick={resetTimer}
                                                className="flex items-center justify-center w-10 h-10 rounded-full text-app-text-muted hover:bg-app-surface hover:text-app-text-main transition-colors"
                                                title="Reset"
                                            >
                                                <RotateCcw size={18} />
                                            </button>

                                            <div className="w-px h-6 bg-app-border/50 mx-1" />

                                            <button
                                                type="button"
                                                onClick={addTenSeconds}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-app-surface text-app-primary border border-app-border hover:bg-app-bg transition-colors active:scale-95"
                                                title="Add 10s"
                                            >
                                                +10s
                                            </button>
                                            <button
                                                type="button"
                                                onClick={addThirtySeconds}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-app-surface text-app-primary border border-app-border hover:bg-app-bg transition-colors active:scale-95"
                                                title="Add 30s"
                                            >
                                                +30s
                                            </button>
                                        </div>
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
