// biome-ignore-all lint/a11y/useSemanticElements: the panel heading must sit
// inside its disclosure button (see the note on that span), and a <button> only
// accepts phrasing content, so the heading role has to live on a span. The
// alternative - an <h2> wrapping the button - would drag the badge text into the
// panel's landmark name.
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, PieChart, TrendingUp } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import type { PieSegmentProps, StudyChartsProps, Subject, SubjectProgressBarProps } from '../../types';
import { completionPercentage, completionRatio, formatHours, formatMinutes, toMinutes } from './metrics';

const PieSegment = memo(({ percentage, color, startAngle }: PieSegmentProps) => {
    const endAngle = startAngle + percentage * 3.6;

    return (
        <div
            className="absolute inset-0 rounded-full"
            style={{
                background: `conic-gradient(transparent ${startAngle}deg, ${color} ${startAngle}deg, ${color} ${endAngle}deg, transparent ${endAngle}deg)`,
            }}
            aria-hidden="true"
        />
    );
});

PieSegment.displayName = 'PieSegment';

/**
 * `label` is a local extension of the shared prop type: it only ever differs
 * from `name` when a sibling subject carries the same name, which is what keeps
 * two identically named progress bars individually addressable. The same string
 * names the matching table row, so one subject answers to one name everywhere.
 *
 * `hasPlan` is a local extension for the same reason: whether there is a plan to
 * be a percentage of is not part of the geometry the shared type describes.
 */
type SubjectProgressBarComponentProps = SubjectProgressBarProps & { label: string; hasPlan: boolean };

