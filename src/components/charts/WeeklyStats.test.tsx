import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAllData } from '../../services/storage';
import type { DayData } from '../../types';
import WeeklyStats from './WeeklyStats';

vi.mock('../../services/storage', () => ({
    exportAllData: vi.fn(),
}));

const day = (date: string, planned: string, actual: string): DayData => ({
    date,
    updatedAt: `${date}T10:00:00.000Z`,
    subjects: [
        {
            id: Number(date.replaceAll('-', '')),
            name: 'Accounts',
            planned,
            actual,
            kpi: 'N',
            time: '',
            reminder: false,
        },
    ],
    checklistItems: [],
    qualityChecks: [],
    dayRating: '',
    errors: [],
});

// 2024-01-15 is a Monday, so this covers the whole Sunday-to-Saturday week.
const week: DayData[] = [day('2024-01-14', '60', '60'), day('2024-01-15', '60', '30'), day('2024-01-17', '60', '0')];

const weeklyTable = () => screen.getByRole('table', { name: /Daily study minutes/i });

/**
 * The disclosure ids are generated per instance, so they are read off the
 * control rather than hardcoded: two panels on one page used to share them.
 */
const panelContent = () => {
    const toggle = screen.getByRole('button', { name: /Weekly Stats/ });
    const id = toggle.getAttribute('aria-controls');
    if (!id) {
        throw new Error('the weekly panel toggle does not point at its content');
    }
    return document.getElementById(id) as HTMLElement;
};

/** Pins the wall clock so week-boundary behaviour does not depend on when the suite runs. */
const freezeClock = (year: number, month: number, dayOfMonth: number) => {
    // `shouldAdvanceTime` keeps the reported clock pinned but still fires queued
    // timers on their own. Without it Testing Library's `waitFor` polling is
    // itself faked, so every `findByRole` below hangs until the test times out
    // instead of ever resolving.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(year, month - 1, dayOfMonth, 12, 0, 0));
};

