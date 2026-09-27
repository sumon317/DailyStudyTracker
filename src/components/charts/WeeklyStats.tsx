// biome-ignore-all lint/a11y/useSemanticElements: the panel heading must sit
// inside its disclosure button (see the note on that span), and a <button> only
// accepts phrasing content, so the heading role has to live on a span. The
// alternative - an <h2> wrapping the button - would drag the subtitle into the
// panel's landmark name.
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Clock, Flame, Target, TrendingUp } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { exportAllData } from '../../services/storage';
import type { BarProps, DayData, StatCardProps, WeeklyStatsProps } from '../../types';
import {
    addLocalDays,
    getLocalWeekDates,
    getTodayLocalDate,
    isValidDateKey,
    parseLocalDate,
} from '../../utils/dateUtils';
import Skeleton from '../shared/SkeletonLoader';
import { completionRatio, dayTotals, formatHours, formatMinutes, longestStudiedStreak } from './metrics';

const getWeekDates = (date: string): string[] => getLocalWeekDates(date);

const formatDateShort = (dateStr: string): string => {
    const date = parseLocalDate(dateStr);
    return date ? date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2) : '';
};

const formatDateLabel = (dateStr: string): string => {
    const date = parseLocalDate(dateStr);
    return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
};

const weekRangeLabel = (dates: string[]): string => {
    const start = dates[0];
    const end = dates[6];
    if (!start || !end) {
        return '';
    }
    return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
};

const Bar = memo(({ actual, planned, label, isToday, maxHeight = 100 }: BarProps) => {
    const percentage = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
    const barHeight = Math.max(percentage, actual > 0 ? 10 : 0);
    /**
     * Colour encodes progress against the plan, so a day with no plan has no
     * percentage to encode. 45 studied minutes against no plan is not "under
     * plan", and painting it the under-plan colour invents a shortfall the
     * user never set; the primary colour says only that the day has minutes.
     */
    const barColor =
        planned > 0
            ? percentage >= 80
                ? 'bg-app-accent-success'
                : percentage >= 50
                  ? 'bg-app-accent-warning'
                  : 'bg-app-accent-error'
            : actual > 0
              ? 'bg-app-primary'
              : 'bg-app-border';

    return (
        <div className="flex flex-col items-center gap-1 flex-1">
            <div className="text-[10px] text-app-text-muted">{actual > 0 ? `${formatMinutes(actual)}m` : '-'}</div>
            <div
                className="w-full max-w-[32px] bg-app-border/50 rounded-t-md relative overflow-hidden"
                style={{ height: `${maxHeight}px` }}
            >
                <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${barHeight}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className={`absolute bottom-0 left-0 right-0 rounded-t-md ${barColor}`}
                />
            </div>
            {/* Bold + primary colour is the only "today" cue on the chart itself;
                the data table carries the same fact as text. */}
            <div
                className={`text-xs font-medium ${isToday ? 'font-bold text-app-primary' : 'text-app-text-muted'}`}
                aria-hidden="true"
            >
                {label}
            </div>
        </div>
    );
});

Bar.displayName = 'Bar';

const StatCard = memo(({ icon: Icon, label, value, subtext, color = 'text-app-primary' }: StatCardProps) => (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-app-bg/50 border border-app-border">
        <div className={`p-2 rounded-lg bg-app-surface ${color}`}>
            <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
            <div className="text-lg font-bold text-app-text-main">{value}</div>
            <div className="text-xs text-app-text-muted">{label}</div>
            {subtext && <div className="text-[10px] text-app-text-muted">{subtext}</div>}
        </div>
    </div>
));

StatCard.displayName = 'StatCard';

interface WeekDataMap {
    [key: string]: DayData;
}

/** `getLocalWeekDates` returns a whole week or nothing at all. */
const WEEK_LENGTH = 7;

interface HistorySnapshot {
    /**
     * The anchor day this payload was read for, or `''` before the first read
     * lands. Comparing it against the live anchor is how a payload that belongs
     * to a previous day is dropped instead of relabelled.
     */
    anchor: string;
    data: WeekDataMap;
}

/** Shared so "no payload yet" keeps one identity across renders. */
const NO_HISTORY: HistorySnapshot = { anchor: '', data: {} };

const LOAD_ERROR_MESSAGE = 'Unable to load weekly statistics.';

