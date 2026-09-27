import { App as CapacitorApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellOff, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import NativeAlarm, {
    isValidNativeAlarmId,
    MAX_FOCUS_ALARMS,
    nativeAlarmRejectionReason,
} from '../../native/NativeAlarm';
import { useToast } from '../../providers/ToastProvider';
import { subscribeToDataImported } from '../../services/dataImportEvents';
import { NotificationService, TIMER_NOTIFICATION_ID } from '../../services/notificationService';
import type { InbuiltAlarmProps, NativeAlarmDefinition } from '../../types';
import TimePicker from '../shared/TimePicker';

interface AlarmEntry {
    id: string;
    time: string;
    active: boolean;
    nativeId?: number;
}

const STORAGE_KEY = 'focusAlarms';
/**
 * The cap the plugin's shared store can actually hold, minus the slot the
 * countdown timer owns. It lives in `native/alarmLimits` because the storage
 * validator and the native plugin have to agree on it: a list that could reach
 * the plugin's own limit would let the last alarm be rejected natively while the
 * UI still counted it as armed.
 */
const MAX_ALARMS = MAX_FOCUS_ALARMS;
const FOCUS_ALARM_TITLE = 'Focus Alarm';
const FOCUS_ALARM_BODY = 'Your scheduled alarm is ringing!';
const NATIVE_ONLY_MESSAGE = 'Focus alarms are delivered by Android only; this browser cannot guarantee delivery.';
let alarmSequence = 0;

export const isValidAlarmTime = (value: unknown): value is string =>
    typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

const focusAlarmNativeId = (id: string): number => NotificationService.getNotificationId('focus-alarm', id);

const createAlarmId = (): string => {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (randomUuid) {
        return `focus-${randomUuid()}`;
    }
    alarmSequence += 1;
    return `focus-${Date.now().toString(36)}-${alarmSequence.toString(36)}`;
};

const readStoredAlarms = (): AlarmEntry[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return [];
        }
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            return [];
        }
        const seen = new Set<string>();
        return parsed
            .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
            .filter((value) => {
                if (typeof value.id !== 'string' && typeof value.id !== 'number') {
                    return false;
                }
                const id = String(value.id);
                if (!id || id.length > 128 || seen.has(id) || !isValidAlarmTime(value.time)) {
                    return false;
                }
                seen.add(id);
                return true;
            })
            .map((value) => {
                const id = typeof value.id === 'string' ? value.id : String(value.id);
                return {
                    id,
                    time: value.time as string,
                    // The armed flag must survive a web visit, otherwise re-persisting on the
                    // web silently disarms every alarm that was scheduled on Android.
                    active: value.active === true,
                    nativeId: focusAlarmNativeId(id),
                };
            })
            .slice(0, MAX_ALARMS);
    } catch {
        return [];
    }
};