const SubjectProgressBar = memo(
    ({ name, planned, actual, color, label, hasPlan }: SubjectProgressBarComponentProps) => {
        // Two different questions: the bar geometry cannot exceed its track, so
        // it uses the capped value, while the text has to be able to report that
        // 90 of 30 planned minutes is 300% and not round it away to a flat 100%.
        const barPercentage = completionPercentage(actual, planned);
        const ratio = completionRatio(actual, planned);
        const isComplete = barPercentage >= 80;
        // A subject with no plan has no completion to report. "45/0 min (0%)" states
        // the opposite of what happened - 45 minutes were studied - so the text says
        // what is actually true instead of inventing a zero.
        const reportedRatio = hasPlan ? `${ratio}%` : 'no plan';

        return (
            <div className="space-y-1">
                <div className="flex justify-between gap-2 text-xs">
                    <span className="max-w-[120px] truncate font-medium text-app-text-main">{name}</span>
                    <span
                        className={
                            isComplete ? 'font-semibold text-app-accent-success' : 'font-semibold text-app-text-muted'
                        }
                    >
                        {formatMinutes(actual)}/{formatMinutes(planned)} min ({reportedRatio})
                    </span>
                </div>
                <div
                    className="h-2 overflow-hidden rounded-full bg-app-border/50"
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={barPercentage}
                    aria-valuetext={`${formatMinutes(actual)} of ${formatMinutes(planned)} minutes studied, ${hasPlan ? `${ratio}% of plan` : 'no plan set'}`}
                >
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${barPercentage}%` }}
                        transition={{ duration: 0.5 }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                    />
                </div>
            </div>
        );
    },
);

SubjectProgressBar.displayName = 'SubjectProgressBar';

const COLORS = ['#0061a4', '#6d4aa5', '#a23b72', '#9a4b13', '#006b68', '#287a3c', '#7a5c00', '#245d91'];

interface SubjectRow {
    key: string;
    /** Text as typed, shown to sighted users. */
    name: string;
    /**
     * The one name this subject answers to everywhere: its progress bar and its
     * table row header must not disagree, and a bare name is ambiguous when a
     * sibling repeats it.
     */
    label: string;
    /**
     * The screen-reader-only qualifier that turns `name` into `label`. Empty
     * unless a sibling subject repeats the name.
     */
    qualifier: string;
    actual: number;
    planned: number;
    /**
     * Whether this subject has any planned minutes to be a percentage of.
     * Reported figures have to branch on it: with no plan there is no ratio, and
     * printing `0%` would blame the subject for a target nobody wrote.
     */
    hasPlan: boolean;
    color: string;
    kpiMet: boolean;
    completion: number;
}

/**
 * `Subject.id` is validated as "some safe integer" when a backup is imported but
 * never for uniqueness inside a day, and two subjects added in the same
 * millisecond can collide too. React reconciles by key, so a repeated id would
 * collapse both rows onto one DOM node and silently drop a progress bar; a
 * repeated id therefore falls back to the row's position.
 */
const uniqueSubjectKey = (id: number, position: number, used: Set<string>): string => {
    const base = typeof id === 'number' && Number.isFinite(id) ? `subject-${id}` : `subject-at-${position}`;
    let key = base;
    let attempt = 1;
    while (used.has(key)) {
        key = `${base}-${attempt}`;
        attempt += 1;
    }
    used.add(key);
    return key;
};

/**
 * Names a subject uniquely only when it has to: a name that appears once is
 * left exactly as typed, while a repeat is scoped by position the same way the
 * rest of the app scopes duplicate checklist objectives.
 *
 * A name that was saved blank is replaced with its position, because a progress
 * bar with no accessible name cannot be announced at all.
 */
const buildRows = (subjects: Subject[]): SubjectRow[] => {
    const displayed = (subject: Subject, index: number): string =>
        subject.name.trim() === '' ? `Subject ${index + 1}` : subject.name;

    const nameTotals = new Map<string, number>();
    subjects.forEach((subject, index) => {
        const name = displayed(subject, index);
        nameTotals.set(name, (nameTotals.get(name) ?? 0) + 1);
    });

    const namePositions = new Map<string, number>();
    const usedKeys = new Set<string>();

    return subjects.map((subject, index) => {
        const actual = toMinutes(subject.actual);
        const planned = toMinutes(subject.planned);
        const name = displayed(subject, index);
        const position = (namePositions.get(name) ?? 0) + 1;
        namePositions.set(name, position);
        const duplicateTotal = nameTotals.get(name) ?? 1;
        const qualifier = duplicateTotal > 1 ? ` (subject ${position} of ${duplicateTotal})` : '';

        return {
            key: uniqueSubjectKey(subject.id, index, usedKeys),
            name,
            label: `${name}${qualifier}`,
            qualifier,
            actual,
            planned,
            hasPlan: planned > 0,
            color: COLORS[index % COLORS.length] ?? COLORS[0] ?? '#0061a4',
            kpiMet: subject.kpi === 'Y',
            completion: completionRatio(actual, planned),
        };
    });
};

const StudyCharts = memo(({ subjects }: StudyChartsProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const headingId = useId();
    const contentId = useId();

    const toggleOpen = useCallback(() => setIsOpen((open) => !open), []);

    const rows = useMemo(() => buildRows(subjects), [subjects]);

    const stats = useMemo(() => {
        const totalPlanned = rows.reduce((sum, row) => sum + row.planned, 0);
        const totalActual = rows.reduce((sum, row) => sum + row.actual, 0);
        return {
            totalPlanned,
            totalActual,
            // Uncapped, because this aggregate is reported as text in the badge
            // and the summary sentence. A day that ran 300% of plan and a
            // sentence claiming exactly 100% is the same false statement the
            // per-subject table was corrected for; only bar geometry is capped.
            completionRate: completionRatio(totalActual, totalPlanned),
            kpiMet: rows.filter((row) => row.kpiMet).length,
        };
    }, [rows]);

    const pieData = useMemo(() => {
        let currentAngle = 0;
        return rows
            .filter((row) => row.actual > 0)
            .map((row) => {
                const share = stats.totalActual > 0 ? (row.actual / stats.totalActual) * 100 : 0;
                const startAngle = currentAngle;
                currentAngle += share * 3.6;
                return { ...row, share, startAngle };
            });
    }, [rows, stats.totalActual]);

    const hasPlan = stats.totalPlanned > 0;
    const planMet = hasPlan && stats.totalActual >= stats.totalPlanned;
    const hasSubjects = rows.length > 0;
    // There is no ratio to report without a plan. "0% of the plan complete"
    // would blame the day for a plan nobody wrote, so the panel says what is
    // actually true instead of rendering a zero it cannot justify.
    const completionSentence = hasPlan ? `${stats.completionRate}% of the planned time completed.` : 'No plan set.';

    const summary = `${formatMinutes(stats.totalActual)} minutes studied out of ${formatMinutes(
        stats.totalPlanned,
    )} minutes planned. ${completionSentence} ${stats.kpiMet} of ${rows.length} KPI targets met.`;

    return (
        <section
            className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm"
            aria-labelledby={headingId}
        >
            <button
                type="button"
                onClick={toggleOpen}
                className="flex w-full items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-app-bg/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-app-primary"
                aria-expanded={isOpen}
                aria-controls={contentId}
            >
                <span className="flex min-w-0 items-center gap-3">
                    <span className="rounded-lg bg-app-primary/10 p-2 text-app-primary">
                        <PieChart size={20} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                        {/* A heading element is not phrasing content, so it cannot legally
                            sit inside the button; the explicit role keeps the page outline at
                            h1 -> h2 without invalid nesting. */}
                        <span
                            id={headingId}
                            role="heading"
                            aria-level={2}
                            className="block font-semibold text-app-text-main"
                        >
                            Study Charts
                        </span>
                        <span className="block text-xs text-app-text-muted">
                            {hasSubjects
                                ? hasPlan
                                    ? `${stats.completionRate}% of plan complete · ${stats.kpiMet}/${rows.length} KPI targets met`
                                    : `No plan set · ${stats.kpiMet}/${rows.length} KPI targets met`
                                : 'No subjects tracked yet'}
                        </span>
                    </span>
                </span>
                <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="shrink-0 text-app-text-muted"
                    aria-hidden="true"
                >
                    <ChevronDown size={20} />
                </motion.span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id={contentId}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-4 p-4 pt-0">
                            <p className="text-sm text-app-text-muted">{summary}</p>

                            <div className="flex items-center gap-4">
                                <div
                                    className="relative h-24 w-24 flex-shrink-0"
                                    role="img"
                                    // The name carries the full summary on purpose. The
                                    // table caption is not a long description for this:
                                    // it sits inside a collapsed <details>, so it is out
                                    // of the accessibility tree until the disclosure is
                                    // opened, and pointing at it describes nothing.
                                    aria-label={`Study time distribution. ${summary}`}
                                >
                                    {stats.totalActual > 0 ? (
                                        <>
                                            <div
                                                className="absolute inset-0 rounded-full bg-app-border/30"
                                                aria-hidden="true"
                                            />
                                            {pieData.map((segment) => (
                                                <PieSegment
                                                    key={segment.key}
                                                    percentage={segment.share}
                                                    color={segment.color}
                                                    startAngle={segment.startAngle}
                                                />
                                            ))}
                                            {/* The ring splits the minutes that were studied, so the
                                                centre reports that total. A completion percentage
                                                here reads as "this slice is 38% of the plan", which
                                                is a different question the ring cannot answer. */}
                                            <div
                                                className="absolute inset-3 flex items-center justify-center rounded-full bg-app-surface"
                                                aria-hidden="true"
                                            >
                                                <div className="text-center">
                                                    <div className="text-base font-bold text-app-text-main">
                                                        {formatHours(stats.totalActual)}
                                                    </div>
                                                    <div className="text-[10px] text-app-text-muted">studied</div>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div
                                            className="absolute inset-0 flex items-center justify-center rounded-full bg-app-border/30 text-xs text-app-text-muted"
                                            aria-hidden="true"
                                        >
                                            No data
                                        </div>
                                    )}
                                </div>

                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex items-center justify-between gap-2 rounded-lg bg-app-bg/50 p-2">
                                        <span className="text-xs text-app-text-muted">Planned</span>
                                        <span className="font-semibold text-app-text-main">
                                            {formatMinutes(stats.totalPlanned)} min
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 rounded-lg bg-app-bg/50 p-2">
                                        <span className="text-xs text-app-text-muted">Actual</span>
                                        <span className="font-semibold text-app-primary">
                                            {formatMinutes(stats.totalActual)} min
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 rounded-lg bg-app-bg/50 p-2">
                                        <span className="text-xs text-app-text-muted">Remaining</span>
                                        <span
                                            className={`font-semibold ${
                                                planMet
                                                    ? 'text-app-accent-success'
                                                    : hasPlan
                                                      ? 'text-app-accent-warning'
                                                      : 'text-app-text-muted'
                                            }`}
                                        >
                                            {/* Nothing planned is not a met plan: without a plan
                                                there is no target left to hit, so success styling
                                                would be a claim the data cannot support. */}
                                            {hasPlan
                                                ? `${formatMinutes(Math.max(0, stats.totalPlanned - stats.totalActual))} min`
                                                : 'No plan set'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-app-text-muted">
                                    <TrendingUp size={14} aria-hidden="true" />
                                    <span>Subject progress</span>
                                </div>
                                {hasSubjects ? (
                                    <div className="space-y-3">
                                        {rows.map((row) => (
                                            <SubjectProgressBar
                                                key={row.key}
                                                name={row.name}
                                                label={row.label}
                                                hasPlan={row.hasPlan}
                                                planned={row.planned}
                                                actual={row.actual}
                                                color={row.color}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-app-text-muted">
                                        No subjects recorded for this day. Add one on the Study tracker to see charts.
                                    </p>
                                )}
                            </div>

                            {pieData.length > 0 && (
                                <ul className="flex list-none flex-wrap gap-2 p-0" aria-label="Study time legend">
                                    {pieData.map((row) => (
                                        <li key={row.key} className="flex items-center gap-1 text-xs">
                                            <span
                                                className="h-2 w-2 rounded-full"
                                                style={{ backgroundColor: row.color }}
                                                aria-hidden="true"
                                            />
                                            <span className="text-app-text-muted">{row.name}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <details className="rounded-lg border border-app-outline-variant">
                                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-app-text-main focus:outline-none focus:ring-2 focus:ring-inset focus:ring-app-primary">
                                    View subject data table
                                </summary>
                                <div className="overflow-x-auto px-3 pb-3">
                                    <table className="w-full min-w-[420px] text-left text-xs text-app-text-muted">
                                        <caption className="sr-only">Study metrics by subject</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col" className="py-2 pr-3">
                                                    Subject
                                                </th>
                                                <th scope="col" className="py-2 pr-3">
                                                    Planned
                                                </th>
                                                <th scope="col" className="py-2 pr-3">
                                                    Actual
                                                </th>
                                                <th scope="col" className="py-2 pr-3">
                                                    Completion
                                                </th>
                                                <th scope="col" className="py-2">
                                                    KPI
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {hasSubjects ? (
                                                rows.map((row) => (
                                                    <tr key={row.key} className="border-t border-app-outline-variant">
                                                        <th
                                                            scope="row"
                                                            className="py-2 pr-3 font-medium text-app-text-main"
                                                            aria-label={row.label}
                                                        >
                                                            {row.name}
                                                            {row.qualifier && (
                                                                <span className="sr-only">{row.qualifier}</span>
                                                            )}
                                                        </th>
                                                        <td className="py-2 pr-3">{formatMinutes(row.planned)} min</td>
                                                        <td className="py-2 pr-3">{formatMinutes(row.actual)} min</td>
                                                        <td className="py-2 pr-3">
                                                            {row.hasPlan ? `${row.completion}%` : 'No plan'}
                                                        </td>
                                                        <td className="py-2">{row.kpiMet ? 'Met' : 'Not met'}</td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="py-2 pr-3">
                                                        No subjects recorded for this day.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </details>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
});

StudyCharts.displayName = 'StudyCharts';

export default StudyCharts;
