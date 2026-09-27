import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import NativeAlarm, { nativeAlarmRejectionReason } from '../../native/NativeAlarm';
import type { AlarmAudioController } from '../../services/alarmAudio';
import { createAlarmAudio } from '../../services/alarmAudio';
import { NotificationService, TIMER_NOTIFICATION_ID } from '../../services/notificationService';
import type { CountdownTimerProps } from '../../types';

const DEFAULT_TIMER_SECONDS = 1800;
const FOREGROUND_SERVICE_ID = 111;
const TIMER_CARD_CONTENT_ID = 'focus-timer-content';

/**
 * The countdown completion alert and an app-level alarm are the same event seen
 * through two paths: the in-page tick and the `localNotificationReceived`
 * callback in `App`. When *anything* is already ringing, the local one must stay
 * silent - otherwise the user gets the same tone from two audio graphs plus a
 * second `aria-modal` dialog stacked under the overlay that is already up.
 *
 * `FOCUS_ALARM` used to be excluded here, on the grounds that the in-built alarm
 * list owns it. That is what let a focus list alarm and a finished focus session
 * ring at once on `/focus`: two tones, and two `aria-modal` dialogs claiming the
 * same alarm, for two different events. The list is a ring like any other, so
 * "some other alarm is already up" is the only question that matters here.
 */
export const isForeignAlarmActive = (globalAlarmSource: string | null | undefined): boolean =>
    globalAlarmSource !== null && globalAlarmSource !== undefined;

export const validateTimerInput = (hours: number, minutes: number, seconds: number): number | null => {
    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        !Number.isInteger(seconds) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59 ||
        seconds < 0 ||
        seconds > 59
    ) {
        return null;
    }
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
};

export const timerProgressPercent = (timeLeft: number, initialTime: number): number => {
    if (!Number.isFinite(timeLeft) || !Number.isFinite(initialTime) || initialTime <= 0) {
        return 0;
    }
    return Math.min(100, Math.max(0, (timeLeft / initialTime) * 100));
};

