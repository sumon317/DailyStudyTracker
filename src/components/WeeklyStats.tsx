import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChevronLeft, ChevronRight, Clock, Flame, Target, TrendingUp } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { exportAllData } from '../db';
import type { BarProps, DayData, StatCardProps, WeeklyStatsProps } from '../types';
import Skeleton from './SkeletonLoader';

const getWeekDates = (date: string): string[] => {
    const d = new Date(date);
    const day = d.getDay();
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
        const weekDay = new Date(sunday);
        weekDay.setDate(sunday.getDate() + i);
        dates.push(weekDay.toISOString().split('T')[0] ?? '');
    }
    return dates;
};

const formatDateShort = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
};

const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const Bar = memo(({ actual, planned, label, isToday, maxHeight = 100 }: BarProps) => {
    const percentage = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
    const barHeight = Math.max(percentage, actual > 0 ? 10 : 0);

    return (
        <div className="flex flex-col items-center gap-1 flex-1">
            <div className="text-[10px] text-app-text-muted">{actual > 0 ? `${actual}m` : '-'}</div>
            <div
                className="w-full max-w-[32px] bg-app-border/50 rounded-t-md relative overflow-hidden"
                style={{ height: `${maxHeight}px` }}
            >
                <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${barHeight}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className={`absolute bottom-0 left-0 right-0 rounded-t-md ${
                        percentage >= 80
                            ? 'bg-app-accent-success'
                            : percentage >= 50
                              ? 'bg-app-accent-warning'
                              : actual > 0
                                ? 'bg-app-accent-error'
                                : 'bg-app-border'
                    }`}
                />
            </div>
            <div className={`text-xs font-medium ${isToday ? 'text-app-primary' : 'text-app-text-muted'}`}>{label}</div>
        </div>
    );
});

Bar.displayName = 'Bar';

const StatCard = memo(({ icon: Icon, label, value, subtext, color = 'text-app-primary' }: StatCardProps) => (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-app-bg/50 border border-app-border">
        <div className={`p-2 rounded-lg bg-app-surface ${color}`}>
            <Icon size={18} />
        </div>
        <div>
            <div className="text-lg font-bold text-app-text-main">{value}</div>
            <div className="text-xs text-app-text-muted">{label}</div>
            {subtext && <div className="text-[10px] text-app-text-muted/70">{subtext}</div>}
        </div>
    </div>
));

StatCard.displayName = 'StatCard';

interface WeekDataMap {
    [key: string]: DayData;
}

