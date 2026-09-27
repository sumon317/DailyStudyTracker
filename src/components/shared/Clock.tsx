import { Clock as ClockIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const TICK_MS = 1000;

// Built once, like the DatePicker's formatters: `toLocaleTimeString` has to
// resolve its locale and its options on every call, and this one runs on every
// page for as long as the app is open.
const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
});

const secondKey = (date: Date): number => Math.floor(date.getTime() / TICK_MS);

const Clock = memo(() => {
    const [time, setTime] = useState(() => new Date());
    const timerRef = useRef<number | null>(null);

    /**
     * Only repaint when the displayed second actually changed: a resync that
     * lands mid-second would otherwise re-render for nothing.
     */
    const syncTime = useCallback(() => {
        const next = new Date();
        setTime((previous) => (secondKey(previous) === secondKey(next) ? previous : next));
    }, []);

    useEffect(() => {
        let cancelled = false;

        /**
         * A self-rescheduling timeout aimed at the next second boundary, rather
         * than a fixed 1s interval that drifts and paints the previous second
         * for up to a full tick after the clock has already turned over.
         */
        const scheduleNextTick = () => {
            if (cancelled) {
                return;
            }
            timerRef.current = window.setTimeout(
                () => {
                    syncTime();
                    scheduleNextTick();
                },
                TICK_MS - (Date.now() % TICK_MS),
            );
        };
        scheduleNextTick();

        /**
         * Background tabs throttle timers to roughly one tick per minute, so on
         * return to the foreground the display can be up to a minute stale.
         * Re-reading the clock on the way back makes the first visible frame
         * correct.
         */
        const handleForeground = () => {
            if (document.visibilityState === 'visible') {
                syncTime();
            }
        };
        document.addEventListener('visibilitychange', handleForeground);
        window.addEventListener('focus', handleForeground);

        return () => {
            // The flag stops the tick that is already inside `setTime` from
            // arming a fresh timeout after the cleanup has run. React flushes
            // that update as a microtask, so clearing `timerRef` alone is not
            // enough: a parent that unmounts the clock in response would leave
            // the self-rescheduling chain running for the life of the process.
            cancelled = true;
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            document.removeEventListener('visibilitychange', handleForeground);
            window.removeEventListener('focus', handleForeground);
        };
    }, [syncTime]);

    const timeString = TIME_FORMATTER.format(time);

    return (
        <div
            className="flex items-center gap-1.5 sm:gap-2 font-mono text-xs sm:text-sm font-semibold text-app-text-main transition-colors"
            role="timer"
            aria-label="Current time"
            aria-live="off"
        >
            <ClockIcon size={14} className="text-app-primary sm:w-4 sm:h-4" aria-hidden="true" />
            <span>{timeString}</span>
        </div>
    );
});

Clock.displayName = 'Clock';

export default Clock;
