import { Clock as ClockIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

const Clock = memo(() => {
    const [time, setTime] = useState(new Date());
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const updateTime = () => {
            setTime(new Date());
        };

        timerRef.current = window.setInterval(updateTime, 1000);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    const timeString = time.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });

    return (
        <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-xs sm:text-sm font-semibold text-app-text-main transition-colors">
            <ClockIcon size={14} className="text-app-primary sm:w-4 sm:h-4" />
            <span>{timeString}</span>
        </div>
    );
});

Clock.displayName = 'Clock';

export default Clock;
