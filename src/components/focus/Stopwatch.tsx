import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const Stopwatch = memo(() => {
    const [elapsedMs, setElapsedMs] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const accumulatedMsRef = useRef(0);
    const startedAtRef = useRef<number | null>(null);
    const intervalRef = useRef<number | null>(null);
    const runningRef = useRef(false);

    const syncElapsed = useCallback(() => {
        if (!runningRef.current) {
            return;
        }
        if (startedAtRef.current !== null) {
            setElapsedMs(accumulatedMsRef.current + Math.max(0, Date.now() - startedAtRef.current));
        }
    }, []);

    useEffect(() => {
        if (!isRunning) {
            if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return;
        }

        if (startedAtRef.current === null) {
            startedAtRef.current = Date.now();
        }
        syncElapsed();
        intervalRef.current = window.setInterval(syncElapsed, 250);
        document.addEventListener('visibilitychange', syncElapsed);
        return () => {
            if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            document.removeEventListener('visibilitychange', syncElapsed);
        };
    }, [isRunning, syncElapsed]);

    const handleStartPause = useCallback(() => {
        // The ref, not `isRunning`, decides: two clicks in the same tick would both
        // read the pre-click state and start twice.
        if (runningRef.current) {
            const now = Date.now();
            if (startedAtRef.current !== null) {
                accumulatedMsRef.current += Math.max(0, now - startedAtRef.current);
            }
            startedAtRef.current = null;
            runningRef.current = false;
            setElapsedMs(accumulatedMsRef.current);
            setIsRunning(false);
        } else {
            startedAtRef.current = Date.now();
            runningRef.current = true;
            setIsRunning(true);
        }
    }, []);

    const handleReset = useCallback(() => {
        accumulatedMsRef.current = 0;
        startedAtRef.current = null;
        runningRef.current = false;
        setElapsedMs(0);
        setIsRunning(false);
    }, []);

    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`;
    const runningLabel = isRunning ? 'running' : 'paused';

    return (
        <div
            className="flex items-center gap-1.5 sm:gap-2"
            role="timer"
            aria-label={`Stopwatch ${timeString}, ${runningLabel}`}
        >
            <div className="flex items-center gap-1 text-xs font-semibold text-app-text-main sm:gap-2 sm:text-sm">
                <Timer size={14} className="text-app-primary sm:h-4 sm:w-4" aria-hidden="true" />
                <span className="font-mono" aria-live="off">
                    {timeString}
                </span>
            </div>
            <div className="flex gap-0.5">
                <button
                    type="button"
                    onClick={handleStartPause}
                    className={`rounded-lg p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary sm:p-1.5 ${
                        isRunning
                            ? 'bg-app-accent-warning/20 text-app-accent-warning hover:bg-app-accent-warning/30'
                            : 'bg-app-accent-success/20 text-app-accent-success hover:bg-app-accent-success/30'
                    }`}
                    aria-label={isRunning ? 'Pause stopwatch' : 'Start stopwatch'}
                    title={isRunning ? 'Pause' : 'Start'}
                >
                    {isRunning ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-lg bg-app-bg p-1 text-app-text-muted transition-colors hover:bg-app-border focus:outline-none focus:ring-2 focus:ring-app-primary sm:p-1.5"
                    aria-label="Reset stopwatch"
                    title="Reset"
                >
                    <RotateCcw size={12} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
});

Stopwatch.displayName = 'Stopwatch';

export default Stopwatch;
