import StudyCharts from '../components/charts/StudyCharts';
import WeeklyStats from '../components/charts/WeeklyStats';
// `../types`, not `../../types`: from `src/pages` the second `..` escapes the
// source root. A type-only import of a missing module fails the typecheck while
// still erasing cleanly at runtime, so the wrong path went unnoticed.
import type { StatsPageProps } from '../types';
import { isValidDateKey, parseLocalDate } from '../utils/dateUtils';

/**
 * Both panels below chart a single day, but the page itself never said which
 * one. The sentence is only rendered when the anchor really is a calendar day:
 * echoing an unparseable value back would be a worse lie than staying silent.
 *
 * `currentDate` is the day the payload was *loaded* for, which is `null` while a
 * read is in flight. The charts are still plotting the outgoing day's data at that
 * point, so naming the incoming day would be a lie - and naming the outgoing one
 * would be a claim the page cannot make either, because it was never told which
 * day that was.
 */
const describeScope = (date: string | null): string => {
    if (date === null) {
        return '';
    }
    const parsed = parseLocalDate(date);
    if (!isValidDateKey(date) || !parsed) {
        return '';
    }
    return parsed.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

const StatsPage = ({ subjects, currentDate }: StatsPageProps) => {
    const scope = describeScope(currentDate);

    return (
        <section className="space-y-4 sm:space-y-6" aria-labelledby="stats-page-title">
            <h1 id="stats-page-title" className="sr-only">
                Study statistics
            </h1>
            <p className="sr-only">Daily charts cover {scope ? scope : 'no selected day'}.</p>
            <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-2">
                <StudyCharts subjects={subjects} />
                {/* `WeeklyStats` anchors its week on a calendar day, so with no
                    loaded day there is no week to anchor on; it already treats an
                    unparseable anchor as "nothing to show", and that is the honest
                    reading of a payload that has not been adopted yet. */}
                <WeeklyStats currentDate={currentDate ?? ''} />
            </div>
        </section>
    );
};

export default StatsPage;
