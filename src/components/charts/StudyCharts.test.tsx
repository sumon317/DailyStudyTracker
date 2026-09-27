import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Subject } from '../../types';
import StudyCharts from './StudyCharts';

const subjects: Subject[] = [
    { id: 1, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '', reminder: false },
    { id: 2, name: 'Economics', planned: '90', actual: '30', kpi: 'N', time: '', reminder: false },
    { id: 3, name: 'Business Law', planned: '45.5', actual: '0', kpi: 'N', time: '', reminder: false },
];

const subjectTable = () => screen.getByRole('table', { name: 'Study metrics by subject' });

describe('StudyCharts', () => {
    it('summarises totals in text for assistive technology', () => {
        render(<StudyCharts subjects={subjects} />);

        expect(
            screen.getByText(
                '75 minutes studied out of 195.5 minutes planned. 38% of the planned time completed. 1 of 3 KPI targets met.',
            ),
        ).toBeInTheDocument();
    });

    it('names its landmark from the heading rather than the header badge', () => {
        render(<StudyCharts subjects={subjects} />);

        // `role="heading"` on a span: an <h2> is not phrasing content and cannot
        // legally nest inside the disclosure button, but the page outline still
        // needs a level two for this panel.
        expect(screen.getByRole('region', { name: 'Study Charts' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Study Charts' })).toBeInTheDocument();
    });

    it('describes the distribution chart in text and leaves the table a reachable alternative', async () => {
        const user = userEvent.setup();
        render(<StudyCharts subjects={subjects} />);

        const chart = screen.getByRole('img', { name: /Study time distribution/ });
        // The name carries the full summary, so the numbers are announced
        // without hunting for a description target.
        expect(chart).toHaveAccessibleName(/75 minutes studied out of 195\.5 minutes planned/);
        // It deliberately has no `aria-describedby`: the table caption it used
        // to point at sits inside a collapsed <details>, so the reference led
        // to content that is not in the accessibility tree yet and described
        // nothing until the disclosure was opened.
        expect(chart).not.toHaveAttribute('aria-describedby');

        // The per-subject breakdown is still there behind its own disclosure.
        await user.click(screen.getByText('View subject data table'));
        expect(screen.getByText('View subject data table').closest('details')).toHaveAttribute('open');
        expect(within(subjectTable()).getByRole('rowheader', { name: 'Accounts' })).toBeInTheDocument();
    });

    it('collapses and expands behind a labelled disclosure button', async () => {
        const user = userEvent.setup();
        render(<StudyCharts subjects={subjects} />);

        const toggle = screen.getByRole('button', { name: /Study Charts/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const contentId = toggle.getAttribute('aria-controls');
        expect(contentId).toBeTruthy();
        expect(document.getElementById(contentId as string)).toBeInTheDocument();

        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('reports a per-subject progress bar with a readable value', () => {
        render(<StudyCharts subjects={subjects} />);

        const bars = screen.getAllByRole('progressbar');
        expect(bars).toHaveLength(3);
        expect(bars[0]).toHaveAttribute('aria-valuenow', '75');
        expect(bars[0]).toHaveAccessibleName('Accounts');
        expect(bars[0]).toHaveAttribute('aria-valuetext', '45 of 60 minutes studied, 75% of plan');
        expect(bars[1]).toHaveAttribute('aria-valuenow', '33');
        // A zero plan must not produce a divide-by-zero percentage.
        expect(bars[2]).toHaveAttribute('aria-valuenow', '0');
    });

    it('caps the progress bar at 100 percent when over-planned', () => {
        render(
            <StudyCharts
                subjects={[{ id: 1, name: 'Over', planned: '30', actual: '90', kpi: 'Y', time: '', reminder: false }]}
            />,
        );

        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '100');
        // `aria-valuenow` is bounded by `aria-valuemax`, so the overflow has to
        // be carried by the value text: "100% of plan" for 90 of 30 minutes is a
        // number the data cannot support.
        expect(bar).toHaveAttribute('aria-valuetext', '90 of 30 minutes studied, 300% of plan');
        expect(screen.getByText('90/30 min (300%)')).toBeInTheDocument();
    });

    it('reports the real over-planned ratio in the table instead of rounding it to 100', () => {
        render(
            <StudyCharts
                subjects={[{ id: 1, name: 'Over', planned: '30', actual: '90', kpi: 'N', time: '', reminder: false }]}
            />,
        );

        // A capped 100% in a data table reads as "exactly met the plan".
        const row = within(subjectTable()).getByRole('rowheader', { name: 'Over' }).closest('tr');
        expect(within(row as HTMLElement).getByRole('cell', { name: '300%' })).toBeInTheDocument();
        expect(within(row as HTMLElement).queryByRole('cell', { name: '100%' })).not.toBeInTheDocument();
    });

    it('renders an empty state when nothing has been studied', () => {
        render(<StudyCharts subjects={[]} />);

        expect(
            screen.getByText('0 minutes studied out of 0 minutes planned. No plan set. 0 of 0 KPI targets met.'),
        ).toBeInTheDocument();
        expect(subjectTable()).toBeInTheDocument();
    });

    it('reports the studied total in the middle of the distribution ring', () => {
        render(<StudyCharts subjects={subjects} />);

        // The ring splits the minutes that were studied, so 75 minutes is what
        // belongs in the middle. A completion percentage there reads as "this
        // slice is 38% of the plan", which the ring cannot answer.
        expect(screen.getByText('1.3h')).toBeInTheDocument();
        expect(screen.getByText('studied')).toBeInTheDocument();
    });

    it('reports the real over-planned total instead of rounding the day to 100', () => {
        render(
            <StudyCharts
                subjects={[{ id: 1, name: 'Over', planned: '30', actual: '90', kpi: 'Y', time: '', reminder: false }]}
            />,
        );

        // The table and each bar report 300%, so a summary sentence and a header
        // badge claiming "100%" would contradict the panel's own data.
        expect(
            screen.getByText(
                '90 minutes studied out of 30 minutes planned. 300% of the planned time completed. 1 of 1 KPI targets met.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText('300% of plan complete · 1/1 KPI targets met')).toBeInTheDocument();
    });

    it('does not report a completion percentage for a subject with no plan', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Unplanned', planned: '0', actual: '45', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // "45/0 min (0%)" states the opposite of what happened: 45 minutes were
        // studied and there was no target to miss.
        expect(screen.getByText('45/0 min (no plan)')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute(
            'aria-valuetext',
            '45 of 0 minutes studied, no plan set',
        );
        expect(within(subjectTable()).getByRole('cell', { name: 'No plan' })).toBeInTheDocument();
        expect(screen.queryByText('45/0 min (0%)')).not.toBeInTheDocument();
    });

    it('says so when there is no plan, instead of reporting a met plan of zero', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Unplanned', planned: '0', actual: '0', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // 0 remaining out of 0 planned is not a success, it is an absence.
        expect(screen.getByText('No plan set')).toBeInTheDocument();
    });

    it('omits the legend until at least one subject has minutes logged', () => {
        const [first] = subjects;
        if (!first) {
            throw new Error('fixture is empty');
        }
        const { rerender } = render(<StudyCharts subjects={subjects} />);
        expect(screen.getByRole('list', { name: 'Study time legend' })).toBeInTheDocument();
        expect(within(screen.getByRole('list', { name: 'Study time legend' })).getAllByRole('listitem')).toHaveLength(
            2,
        );

        rerender(<StudyCharts subjects={[{ ...first, actual: '0', kpi: 'N' }]} />);
        expect(screen.queryByRole('list', { name: 'Study time legend' })).not.toBeInTheDocument();
    });

    it('exposes a full data table alternative with row headers', async () => {
        const user = userEvent.setup();
        render(<StudyCharts subjects={subjects} />);

        const table = subjectTable();
        const rows = within(table).getAllByRole('row');
        // One header row plus one row per subject.
        expect(rows).toHaveLength(4);
        expect(within(table).getByRole('rowheader', { name: 'Accounts' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '60 min' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '45 min' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '75%' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: 'Met' })).toBeInTheDocument();
        expect(within(table).getAllByRole('cell', { name: 'Not met' })).toHaveLength(2);

        await user.click(screen.getByText('View subject data table'));
        expect(screen.getByText('View subject data table').closest('details')).toHaveAttribute('open');
    });

    it('gives the table alternative a row when the day has no subjects', () => {
        render(<StudyCharts subjects={[]} />);

        // A header-only table is not a usable alternative to the chart.
        expect(
            within(subjectTable()).getByRole('cell', { name: 'No subjects recorded for this day.' }),
        ).toBeInTheDocument();
        expect(screen.getByText('No subjects tracked yet')).toBeInTheDocument();
        expect(
            screen.getByText('No subjects recorded for this day. Add one on the Study tracker to see charts.'),
        ).toBeInTheDocument();
    });

    it('keeps the wide data table scrollable instead of clipping it', () => {
        render(<StudyCharts subjects={subjects} />);

        const table = subjectTable();
        expect(table.parentElement).toHaveClass('overflow-x-auto');
        expect(table).toHaveClass('min-w-[420px]');
    });

    it('scopes duplicate subject names by position', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Accounts', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                    { id: 2, name: 'Accounts', planned: '60', actual: '60', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // Two progress bars answering to the same name cannot be told apart.
        expect(screen.getByRole('progressbar', { name: 'Accounts (subject 1 of 2)' })).toHaveAttribute(
            'aria-valuenow',
            '50',
        );
        expect(screen.getByRole('progressbar', { name: 'Accounts (subject 2 of 2)' })).toHaveAttribute(
            'aria-valuenow',
            '100',
        );
        const table = subjectTable();
        expect(within(table).getByRole('rowheader', { name: 'Accounts (subject 1 of 2)' })).toBeInTheDocument();
        expect(within(table).getByRole('rowheader', { name: 'Accounts (subject 2 of 2)' })).toBeInTheDocument();
        // The visible label stays exactly as typed.
        expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent(/^Accounts/);
    });

    it('reads a scoped row header with a pause before its qualifier', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Accounts', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                    { id: 2, name: 'Accounts', planned: '60', actual: '60', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // The qualifier lived in a separate screen-reader-only element, and the
        // accessible name is computed by joining child nodes without a
        // separator, so this used to be announced as "Accounts(subject 1 of 2)".
        const header = within(subjectTable()).getByRole('rowheader', { name: 'Accounts (subject 1 of 2)' });
        expect(header).toHaveTextContent('Accounts (subject 1 of 2)');
    });

    it('gives the progress bar and the table row header the same name for a subject', () => {
        render(
            <StudyCharts
                subjects={[{ id: 1, name: 'Solo', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false }]}
            />,
        );

        // One subject, one name: a reader who hears two spellings of the same
        // row cannot tell whether they are looking at two subjects or one.
        expect(screen.getByRole('progressbar')).toHaveAccessibleName('Solo');
        expect(within(subjectTable()).getByRole('rowheader')).toHaveAccessibleName('Solo');
    });

    it('names a subject that was saved without a name', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: '   ', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                    { id: 2, name: 'Economics', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // An empty label leaves a progressbar with no accessible name, which no
        // screen reader can announce at all.
        const bars = screen.getAllByRole('progressbar');
        for (const bar of bars) {
            expect(bar).toHaveAccessibleName();
        }
        expect(bars[0]).toHaveAccessibleName('Subject 1');
        expect(within(subjectTable()).getAllByRole('rowheader')[0]).toHaveAccessibleName('Subject 1');
    });

    it('keeps both rows addressable when a repeated id repeats a repeated name', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 7, name: 'Same', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                    { id: 7, name: 'Same', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        // The id collision and the name collision are independent, and both have
        // to be disambiguated for the two rows to stay reachable.
        expect(screen.getByRole('progressbar', { name: 'Same (subject 1 of 2)' })).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Same (subject 2 of 2)' })).toBeInTheDocument();
        expect(within(subjectTable()).getAllByRole('row')).toHaveLength(3);
    });

    it('keeps every subject row when two of them share an id', () => {
        // A backup import validates ids as safe integers but never for
        // uniqueness inside a day, and React reconciles by key, so a repeated
        // id used to collapse two rows onto one node.
        render(
            <StudyCharts
                subjects={[
                    { id: 7, name: 'First', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                    { id: 7, name: 'Second', planned: '60', actual: '30', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        expect(screen.getAllByRole('progressbar')).toHaveLength(2);
        expect(within(subjectTable()).getAllByRole('row')).toHaveLength(3);
        expect(within(screen.getByRole('list', { name: 'Study time legend' })).getAllByRole('listitem')).toHaveLength(
            2,
        );
    });

    it('ignores malformed numeric input instead of rendering NaN', () => {
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Broken', planned: 'abc', actual: 'xyz', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        expect(
            screen.getByText('0 minutes studied out of 0 minutes planned. No plan set. 0 of 1 KPI targets met.'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it('drops minutes that are not finite, non-negative numbers', () => {
        // Both values are typeable into `<input type="number" min="0">`:
        // "1e999" is a valid float to the browser and "min" is not enforced
        // while typing, so the charts have to refuse them themselves.
        render(
            <StudyCharts
                subjects={[
                    { id: 1, name: 'Overflow', planned: '1e999', actual: '1e999', kpi: 'N', time: '', reminder: false },
                    { id: 2, name: 'Negative', planned: '-60', actual: '-30', kpi: 'N', time: '', reminder: false },
                ]}
            />,
        );

        expect(
            screen.getByText('0 minutes studied out of 0 minutes planned. No plan set. 0 of 2 KPI targets met.'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
        expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '0');
        expect(screen.getByText('No plan set')).toBeInTheDocument();
    });
});