const WeeklyStats = memo(({ currentDate }: WeeklyStatsProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0);
    const [weekData, setWeekData] = useState<WeekDataMap>({});
    const [loading, setLoading] = useState(false);

    const targetDate = useMemo(() => {
        const d = new Date(currentDate);
        d.setDate(d.getDate() + weekOffset * 7);
        return d.toISOString().split('T')[0] ?? '';
    }, [currentDate, weekOffset]);

    const weekDates = useMemo(() => getWeekDates(targetDate), [targetDate]);

    const todayStr = useMemo(() => new Date().toISOString().split('T')[0] ?? '', []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const loadWeekData = async () => {
            setLoading(true);
            try {
                const allData = await exportAllData();
                const dataMap: WeekDataMap = {};
                allData.forEach((entry) => {
                    if (entry.date) {
                        dataMap[entry.date] = entry;
                    }
                });
                setWeekData(dataMap);
            } catch (_error) {
                // Silently ignore week data load errors
            }
            setLoading(false);
        };
        loadWeekData();
    }, [isOpen]);

    const stats = useMemo(() => {
        let totalActual = 0;
        let totalPlanned = 0;
        let daysStudied = 0;
        let streak = 0;
        let currentStreak = 0;

        weekDates.forEach((dateStr) => {
            const dayData = weekData[dateStr];
            if (dayData?.subjects) {
                const dayActual = dayData.subjects.reduce((sum, s) => sum + (Number.parseFloat(s.actual) || 0), 0);
                const dayPlanned = dayData.subjects.reduce((sum, s) => sum + (Number.parseFloat(s.planned) || 0), 0);
                totalActual += dayActual;
                totalPlanned += dayPlanned;

                if (dayActual > 0) {
                    daysStudied++;
                    currentStreak++;
                    streak = Math.max(streak, currentStreak);
                } else {
                    currentStreak = 0;
                }
            } else {
                currentStreak = 0;
            }
        });

        const avgPerDay = daysStudied > 0 ? Math.round(totalActual / daysStudied) : 0;
        const completionRate = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;

        return { totalActual, totalPlanned, daysStudied, streak, avgPerDay, completionRate };
    }, [weekDates, weekData]);

    const handlePrevWeek = useCallback(() => setWeekOffset((prev) => prev - 1), []);
    const handleNextWeek = useCallback(() => setWeekOffset((prev) => prev + 1), []);
    const handleThisWeek = useCallback(() => setWeekOffset(0), []);

    const weekLabel = useMemo(() => {
        const first = weekDates[0];
        const last = weekDates[6];
        if (!first || !last) {
            return '';
        }
        const start = formatDateLabel(first);
        const end = formatDateLabel(last);
        return `${start} - ${end}`;
    }, [weekDates]);

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden">
            {/* Toggle Header */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-app-bg/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-app-primary/10 text-app-primary">
                        <BarChart3 size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-app-text-main">Weekly Stats</h3>
                        <p className="text-xs text-app-text-muted">View your study patterns</p>
                    </div>
                </div>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-app-text-muted"
                >
                    <ChevronLeft size={20} className="rotate-[-90deg]" />
                </motion.div>
            </button>

            {/* Expandable Content */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="p-4 pt-0 space-y-4">
                            {/* Week Navigation */}
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={handlePrevWeek}
                                    className="p-2 rounded-lg hover:bg-app-bg text-app-text-muted"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleThisWeek}
                                    className={`font-medium text-sm ${weekOffset === 0 ? 'text-app-primary' : 'text-app-text-main hover:text-app-primary'}`}
                                >
                                    {weekLabel}
                                    {weekOffset === 0 && <span className="text-xs ml-1">(This Week)</span>}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleNextWeek}
                                    disabled={weekOffset >= 0}
                                    className={`p-2 rounded-lg hover:bg-app-bg text-app-text-muted ${weekOffset >= 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>

                            {/* Bar Chart */}
                            {loading ? (
                                <div className="h-32 flex items-center justify-center">
                                    <div className="flex gap-2 px-2 w-full">
                                        {Array.from({ length: 7 }).map((_, i) => (
                                            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton placeholders are static
                                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                <Skeleton className="h-3 w-8" />
                                                <Skeleton className="w-full max-w-[32px]" style={{ height: '80px' }} />
                                                <Skeleton className="h-3 w-6" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex gap-2 px-2">
                                    {weekDates.map((dateStr) => {
                                        const dayData = weekData[dateStr];
                                        const actual =
                                            dayData?.subjects?.reduce(
                                                (sum, s) => sum + (Number.parseFloat(s.actual) || 0),
                                                0,
                                            ) || 0;
                                        const planned =
                                            dayData?.subjects?.reduce(
                                                (sum, s) => sum + (Number.parseFloat(s.planned) || 0),
                                                0,
                                            ) || 360;

                                        return (
                                            <Bar
                                                key={dateStr}
                                                actual={actual}
                                                planned={planned}
                                                label={formatDateShort(dateStr)}
                                                isToday={dateStr === todayStr}
                                                maxHeight={80}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            {/* Stats Grid */}
                            {loading ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <div
                                            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton placeholders are static
                                            key={i}
                                            className="flex items-center gap-3 p-3 rounded-lg bg-app-bg/50 border border-app-border"
                                        >
                                            <Skeleton className="h-10 w-10 rounded-lg" />
                                            <div className="flex-1 space-y-2">
                                                <Skeleton className="h-5 w-16" />
                                                <Skeleton className="h-3 w-24" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <StatCard
                                        icon={Clock}
                                        label="Total Study Time"
                                        value={`${Math.round((stats.totalActual / 60) * 10) / 10}h`}
                                        subtext={`${stats.totalActual} minutes`}
                                        color="text-app-primary"
                                    />
                                    <StatCard
                                        icon={Target}
                                        label="Completion Rate"
                                        value={`${stats.completionRate}%`}
                                        subtext={`${stats.daysStudied}/7 days`}
                                        color="text-app-accent-success"
                                    />
                                    <StatCard
                                        icon={TrendingUp}
                                        label="Daily Average"
                                        value={`${Math.round((stats.avgPerDay / 60) * 10) / 10}h`}
                                        subtext="per active day"
                                        color="text-app-accent-warning"
                                    />
                                    <StatCard
                                        icon={Flame}
                                        label="Best Streak"
                                        value={`${stats.streak} days`}
                                        subtext="consecutive"
                                        color="text-app-accent-error"
                                    />
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

WeeklyStats.displayName = 'WeeklyStats';

export default WeeklyStats;