describe('WeeklyStats', () => {
    beforeEach(() => {
        vi.mocked(exportAllData).mockResolvedValue(week);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('summarises the week in text and in a hidden data table', async () => {
        render(<WeeklyStats currentDate="2024-01-15" />);

        const chart = await screen.findByRole('img', { name: /minutes studied out of/i });
        expect(chart).toHaveAccessibleName(
            'Jan 14 - Jan 20: 90 minutes studied out of 180 minutes planned across 2 active days.',
        );

        const table = weeklyTable();
        expect(within(table).getByRole('rowheader', { name: /^Jan 14/ })).toBeInTheDocument();
        expect(within(table).getAllByRole('row')).toHaveLength(8);
    });

    it('ties the chart to its data table as a long description', async () => {
        render(<WeeklyStats currentDate="2024-01-15" />);

        const chart = await screen.findByRole('img', { name: /minutes studied out of/i });
        const describedBy = chart.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        // A screen reader user gets the per-day numbers, not just the total.
        expect(document.getElementById(describedBy as string)).toHaveTextContent(
            'Daily study minutes for Jan 14 - Jan 20',
        );
    });

    it('hides every decorative icon from assistive technology', async () => {
        render(<WeeklyStats currentDate="2024-01-15" />);

        const toggle = screen.getByRole('button', { name: /Weekly Stats/ });
        expect(toggle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

        await screen.findByRole('img', { name: /minutes studied out of/i });
        // Lucide icons have no accessible name of their own; anything left
        // unhidden shows up as an unnamed graphic in the accessibility tree.
        expect(document.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
    });

    it('reports itself busy and shows nothing derived from the payload until the week loads', async () => {
        let resolveExport: ((value: DayData[]) => void) | undefined;
        const pending = new Promise<DayData[]>((resolve) => {
            resolveExport = resolve;
        });
        vi.mocked(exportAllData).mockReturnValue(pending);

        render(<WeeklyStats currentDate="2024-01-15" />);

        expect(panelContent()).toHaveAttribute('aria-busy', 'true');
        // Nothing derived from the payload may exist yet, in any branch: a
        // zeroed chart or grid under the new label states as fact that the week
        // was read and came back empty.
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /minutes studied/ })).not.toBeInTheDocument();
        expect(screen.queryByText('No study time recorded for this week.')).not.toBeInTheDocument();
        expect(screen.queryByText('Total Study Time')).not.toBeInTheDocument();

        await act(async () => {
            resolveExport?.(week);
        });

        await waitFor(() => expect(panelContent()).toHaveAttribute('aria-busy', 'false'));
        expect(weeklyTable()).toBeInTheDocument();
    });

    it('aggregates totals, active days, averages and completion', async () => {
        render(<WeeklyStats currentDate="2024-01-15" />);

        await waitFor(() => expect(screen.getByText('1.5h')).toBeInTheDocument());
        expect(screen.getByText('90 minutes')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('2/7 days')).toBeInTheDocument();
        // 90 minutes across 2 active days.
        expect(screen.getByText('0.8h')).toBeInTheDocument();
        expect(screen.getByText('per active day')).toBeInTheDocument();
    });

    it('scopes the streak to the displayed week instead of all recorded history', async () => {
        // A five-day run sits in the week before the anchor. Every other card
        // describes the week on screen, so a lifetime streak next to them
        // answered a question nobody asked.
        vi.mocked(exportAllData).mockResolvedValue([
            day('2024-01-08', '60', '10'),
            day('2024-01-09', '60', '10'),
            day('2024-01-10', '60', '10'),
            day('2024-01-11', '60', '10'),
            day('2024-01-12', '60', '10'),
        ]);
        const user = userEvent.setup();

        render(<WeeklyStats currentDate="2024-01-15" />);

        await waitFor(() => expect(screen.getByText('No study time recorded for this week.')).toBeInTheDocument());
        expect(screen.getByText('0 days')).toBeInTheDocument();
        expect(screen.getByText('in this week')).toBeInTheDocument();
        // The neighbouring week is unreachable from the numbers on screen.
        const table = weeklyTable();
        expect(
            within(table)
                .getByRole('rowheader', { name: /^Jan 14/ })
                .closest('tr'),
        ).toHaveTextContent('0');

        await user.click(screen.getByRole('button', { name: 'View previous week' }));

        expect(await screen.findByRole('img', { name: /Jan 7 - Jan 13: 50 minutes studied/ })).toBeInTheDocument();
        // All five studied days fall inside Jan 7 - Jan 13, so the longest run
        // visible in that week is the whole run.
        expect(screen.getByText('5 days')).toBeInTheDocument();
    });

    it('does not let a run that began in the previous week inflate the in-week streak', async () => {
        vi.mocked(exportAllData).mockResolvedValue([
            day('2024-01-12', '60', '10'),
            day('2024-01-13', '60', '10'),
            day('2024-01-14', '60', '10'),
            day('2024-01-15', '60', '10'),
        ]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // Jan 12-13 fall outside Jan 14-20, so the run is counted from the
        // week boundary: only two in-week days, not a four-day streak.
        await waitFor(() => expect(screen.getByText('2 days')).toBeInTheDocument());
    });

    it('counts the longest run in the week, not the first one', async () => {
        vi.mocked(exportAllData).mockResolvedValue([
            // A two-day run, a gap, then a three-day run, all inside Jan 14-20.
            day('2024-01-14', '60', '10'),
            day('2024-01-15', '60', '10'),
            day('2024-01-17', '60', '10'),
            day('2024-01-18', '60', '10'),
            day('2024-01-19', '60', '10'),
        ]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // "Best Streak" is the best run in the week, so the later and longer
        // one has to win; reporting the run that happened to come first would
        // make the card a different statistic from the one it is named for.
        await waitFor(() => expect(screen.getByText('3 days')).toBeInTheDocument());
        expect(screen.getByText('in this week')).toBeInTheDocument();
    });

    it('shows a zeroed week when nothing has been recorded', async () => {
        vi.mocked(exportAllData).mockResolvedValue([]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        await waitFor(() =>
            expect(
                screen.getByRole('img', {
                    name: 'Jan 14 - Jan 20: 0 minutes studied out of 0 minutes planned across 0 active days.',
                }),
            ).toBeInTheDocument(),
        );
        // No plan was ever set for the week, so there is no completion to report:
        // "0%" beside a study total states a failure against a target that does
        // not exist, and the daily panel already says "No plan set" for the same
        // situation.
        expect(screen.getByText('No plan set')).toBeInTheDocument();
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
        expect(screen.getByText('0/7 days')).toBeInTheDocument();
        expect(screen.getByText('0 days')).toBeInTheDocument();
        // A zeroed chart needs to say why, or it reads as a rendering failure.
        expect(screen.getByText('No study time recorded for this week.')).toBeInTheDocument();
    });

    it('does not report a completion rate against a week that was never planned', async () => {
        // 90 minutes studied, nothing planned: "0%" would read as having missed
        // the whole plan rather than as having set no plan at all.
        vi.mocked(exportAllData).mockResolvedValue([day('2024-01-16', '0', '90')]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        expect(
            await screen.findByRole('img', {
                name: 'Jan 14 - Jan 20: 90 minutes studied out of 0 minutes planned across 1 active days.',
            }),
        ).toBeInTheDocument();
        expect(screen.getByText('No plan set')).toBeInTheDocument();
        expect(screen.getByText('1/7 days')).toBeInTheDocument();
        // The studied minutes are still reported; only the ratio is withheld.
        // The total and the per-active-day average are both 90 minutes here.
        expect(screen.getAllByText('1.5h')).toHaveLength(2);
        expect(screen.getByText('90 minutes')).toBeInTheDocument();
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });

    it('pluralises a one-day streak', async () => {
        vi.mocked(exportAllData).mockResolvedValue([day('2024-01-15', '60', '30')]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // "1 days" is not a thing, and the card is named "Best Streak", so the
        // count has to read as the number of days it is.
        await waitFor(() => expect(screen.getByText('1 day')).toBeInTheDocument());
    });

    it('reports an over-planned week as more than 100 percent', async () => {
        vi.mocked(exportAllData).mockResolvedValue([day('2024-01-15', '30', '90')]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // A card reading "100%" next to "90 minutes" and "30 minutes planned"
        // states that the plan was met exactly, which is not what happened.
        await waitFor(() => expect(screen.getByText('300%')).toBeInTheDocument());
        expect(screen.queryByText('100%')).not.toBeInTheDocument();
        // The bar itself is still bounded by its track.
        const chart = await screen.findByRole('img', { name: /Jan 14 - Jan 20/ });
        expect(chart).toBeInTheDocument();
    });

    it('never invents a plan for a day with no record', async () => {
        vi.mocked(exportAllData).mockResolvedValue([day('2024-01-15', '60', '30')]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        await waitFor(() => expect(weeklyTable()).toBeInTheDocument());
        const rows = within(weeklyTable())
            .getAllByRole('row')
            .map((row) => row.textContent);
        // The bar chart used to fall back to 360 minutes for a missing day
        // while the table reported 0 for the very same day.
        expect(rows.some((row) => row?.includes('360'))).toBe(false);
        expect(
            within(weeklyTable())
                .getByRole('rowheader', { name: /^Jan 16/ })
                .closest('tr'),
        ).toHaveTextContent(/^Jan 16\s*0\s*0$/);
    });

    it('drops minutes that are not finite, non-negative numbers', async () => {
        vi.mocked(exportAllData).mockResolvedValue([
            {
                ...day('2024-01-15', '60', '30'),
                subjects: [
                    { id: 1, name: 'Overflow', planned: '1e999', actual: '1e999', kpi: 'N', time: '', reminder: false },
                    { id: 2, name: 'Negative', planned: '-60', actual: '-30', kpi: 'N', time: '', reminder: false },
                ],
            },
        ]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        await waitFor(() =>
            expect(
                screen.getByRole('img', {
                    name: 'Jan 14 - Jan 20: 0 minutes studied out of 0 minutes planned across 0 active days.',
                }),
            ).toBeInTheDocument(),
        );
        expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
    });

    it('announces a load failure and recovers when the week is revisited', async () => {
        const user = userEvent.setup();
        vi.mocked(exportAllData).mockRejectedValueOnce(new Error('offline'));

        render(<WeeklyStats currentDate="2024-01-15" />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Unable to load weekly statistics.');

        await user.click(screen.getByRole('button', { name: 'View previous week' }));

        await waitFor(() => expect(vi.mocked(exportAllData).mock.calls).toHaveLength(2));
        await waitFor(() =>
            expect(screen.getByRole('img', { name: /Jan 7 - Jan 13: 0 minutes studied/ })).toBeInTheDocument(),
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('drops the previous day rather than relabelling it when the anchor moves', async () => {
        // The payload is keyed to the day it was read for, so a day change can
        // never leave the outgoing day's numbers sitting under the incoming day's
        // dates. While the new day's read is in flight there is nothing to show.
        const secondRead = new Promise<DayData[]>((resolve) => {
            setTimeout(() => resolve([day('2024-01-16', '60', '20')]), 0);
        });
        vi.mocked(exportAllData).mockResolvedValueOnce(week).mockReturnValueOnce(secondRead);

        const { rerender } = render(<WeeklyStats currentDate="2024-01-15" />);
        await waitFor(() => expect(screen.getByText('90 minutes')).toBeInTheDocument());

        rerender(<WeeklyStats currentDate="2024-01-17" />);

        expect(screen.queryByText('90 minutes')).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
        expect(screen.queryByText('2/7 days')).not.toBeInTheDocument();

        expect(await screen.findByRole('img', { name: /Jan 14 - Jan 20: 20 minutes studied/ })).toBeInTheDocument();
        expect(screen.getByText('20 minutes')).toBeInTheDocument();
    });

    it('shows no weekly numbers at all when the very first read fails', async () => {
        vi.mocked(exportAllData).mockRejectedValue(new Error('offline'));

        render(<WeeklyStats currentDate="2024-01-15" />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load weekly statistics.');
        // A zeroed grid next to the error reads as "you studied nothing", which
        // is a completely different claim from "the numbers could not be read".
        for (const label of ['Total Study Time', 'Completion Rate', 'Daily Average', 'Best Streak']) {
            expect(screen.queryByText(label)).not.toBeInTheDocument();
        }
        expect(screen.queryByText('0h')).not.toBeInTheDocument();
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /minutes studied/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
    });

    it('does not carry a failed read over to a different day', async () => {
        // The error is stored against the week it is about, so a new anchor
        // cannot open already reporting the previous day's read failure.
        let resolveSecond: ((value: DayData[]) => void) | undefined;
        vi.mocked(exportAllData)
            .mockRejectedValueOnce(new Error('offline'))
            .mockReturnValueOnce(
                new Promise<DayData[]>((resolve) => {
                    resolveSecond = resolve;
                }),
            );

        const { rerender } = render(<WeeklyStats currentDate="2024-01-15" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load weekly statistics.');

        rerender(<WeeklyStats currentDate="2024-01-16" />);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(panelContent()).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            resolveSecond?.([day('2024-01-16', '60', '20')]);
        });

        expect(await screen.findByRole('img', { name: /Jan 14 - Jan 20: 20 minutes studied/ })).toBeInTheDocument();
    });

    it('keeps the week navigation usable after a failure so the read can be retried', async () => {
        const user = userEvent.setup();
        vi.mocked(exportAllData).mockRejectedValueOnce(new Error('offline'));

        render(<WeeklyStats currentDate="2024-01-15" />);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        // The failure is scoped to one week, so the user must be able to move
        // off it instead of being stranded on a dead panel.
        expect(screen.getByRole('button', { name: 'View previous week' })).toBeEnabled();

        await user.click(screen.getByRole('button', { name: 'View previous week' }));

        expect(await screen.findByRole('img', { name: /Jan 7 - Jan 13/ })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('accepts a legacy envelope shape and skips entries without a date', async () => {
        vi.mocked(exportAllData).mockResolvedValue({
            days: [...week, { ...day('2024-01-18', '60', '5'), date: '' }],
        } as unknown as DayData[]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // The undated record is dropped, so the total stays at 90 minutes.
        await waitFor(() => expect(screen.getByText('90 minutes')).toBeInTheDocument());
    });

    it('reports a payload that is neither an array nor an envelope as a failed read', async () => {
        vi.mocked(exportAllData).mockResolvedValue(null as unknown as DayData[]);

        render(<WeeklyStats currentDate="2024-01-15" />);

        // `exportAllData` is contracted to return a day array. Anything else
        // means the history could not be read, and a zeroed week would state as
        // fact that nothing was ever studied.
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load weekly statistics.');
        expect(screen.queryByRole('img', { name: /minutes studied/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
    });

    it('marks today in the data table instead of relying on colour alone', async () => {
        freezeClock(2024, 1, 17);
        vi.mocked(exportAllData).mockResolvedValue(week);

        render(<WeeklyStats currentDate="2024-01-15" />);

        const table = await screen.findByRole('table', { name: /Daily study minutes/i });
        expect(within(table).getByRole('rowheader', { name: 'Jan 17 (today)' })).toBeInTheDocument();
        expect(within(table).getByRole('rowheader', { name: /^Jan 14$/ })).toBeInTheDocument();
    });

    it('moves the today marker when the local date rolls over at midnight', async () => {
        freezeClock(2024, 1, 15);
        vi.mocked(exportAllData).mockResolvedValue(week);

        render(<WeeklyStats currentDate="2024-01-15" />);

        const table = await screen.findByRole('table', { name: /Daily study minutes/i });
        expect(within(table).getByRole('rowheader', { name: 'Jan 15 (today)' })).toBeInTheDocument();

        await act(async () => {
            // Nothing else re-renders this panel, so only a scheduled read can
            // notice the new day.
            vi.setSystemTime(new Date(2024, 0, 16, 0, 0, 1));
            await vi.advanceTimersByTime(13 * 60 * 60 * 1000);
        });

        expect(within(weeklyTable()).getByRole('rowheader', { name: 'Jan 16 (today)' })).toBeInTheDocument();
        expect(screen.queryByRole('rowheader', { name: 'Jan 15 (today)' })).not.toBeInTheDocument();
    });

    it('labels the week button for the week it returns to', async () => {
        freezeClock(2024, 1, 15);
        render(<WeeklyStats currentDate="2024-01-15" />);

        await screen.findByRole('img', { name: /minutes studied out of/i });
        // "This Week" would be a lie for any anchor that is not today.
        expect(screen.getByText('(This Week)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show the week of Jan 14 - Jan 20' })).toBeDisabled();
    });

    it('navigates backwards and forwards without ever passing the current week', async () => {
        // No `advanceTimers` here: `freezeClock` already lets the fake clock run
        // on its own, and driving it from user-event as well skips the click.
        const user = userEvent.setup();
        // The anchor week is the week before the current one, so it is not the
        // last week that can be read.
        freezeClock(2024, 1, 22);
        render(<WeeklyStats currentDate="2024-01-15" />);

        await screen.findByRole('img', { name: /minutes studied out of/i });
        // `getByText` throws when the badge is absent, which would fail the test
        // before the "not in the document" assertion could ever be reached.
        expect(screen.queryByText('(This Week)')).not.toBeInTheDocument();

        const next = screen.getByRole('button', { name: 'View next week' });
        expect(next).toBeEnabled();

        await user.click(next);

        expect(await screen.findByRole('img', { name: /Jan 21 - Jan 27/ })).toBeInTheDocument();
        expect(screen.getByText('(This Week)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View next week' })).toBeDisabled();
    });

    it('never offers a week that has not happened yet', async () => {
        freezeClock(2024, 1, 15);
        render(<WeeklyStats currentDate="2024-01-15" />);

        await screen.findByRole('img', { name: /minutes studied out of/i });
        expect(screen.getByRole('button', { name: 'View next week' })).toBeDisabled();
    });

    it('returns to the anchor week from the week label button', async () => {
        const user = userEvent.setup();
        // The "(This Week)" badge is only true while the anchor really is in the
        // current week, so the clock has to agree with the fixture date.
        freezeClock(2024, 1, 15);
        render(<WeeklyStats currentDate="2024-01-15" />);

        await user.click(screen.getByRole('button', { name: 'View previous week' }));
        await user.click(screen.getByRole('button', { name: 'Show the week of Jan 14 - Jan 20' }));

        expect(screen.getByText('(This Week)')).toBeInTheDocument();
        expect(await screen.findByRole('img', { name: /Jan 14 - Jan 20/ })).toBeInTheDocument();
    });

    it('names the week button for the week it returns to, not the week on screen', async () => {
        const user = userEvent.setup();
        render(<WeeklyStats currentDate="2024-01-15" />);

        await screen.findByRole('img', { name: /Jan 14 - Jan 20/ });
        // Already there, so the button is inert.
        expect(screen.getByRole('button', { name: 'Show the week of Jan 14 - Jan 20' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'View previous week' }));

        // The button now sits above Jan 7 - Jan 13 but still returns to Jan 14.
        // Naming the week already on screen would describe it as the thing the
        // button shows, while activating it jumps somewhere else entirely.
        expect(await screen.findByRole('img', { name: /Jan 7 - Jan 13/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show the week of Jan 14 - Jan 20' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Show the week of Jan 7 - Jan 13' })).not.toBeInTheDocument();
    });

    it('collapses the panel without discarding the loaded data', async () => {
        const user = userEvent.setup();
        render(<WeeklyStats currentDate="2024-01-15" />);

        const toggle = screen.getByRole('button', { name: /Weekly Stats/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(panelContent()).toBeInTheDocument();
        await screen.findByRole('img', { name: /minutes studied out of/i });

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        // Reopened without another read, so the numbers come straight back.
        expect(screen.getByText('90 minutes')).toBeInTheDocument();
        expect(await screen.findByRole('img', { name: /minutes studied out of/i })).toBeInTheDocument();
    });

    it('reads the history once per visit, and not at all while collapsed', async () => {
        const user = userEvent.setup();
        render(<WeeklyStats currentDate="2024-01-15" />);
        await waitFor(() => expect(vi.mocked(exportAllData).mock.calls).toHaveLength(1));

        await user.click(screen.getByRole('button', { name: /Weekly Stats/ }));
        await user.click(screen.getByRole('button', { name: /Weekly Stats/ }));

        // `exportAllData` reads the whole store, deep clones it and validates
        // every day, so an unnecessary call is O(days) of work for numbers the
        // panel already holds. Nothing on this page can change the store, so a
        // reopened panel has nothing new to read.
        expect(vi.mocked(exportAllData).mock.calls).toHaveLength(1);
    });

    it('does not re-read the whole history to move between weeks', async () => {
        const user = userEvent.setup();
        render(<WeeklyStats currentDate="2024-01-15" />);
        await waitFor(() => expect(vi.mocked(exportAllData).mock.calls).toHaveLength(1));

        // One payload is the whole history, so the weeks either side of the
        // anchor are already in it. Re-reading per week turned every click on
        // the arrows into a full store read, deep clone and validation.
        await user.click(screen.getByRole('button', { name: 'View previous week' }));
        expect(await screen.findByRole('img', { name: /Jan 7 - Jan 13/ })).toBeInTheDocument();
        expect(vi.mocked(exportAllData).mock.calls).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'View next week' }));
        expect(await screen.findByRole('img', { name: /Jan 14 - Jan 20/ })).toBeInTheDocument();
        expect(vi.mocked(exportAllData).mock.calls).toHaveLength(1);
    });

    it('gives each panel on a page its own disclosure ids', async () => {
        render(
            <>
                <WeeklyStats currentDate="2024-01-15" />
                <WeeklyStats currentDate="2024-01-16" />
            </>,
        );

        const toggles = screen.getAllByRole('button', { name: /Weekly Stats/ });
        expect(toggles).toHaveLength(2);
        const controlledIds = toggles.map((toggle) => toggle.getAttribute('aria-controls'));
        // A shared id made both panels' disclosures point at the first panel's
        // content, so the second panel reported the first one's state.
        expect(new Set(controlledIds).size).toBe(2);
        for (const id of controlledIds) {
            expect(document.getElementById(id as string)).toBeInTheDocument();
        }

        // Both panels settle on their own anchor rather than sharing one read.
        await waitFor(() => expect(screen.getAllByRole('table', { name: /Daily study minutes/i })).toHaveLength(2));
    });

    it('skips the history read and explains itself when the anchor date is not a real day', async () => {
        render(<WeeklyStats currentDate="2024-02-30" />);

        expect(vi.mocked(exportAllData).mock.calls).toHaveLength(0);
        // Zeroing the chart here would claim the user studied nothing, when the
        // truth is that there is no day to report on.
        expect(screen.getByText('Select a study date to see weekly statistics.')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /minutes studied/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'View previous week' })).not.toBeInTheDocument();
    });

    it('skips the history read for a real day whose week cannot be named', () => {
        // 0001-01-01 is a real Monday, but its week starts on 0000-12-31, and
        // there is no such year to report on.
        render(<WeeklyStats currentDate="0001-01-01" />);

        expect(vi.mocked(exportAllData).mock.calls).toHaveLength(0);
        // Seven zeroed days for a week that cannot be laid out day by day would
        // be a confident claim about days that do not exist.
        expect(screen.getByText('This date cannot be shown as a full week.')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /minutes studied/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: /Daily study minutes/i })).not.toBeInTheDocument();
        expect(screen.queryByText('No study time recorded for this week.')).not.toBeInTheDocument();
    });
});
