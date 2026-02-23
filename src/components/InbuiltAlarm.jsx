import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, X, Plus, Trash2, ChevronDown } from 'lucide-react';
import TimePicker from './TimePicker';
import NativeAlarm from '../plugins/NativeAlarm';
import { Capacitor } from '@capacitor/core';
import { motion, AnimatePresence } from 'framer-motion';

const InbuiltAlarm = ({ globalAlarmSource, stopGlobalAlarm }) => {
    const [alarms, setAlarms] = useState([]);
    const [isOpen, setIsOpen] = useState(true);

    // Load saved alarms
    useEffect(() => {
        const savedAlarms = localStorage.getItem('focusAlarms');
        if (savedAlarms) {
            try {
                setAlarms(JSON.parse(savedAlarms));
            } catch (e) {
                console.error("Failed to parse saved alarms", e);
                setAlarms([]);
            }
        }
    }, []);

    // Save alarms to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem('focusAlarms', JSON.stringify(alarms));
    }, [alarms]);

    const addAlarm = () => {
        const newAlarm = {
            id: Date.now().toString(),
            time: '08:00',
            active: false
        };
        setAlarms([...alarms, newAlarm]);
    };

    const removeAlarm = async (id) => {
        if (Capacitor.isNativePlatform()) {
            await NativeAlarm.cancelAlarm({ id: parseInt(id) }).catch(console.error);
        }
        setAlarms(alarms.filter(a => a.id !== id));
    };

    const updateAlarmTime = async (id, newTime) => {
        setAlarms(prev => prev.map(a => {
            if (a.id === id) {
                // If active, we need to reschedule
                if (a.active) {
                    if (Capacitor.isNativePlatform()) {
                        NativeAlarm.cancelAlarm({ id: parseInt(id) }).catch(console.error);
                    }
                    // Setting it to inactive so user has to turn it back on with new time
                    return { ...a, time: newTime, active: false };
                }
                return { ...a, time: newTime };
            }
            return a;
        }));
    };

    const toggleAlarm = async (id) => {
        const alarm = alarms.find(a => a.id === id);
        if (!alarm) return;

        if (alarm.active) {
            // Turn off
            if (Capacitor.isNativePlatform()) {
                await NativeAlarm.cancelAlarm({ id: parseInt(id) }).catch(console.error);
            }
            setAlarms(prev => prev.map(a => a.id === id ? { ...a, active: false } : a));
        } else {
            // Turn on
            if (!alarm.time) {
                alert('Please set a time first.');
                return;
            }

            const [hours, minutes] = alarm.time.split(':');
            const h = parseInt(hours, 10);
            const m = parseInt(minutes, 10);

            // Calculate exact next timestamp
            const now = new Date();
            const alarmTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);

            // If the time has already passed today, schedule for tomorrow
            if (alarmTime.getTime() <= now.getTime()) {
                alarmTime.setDate(alarmTime.getDate() + 1);
            }

            if (Capacitor.isNativePlatform()) {
                try {
                    await NativeAlarm.scheduleAlarm({
                        id: parseInt(id),
                        time: alarmTime.getTime(),
                        title: "Focus Alarm",
                        body: "Your scheduled alarm is ringing!"
                    });
                    setAlarms(prev => prev.map(a => a.id === id ? { ...a, active: true } : a));
                } catch (e) {
                    console.error("Native Alarm scheduling failed", e);
                    alert("Failed to schedule native alarm.");
                }
            } else {
                setAlarms(prev => prev.map(a => a.id === id ? { ...a, active: true } : a));
            }
        }
    };

    const isRinging = globalAlarmSource === 'FOCUS_ALARM';

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden relative">
            {/* Header / Toggle */}
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-app-bg/50 hover:bg-app-bg/80 transition-colors border-b border-app-border cursor-pointer group"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-app-accent-warning/10 text-app-accent-warning group-hover:bg-app-accent-warning/20 transition-colors">
                        <Bell size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-app-text-main">Real Alarms</h3>
                        <p className="text-xs text-app-text-muted">
                            {alarms.filter(a => a.active).length} Active • Multi-Alarm System
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            addAlarm();
                            setIsOpen(true);
                        }}
                        className="p-1.5 rounded-lg bg-app-primary/10 text-app-primary hover:bg-app-primary/20 transition-colors"
                        title="Add Alarm"
                    >
                        <Plus size={18} />
                    </button>
                    <motion.div
                        animate={{ rotate: isOpen ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-app-text-muted"
                    >
                        <ChevronDown size={20} />
                    </motion.div>
                </div>
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="p-4 space-y-3 min-h-[80px]">
                            {alarms.length === 0 ? (
                                <div className="text-center py-6 text-app-text-muted text-sm italic">
                                    No alarms yet. Tap + to add one.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {alarms.map(alarm => (
                                        <div
                                            key={alarm.id}
                                            className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-app-bg/30 border border-app-border/40 hover:border-app-primary/30 transition-all group/item"
                                        >
                                            <div className="flex items-center gap-4">
                                                <TimePicker
                                                    value={alarm.time}
                                                    onChange={(newTime) => updateAlarmTime(alarm.id, newTime)}
                                                />
                                            </div>

                                            <div className="flex items-center gap-2 sm:gap-3">
                                                <button
                                                    onClick={() => toggleAlarm(alarm.id)}
                                                    className={`p-2 rounded-full transition-all active:scale-95 ${alarm.active
                                                        ? 'bg-app-accent-warning text-white shadow-lg shadow-app-accent-warning/20 hover:bg-app-accent-warning/90'
                                                        : 'text-app-text-muted hover:bg-app-surface'
                                                        }`}
                                                    title={alarm.active ? 'Turn Off' : 'Turn On'}
                                                >
                                                    {alarm.active ? <Bell size={18} fill="currentColor" /> : <BellOff size={18} />}
                                                </button>
                                                <button
                                                    onClick={() => removeAlarm(alarm.id)}
                                                    className="p-2 rounded-full text-app-text-muted hover:text-destructive hover:bg-destructive/10 transition-all active:scale-95"
                                                    title="Delete Alarm"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="pt-2 flex flex-col items-center gap-1">
                                <p className="text-[10px] text-app-text-muted uppercase tracking-widest font-bold">
                                    Neighbours will hear this alarm 🔊
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Inbuilt Stop UI - Only visible when ANY focus alarm is actively ringing */}
            <AnimatePresence>
                {isRinging && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-app-accent-warning/95 backdrop-blur-md p-6"
                    >
                        <motion.div
                            animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                            transition={{ repeat: Infinity, duration: 1.2 }}
                            className="text-white mb-4 drop-shadow-lg"
                        >
                            <Bell size={56} />
                        </motion.div>
                        <h2 className="text-2xl font-bold text-white mb-2 text-center drop-shadow-md">
                            WAKE UP!
                        </h2>
                        <p className="text-white/90 text-sm text-center mb-6 font-medium max-w-[200px]">
                            Navigation required: open focus tab to stop.
                        </p>
                        <button
                            onClick={stopGlobalAlarm}
                            className="w-full max-w-sm py-3.5 px-8 rounded-2xl bg-white text-app-accent-warning font-black tracking-wider text-lg shadow-2xl hover:bg-gray-100 transition-all active:scale-95 flex items-center justify-center gap-3"
                        >
                            <X size={24} strokeWidth={4} /> STOP ALARM
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InbuiltAlarm;
