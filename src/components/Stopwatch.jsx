import React, { useState, useEffect, memo, useRef, useCallback } from 'react';
import { Timer, Play, Pause, RotateCcw } from 'lucide-react';

const Stopwatch = memo(() => {
    const [time, setTime] = useState(0); // time in seconds
    const [isRunning, setIsRunning] = useState(false);
    const intervalRef = useRef(null);

    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setTime(prev => prev + 1);
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
        setIsRunning(prev => !prev);
    }, []);

    const handleReset = useCallback(() => {
        setIsRunning(false);
        setTime(0);
    }, []);

    // Format: HH:MM:SS
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;

    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-app-text-main">
                <Timer size={16} className="text-app-primary" />
                <span className="font-mono">{timeString}</span>
            </div>
            <div className="flex gap-1">
                <button
                    onClick={handleStartPause}
                    className={`p-1.5 rounded-lg transition-colors ${isRunning
                            ? 'bg-app-accent-warning/20 text-app-accent-warning hover:bg-app-accent-warning/30'
                            : 'bg-app-accent-success/20 text-app-accent-success hover:bg-app-accent-success/30'
                        }`}
                    title={isRunning ? 'Pause' : 'Start'}
                >
                    {isRunning ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                    onClick={handleReset}
                    className="p-1.5 rounded-lg bg-app-bg text-app-text-muted hover:bg-app-border transition-colors"
                    title="Reset"
                >
                    <RotateCcw size={14} />
                </button>
            </div>
        </div>
    );
});

Stopwatch.displayName = 'Stopwatch';

export default Stopwatch;
