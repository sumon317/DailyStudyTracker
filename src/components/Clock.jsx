import React, { useState, useEffect, memo, useRef } from 'react';
import { Clock as ClockIcon } from 'lucide-react';

const Clock = memo(() => {
    const [time, setTime] = useState(new Date());
    const timerRef = useRef(null);

    useEffect(() => {
        // Use requestAnimationFrame for smoother updates
        const updateTime = () => {
            setTime(new Date());
        };

        timerRef.current = setInterval(updateTime, 1000);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    // Format: 10:45:23 AM - memoize the options object
    const timeString = time.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });

    return (
        <div className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface px-4 py-2 font-mono text-sm font-semibold text-app-text-main shadow-sm transition-colors">
            <ClockIcon size={16} className="text-app-primary" />
            <span>{timeString}</span>
        </div>
    );
});

Clock.displayName = 'Clock';

export default Clock;
