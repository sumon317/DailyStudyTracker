import React, { memo, useMemo, useState, useCallback } from 'react';
import { PieChart, TrendingUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Simple CSS-based pie chart segment
const PieSegment = memo(({ percentage, color, startAngle }) => {
    const endAngle = startAngle + (percentage * 3.6); // 360 degrees / 100%

    return (
        <div
            className="absolute inset-0 rounded-full"
            style={{
                background: `conic-gradient(transparent ${startAngle}deg, ${color} ${startAngle}deg, ${color} ${endAngle}deg, transparent ${endAngle}deg)`
            }}
        />
    );
});

PieSegment.displayName = 'PieSegment';

// Progress bar for subject
const SubjectProgressBar = memo(({ name, planned, actual, color }) => {
    const percentage = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
    const isComplete = percentage >= 80;

    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="font-medium text-app-text-main truncate max-w-[120px]">{name}</span>
                <span className={`font-semibold ${isComplete ? 'text-app-accent-success' : 'text-app-text-muted'}`}>
                    {actual}/{planned} min
                </span>
            </div>
            <div className="h-2 rounded-full bg-app-border/50 overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: color }}
                />
            </div>
        </div>
    );
});

SubjectProgressBar.displayName = 'SubjectProgressBar';

// Color palette for subjects
const COLORS = [
    '#6366f1', // Indigo
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#22c55e', // Green
    '#eab308', // Yellow
    '#0ea5e9', // Sky
];

const StudyCharts = memo(({ subjects }) => {
    const [isOpen, setIsOpen] = useState(false);

    const toggleOpen = useCallback(() => setIsOpen(prev => !prev), []);

    const stats = useMemo(() => {
        const totalPlanned = subjects.reduce((sum, s) => sum + (parseFloat(s.planned) || 0), 0);
        const totalActual = subjects.reduce((sum, s) => sum + (parseFloat(s.actual) || 0), 0);
        const completionRate = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
        const kpiMet = subjects.filter(s => s.kpi === 'Y').length;

        // Calculate percentages for pie chart
        const subjectStats = subjects.map((s, i) => {
            const actual = parseFloat(s.actual) || 0;
            const planned = parseFloat(s.planned) || 0;
            return {
                name: s.name,
                actual,
                planned,
                percentage: totalActual > 0 ? (actual / totalActual) * 100 : 0,
                color: COLORS[i % COLORS.length]
            };
        }).filter(s => s.actual > 0);

        return { totalPlanned, totalActual, completionRate, kpiMet, subjectStats };
    }, [subjects]);

    // Calculate pie chart angles
    const pieData = useMemo(() => {
        let currentAngle = 0;
        return stats.subjectStats.map(s => {
            const data = { ...s, startAngle: currentAngle };
            currentAngle += s.percentage * 3.6;
            return data;
        });
    }, [stats.subjectStats]);

    return (
        <div className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden">
            {/* Toggle Header */}
            <button
                onClick={toggleOpen}
                className="w-full flex items-center justify-between p-4 hover:bg-app-bg/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-app-primary/10 text-app-primary">
                        <PieChart size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-app-text-main">Study Charts</h3>
                        <p className="text-xs text-app-text-muted">
                            {stats.completionRate}% complete • {stats.kpiMet}/{subjects.length} KPI met
                        </p>
                    </div>
                </div>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-app-text-muted"
                >
                    <ChevronDown size={20} />
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
                            {/* Pie Chart & Overall Stats */}
                            <div className="flex gap-4 items-center">
                                {/* Pie Chart */}
                                <div className="relative w-24 h-24 flex-shrink-0">
                                    {stats.totalActual > 0 ? (
                                        <>
                                            <div className="absolute inset-0 rounded-full bg-app-border/30" />
                                            {pieData.map((segment, i) => (
                                                <PieSegment
                                                    key={i}
                                                    percentage={segment.percentage}
                                                    color={segment.color}
                                                    startAngle={segment.startAngle}
                                                />
                                            ))}
                                            <div className="absolute inset-3 rounded-full bg-app-surface flex items-center justify-center">
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-app-text-main">{stats.completionRate}%</div>
                                                    <div className="text-[10px] text-app-text-muted">Done</div>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="absolute inset-0 rounded-full bg-app-border/30 flex items-center justify-center">
                                            <span className="text-xs text-app-text-muted">No data</span>
                                        </div>
                                    )}
                                </div>

                                {/* Summary Stats */}
                                <div className="flex-1 space-y-2">
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-app-bg/50">
                                        <span className="text-xs text-app-text-muted">Planned</span>
                                        <span className="font-semibold text-app-text-main">{stats.totalPlanned} min</span>
                                    </div>
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-app-bg/50">
                                        <span className="text-xs text-app-text-muted">Actual</span>
                                        <span className="font-semibold text-app-primary">{stats.totalActual} min</span>
                                    </div>
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-app-bg/50">
                                        <span className="text-xs text-app-text-muted">Remaining</span>
                                        <span className={`font-semibold ${stats.totalActual >= stats.totalPlanned ? 'text-app-accent-success' : 'text-app-accent-warning'}`}>
                                            {Math.max(0, stats.totalPlanned - stats.totalActual)} min
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Subject Progress Bars */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-app-text-muted">
                                    <TrendingUp size={14} />
                                    <span>Subject Progress</span>
                                </div>
                                <div className="space-y-3">
                                    {subjects.map((subject, i) => (
                                        <SubjectProgressBar
                                            key={i}
                                            name={subject.name}
                                            planned={parseFloat(subject.planned) || 0}
                                            actual={parseFloat(subject.actual) || 0}
                                            color={COLORS[i % COLORS.length]}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Legend */}
                            {stats.subjectStats.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {stats.subjectStats.map((s, i) => (
                                        <div key={i} className="flex items-center gap-1 text-xs">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: s.color }}
                                            />
                                            <span className="text-app-text-muted">{s.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

StudyCharts.displayName = 'StudyCharts';

export default StudyCharts;
