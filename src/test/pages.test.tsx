import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FocusPage from '../pages/FocusPage';
import ReviewPage from '../pages/ReviewPage';
import StatsPage from '../pages/StatsPage';
import TrackerPage from '../pages/TrackerPage';
import { ToastProvider } from '../providers/ToastProvider';
import { exportAllData } from '../services/storage';
import type { ChecklistItem, ErrorLogEntry, QualityCheckItem, Subject } from '../types';

vi.mock('../services/storage', () => ({
    exportAllData: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/notificationService', () => ({
    NotificationService: {
        scheduleNotification: vi.fn().mockResolvedValue({ success: true }),
        cancelNotification: vi.fn().mockResolvedValue(true),
        initialize: vi.fn().mockResolvedValue(undefined),
        initListeners: vi.fn().mockResolvedValue(undefined),
        removeListeners: vi.fn().mockResolvedValue(undefined),
    },
}));

// Only the widget push is replaced. The rest of the module is passed through, so
// a new export added there cannot turn into a "No X export is defined on the
// mock" ReferenceError the first time a page under test happens to import it.
vi.mock('../services/widgetService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/widgetService')>();
    return { ...actual, updateWidget: vi.fn(), shouldPublishWidget: vi.fn().mockReturnValue(false) };
});

vi.mock('../services/updateService', () => ({
    checkForUpdate: vi.fn().mockResolvedValue(null),
    getCurrentVersion: vi.fn().mockReturnValue('2.2.2'),
    downloadAndInstallUpdate: vi.fn().mockResolvedValue({ success: true }),
    isAllowedReleaseUrl: vi.fn().mockReturnValue(false),
}));

const subjects: Subject[] = [
    { id: 1, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '', reminder: false },
    { id: 2, name: 'Economics', planned: '90', actual: '30', kpi: 'N', time: '', reminder: false },
];

const reviewProps = () => ({
    checklistItems: [{ id: 1, label: 'Read notes', checked: false }] as ChecklistItem[],
    setChecklistItems: vi.fn(),
    qualityChecks: [{ id: 1, label: 'Cite sources', checked: false }] as QualityCheckItem[],
    setQualityChecks: vi.fn(),
    dayRating: '',
    setDayRating: vi.fn(),
    errors: [{ id: 1, question: 'q', mistake: 'm', correctLogic: 'l' }] as ErrorLogEntry[],
    setErrors: vi.fn(),
});

