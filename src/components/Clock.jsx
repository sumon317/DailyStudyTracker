import React, { useState, useEffect } from 'react';
import { Clock as ClockIcon } from 'lucide-react';

const Clock = () => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Format: 10:45:23 AM
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
};

export default Clock;