/**
 * `exportAllData` is typed as `Promise<DayData[]>` but the panel also accepts a
 * backup envelope, so both shapes are read here rather than by reaching into
 * `.days` on whatever came back. `null` means "neither shape": the caller
 * reports that as a failed read instead of charting an empty week.
 */
const readExportedDays = (exported: unknown): DayData[] | null => {
    if (Array.isArray(exported)) {
        return exported as DayData[];
    }
    if (exported !== null && typeof exported === 'object') {
        const days = (exported as { days?: unknown }).days;
        if (Array.isArray(days)) {
            return days as DayData[];
        }
    }
    return null;
};

const WeeklyStats = memo(({ currentDate }: WeeklyStatsProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0);
    const [history, setHistory] = useState<HistorySnapshot>(NO_HISTORY);
    /**
     * Identifies the read that failed, or null. One state rather than a message
     * plus a marker: the message and what it is about are set together, and
     * stored apart a message outlives its week - a new anchor would then open
     * already reporting the previous day's failure.
     */
    const [failedReadKey, setFailedReadKey] = useState<string | null>(null);
    const [today, setToday] = useState(getTodayLocalDate);
    const loadRequestRef = useRef(0);
    const headingId = useId();
    const contentId = useId();
    const tableCaptionId = useId();

    const hasAnchor = isValidDateKey(currentDate);

    const targetDate = useMemo(() => {
        return addLocalDays(currentDate, weekOffset * 7) ?? currentDate;
    }, [currentDate, weekOffset]);

    const weekDates = useMemo(() => getWeekDates(targetDate), [targetDate]);
    const weekStart = weekDates[0] ?? '';
    const todayWeekDates = useMemo(() => getWeekDates(today), [today]);
    /**
     * A real day is not always the start of a nameable week: the week holding
     * `0001-01-01` reaches back into a year that does not exist, and a zone
     * that skipped a whole calendar day cannot be walked day by day. Those
     * anchors resolve to no dates at all, and every figure below divides by
     * the week length, so they are treated as "no week to report on" rather
     * than as a week that happens to be empty.
     */
    const hasWeek = hasAnchor && weekDates.length === WEEK_LENGTH;
    const hasHistory = hasWeek && history.anchor === currentDate;
    /**
     * What one read is about: the anchor day, and the week it was issued for.
     * The week has to be part of it because navigation is what retries a failed
     * read, and the day because two anchors can share a week - a failure
     * recorded for one would otherwise silence the other and leave it unread.
     */
    const readKey = `${currentDate}|${weekStart}`;
    const hasFailedRead = hasWeek && failedReadKey === readKey;
    /**
     * When a read is actually necessary. One payload is the whole history, so
     * it already holds every week the navigation can reach: reading it again on
     * each week change repeated a full store read, deep clone and validation -
     * all of it O(days) - to recompute numbers that were already in hand. Only
     * a week with no payload, and no failed read standing against it, is read.
     *
     * Navigation is the retry for a week whose read failed, so moving off the
     * dead week has to try again rather than leave the user stranded on it.
     *
     * Why this is a whole-store read and not a `readDaysInRange` window: the
     * panel only ever indexes the payload with the seven dates of the week it is
     * showing, so a seven-day window would be enough *per week* - but it would
     * also mean a store read on every arrow press, and the whole point of the
     * anchor-keyed snapshot is that one read serves the entire session. The
     * measured cost of that choice, against the alternative: one
     * `exportAllData()` call is a full backup read - parse the whole store,
     * validate every day, deep-clone it once inside the envelope read and (until
     * this was fixed) a second time on the way out. `MAX_DAYS` is 10 000, so at
     * the day limit that is ~20 000 full deep clones of every subject, checklist
     * item, quality check and error record in the store, for a chart of one week.
     * It happens **once per anchor**, not once per week, and the alternative - a
     * bounded read per week - trades that one expensive read for a cheap read on
     * every single navigation, which is the interaction that actually happens.
     * `readDaysInRange` exists for callers that want a window without the
     * full-store cost; this panel's caching is the deliberate answer for this one.
     */
    const shouldRead = hasWeek && isOpen && Number.isInteger(weekOffset) && !hasHistory && !hasFailedRead;

    /**
     * "Today" is state, not a render-time read. Nothing else re-renders this
     * panel when the clock passes midnight, so a plain read (or a memoised one)
     * leaves yesterday highlighted and keeps the "This Week" badge lit until
     * some unrelated interaction happens to re-run the component.
     */
    useEffect(() => {
        let timeout = 0;
        const schedule = () => {
            const now = new Date();
            const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
            timeout = window.setTimeout(
                () => {
                    setToday(getTodayLocalDate());
                    schedule();
                },
                Math.max(nextMidnight.getTime() - now.getTime(), 1000),
            );
        };
        schedule();
        return () => window.clearTimeout(timeout);
    }, []);

    useEffect(() => {
        // Everything that makes a read necessary is in `shouldRead`: a nameable
        // week, an open panel, no payload for this anchor yet, and no failed
        // read standing against this very week.
        if (!shouldRead) {
            return;
        }

        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        let active = true;
        const loadHistory = async () => {
            try {
                const days = readExportedDays(await exportAllData());
                if (!active || requestId !== loadRequestRef.current) {
                    return;
                }
                if (days === null) {
                    // A payload that is neither shape is a failed read, not an
                    // empty history. Falling back to `[]` here would render a
                    // confident "0 minutes studied" for a week nobody read.
                    throw new Error('Unreadable export payload');
                }
                const dataMap: WeekDataMap = {};
                days.forEach((entry) => {
                    if (entry?.date) {
                        dataMap[entry.date] = entry;
                    }
                });
                setHistory({ anchor: currentDate, data: dataMap });
            } catch (_error) {
                if (active && requestId === loadRequestRef.current) {
                    // Recorded against this read, so the effect settling into the
                    // failure does not immediately retry it.
                    setFailedReadKey(readKey);
                }
            }
        };
        void loadHistory();
        return () => {
            active = false;
            loadRequestRef.current += 1;
        };
        // `shouldRead` stands in for the states it folds together: they only
        // matter here through whether a read is still needed, and the values the
        // body itself reads are listed on their own - a new anchor can leave
        // `shouldRead` true while pointing the read at another day.
    }, [currentDate, readKey, shouldRead]);

    /**
     * A payload is only shown while it belongs to the anchor it was read for,
     * so a day change (or a failed read) can never relabel it.
     */
    const weekData = hasHistory ? history.data : NO_HISTORY.data;

    const stats = useMemo(() => {
        let totalActual = 0;
        let totalPlanned = 0;
        let daysStudied = 0;
        const studiedDates: string[] = [];

        for (const dateStr of weekDates) {
            const totals = dayTotals(weekData[dateStr]);
            totalActual += totals.actual;
            totalPlanned += totals.planned;
            if (totals.actual > 0) {
                daysStudied += 1;
                studiedDates.push(dateStr);
            }
        }

        return {
            totalActual,
            totalPlanned,
            daysStudied,
            streak: longestStudiedStreak(studiedDates),
            avgPerDay: daysStudied > 0 ? Math.round(totalActual / daysStudied) : 0,
            // Uncapped, because this is a reported figure rather than a bar
            // height: a week of 300% of plan is 300%, and rounding it down to a
            // flat 100% would claim the plan was met exactly.
            completionRate: completionRatio(totalActual, totalPlanned),
            hasPlan: totalPlanned > 0,
        };
    }, [weekDates, weekData]);

    const isCurrentWeek = weekDates.includes(today);
    // Forward navigation stops at the current week, not at the anchor's week:
    // a historical anchor still has the weeks between it and today to read.
    const canGoNext = weekDates[6] !== undefined && todayWeekDates[6] !== undefined && weekDates[6] < todayWeekDates[6];

    /**
     * Moving between weeks is the retry for a week whose read failed, so
     * navigating off it clears the failure; otherwise the error would outlive
     * the week it was about and the new week would be stuck unretried.
     */
    const moveWeek = useCallback((step: number) => {
        setFailedReadKey(null);
        setWeekOffset((prev) => prev + step);
    }, []);

    const handlePrevWeek = useCallback(() => moveWeek(-1), [moveWeek]);
    /**
     * The upper bound is enforced by the button's own `disabled` state, which is
     * derived from the current week rather than from the offset. Guarding the
     * offset here instead meant the button was live but did nothing whenever the
     * anchor sat in a week before the current one - exactly the case that needs
     * the forward step to read the weeks in between.
     */
    const handleNextWeek = useCallback(() => moveWeek(1), [moveWeek]);
    const handleThisWeek = useCallback(() => moveWeek(-weekOffset), [moveWeek, weekOffset]);

    const weekLabel = useMemo(() => weekRangeLabel(weekDates), [weekDates]);
    /**
     * The week-label button returns to the anchor, not to whatever week happens
     * to be on screen, so its accessible name has to describe the destination.
     * Naming the displayed week here meant a button reading "Show the week of
     * Jan 7 - Jan 13" while sitting on Jan 7 - Jan 13 and jumping to Jan 14.
     */
    const anchorWeekLabel = useMemo(() => weekRangeLabel(getWeekDates(currentDate)), [currentDate]);

    const chartSummary = `${weekLabel}: ${formatMinutes(stats.totalActual)} minutes studied out of ${formatMinutes(
        stats.totalPlanned,
    )} minutes planned across ${stats.daysStudied} active days.`;
    /**
     * Nothing derived from the payload is rendered until this anchor's own
     * history has landed. On the first paint the read has not resolved yet, and
     * "0 minutes / 0% / No study time recorded" for a week nobody read is a
     * claim, not a placeholder. `pending` also covers the single frame between
     * a week change and the effect that would have fetched it, so the skeleton
     * holds the space instead of the previous week flashing through.
     */
    const pending = hasWeek && !hasHistory && !hasFailedRead;
    const showWeek = hasWeek && hasHistory && !hasFailedRead;
    const showEmptyWeek = showWeek && stats.daysStudied === 0;

    return (
        <section
            className="rounded-xl border border-app-border bg-app-surface shadow-sm overflow-hidden"
            aria-labelledby={headingId}
        >
            {/* Toggle Header */}
            <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={contentId}
                onClick={() => setIsOpen((open) => !open)}
                className="w-full flex items-center justify-between gap-2 p-4 hover:bg-app-bg/50 transition-colors"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <div className="shrink-0 rounded-lg bg-app-primary/10 p-2 text-app-primary">
                        <BarChart3 size={20} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 text-left">
                        {/* `role="heading"` on a span: an <h2> is not phrasing content and
                            cannot legally nest inside the disclosure button. */}
                        <span
                            id={headingId}
                            role="heading"
                            aria-level={2}
                            className="block font-semibold text-app-text-main"
                        >
                            Weekly Stats
                        </span>
                        <p className="text-xs text-app-text-muted">View your study patterns</p>
                    </div>
                </div>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="shrink-0 text-app-text-muted"
                    aria-hidden="true"
                >
                    <ChevronDown size={20} />
                </motion.div>
            </button>

            {/* Expandable Content */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id={contentId}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                        aria-busy={pending}
                    >
                        <div className="p-4 pt-0 space-y-4">
                            {!hasAnchor ? (
                                // An unparseable anchor is not an empty week. Zeroing the
                                // chart would claim the user studied nothing rather than
                                // that there is no day to report on.
                                <p className="text-sm text-app-text-muted">
                                    Select a study date to see weekly statistics.
                                </p>
                            ) : !hasWeek ? (
                                // A real day whose week cannot be named day by day
                                // (the week reaches outside the supported year range, or
                                // a zone skipped a calendar day) is likewise not an empty
                                // week. Reporting seven zeroed days for it would invent
                                // numbers for days that do not exist.
                                <p className="text-sm text-app-text-muted">This date cannot be shown as a full week.</p>
                            ) : (
                                <>
                                    {/* Week Navigation */}
                                    <div className="flex items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            aria-label="View previous week"
                                            onClick={handlePrevWeek}
                                            className="p-2 rounded-lg hover:bg-app-bg text-app-text-muted"
                                        >
                                            <ChevronLeft size={20} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Show the week of ${anchorWeekLabel}`}
                                            onClick={handleThisWeek}
                                            disabled={weekOffset === 0}
                                            className={`min-w-0 text-center font-medium text-sm ${
                                                weekOffset === 0
                                                    ? 'text-app-primary cursor-default'
                                                    : 'text-app-text-main hover:text-app-primary'
                                            }`}
                                        >
                                            {weekLabel}
                                            {isCurrentWeek && <span className="text-xs ml-1">(This Week)</span>}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="View next week"
                                            onClick={handleNextWeek}
                                            disabled={!canGoNext}
                                            className={`p-2 rounded-lg hover:bg-app-bg text-app-text-muted ${
                                                canGoNext ? '' : 'opacity-30 cursor-not-allowed'
                                            }`}
                                        >
                                            <ChevronRight size={20} aria-hidden="true" />
                                        </button>
                                    </div>

                                    {hasFailedRead && (
                                        <p role="alert" className="text-xs text-app-accent-error">
                                            {LOAD_ERROR_MESSAGE}
                                        </p>
                                    )}

                                    {showEmptyWeek && (
                                        <p className="text-xs text-app-text-muted">
                                            No study time recorded for this week.
                                        </p>
                                    )}

                                    {/* Bar Chart */}
                                    {pending ? (
                                        <div className="h-32 flex items-center justify-center">
                                            <div className="flex gap-2 px-2 w-full">
                                                {Array.from({ length: WEEK_LENGTH }).map((_, i) => (
                                                    // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton placeholders are static
                                                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                        <Skeleton className="h-3 w-8" />
                                                        <Skeleton
                                                            className="w-full max-w-[32px]"
                                                            style={{ height: '80px' }}
                                                        />
                                                        <Skeleton className="h-3 w-6" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        showWeek && (
                                            <div
                                                className="flex gap-2 px-2"
                                                role="img"
                                                aria-label={chartSummary}
                                                aria-describedby={tableCaptionId}
                                            >
                                                {weekDates.map((dateStr) => {
                                                    const totals = dayTotals(weekData[dateStr]);
                                                    return (
                                                        <Bar
                                                            key={dateStr}
                                                            actual={totals.actual}
                                                            planned={totals.planned}
                                                            label={formatDateShort(dateStr)}
                                                            isToday={dateStr === today}
                                                            maxHeight={80}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )
                                    )}

                                    {showWeek && (
                                        <table className="sr-only">
                                            <caption id={tableCaptionId}>Daily study minutes for {weekLabel}</caption>
                                            <thead>
                                                <tr>
                                                    <th scope="col">Day</th>
                                                    <th scope="col">Actual minutes</th>
                                                    <th scope="col">Planned minutes</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {weekDates.map((dateStr) => {
                                                    const totals = dayTotals(weekData[dateStr]);
                                                    const dayLabel = formatDateLabel(dateStr);
                                                    // An accessible name is computed by joining
                                                    // the child nodes of an element, and the join
                                                    // drops the qualifier's leading space, so a
                                                    // screen reader announced this row as
                                                    // "Jan 17(today)". The name is stated once
                                                    // here and applied as an explicit label
                                                    // instead of being re-derived from content.
                                                    const rowLabel =
                                                        dateStr === today ? `${dayLabel} (today)` : dayLabel;
                                                    return (
                                                        <tr key={`summary-${dateStr}`}>
                                                            <th scope="row" aria-label={rowLabel}>
                                                                {dayLabel}
                                                                {dateStr === today && (
                                                                    <span className="sr-only"> (today)</span>
                                                                )}
                                                            </th>
                                                            <td>{formatMinutes(totals.actual)}</td>
                                                            <td>{formatMinutes(totals.planned)}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}

                                    {/* Stats Grid */}
                                    {pending ? (
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
                                        // Gated on the same condition as the chart and
                                        // its table: after a failed read these four
                                        // cards would otherwise render 0h / 0% / 0 days,
                                        // which reads as "you studied nothing" rather
                                        // than "the numbers could not be loaded".
                                        showWeek && (
                                            <div className="grid grid-cols-2 gap-2" aria-live="polite">
                                                <StatCard
                                                    icon={Clock}
                                                    label="Total Study Time"
                                                    value={formatHours(stats.totalActual)}
                                                    subtext={`${formatMinutes(stats.totalActual)} minutes`}
                                                    color="text-app-primary"
                                                />
                                                <StatCard
                                                    icon={Target}
                                                    label="Completion Rate"
                                                    // A week with no planned minutes has no
                                                    // completion to be a share of. "0%" next to
                                                    // 90 studied minutes would report a total
                                                    // failure against a target that was never set.
                                                    value={stats.hasPlan ? `${stats.completionRate}%` : 'No plan set'}
                                                    subtext={`${stats.daysStudied}/${WEEK_LENGTH} days`}
                                                    color="text-app-accent-success"
                                                />
                                                <StatCard
                                                    icon={TrendingUp}
                                                    label="Daily Average"
                                                    value={formatHours(stats.avgPerDay)}
                                                    subtext="per active day"
                                                    color="text-app-accent-warning"
                                                />
                                                <StatCard
                                                    icon={Flame}
                                                    label="Best Streak"
                                                    value={`${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}`}
                                                    subtext="in this week"
                                                    color="text-app-accent-error"
                                                />
                                            </div>
                                        )
                                    )}
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
});

WeeklyStats.displayName = 'WeeklyStats';

export default WeeklyStats;