describe('pages', () => {
    beforeEach(() => {
        vi.mocked(exportAllData).mockResolvedValue([]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('ReviewPage', () => {
        it('names itself and renders all three review sections in order', () => {
            render(<ReviewPage {...reviewProps()} />);

            const section = screen.getByRole('region', { name: 'Review' });
            expect(section).toBeInTheDocument();
            const headings = within(section)
                .getAllByRole('heading')
                .map((heading) => heading.textContent);
            expect(headings).toEqual([
                'Review',
                'Output Checklist',
                'Quality Check',
                'Day Rating',
                'Error Log',
                'Error log 1',
            ]);
        });

        it('forwards each section change to the supplied setters', async () => {
            const user = userEvent.setup();
            const props = reviewProps();
            render(<ReviewPage {...props} />);

            await user.click(screen.getByRole('checkbox', { name: /Mark checklist/ }));
            expect(props.setChecklistItems).toHaveBeenCalledTimes(1);

            await user.click(screen.getByRole('radio', { name: 'Productive' }));
            expect(props.setDayRating).toHaveBeenCalledTimes(1);
        });

        it('renders every section empty without a dedicated placeholder', () => {
            render(<ReviewPage {...reviewProps()} checklistItems={[]} qualityChecks={[]} errors={[]} />);

            expect(screen.getByText(/Add your first objective/i)).toBeInTheDocument();
            expect(screen.getByText(/Add quality criteria/i)).toBeInTheDocument();
            expect(screen.getByText(/No errors logged today/i)).toBeInTheDocument();
        });
    });

    describe('StatsPage', () => {
        it('names itself and pairs the daily charts with the weekly chart', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-01-15" />);

            const section = screen.getByRole('region', { name: 'Study statistics' });
            expect(section).toBeInTheDocument();
            expect(within(section).getByRole('table', { name: 'Study metrics by subject' })).toBeInTheDocument();
            expect(await within(section).findByRole('table', { name: /Daily study minutes/i })).toBeInTheDocument();
        });

        it('keeps its own heading out of the two-column grid flow', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-01-15" />);

            // `sr-only` takes the heading out of layout, so the grid still
            // resolves to exactly two chart panels.
            const section = screen.getByRole('region', { name: 'Study statistics' });
            await within(section).findByRole('table', { name: /Daily study minutes/i });
            const charts = within(section).getAllByRole('table');
            expect(charts).toHaveLength(2);
        });

        it('gives each chart panel a level-two heading, skipping no levels', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-01-15" />);
            await screen.findByRole('table', { name: /Daily study minutes/i });

            const levels = screen
                .getAllByRole('heading')
                .map((heading) => Number(heading.getAttribute('aria-level') ?? heading.tagName.slice(1)));
            // h1 page title, then one heading per panel. `role="heading"` on a
            // span is what keeps the level out of a heading element that cannot
            // legally nest inside the disclosure button.
            expect(levels).toEqual([1, 2, 2]);
        });

        it('names each panel landmark from its own heading', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-01-15" />);
            // The panels load their own data; the landmark itself is on screen
            // immediately, so waiting for it would read the shell before the
            // panels have settled.
            await screen.findByRole('table', { name: /Daily study minutes/i });

            expect(screen.getByRole('region', { name: 'Study Charts' })).toBeInTheDocument();
            expect(screen.getByRole('region', { name: 'Weekly Stats' })).toBeInTheDocument();
        });

        it('states which day the daily charts cover', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-01-15" />);
            await screen.findByText(/minutes studied out of/i);

            // The panels chart a single day and the page never said which one.
            expect(screen.getByText('Daily charts cover Monday, January 15, 2024.')).toBeInTheDocument();
        });

        it('does not echo an unparseable date back as the scope', async () => {
            render(<StatsPage subjects={subjects} currentDate="2024-02-30" />);
            await screen.findByText(/minutes studied out of/i);

            expect(screen.getByText('Daily charts cover no selected day.')).toBeInTheDocument();
        });

        it('survives an empty subject list', async () => {
            render(<StatsPage subjects={[]} currentDate="2024-01-15" />);

            // With no subjects there is no plan either, so the panel says that
            // rather than reporting a 0% it cannot justify.
            expect(
                await screen.findByText(
                    '0 minutes studied out of 0 minutes planned. No plan set. 0 of 0 KPI targets met.',
                ),
            ).toBeInTheDocument();
        });
    });

    describe('FocusPage', () => {
        it('names itself and renders the countdown and the in-built alarm', () => {
            render(
                <ToastProvider>
                    <FocusPage globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />
                </ToastProvider>,
            );

            const section = screen.getByRole('region', { name: 'Focus' });
            expect(section).toBeInTheDocument();
            expect(within(section).getByRole('button', { name: 'Start focus timer' })).toBeInTheDocument();
            expect(within(section).getByRole('button', { name: 'Add focus alarm' })).toBeInTheDocument();
        });

        it('renders no ringing overlay of its own, whatever the app-level alarm says', () => {
            const { rerender } = render(
                <ToastProvider>
                    <FocusPage globalAlarmSource={null} stopGlobalAlarm={vi.fn()} />
                </ToastProvider>,
            );
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            for (const source of ['SYSTEM', 'ALARM_ACTIONS', 'FOCUS_ALARM']) {
                rerender(
                    <ToastProvider>
                        <FocusPage globalAlarmSource={source} stopGlobalAlarm={vi.fn()} />
                    </ToastProvider>,
                );
                // The shell is the only in-app owner of the ringing overlay. The
                // focus card used to answer `'FOCUS_ALARM'` - a value nothing
                // registers with the notification plugin - and painted a second
                // `aria-modal` stop dialog on top of the shell's, so one alarm had
                // two stop controls and focus trapped by whichever mounted last.
                // Any source, including the one that branch keyed off, leaves the
                // route with no dialog of its own.
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'Add focus alarm' })).toBeInTheDocument();
            }
        });
    });

    describe('TrackerPage', () => {
        it('names itself and shows the desktop date, clock and planner', () => {
            render(
                <ToastProvider>
                    <TrackerPage date="2024-01-15" setDate={vi.fn()} subjects={subjects} setSubjects={vi.fn()} />
                </ToastProvider>,
            );

            const section = screen.getByRole('region', { name: 'Study tracker' });
            expect(section).toBeInTheDocument();
            expect(within(section).getByRole('timer', { name: 'Current time' })).toBeInTheDocument();
            expect(within(section).getByRole('timer', { name: /Stopwatch/ })).toBeInTheDocument();
            expect(within(section).getByRole('heading', { name: 'Study Planner' })).toBeInTheDocument();
        });

        it('passes the selected date through to the picker', async () => {
            const user = userEvent.setup();
            const setDate = vi.fn().mockResolvedValue(undefined);
            render(
                <ToastProvider>
                    <TrackerPage date="2024-01-15" setDate={setDate} subjects={subjects} setSubjects={vi.fn()} />
                </ToastProvider>,
            );

            const trigger = within(screen.getByRole('region', { name: 'Study tracker' })).getAllByRole('button', {
                name: /Study Date/i,
            })[0] as HTMLElement;
            await user.click(trigger);

            const dialog = await screen.findByRole('dialog');
            await waitFor(() => expect(dialog).toBeInTheDocument());
            expect(within(dialog).getByText(/January 2024/)).toBeInTheDocument();
        });
    });
});
