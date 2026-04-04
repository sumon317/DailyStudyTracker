import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const Stopwatch = memo(() => {
    const [time, setTime] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (isRunning) {
            intervalRef.current = window.setInterval(() => {
                setTime((prev) => prev + 1);
            }, 1000);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [isRunning]);

    const handleStartPause = useCallback(() => {
        setIsRunning((prev) => !prev);
    }, []);

    const handleReset = useCallback(() => {
        setIsRunning(false);
        setTime(0);
    }, []);

    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;

    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return (
        <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-app-text-main">
                <Timer size={14} className="text-app-primary sm:w-4 sm:h-4" />
                <span className="font-mono">{timeString}</span>
            </div>
            <div className="flex gap-0.5">
                <button
                    type="button"
                    onClick={handleStartPause}
                    className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
                        isRunning
                            ? 'bg-app-accent-warning/20 text-app-accent-warning hover:bg-app-accent-warning/30'
                            : 'bg-app-accent-success/20 text-app-accent-success hover:bg-app-accent-success/30'
                    }`}
                    title={isRunning ? 'Pause' : 'Start'}
                >
                    {isRunning ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="p-1 sm:p-1.5 rounded-lg bg-app-bg text-app-text-muted hover:bg-app-border transition-colors"
                    title="Reset"
                >
                    <RotateCcw size={12} />
                </button>
            </div>
        </div>
    );
});

Stopwatch.displayName = 'Stopwatch';

export default Stopwatch;