const getNextAlarmTime = (time: string, now = new Date()): Date => {
    const [hourText, minuteText] = time.split(':');
    const target = new Date(now);
    target.setHours(Number(hourText), Number(minuteText), 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target;
};

export const buildFocusAlarmDefinitions = (alarms: AlarmEntry[], now = Date.now()): NativeAlarmDefinition[] => {
    const seen = new Set<number>();
    const definitions: NativeAlarmDefinition[] = [];
    for (const alarm of alarms) {
        if (!alarm.active || !isValidAlarmTime(alarm.time)) {
            continue;
        }
        const id = focusAlarmNativeId(alarm.id);
        // A hash collision (or a reserved id) would leave one of the two alarms
        // permanently unarmed while both read as active, so the second one is
        // dropped instead of silently overwriting the first. An id outside the
        // range Android accepts is dropped for the same reason: it would be
        // rejected by the bridge while the list still showed it as armed.
        if (seen.has(id) || id === TIMER_NOTIFICATION_ID || !isValidNativeAlarmId(id)) {
            continue;
        }
        seen.add(id);
        const time = getNextAlarmTime(alarm.time, new Date(now)).getTime();
        if (time <= now) {
            continue;
        }
        definitions.push({ id, time, title: FOCUS_ALARM_TITLE, body: FOCUS_ALARM_BODY });
    }
    return definitions;
};

const InbuiltAlarm = (_props: InbuiltAlarmProps) => {
    const nativePlatform = Capacitor.isNativePlatform();
    const { showToast } = useToast();
    const [alarms, setAlarms] = useState<AlarmEntry[]>(() => readStoredAlarms());
    const [isOpen, setIsOpen] = useState(true);
    const [pendingIds, setPendingIds] = useState<string[]>([]);
    const syncedNativeIdsRef = useRef<Set<number>>(new Set());
    // Every handler reads the live list through this ref: two clicks landing in
    // the same tick would otherwise both see the pre-click `alarms` closure and
    // schedule against an id that the second click has already removed.
    const alarmsRef = useRef(alarms);
    const pendingIdsRef = useRef<Set<string>>(new Set());
    const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
    const syncGenerationRef = useRef(0);
    const showToastRef = useRef(showToast);

    alarmsRef.current = alarms;
    showToastRef.current = showToast;

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms));
        } catch {
            return;
        }
    }, [alarms]);

    // A restore can carry a different alarm list, and this card reads its value
    // once, at mount. Re-reading here is also what re-arms the native alarms: the
    // `alarms` effect below reconciles every change, so adopting the restored
    // list schedules (and cancels) the difference without a second code path.
    useEffect(() => {
        return subscribeToDataImported(() => {
            setAlarms(readStoredAlarms());
        });
    }, []);

    const setPending = useCallback((id: string, pending: boolean) => {
        pendingIdsRef.current = pending
            ? new Set([...pendingIdsRef.current, id])
            : new Set([...pendingIdsRef.current].filter((pendingId) => pendingId !== id));
        setPendingIds([...pendingIdsRef.current]);
    }, []);

    // NativeAlarm persists every armed alarm in one shared store, and that store is also
    // used by the focus countdown timer. Bulk syncAlarms() would therefore delete a running
    // timer, so focus alarms are reconciled one by one and only ids this component armed
    // are ever cancelled.
    const syncNativeAlarms = useCallback(
        async (entries: AlarmEntry[]) => {
            if (!nativePlatform) {
                return;
            }
            const generation = syncGenerationRef.current + 1;
            syncGenerationRef.current = generation;
            const desired = new Map<number, NativeAlarmDefinition>();
            for (const definition of buildFocusAlarmDefinitions(entries)) {
                desired.set(definition.id, definition);
            }
            const previouslyArmed = [...syncedNativeIdsRef.current];
            syncedNativeIdsRef.current = new Set(desired.keys());

            // Serialised: two overlapping passes could otherwise let a stale
            // `scheduleAlarm` land after a newer `cancelAlarm` and leave an alarm
            // armed natively while the UI shows it as off.
            syncQueueRef.current = syncQueueRef.current
                .catch(() => undefined)
                .then(async () => {
                    if (generation !== syncGenerationRef.current) {
                        return;
                    }
                    const failed: number[] = [];
                    for (const id of previouslyArmed) {
                        if (!desired.has(id)) {
                            await NativeAlarm.cancelAlarm({ id }).catch(() => undefined);
                        }
                    }
                    for (const definition of desired.values()) {
                        if (generation !== syncGenerationRef.current) {
                            return;
                        }
                        // A reconcile failure is otherwise invisible: the list keeps
                        // counting the alarm as active while nothing is armed
                        // natively. The reason is reported once per pass instead.
                        const armed = await NativeAlarm.scheduleAlarm(definition)
                            .then(() => true)
                            .catch(() => false);
                        if (!armed) {
                            failed.push(definition.id);
                        }
                    }
                    if (failed.length > 0 && generation === syncGenerationRef.current) {
                        showToastRef.current({
                            type: 'warning',
                            message:
                                failed.length === 1
                                    ? 'One focus alarm could not be armed and will not ring. Try toggling it off and on.'
                                    : `${failed.length} focus alarms could not be armed and will not ring. Try toggling them off and on.`,
                        });
                    }
                });
            await syncQueueRef.current;
        },
        [nativePlatform],
    );

    useEffect(() => {
        if (!nativePlatform) {
            return;
        }
        // The re-arm signal is registered once per mount rather than per list
        // change. Re-subscribing on every toggle tore the listener down and back
        // up again, which left windows where a resume was not being observed and
        // the alarms went un-re-armed after a reboot.
        let active = true;
        let resumeHandle: PluginListenerHandle | undefined;
        const rearm = () => {
            void (async () => {
                await NativeAlarm.reconcileAlarms().catch(() => undefined);
                if (active) {
                    await syncNativeAlarms(alarmsRef.current);
                }
            })();
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                rearm();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // `visibilitychange` is not guaranteed in a Capacitor WebView, so the
        // native resume event is the reliable re-arm signal there. The handle is
        // captured in a local the cleanup closure shares, so a subscription that
        // resolves *after* the teardown is removed instead of leaked - which
        // StrictMode's double effect run makes a real case, not a theoretical one.
        void CapacitorApp.addListener('resume', rearm).then(
            (handle) => {
                if (active) {
                    resumeHandle = handle;
                } else {
                    void handle.remove();
                }
            },
            () => undefined,
        );
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            void resumeHandle?.remove();
        };
    }, [nativePlatform, syncNativeAlarms]);

    useEffect(() => {
        if (!nativePlatform) {
            return;
        }
        void syncNativeAlarms(alarms);
    }, [alarms, nativePlatform, syncNativeAlarms]);

    const addAlarm = () => {
        setIsOpen(true);
        if (alarmsRef.current.length >= MAX_ALARMS) {
            // Silently doing nothing reads as a broken button, so the cap is
            // reported as the limit it is.
            showToastRef.current({
                type: 'warning',
                message: `You can keep at most ${MAX_ALARMS} focus alarms. Delete one to add another.`,
            });
            return;
        }
        setAlarms((previous) => {
            if (previous.length >= MAX_ALARMS) {
                return previous;
            }
            const id = createAlarmId();
            const newAlarm: AlarmEntry = {
                id,
                time: '08:00',
                active: false,
                nativeId: focusAlarmNativeId(id),
            };
            return [...previous, newAlarm];
        });
    };

    const removeAlarm = async (id: string) => {
        // The `disabled` attribute the `pendingIds` render adds only blocks a click
        // once that render has committed. The ref is the authoritative guard: it is
        // written before the first `await`, so a second press inside the same tick
        // cannot issue a second cancellation for an id the first has retired.
        if (pendingIdsRef.current.has(id)) {
            return;
        }
        setPending(id, true);
        try {
            if (nativePlatform) {
                await NativeAlarm.cancelAlarm({ id: focusAlarmNativeId(id) });
            }
            setAlarms((previous) => previous.filter((alarm) => alarm.id !== id));
        } catch {
            showToastRef.current({ type: 'error', message: 'Failed to remove the alarm; it is still scheduled.' });
        } finally {
            setPending(id, false);
        }
    };

    const updateAlarmTime = async (id: string, newTime: string) => {
        if (!isValidAlarmTime(newTime)) {
            return;
        }
        const alarm = alarmsRef.current.find((entry) => entry.id === id);
        if (!alarm) {
            return;
        }
        // The time picker's own Set control is not one of the row buttons, so
        // nothing disables it while a cancellation is in flight; the ref is the
        // only thing that stops a fast double-tap from cancelling the same id
        // twice.
        if (pendingIdsRef.current.has(id)) {
            return;
        }
        // Re-picking the same time is not an edit: cancelling and disarming here
        // would silently switch off an alarm the user believes is still armed.
        if (alarm.time === newTime) {
            return;
        }
        setPending(id, true);
        try {
            if (nativePlatform && alarm.active) {
                await NativeAlarm.cancelAlarm({ id: focusAlarmNativeId(id) });
            }
            setAlarms((previous) =>
                previous.map((entry) => (entry.id === id ? { ...entry, time: newTime, active: false } : entry)),
            );
        } catch {
            showToastRef.current({
                type: 'error',
                message: 'Failed to update the alarm; the previous time is still scheduled.',
            });
        } finally {
            setPending(id, false);
        }
    };

    const toggleAlarm = async (id: string) => {
        const alarm = alarmsRef.current.find((entry) => entry.id === id);
        if (!alarm || pendingIdsRef.current.has(id)) {
            return;
        }
        if (!nativePlatform) {
            showToastRef.current({ type: 'warning', message: NATIVE_ONLY_MESSAGE });
            return;
        }
        setPending(id, true);
        try {
            const nativeId = focusAlarmNativeId(id);
            if (alarm.active) {
                await NativeAlarm.cancelAlarm({ id: nativeId });
                setAlarms((previous) =>
                    previous.map((entry) => (entry.id === id ? { ...entry, active: false } : entry)),
                );
                return;
            }
            if (!isValidAlarmTime(alarm.time)) {
                showToastRef.current({ type: 'warning', message: 'Please set a valid time first.' });
                return;
            }
            const options: NativeAlarmDefinition = {
                id: nativeId,
                time: getNextAlarmTime(alarm.time).getTime(),
                title: FOCUS_ALARM_TITLE,
                body: FOCUS_ALARM_BODY,
            };
            const rejected = nativeAlarmRejectionReason(options, [TIMER_NOTIFICATION_ID]);
            if (rejected) {
                showToastRef.current({ type: 'error', message: rejected });
                return;
            }
            await NativeAlarm.scheduleAlarm(options);
            setAlarms((previous) => previous.map((entry) => (entry.id === id ? { ...entry, active: true } : entry)));
        } catch {
            showToastRef.current({ type: 'error', message: 'Failed to schedule native alarm.' });
        } finally {
            setPending(id, false);
        }
    };

    const activeCount = alarms.filter((alarm) => alarm.active).length;

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden relative">
            <div className="w-full flex items-center justify-between p-4 bg-app-bg/50 border-b border-app-border group">
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls="native-alarm-content"
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-3 text-left flex-1 hover:bg-app-bg/80 transition-colors"
                >
                    <div className="p-2 rounded-lg bg-app-accent-warning/10 text-app-accent-warning group-hover:bg-app-accent-warning/20 transition-colors">
                        <Bell size={20} aria-hidden="true" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-app-text-main">Real Alarms</h3>
                        <p className="text-xs text-app-text-muted" aria-live="polite">
                            {activeCount} Active • Multi-Alarm System
                        </p>
                    </div>
                </button>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        aria-label="Add focus alarm"
                        onClick={addAlarm}
                        className="p-1.5 rounded-lg bg-app-primary/10 text-app-primary hover:bg-app-primary/20 transition-colors"
                        title="Add Alarm"
                    >
                        <Plus size={18} aria-hidden="true" />
                    </button>
                    <motion.div
                        animate={{ rotate: isOpen ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-app-text-muted"
                        aria-hidden="true"
                    >
                        <ChevronDown size={20} />
                    </motion.div>
                </div>
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id="native-alarm-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="p-4 space-y-3 min-h-[80px]">
                            {!nativePlatform && (
                                <p className="rounded-lg bg-app-bg p-3 text-xs text-app-text-muted">
                                    {NATIVE_ONLY_MESSAGE}
                                </p>
                            )}
                            {alarms.length === 0 ? (
                                <div className="text-center py-6 text-app-text-muted text-sm italic">
                                    No alarms yet. Tap + to add one.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {alarms.map((alarm) => (
                                        <div
                                            key={alarm.id}
                                            className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-app-bg/30 border border-app-border/40 hover:border-app-primary/30 transition-all group/item"
                                        >
                                            <div className="flex items-center gap-4">
                                                <TimePicker
                                                    value={alarm.time}
                                                    onChange={(newTime) => {
                                                        void updateAlarmTime(alarm.id, newTime);
                                                    }}
                                                />
                                            </div>

                                            <div className="flex items-center gap-2 sm:gap-3">
                                                <button
                                                    type="button"
                                                    aria-label={`${alarm.active ? 'Turn off' : 'Turn on'} alarm at ${alarm.time}`}
                                                    onClick={() => void toggleAlarm(alarm.id)}
                                                    disabled={pendingIds.includes(alarm.id)}
                                                    className={`p-2 rounded-full transition-all active:scale-95 disabled:opacity-50 ${
                                                        alarm.active
                                                            ? 'bg-app-accent-warning text-app-bg shadow-lg shadow-app-accent-warning/20 hover:bg-app-accent-warning/90'
                                                            : 'text-app-text-muted hover:bg-app-surface'
                                                    }`}
                                                    title={alarm.active ? 'Turn Off' : 'Turn On'}
                                                >
                                                    {alarm.active ? (
                                                        <Bell size={18} fill="currentColor" aria-hidden="true" />
                                                    ) : (
                                                        <BellOff size={18} aria-hidden="true" />
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label={`Delete alarm at ${alarm.time}`}
                                                    onClick={() => void removeAlarm(alarm.id)}
                                                    disabled={pendingIds.includes(alarm.id)}
                                                    className="p-2 rounded-full text-app-text-muted hover:text-app-accent-error hover:bg-app-accent-error/10 transition-all active:scale-95 disabled:opacity-50"
                                                    title="Delete Alarm"
                                                >
                                                    <Trash2 size={18} aria-hidden="true" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="pt-2 flex flex-col items-center gap-1">
                                <p className="text-[10px] text-app-text-muted uppercase tracking-widest font-bold">
                                    {nativePlatform
                                        ? 'Android alarm scheduling enabled'
                                        : 'Android-only alarm scheduling'}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InbuiltAlarm;