const CountdownTimer = memo(({ globalAlarmSource, stopGlobalAlarm }: CountdownTimerProps) => {
    const [timeLeft, setTimeLeft] = useState(DEFAULT_TIMER_SECONDS);
    const [isActive, setIsActive] = useState(false);
    const [initialTime, setInitialTime] = useState(DEFAULT_TIMER_SECONDS);
    const [isEditing, setIsEditing] = useState(false);
    const [isOpen, setIsOpen] = useState(true);
    const [validationError, setValidationError] = useState<string | null>(null);
    /**
     * Why the session reminder is not covered, when the device refused to arm
     * it. Rendered next to the card's own status line so it is visible without
     * opening the editor, which is the only other place an error can appear.
     */
    const [alarmWarning, setAlarmWarning] = useState<string | null>(null);

    const [hoursInput, setHoursInput] = useState(0);
    const [minutesInput, setMinutesInput] = useState(30);
    const [secondsInput, setSecondsInput] = useState(0);

    const intervalRef = useRef<number | null>(null);
    const endTimeRef = useRef<number | null>(null);
    const timeLeftRef = useRef(timeLeft);
    const operationRef = useRef(0);
    const initialTimeRef = useRef(initialTime);
    const foregroundServiceStartedRef = useRef(false);
    // Shared across every run of the service effect so a pause's stop cannot land
    // after the resume's start.
    const foregroundQueueRef = useRef<Promise<void>>(Promise.resolve());
    const keepAwakeHeldRef = useRef(false);
    const globalAlarmSourceRef = useRef<string | null>(globalAlarmSource);
    const timerAlarmQueueRef = useRef<Promise<void>>(Promise.resolve());
    timeLeftRef.current = timeLeft;
    initialTimeRef.current = initialTime;
    globalAlarmSourceRef.current = globalAlarmSource;

    const [isAlarmPlaying, setIsAlarmPlaying] = useState(false);
    const alarmAudioRef = useRef<AlarmAudioController | null>(null);
    // `stopAlarm` is declared after the unmount cleanup that uses it; the ref
    // breaks that ordering so the cleanup silences a still-ringing alarm.
    const stopAlarmRef = useRef<() => void>(() => undefined);
    const stopButtonRef = useRef<HTMLButtonElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const overlayTitleId = useId();
    const validationErrorId = useId();

    const getAlarmAudio = useCallback((): AlarmAudioController => {
        // Built lazily so merely opening the focus page does not fetch the
        // ~1.4 MiB alarm asset.
        alarmAudioRef.current ??= createAlarmAudio();
        return alarmAudioRef.current;
    }, []);

    const formatTimeDisplay = useCallback((totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, []);

    useEffect(() => {
        return () => {
            // A ringing alarm outlives the component it was started from, and the
            // cleanup that disposes the audio graph is not enough on its own: the
            // pattern it started is still running, and nothing else would ever
            // cancel it. Silence it before the graph goes.
            stopAlarmRef.current();
            alarmAudioRef.current?.dispose();
            alarmAudioRef.current = null;
        };
    }, []);

    const playAlarm = useCallback(async () => {
        // The overlay already up (and owning the only stop control the user can
        // reach) claims this alert, so stay silent rather than doubling up.
        if (isForeignAlarmActive(globalAlarmSourceRef.current)) {
            return;
        }
        setIsAlarmPlaying(true);
        navigator.vibrate?.([1000, 500, 1000, 500, 1000, 500, 1000]);

        const audio = getAlarmAudio();
        await audio.play();

        // Unmounting mid-`play()` disposes the controller this call captured, and
        // `getAlarmAudio` would then hand the next caller a fresh graph. The
        // pattern this call started is still running, and `dispose()` cannot know
        // about it, so the vibration has to be cancelled here.
        if (alarmAudioRef.current !== audio) {
            audio.stop();
            navigator.vibrate?.(0);
        }

        if (
            !Capacitor.isNativePlatform() &&
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
        ) {
            new Notification("Time's Up!", {
                body: 'Your focus session is complete.',
                tag: 'focus-timer',
            });
        }
    }, [getAlarmAudio]);

    const stopAlarm = useCallback(() => {
        alarmAudioRef.current?.stop();
        // `vibrate(0)` is the only way to cancel a running pattern; stopping the
        // media element alone leaves the phone buzzing under a silent alarm.
        navigator.vibrate?.(0);
        setIsAlarmPlaying(false);
    }, []);

    // The unmount cleanup runs before `stopAlarm` is initialised on the first
    // render's closure, so it reaches the callback through a ref.
    stopAlarmRef.current = stopAlarm;

    // Another alarm's overlay covers the page while it rings, so the local alarm
    // must not keep playing underneath it where the user cannot reach the stop
    // control.
    useEffect(() => {
        if (isForeignAlarmActive(globalAlarmSource)) {
            stopAlarm();
        }
    }, [globalAlarmSource, stopAlarm]);

    /**
     * Every native timer-alarm mutation runs through one queue. `TIMER_NOTIFICATION_ID`
     * is a single shared id, so a cancel and a schedule that overlap across two
     * turns of the event loop can otherwise land in the wrong order and leave a
     * stale alarm armed.
     */
    const enqueueTimerAlarmOp = useCallback((operation: () => Promise<void>): Promise<void> => {
        timerAlarmQueueRef.current = timerAlarmQueueRef.current.catch(() => undefined).then(operation);
        return timerAlarmQueueRef.current;
    }, []);

    const cancelTimerNotifications = useCallback(
        () =>
            enqueueTimerAlarmOp(async () => {
                if (!Capacitor.isNativePlatform()) {
                    return;
                }
                // Both are cancelled even though only the notification is armed:
                // a build from before the single-authoritative-alarm change may
                // still have an `AlarmManager` entry under this id, and leaving it
                // would keep ringing after the session was stopped.
                await Promise.allSettled([
                    NativeAlarm.cancelAlarm({ id: TIMER_NOTIFICATION_ID }),
                    NotificationService.cancelTimerNotifications(),
                ]);
            }),
        [enqueueTimerAlarmOp],
    );

    useEffect(() => {
        let active = true;
        // Distinguishes "the teardown already issued the stop" from "the teardown ran
        // before the service existed, so nothing stopped it".
        let stopRequested = false;
        /**
         * One queue for the whole service lifecycle.
         *
         * The pause and resume that a user performs a second apart issue two
         * independent bridge calls, and nothing ordered them: a stop that landed
         * after the next start left the notification service dead while the card
         * counted down, with no error anywhere. Serialising the calls is what
         * makes the intent ("stop, then start") survive the round trips.
         */
        const enqueueForegroundOp = (operation: () => Promise<void>): Promise<void> => {
            foregroundQueueRef.current = foregroundQueueRef.current.catch(() => undefined).then(operation);
            return foregroundQueueRef.current;
        };
        const stopOwnedForegroundService = () => {
            if (stopRequested || !foregroundServiceStartedRef.current) {
                return Promise.resolve();
            }
            stopRequested = true;
            foregroundServiceStartedRef.current = false;
            if (Capacitor.getPlatform() !== 'android') {
                return Promise.resolve();
            }
            return enqueueForegroundOp(() => ForegroundService.stopForegroundService().then(() => undefined));
        };
        const releaseKeepAwake = () => {
            // Only release a keep-awake this component actually took: the app-level
            // alarm holds its own, and a bare mount must not switch the screen off
            // for it.
            if (!keepAwakeHeldRef.current) {
                return;
            }
            keepAwakeHeldRef.current = false;
            void KeepAwake.allowSleep().catch(() => undefined);
        };
        const manageServices = async () => {
            if (isActive) {
                if (!keepAwakeHeldRef.current) {
                    keepAwakeHeldRef.current = true;
                    void KeepAwake.keepAwake().catch(() => undefined);
                }
                if (!active || Capacitor.getPlatform() !== 'android') {
                    return;
                }
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
                        await ForegroundService.requestManageOverlayPermission().catch(() => undefined);
                    }
                    // Ownership is claimed *before* the start so an unmount during the
                    // bridge round trip can still stop it. The cleanup below only stops
                    // a service this component started, so claiming it early is what
                    // keeps the ownership flag and the running service in agreement.
                    foregroundServiceStartedRef.current = true;
                    await enqueueForegroundOp(async () => {
                        // The effect can be torn down while the permission round trip
                        // above is still in flight, which is before the claim was
                        // reached: the teardown had no service to stop, so it left the
                        // claim this call just made in place. Dropping it here is what
                        // keeps a later teardown from stopping a service this component
                        // never started - the app-level alarm runs its own.
                        if (!active) {
                            foregroundServiceStartedRef.current = false;
                            return;
                        }
                        try {
                            await ForegroundService.startForegroundService({
                                id: FOREGROUND_SERVICE_ID,
                                title: 'Focus Timer',
                                body: `Time remaining: ${formatTimeDisplay(timeLeftRef.current)}`,
                                smallIcon: 'ic_timer_icon',
                                serviceType: 1073741824 as never,
                                silent: true,
                            });
                        } catch {
                            // Nothing is running, so the claim has to go back or the next
                            // teardown would stop a service this component never started.
                            foregroundServiceStartedRef.current = false;
                        }
                    });
                } catch {
                    // The permission round trip failed, so nothing was even attempted.
                    foregroundServiceStartedRef.current = false;
                    return;
                }
            } else {
                releaseKeepAwake();
                await stopOwnedForegroundService();
            }
        };
        void manageServices();
        return () => {
            active = false;
            releaseKeepAwake();
            // Never tear down a foreground service this component did not start: the
            // app-level alarm runs its own service and a plain mount must not stop it.
            void stopOwnedForegroundService();
        };
    }, [isActive, formatTimeDisplay]);

    useEffect(() => {
        if (!isActive) {
            if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return;
        }

        const tick = () => {
            if (endTimeRef.current === null) {
                return;
            }
            const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
            setTimeLeft(remaining);
            if (remaining <= 0) {
                if (intervalRef.current !== null) {
                    window.clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
                endTimeRef.current = null;
                setIsActive(false);
                // Restore the armed duration so the play control stays usable without
                // forcing the user back through the editor.
                setTimeLeft(initialTimeRef.current);
                void playAlarm();
                return;
            }
            if (Capacitor.getPlatform() === 'android') {
                void ForegroundService.updateForegroundService({
                    id: FOREGROUND_SERVICE_ID,
                    title: 'Focus Timer',
                    body: `Time remaining: ${formatTimeDisplay(remaining)}`,
                    smallIcon: 'ic_timer_icon',
                    silent: true,
                }).catch(() => undefined);
            }
        };

        intervalRef.current = window.setInterval(tick, 1000);
        return () => {
            if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isActive, playAlarm, formatTimeDisplay]);

    useEffect(() => {
        return () => {
            operationRef.current += 1;
            void cancelTimerNotifications();
        };
    }, [cancelTimerNotifications]);

    const requestTimerPermission = useCallback(async (): Promise<boolean> => {
        if (Capacitor.isNativePlatform()) {
            return NotificationService.requestPermissions();
        }
        if (typeof window === 'undefined' || !('Notification' in window)) {
            return false;
        }
        try {
            return (await Notification.requestPermission()) === 'granted';
        } catch {
            return false;
        }
    }, []);

    /**
     * Arms the single authoritative alert for a session.
     *
     * Two native paths used to be armed at the same instant under the same id: a
     * raw `NativeAlarm` (`AlarmManager` -> `AlarmReceiver`, posted on the
     * `native_alarm` channel with a full-screen intent) *and* the
     * `NotificationService` alarm on the app's own `study-alarms-v4` channel.
     * Each posts its own notification with its own sound, so one focus session
     * rang twice, from two channels, and launched two activities.
     *
     * The `NotificationService` alarm is the authoritative one: it is the only
     * path that carries the app's channel and `alarm_loop.mp3` semantics, the
     * `ALARM_ACTIONS` type the Dismiss button comes from, and the
     * `localNotificationReceived` callback that drives the in-app overlay and its
     * audio. The raw alarm is still *cancelled* on every stop, so an id armed by
     * an older build is cleaned up.
     */
    const scheduleTimerNotifications = useCallback(
        (end: number, operation: number) =>
            enqueueTimerAlarmOp(async () => {
                if (!Capacitor.isNativePlatform() || operation !== operationRef.current) {
                    return;
                }
                if (nativeAlarmRejectionReason({ id: TIMER_NOTIFICATION_ID, time: end })) {
                    return;
                }
                // Re-arm from a known state so a retried schedule cannot leave a
                // stale `AlarmManager` entry competing with the new one.
                await NativeAlarm.cancelAlarm({ id: TIMER_NOTIFICATION_ID });
                if (operation !== operationRef.current) {
                    return;
                }
                const result = await NotificationService.scheduleNotification(
                    TIMER_NOTIFICATION_ID,
                    "Time's Up!",
                    'Your focus session is complete.',
                    new Date(end),
                    'ALARM_ACTIONS',
                    'timer',
                ).catch(() => ({ success: false as const }));
                if (operation !== operationRef.current) {
                    // A newer operation owns this id now and is queued behind this
                    // one, so it re-arms last. Cancelling here would delete it.
                    return;
                }
                if (!result.success) {
                    // The notification was not armed, so the session ends in
                    // silence unless the app happens to be open. The in-page
                    // countdown still rings, but a user who leaves the app must be
                    // told the reminder is not covered rather than left to
                    // discover it when the session ends.
                    setAlarmWarning(
                        'This device would not arm the session reminder. The alarm only plays while the app is open.',
                    );
                    return;
                }
                setAlarmWarning(null);
            }),
        [enqueueTimerAlarmOp],
    );

    const toggleTimer = useCallback(async () => {
        if (!isActive && timeLeft > 0) {
            const operation = operationRef.current + 1;
            operationRef.current = operation;
            const end = Date.now() + timeLeft * 1000;
            endTimeRef.current = end;
            setTimeLeft(timeLeft);
            setIsActive(true);
            stopAlarm();
            await requestTimerPermission();
            await scheduleTimerNotifications(end, operation);
            return;
        }
        if (isActive) {
            operationRef.current += 1;
            const remaining = Math.max(0, Math.ceil(((endTimeRef.current ?? Date.now()) - Date.now()) / 1000));
            setTimeLeft(remaining);
            endTimeRef.current = null;
            setIsActive(false);
            stopAlarm();
            await cancelTimerNotifications();
        }
    }, [cancelTimerNotifications, isActive, requestTimerPermission, scheduleTimerNotifications, stopAlarm, timeLeft]);

    const resetTimer = useCallback(async () => {
        operationRef.current += 1;
        setIsActive(false);
        endTimeRef.current = null;
        setTimeLeft(initialTime);
        stopAlarm();
        await cancelTimerNotifications();
    }, [cancelTimerNotifications, initialTime, stopAlarm]);

    const openEditor = useCallback(() => {
        operationRef.current += 1;
        setIsActive(false);
        endTimeRef.current = null;
        stopAlarm();
        void cancelTimerNotifications();
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);
        const seconds = timeLeft % 60;
        setHoursInput(hours);
        setMinutesInput(minutes);
        setSecondsInput(seconds);
        setValidationError(null);
        setIsEditing(true);
    }, [cancelTimerNotifications, stopAlarm, timeLeft]);

    const saveTime = useCallback(async () => {
        const totalSeconds = validateTimerInput(hoursInput, minutesInput, secondsInput);
        if (totalSeconds === null) {
            setValidationError('Enter a duration from 00:00:01 to 23:59:59.');
            return;
        }
        operationRef.current += 1;
        await cancelTimerNotifications();
        setInitialTime(totalSeconds);
        setTimeLeft(totalSeconds);
        setValidationError(null);
        setIsEditing(false);
    }, [cancelTimerNotifications, hoursInput, minutesInput, secondsInput]);

    /**
     * Extending a running session moves the deadline, so the armed native alarm has
     * to move with it - otherwise it rings at the original end while the card still
     * counts down.
     */
    const extendTimer = useCallback(
        (seconds: number) => {
            const end = endTimeRef.current;
            if (isActive && end !== null) {
                const nextEnd = end + seconds * 1000;
                endTimeRef.current = nextEnd;
                setTimeLeft((previous) => previous + seconds);
                const operation = operationRef.current + 1;
                operationRef.current = operation;
                void scheduleTimerNotifications(nextEnd, operation);
                return;
            }
            // Idle: the added seconds become part of the duration the next run is
            // measured against. Leaving `initialTime` behind would pin the progress
            // bar at 100% and make it claim more time remaining than the session
            // was ever armed for, and would let a reset throw the extra time away.
            setInitialTime((previous) => previous + seconds);
            setTimeLeft((previous) => previous + seconds);
        },
        [isActive, scheduleTimerNotifications],
    );

    const handleInputChange = (setter: Dispatch<SetStateAction<number>>) => (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        const parsed = Number.parseInt(value, 10);
        setter(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
        setValidationError(null);
    };

    const showLocalAlarmOverlay = isAlarmPlaying && !isForeignAlarmActive(globalAlarmSource);
    const progressPercent = timerProgressPercent(timeLeft, initialTime);

    useEffect(() => {
        if (!showLocalAlarmOverlay) {
            return;
        }
        // The overlay claims `aria-modal`, so the caret has to move into it, stay
        // inside it (there is exactly one control, so Tab would otherwise walk
        // straight out into the page the dialog says is unreachable), and go back
        // where it was once the alarm is silenced. Without the restore, stopping
        // the alarm drops the caret on `<body` and the tab sequence restarts at
        // the top of the page.
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        stopButtonRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                stopAlarm();
                stopGlobalAlarm();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }
            event.preventDefault();
            stopButtonRef.current?.focus();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            const target = previousFocusRef.current;
            previousFocusRef.current = null;
            if (target?.isConnected) {
                target.focus();
            }
        };
    }, [showLocalAlarmOverlay, stopAlarm, stopGlobalAlarm]);

    return (
        <>
            <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden">
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={TIMER_CARD_CONTENT_ID}
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full flex items-center justify-between p-4 bg-app-bg/50 hover:bg-app-bg/80 transition-colors border-b border-app-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-app-accent-warning/10 text-app-accent-warning">
                            <Timer size={20} aria-hidden="true" />
                        </div>
                        <div className="text-left">
                            <h3 className="font-semibold text-app-text-main">Focus Timer</h3>
                            <p className="text-xs text-app-text-muted">
                                {isActive ? `Running • ${formatTimeDisplay(timeLeft)}` : 'Start a focus session'}
                            </p>
                            {alarmWarning && <p className="mt-1 text-xs text-app-accent-error">{alarmWarning}</p>}
                        </div>
                    </div>
                    <motion.div
                        animate={{ rotate: isOpen ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-app-text-muted"
                        aria-hidden="true"
                    >
                        <ChevronDown size={20} />
                    </motion.div>
                </button>

                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            id={TIMER_CARD_CONTENT_ID}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                        >
                            <div className="p-5 flex flex-col items-center justify-center gap-6 min-h-[200px] relative">
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
                                                        inputMode="numeric"
                                                        value={hoursInput}
                                                        onChange={handleInputChange(setHoursInput)}
                                                        className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                        min="0"
                                                        max="23"
                                                        aria-invalid={validationError ? true : undefined}
                                                        aria-describedby={
                                                            validationError ? validationErrorId : undefined
                                                        }
                                                    />
                                                </div>
                                                <span className="text-2xl mb-2 font-bold" aria-hidden="true">
                                                    :
                                                </span>
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
                                                        inputMode="numeric"
                                                        value={minutesInput}
                                                        onChange={handleInputChange(setMinutesInput)}
                                                        className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                        min="0"
                                                        max="59"
                                                        aria-invalid={validationError ? true : undefined}
                                                        aria-describedby={
                                                            validationError ? validationErrorId : undefined
                                                        }
                                                    />
                                                </div>
                                                <span className="text-2xl mb-2 font-bold" aria-hidden="true">
                                                    :
                                                </span>
                                                <div className="flex flex-col items-center gap-1">
                                                    <label
                                                        htmlFor="timer-sec"
                                                        className="text-xs text-app-text-muted font-bold tracking-wider"
                                                    >
                                                        SEC
                                                    </label>
                                                    <input
                                                        id="timer-sec"
                                                        type="number"
                                                        inputMode="numeric"
                                                        value={secondsInput}
                                                        onChange={handleInputChange(setSecondsInput)}
                                                        className="w-16 h-12 text-center text-2xl font-mono bg-app-surface rounded-lg border border-app-border focus:border-app-primary focus:ring-1 focus:ring-app-primary outline-none"
                                                        min="0"
                                                        max="59"
                                                        aria-invalid={validationError ? true : undefined}
                                                        aria-describedby={
                                                            validationError ? validationErrorId : undefined
                                                        }
                                                    />
                                                </div>
                                            </div>

                                            {validationError && (
                                                <p
                                                    id={validationErrorId}
                                                    role="alert"
                                                    className="text-xs text-app-accent-error"
                                                >
                                                    {validationError}
                                                </p>
                                            )}

                                            <div className="flex gap-2 w-full">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditing(false)}
                                                    className="flex-1 py-2 px-4 rounded-lg bg-app-surface border border-app-border text-app-text-muted hover:bg-app-bg transition-colors flex items-center justify-center gap-1"
                                                >
                                                    <X size={16} aria-hidden="true" /> Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void saveTime()}
                                                    className="flex-1 py-2 px-4 rounded-lg bg-app-primary text-white hover:bg-app-primary-hover transition-colors flex items-center justify-center gap-1 font-medium shadow-sm"
                                                >
                                                    <Check size={16} aria-hidden="true" /> Set Timer
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
                                                    <Timer size={12} aria-hidden="true" /> Click numbers to edit
                                                </span>
                                            )}
                                        </button>
                                    )}
                                </div>

                                {!isEditing && (
                                    <>
                                        <div
                                            className="w-full h-2 bg-app-bg rounded-full overflow-hidden ring-1 ring-app-border/50"
                                            role="progressbar"
                                            aria-label="Focus timer progress"
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={Math.round(progressPercent)}
                                            aria-valuetext={`${formatTimeDisplay(timeLeft)} of ${formatTimeDisplay(initialTime)} remaining`}
                                        >
                                            <motion.div
                                                className="h-full bg-app-primary"
                                                initial={{ width: '100%' }}
                                                animate={{ width: `${progressPercent}%` }}
                                                transition={{ duration: 1, ease: 'linear' }}
                                            />
                                        </div>

                                        <div className="flex flex-col items-center gap-6">
                                            <button
                                                type="button"
                                                aria-label={isActive ? 'Pause focus timer' : 'Start focus timer'}
                                                onClick={() => void toggleTimer()}
                                                className={`flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all active:scale-95 ${
                                                    isActive
                                                        ? 'bg-app-accent-warning text-app-bg hover:bg-app-accent-warning/90 ring-4 ring-app-accent-warning/20'
                                                        : 'bg-app-primary text-white hover:bg-app-primary-hover ring-4 ring-app-primary/20'
                                                }`}
                                            >
                                                {isActive ? (
                                                    <Pause size={32} fill="currentColor" aria-hidden="true" />
                                                ) : (
                                                    <Play
                                                        size={32}
                                                        fill="currentColor"
                                                        className="ml-1"
                                                        aria-hidden="true"
                                                    />
                                                )}
                                            </button>

                                            <div className="flex items-center gap-3 bg-app-bg/50 p-2 rounded-2xl border border-app-border/50 backdrop-blur-sm">
                                                <button
                                                    type="button"
                                                    onClick={() => void resetTimer()}
                                                    className="flex items-center justify-center w-10 h-10 rounded-full text-app-text-muted hover:bg-app-surface hover:text-app-text-main transition-colors"
                                                    title="Reset"
                                                >
                                                    <RotateCcw size={18} aria-hidden="true" />
                                                </button>
                                                <div className="w-px h-6 bg-app-border/50 mx-1" aria-hidden="true" />
                                                <button
                                                    type="button"
                                                    onClick={() => extendTimer(10)}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-app-surface text-app-primary border border-app-border hover:bg-app-bg transition-colors active:scale-95"
                                                    title="Add 10s"
                                                >
                                                    +10s
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => extendTimer(30)}
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

            {/*
             * Deliberately not wrapped in `AnimatePresence`. The exit animation would
             * keep a dismissed `aria-modal` dialog in the accessibility tree - still
             * announced as modal, still holding the only stop control - after the
             * alarm is already silenced. The entry animation is enough here.
             */}
            {showLocalAlarmOverlay && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={overlayTitleId}
                    className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-app-bg/95 backdrop-blur-md p-6"
                >
                    <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.5 }}
                        className="text-app-accent-warning mb-4"
                        aria-hidden="true"
                    >
                        <Timer size={48} />
                    </motion.div>
                    <h3 id={overlayTitleId} className="text-xl font-bold text-app-text-main mb-6">
                        Time&apos;s Up!
                    </h3>
                    <button
                        type="button"
                        ref={stopButtonRef}
                        onClick={() => {
                            stopAlarm();
                            stopGlobalAlarm();
                        }}
                        className="w-full max-w-sm py-3 px-6 rounded-xl bg-app-accent-warning text-app-bg font-bold text-lg shadow-lg shadow-app-accent-warning/20 hover:bg-app-accent-warning/90 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <X size={24} aria-hidden="true" /> Stop Alarm
                    </button>
                </motion.div>
            )}
        </>
    );
});

CountdownTimer.displayName = 'CountdownTimer';

export default CountdownTimer;
