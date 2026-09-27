import { App as CapacitorApp } from '@capacitor/app';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFocusableElements } from '../components/shared/focusOrder';
import { NotificationService } from '../services/notificationService';
import { downloadBackup, handleFileImport, loadFromNativeStorage } from '../services/storage';
import { checkForUpdate } from '../services/updateService';
import { shouldPublishWidget, updateWidget } from '../services/widgetService';
import {
    createUser,
    isRouteSettled,
    navigateToRoute,
    preloadRouteModules,
    routeHeadings,
    TestWrapper,
    waitForRoute,
    waitForRouteCommit,
} from '../test/test-utils';
import { getTodayLocalDate } from '../utils/dateUtils';
import App, { PERSISTENCE_NOTICE_COOLDOWN_MS } from './App';

type ComponentProps<T> = T extends (props: infer P) => unknown ? P : never;

type PageModule = { default: (props: ComponentProps<never>) => JSX.Element };

/**
 * The routes a test can make throw.
 *
 * Every route renders the *same* `ErrorBoundary` component in the *same* tree
 * position, so React reconciles them into one instance unless each element
 * carries a key of its own. A single failing route cannot prove that: it can
 * only prove the boundary *works*. Failing two different routes, recovering,
 * and failing the first one again is what proves the boundaries are separate -
 * and one missing key would otherwise latch the fallback on for the rest of the
 * session with no way back to the app.
 */
const failingRoutes = vi.hoisted(() => new Set<string>());

/**
 * Wraps a lazily loaded page so a test can make *it* throw.
 *
 * A function declaration, not a `const`: `vi.mock` is hoisted above this file's
 * imports, and the factories below run while the module graph is still loading.
 */
function wrapRoute(route: string, actual: { default: unknown }) {
    const Page = actual.default as (props: Record<string, unknown>) => JSX.Element;
    return {
        default: (props: Record<string, unknown>) => {
            if (failingRoutes.has(route)) {
                throw new Error(`${route} route exploded`);
            }
            return <Page {...props} />;
        },
    };
}

vi.mock('../pages/TrackerPage', async () =>
    wrapRoute('tracker', await vi.importActual<PageModule>('../pages/TrackerPage')),
);
vi.mock('../pages/ReviewPage', async () =>
    wrapRoute('review', await vi.importActual<PageModule>('../pages/ReviewPage')),
);
vi.mock('../pages/StatsPage', async () => wrapRoute('stats', await vi.importActual<PageModule>('../pages/StatsPage')));
vi.mock('../pages/TodoPage', async () => wrapRoute('todo', await vi.importActual<PageModule>('../pages/TodoPage')));
vi.mock('../pages/FocusPage', async () => wrapRoute('focus', await vi.importActual<PageModule>('../pages/FocusPage')));

beforeAll(() => {
    globalThis.matchMedia =
        globalThis.matchMedia ||
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

    // Resolve every lazy route chunk before any navigation happens. A route
    // transition then settles on the microtask queue instead of waiting on a
    // module transform, which was the only wall-clock dependency behind the
    // old `findBy*` navigation assertions.
    return preloadRouteModules();
});

vi.mock('../services/storage', () => ({
    loadFromNativeStorage: vi.fn().mockResolvedValue(null),
    saveToNativeStorage: vi.fn().mockResolvedValue(undefined),
    loadGlobalTodos: vi.fn().mockResolvedValue([]),
    saveGlobalTodos: vi.fn().mockResolvedValue(undefined),
    loadRecurringSubjects: vi.fn().mockResolvedValue([]),
    saveRecurringSubjects: vi.fn().mockResolvedValue(undefined),
    downloadBackup: vi.fn().mockResolvedValue(0),
    handleFileImport: vi.fn().mockResolvedValue(0),
    exportAllData: vi.fn().mockResolvedValue([]),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false),
    },
    registerPlugin: vi.fn(() => ({
        addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
        removeAllListeners: vi.fn().mockResolvedValue(undefined),
    })),
    WebPlugin: class {},
}));

vi.mock('@capacitor/app', () => ({
    App: {
        addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
    },
}));

vi.mock('../services/notificationService', () => ({
    NotificationService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        initListeners: vi.fn().mockResolvedValue(undefined),
        removeListeners: vi.fn().mockResolvedValue(undefined),
        reconcileNotifications: vi.fn().mockResolvedValue({ success: true }),
        checkExactAlarmPermission: vi.fn().mockResolvedValue(true),
        // The shell reads the tri-state, not the boolean: only a real `denied`
        // opens the exact-alarm sheet, so a bridge that could not answer does not
        // nag a user who has already granted the permission.
        getExactAlarmState: vi.fn().mockResolvedValue('granted'),
        openExactAlarmSettings: vi.fn(),
        scheduleNotification: vi.fn().mockResolvedValue({ success: true }),
        cancelNotification: vi.fn().mockResolvedValue(true),
    },
}));

// Only the two functions the shell's data path calls are replaced. Everything
// else is passed through from the real module, so a new export added there
// cannot turn into a "No X export is defined on the mock" ReferenceError the
// first time `DataProvider` happens to import it.
vi.mock('../services/widgetService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/widgetService')>();
    return {
        ...actual,
        updateWidget: vi.fn(),
        shouldPublishWidget: vi.fn().mockReturnValue(false),
    };
});

vi.mock('../services/updateService', () => ({
    checkForUpdate: vi.fn().mockResolvedValue({ available: false }),
    getCurrentVersion: vi.fn().mockReturnValue('2.2.2'),
    downloadAndInstallUpdate: vi.fn().mockResolvedValue({ success: true }),
    isAllowedReleaseUrl: vi.fn().mockReturnValue(false),
}));

afterAll(() => {
    vi.restoreAllMocks();
});

const hasHeading = (name: string) => () => screen.queryByRole('heading', { level: 1, name }) !== null;

const ALARM_PERMISSION_PROMPTED_AT_KEY = 'alarmPermissionPromptedAt';
const NOTIFICATION_RECONCILE_DEBOUNCE_MS = 250;

/**
 * Fakes only the two timer functions the reconcile debounce is built on.
 *
 * `vi.useFakeTimers()` with no argument also fakes `requestAnimationFrame`, and
 * framer-motion drives both its animations and the `AnimatePresence` exit
 * callbacks from it. Waking up in a file where some earlier test already wedged
 * that module-level frameloop left the menu and the alarm overlay mounted
 * forever at their exit keyframes, so every "did this panel actually leave"
 * assertion passed or failed depending on what ran before it.
 */
const useDebounceTimers = (): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};

/**
 * Lets every pending debounce fire and every queued reconcile drain, without
 * depending on how long a machine takes to get there.
 *
 * The leading microtask turn is load-bearing: `act` runs its callback *before*
 * it flushes effects, so advancing the clock in the same turn would race the
 * effect that arms the debounce and the pass would never be seen.
 */
const flushNotificationPasses = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve();
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(NOTIFICATION_RECONCILE_DEBOUNCE_MS);
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
};

const fireResume = async () => {
    const addListener = vi.mocked(
        CapacitorApp.addListener as unknown as (eventName: string, listener: () => void) => Promise<unknown>,
    );
    // The mock accumulates registrations across tests, and a listener belonging to
    // an already unmounted App would ignore the event. `settle` guarantees the
    // current render committed, so the newest registration is the live one.
    await settle();
    const resumeCall = addListener.mock.calls.filter(([eventName]) => eventName === 'resume').at(-1);
    expect(resumeCall).toBeDefined();
    const [, listener] = resumeCall ?? [];
    expect(listener).toBeDefined();
    await act(async () => {
        await listener?.();
    });
};

const renderApp = (initialEntries?: string[]) =>
    render(<App />, {
        wrapper: initialEntries
            ? ({ children }: { children: React.ReactNode }) => (
                  <TestWrapper initialEntries={initialEntries}>{children}</TestWrapper>
              )
            : TestWrapper,
    });

/**
 * Waits for the shell and the current route to settle.
 *
 * The header renders outside the route outlet, so waiting for its title alone
 * left the lazily loaded route mid-resolve and every landmark assertion below it
 * was a race that only lost on a loaded machine. No heading is required by
 * default: not every route has one, and the one test that needs a specific
 * heading asks for it.
 */
const settle = async (heading?: string) => {
    const committed = await waitForRoute(heading);
    expect(committed).toBe(true);
};

describe('Daily Study Tracker App', () => {
    beforeEach(() => {
        localStorage.clear();
        failingRoutes.clear();

        // `clearMocks` empties a call log but deliberately leaves the
        // implementation alone, so a test that installs one - a never-resolving
        // reconcile, a rejecting import, a `shouldPublishWidget` that returns
        // true - silently handed it to every test after it. That is what made
        // this file order dependent: the serialised-reconcile test's pending
        // promise left the shared reconcile queue blocked, and the next two
        // tests saw one pass instead of two. Re-seeding every service mock here
        // makes each test's starting point depend on nothing but this file.
        vi.mocked(loadFromNativeStorage).mockResolvedValue(null);
        vi.mocked(downloadBackup).mockResolvedValue(0);
        vi.mocked(handleFileImport).mockResolvedValue(0);
        vi.mocked(shouldPublishWidget).mockReturnValue(false);
        vi.mocked(updateWidget).mockReset();
        vi.mocked(NotificationService.initialize).mockResolvedValue(undefined);
        vi.mocked(NotificationService.initListeners).mockResolvedValue(undefined);
        vi.mocked(NotificationService.removeListeners).mockResolvedValue(undefined);
        vi.mocked(NotificationService.reconcileNotifications).mockResolvedValue({ success: true });
        vi.mocked(NotificationService.checkExactAlarmPermission).mockResolvedValue(true);
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('granted');
        vi.mocked(NotificationService.scheduleNotification).mockResolvedValue({ success: true });
        vi.mocked(NotificationService.cancelNotification).mockResolvedValue(true);
        // A real `UpdateResult`, not `null`. The startup check reads
        // `info.available` and swallows any throw, so a mock that returns a shape
        // the real function never produces hides a `TypeError` behind that
        // `catch` instead of failing here.
        vi.mocked(checkForUpdate).mockResolvedValue({ available: false });
    });

    afterEach(() => {
        if (vi.isFakeTimers()) {
            vi.clearAllTimers();
        }
        vi.useRealTimers();
    });

    it('renders the main title', async () => {
        renderApp();
        expect(await screen.findByText(/Daily Study Tracker/i)).toBeInTheDocument();
    });

    it('reconciles once after initialization and rechecks exact-alarm permission on resume', async () => {
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        const readState = vi.mocked(NotificationService.getExactAlarmState);
        const load = vi.mocked(loadFromNativeStorage);
        reconcile.mockClear();
        readState.mockClear();
        load.mockClear();

        renderApp();
        await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
        expect(load).toHaveBeenCalledTimes(1);

        await fireResume();

        expect(readState).toHaveBeenCalledTimes(2);
    });

    it('does not prompt for exact-alarm access it could not read', async () => {
        // The boolean `checkExactAlarmPermission` folds `unreadable` into `false`,
        // and the shell used to read that as a refusal: a user who had already
        // granted the exact-alarm permission was told, on every resume, to go and
        // grant it. A read that could not answer is not a denial, and the reconcile
        // that follows is what actually arms the alarms.
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('unreadable');
        renderApp();
        await settle();

        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
        // The schedule still gets reconciled - a read that failed is not a reason
        // to stop trying to arm anything.
        await waitFor(() => expect(NotificationService.reconcileNotifications).toHaveBeenCalled());

        await fireResume();

        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
    });

    it('waits out the debounce before the first reconcile instead of racing a wall clock', async () => {
        // The reconcile is debounced by 250ms. Under a real timer the assertion
        // below had to out-wait that delay inside a 1s `waitFor`, which is exactly
        // the wall-clock dependency the harness is meant to avoid. Faking the
        // timers makes "not yet" and "now" both explicit.
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();

        renderApp();
        await act(async () => {
            await Promise.resolve();
        });

        expect(reconcile).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(NOTIFICATION_RECONCILE_DEBOUNCE_MS);
        });

        expect(reconcile).toHaveBeenCalledTimes(1);
    });

    it('keeps the reconcile serialised when resume lands mid-pass', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        const resolvers: Array<() => void> = [];
        reconcile.mockClear();
        reconcile.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolvers.push(() => resolve({ success: true }));
                }),
        );

        renderApp();
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(1);

        await fireResume();
        // The resume pass is queued behind the in-flight one rather than racing it.
        expect(reconcile).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolvers[0]?.();
            await Promise.resolve();
        });
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(2);

        await act(async () => {
            resolvers[1]?.();
            await Promise.resolve();
        });
        await flushNotificationPasses();

        // Exactly one follow-up pass, not a burst.
        expect(reconcile).toHaveBeenCalledTimes(2);
    });

    it('reconciles notifications again on resume instead of only re-reading the permission', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();

        renderApp();
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(1);

        await fireResume();
        await flushNotificationPasses();

        expect(reconcile).toHaveBeenCalledTimes(2);

        // Still one serialised pass per resume, not a burst.
        await act(async () => {
            await Promise.resolve();
        });
        expect(reconcile).toHaveBeenCalledTimes(2);
    });

    it('supersedes the pass that is already armed instead of running it alongside the new one', async () => {
        // Two requests inside one debounce window must collapse into a single
        // pass. Without the generation guard the armed pass kept running with
        // whatever it had captured, so a resume during a data change produced two
        // reconciles for the same day.
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();

        renderApp();
        // Long enough for the data to land and arm the first pass, short enough
        // that the pass is still pending.
        await act(async () => {
            await Promise.resolve();
        });
        expect(reconcile).not.toHaveBeenCalled();

        await fireResume();
        await flushNotificationPasses();

        expect(reconcile).toHaveBeenCalledTimes(1);
        const [, , reconciledDay] = reconcile.mock.calls[0] ?? [];
        expect(reconciledDay).toBeTruthy();
    });

    it('drops the pass it was given nothing coherent to schedule', async () => {
        // The `resume` handler and the data effect share one callback, and both
        // of them can arrive with no coherent day to reconcile. That case has to
        // clear the pending debounce and bump the generation rather than return
        // early and leave a pass armed with the day the user just left.
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        let release: (value: null) => void = () => undefined;
        vi.mocked(loadFromNativeStorage).mockReturnValueOnce(
            new Promise<null>((resolve) => {
                release = resolve;
            }),
        );

        renderApp();
        await act(async () => {
            await Promise.resolve();
        });
        // Nothing coherent yet, so nothing is armed and nothing may run.
        await flushNotificationPasses();
        expect(reconcile).not.toHaveBeenCalled();

        // A resume that still has nothing to schedule must stay silent.
        await fireResume();
        await flushNotificationPasses();
        expect(reconcile).not.toHaveBeenCalled();

        // Once the day does load, the very next pass is the only one.
        await act(async () => {
            release(null);
            await Promise.resolve();
        });
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(1);
    });

    it('still reconciles when the exact-alarm read rejects, without claiming a refusal', async () => {
        // A rejected bridge used to escape `onForeground` as an unhandled
        // rejection: the reconcile never ran and the prompt was never re-evaluated.
        // It is also not a refusal. The prompt is for a device that has actually
        // said no, and a user whose grant simply could not be read would be told,
        // on every resume, to go and grant a permission they already hold.
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        vi.mocked(NotificationService.getExactAlarmState).mockRejectedValueOnce(new Error('bridge unavailable'));

        renderApp();
        await settle();

        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
        await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    });

    it('does not reconcile on resume while the loaded day still lags the selected one', async () => {
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        let release: (value: null) => void = () => undefined;
        vi.mocked(loadFromNativeStorage).mockReturnValueOnce(
            new Promise<null>((resolve) => {
                release = resolve;
            }),
        );

        renderApp();
        await settle();
        // Data has not arrived, so there is nothing coherent to schedule.
        expect(reconcile).not.toHaveBeenCalled();

        await fireResume();
        expect(reconcile).not.toHaveBeenCalled();

        await act(async () => {
            release(null);
            await Promise.resolve();
        });
        await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    });

    it('surfaces a reconcile failure instead of reporting armed reminders it does not have', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        reconcile.mockResolvedValue({ success: false, error: 'Exact alarm permission not granted' });

        renderApp();
        await flushNotificationPasses();

        // A failed pass used to be discarded: the UI carried on as though every
        // reminder were armed while nothing was scheduled at all.
        expect(screen.getByText(/Exact alarm permission not granted/)).toBeInTheDocument();
    });

    it('says nothing on a reconcile that armed everything', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        reconcile.mockResolvedValue({ success: true });

        renderApp();
        await flushNotificationPasses();

        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('reports an inexact alarm, and only once per window', async () => {
        // A downgrade is a success the plugin resolved, and its `warning` is the
        // only place it is ever stated. Dropping it made a reminder that can
        // arrive minutes late look like one that will arrive on time.
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        reconcile.mockResolvedValue({ success: true, inexact: true, warning: 'AlarmManager downgrade' });

        renderApp();
        await flushNotificationPasses();

        expect(screen.getByText(/may deliver some reminders late/i)).toBeInTheDocument();
        expect(screen.getByText(/AlarmManager downgrade/)).toBeInTheDocument();

        // A second failing pass inside the window must not re-nag: the pass runs
        // on every data change and on every resume.
        await fireResume();
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(2);
        expect(screen.getAllByText(/may deliver some reminders late/i)).toHaveLength(1);
    });

    it('stays silent about a pass the user has already moved on from', async () => {
        // The pass runs against a day, and the bridge call can take seconds. If
        // the user changes day - or the app resumes - while it is in flight, the
        // result describes something they are no longer looking at. Reporting it
        // claims the app failed at yesterday's reminders, and it spends the
        // rate-limit window, so the failure that is still current is the one
        // that gets swallowed.
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        const resolvers: Array<() => void> = [];
        reconcile.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolvers.push(() => resolve({ success: false, error: 'Exact alarm permission not granted' }));
                }),
        );

        renderApp();
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(1);

        // Supersedes the in-flight pass without waiting for it.
        await fireResume();
        await act(async () => {
            resolvers[0]?.();
            await Promise.resolve();
        });
        await flushNotificationPasses();
        expect(reconcile).toHaveBeenCalledTimes(2);

        expect(screen.queryByText(/Exact alarm permission not granted/)).not.toBeInTheDocument();

        // ...and the pass that *is* current still gets to say so, which is the
        // half that matters: a silent shell is not a fixed shell.
        await act(async () => {
            resolvers[1]?.();
            await Promise.resolve();
        });
        await flushNotificationPasses();
        expect(screen.getByText(/Exact alarm permission not granted/)).toBeInTheDocument();
    });

    it('does not re-report an inexact downgrade for a pass it has superseded either', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();
        const resolvers: Array<() => void> = [];
        reconcile.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolvers.push(() => resolve({ success: true, inexact: true, warning: 'AlarmManager downgrade' }));
                }),
        );

        renderApp();
        await flushNotificationPasses();
        await fireResume();
        await act(async () => {
            resolvers[0]?.();
            await Promise.resolve();
        });
        await flushNotificationPasses();

        expect(screen.queryByText(/may deliver some reminders late/i)).not.toBeInTheDocument();
    });

    it('stops reconciling after the shell unmounts', async () => {
        useDebounceTimers();
        const reconcile = vi.mocked(NotificationService.reconcileNotifications);
        reconcile.mockClear();

        const view = renderApp();
        await act(async () => {
            await Promise.resolve();
        });

        view.unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(NOTIFICATION_RECONCILE_DEBOUNCE_MS * 8);
        });

        // A debounce that survived the unmount would arm reminders for a shell
        // that no longer exists.
        expect(reconcile).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('re-prompts for exact-alarm access after the cooldown instead of suppressing it forever', async () => {
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('denied');

        renderApp();

        expect(await screen.findByRole('dialog', { name: 'Alarm Permission Needed' })).toBeInTheDocument();
    });

    it('records when the exact-alarm prompt was dismissed, then honours the cooldown', async () => {
        const user = createUser();
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('denied');
        const first = renderApp();

        const dialog = await screen.findByRole('dialog', { name: 'Alarm Permission Needed' });
        const before = Date.now();
        await user.click(within(dialog).getByRole('button', { name: 'Later' }));
        const stampedAt = Number.parseInt(localStorage.getItem(ALARM_PERMISSION_PROMPTED_AT_KEY) ?? '', 10);
        expect(Number.isFinite(stampedAt)).toBe(true);
        expect(stampedAt).toBeGreaterThanOrEqual(before);
        first.unmount();

        // A fresh mount inside the cooldown stays quiet instead of nagging.
        renderApp();
        await waitFor(() =>
            expect(vi.mocked(NotificationService.getExactAlarmState).mock.calls.length).toBeGreaterThan(1),
        );
        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
    });

    it('offers the exact-alarm prompt again once the cooldown has lapsed', async () => {
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('denied');
        const COOLDOWN_MS = 24 * 60 * 60 * 1000;
        localStorage.setItem(ALARM_PERMISSION_PROMPTED_AT_KEY, String(Date.now() - COOLDOWN_MS - 1));

        renderApp();

        expect(await screen.findByRole('dialog', { name: 'Alarm Permission Needed' })).toBeInTheDocument();
    });

    it('treats a dismissal stamp from the future as untrustworthy rather than as a fresh cooldown', async () => {
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('denied');
        // A device clock correction or a restored backup can leave a stamp ahead of
        // "now". Trusting it would silence the prompt until the clock caught up.
        localStorage.setItem(ALARM_PERMISSION_PROMPTED_AT_KEY, String(Date.now() + 60_000));

        renderApp();

        expect(await screen.findByRole('dialog', { name: 'Alarm Permission Needed' })).toBeInTheDocument();
    });

    it('honours the cooldown on resume without re-stamping it', async () => {
        const user = createUser();
        const readState = vi.mocked(NotificationService.getExactAlarmState);
        readState.mockResolvedValue('denied');
        const first = renderApp();

        const dialog = await screen.findByRole('dialog', { name: 'Alarm Permission Needed' });
        await user.click(within(dialog).getByRole('button', { name: 'Later' }));
        const stampedAt = localStorage.getItem(ALARM_PERMISSION_PROMPTED_AT_KEY);
        first.unmount();

        renderApp();
        await settle();
        await fireResume();
        expect(readState).toHaveBeenCalled();

        // Resume inside the cooldown must not renew the stamp, or the prompt would
        // be suppressed forever.
        expect(localStorage.getItem(ALARM_PERMISSION_PROMPTED_AT_KEY)).toBe(stampedAt);
        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
    });

    it('does not prompt when the exact-alarm permission is already granted', async () => {
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('granted');

        renderApp();
        await settle();

        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
    });

    it('does not prompt on a platform where exact alarms are not a question', async () => {
        // `not-applicable` is not `granted`: nobody made a grant, the platform
        // simply does not ask. Folding it into a refusal would put an
        // un-actionable prompt in front of every user off Android.
        vi.mocked(NotificationService.getExactAlarmState).mockResolvedValue('not-applicable');

        renderApp();
        await settle();
        await fireResume();

        expect(screen.queryByRole('dialog', { name: 'Alarm Permission Needed' })).not.toBeInTheDocument();
    });

    it('names the loaded day, not the selected one, while a read is still in flight', async () => {
        // The charts plot the payload the provider has adopted, so the scope
        // sentence has to name that day. Passing the selected date instead named
        // a day the panels had not loaded yet, for the whole length of a slow
        // read.
        vi.mocked(loadFromNativeStorage).mockReturnValueOnce(new Promise<null>(() => undefined));

        renderApp();
        await settle();
        await navigateToRoute({ user: createUser(), linkName: /Stats/i, isReady: hasHeading(routeHeadings.stats) });

        // Nothing has been loaded, so the scope must not claim one.
        expect(screen.getByText('Daily charts cover no selected day.')).toBeInTheDocument();
    });

    it('derives the Target display from the total planned minutes', async () => {
        // The stored record has to name the day the shell asks for. The provider
        // reads the *selected* day, which is today, and refuses to adopt a
        // record filed under any other date - so a hard-coded fixture date
        // silently became "no data", and the header went back to reporting a
        // default plan instead of the one under test.
        const today = getTodayLocalDate();
        vi.mocked(loadFromNativeStorage).mockResolvedValueOnce({
            date: today,
            updatedAt: `${today}T10:00:00.000Z`,
            subjects: [
                { id: 1, name: 'Accounts', planned: '45', actual: '0', kpi: 'N', time: '', reminder: false },
                { id: 2, name: 'Economics', planned: '30', actual: '0', kpi: 'N', time: '', reminder: false },
            ],
            checklistItems: [],
            qualityChecks: [],
            dayRating: '',
            errors: [],
        });

        renderApp();
        // 45 + 30 = 75 minutes = 1.25h, which `formatHours` rounds to the nearest
        // tenth: `1.3h`. The rounding contract itself is pinned in `metrics.test.ts`;
        // what matters here is that the header sums the two rows before formatting.
        expect(await screen.findByText(/1\.3h/)).toBeInTheDocument();
    });

    it('renders the DatePicker', async () => {
        renderApp();
        expect((await screen.findAllByText(/Study Date/i)).length).toBeGreaterThan(0);
    });

    it('renders all subject inputs', async () => {
        renderApp();
        const subjectInputs = await screen.findAllByDisplayValue('New Subject');
        expect(subjectInputs.length).toBeGreaterThan(0);
    });

    it('updates subject actual time', async () => {
        renderApp();
        const inputs = await screen.findAllByPlaceholderText('0');
        const actualInput = inputs[0];
        if (!actualInput) {
            return;
        }
        fireEvent.change(actualInput, { target: { value: '45' } });
        expect((actualInput as HTMLInputElement).value).toBe('45');
    });

    it('exposes one level-one heading per route plus banner, main and navigation landmarks', async () => {
        renderApp();
        await settle();

        expect(screen.getByRole('banner')).toBeInTheDocument();
        expect(screen.getByRole('main')).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Study tracker' })).toBeInTheDocument();
    });

    it('renders the Review page with checklist', async () => {
        const user = createUser();
        renderApp();

        await navigateToRoute({ user, linkName: /Review/i, isReady: hasHeading('Review') });

        expect(screen.getByRole('heading', { name: 'Output Checklist' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Quality Check' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Error Log' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Review/i })).toHaveAttribute('aria-current', 'page');
    });

    it('renders the Stats page with a textual chart summary and data table', async () => {
        const user = createUser();
        renderApp();

        await navigateToRoute({ user, linkName: /Stats/i, isReady: hasHeading('Study statistics') });

        expect(screen.getAllByRole('img', { name: /minutes studied out of/i })).toHaveLength(2);
        expect(screen.getByRole('table', { name: /Study metrics by subject/i })).toBeInTheDocument();
        expect(screen.getByRole('table', { name: /Daily study minutes/i })).toBeInTheDocument();
    });

    it('renders the Focus page', async () => {
        const user = createUser();
        renderApp();

        await navigateToRoute({ user, linkName: /Focus/i, isReady: hasHeading('Focus') });

        // Both the countdown and the in-built alarm expose a start control.
        expect(screen.getAllByRole('button', { name: /start/i }).length).toBeGreaterThan(0);
    });

    it('redirects unknown routes to the tracker', async () => {
        renderApp(['/does-not-exist']);

        const committed = await waitForRouteCommit(hasHeading('Study tracker'));
        expect(committed).toBe(true);
        expect(screen.getByRole('heading', { level: 1, name: 'Study tracker' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1, name: 'Review' })).not.toBeInTheDocument();
    });

    it.each(['/deep/unknown/path', '/tracker/extra', '/stats/2024', '/focus/1/2/3'])(
        'redirects the unmatched path %s to the tracker exactly once',
        async (unknownPath) => {
            renderApp([unknownPath]);

            const committed = await waitForRouteCommit(hasHeading(routeHeadings.tracker));
            expect(committed).toBe(true);
            expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
            expect(screen.getByRole('link', { name: /Tracker/i })).toHaveAttribute('aria-current', 'page');
        },
    );

    it('resolves a differently cased path to its route instead of bouncing it off the wildcard', async () => {
        // `react-router` compiles every route pattern case-insensitively, so
        // `/FOCUS` is a genuine hit on the focus route rather than an unknown
        // path. The wildcard must not fight that, and a cased URL must still land
        // on one route with one heading.
        renderApp(['/FOCUS']);

        const committed = await waitForRouteCommit(hasHeading(routeHeadings.focus));
        expect(committed).toBe(true);
        expect(screen.getByRole('heading', { level: 1, name: routeHeadings.focus })).toBeInTheDocument();
        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Focus/i })).toHaveAttribute('aria-current', 'page');
    });

    it('keeps the router usable after a wildcard redirect', async () => {
        const user = createUser();
        renderApp(['/nope']);

        expect(await waitForRouteCommit(hasHeading(routeHeadings.tracker))).toBe(true);

        // A `replace` redirect must leave a working router, not a dead one.
        await navigateToRoute({ user, linkName: /Stats/i, isReady: hasHeading(routeHeadings.stats) });
        expect(screen.getByRole('heading', { level: 1, name: routeHeadings.stats })).toBeInTheDocument();
    });

    it('renders exactly one main landmark on every route', async () => {
        const user = createUser();
        renderApp();
        await settle();

        // The shell owns the landmark structure; the route owns its own
        // top-level heading. `queryAll*` rather than `getAll*` because a
        // zero count has to be an assertion, not a thrown lookup error.
        const routeReady = (extra: () => boolean) => () => isRouteSettled() && extra();
        const routes: Array<[RegExp, () => boolean, string]> = [
            [/Tracker/i, routeReady(hasHeading(routeHeadings.tracker)), routeHeadings.tracker],
            [/Todo/i, routeReady(hasHeading(routeHeadings.todo)), routeHeadings.todo],
            [/Review/i, routeReady(hasHeading(routeHeadings.review)), routeHeadings.review],
            [/Stats/i, routeReady(hasHeading(routeHeadings.stats)), routeHeadings.stats],
            [/Focus/i, routeReady(hasHeading(routeHeadings.focus)), routeHeadings.focus],
        ];

        for (const [linkName, isReady, heading] of routes) {
            await navigateToRoute({ user, linkName, isReady });
            expect(screen.getAllByRole('main')).toHaveLength(1);
            expect(screen.getByRole('banner')).toBeInTheDocument();
            expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
            // Every route ships exactly one level-one heading of its own: the
            // shell's title is a paragraph, so a second one would mean the route
            // and the shell are both claiming the page title.
            const levelOne = screen.queryAllByRole('heading', { level: 1 });
            expect(levelOne).toHaveLength(1);
            expect(levelOne[0]).toHaveAccessibleName(heading);
        }
    });

    describe('per-route error boundaries', () => {
        /**
         * Every test in this block makes a route throw on purpose, and React reports
         * a caught render error twice: the raw throw, which jsdom re-raises as an
         * uncaught `error` event on `window`, and the "The above error occurred in
         * <X>" summary. Both are the expected outcome of the test rather than a
         * finding, and left in place they were the only stderr a clean run produced -
         * forty lines of it, which is exactly the noise that hides a real warning.
         *
         * The suppression is scoped to this block and undone in `afterEach`, so a
         * React warning anywhere else in the suite still reaches `console.error` and
         * fails the run. `leaves the error log alone outside this block` below pins
         * that.
         */
        let restoreErrorLog: (() => void) | undefined;
        beforeEach(() => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const swallow = (event: ErrorEvent) => {
                event.preventDefault();
            };
            window.addEventListener('error', swallow);
            restoreErrorLog = () => {
                window.removeEventListener('error', swallow);
                consoleSpy.mockRestore();
            };
        });
        afterEach(() => {
            restoreErrorLog?.();
            restoreErrorLog = undefined;
        });

        const routes: Array<[RegExp, string]> = [
            [/Review/i, 'review'],
            [/Stats/i, 'stats'],
            [/Todo/i, 'todo'],
            [/Focus/i, 'focus'],
        ];

        it.each(routes)('contains a throwing %s route inside its own boundary', async (linkName, route) => {
            const user = createUser();
            failingRoutes.add(route);
            renderApp();
            await user.click(screen.getByRole('link', { name: linkName }));

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(/Something went wrong/i);
            expect(alert).toHaveTextContent(new RegExp(`${route} route exploded`));
            // The shell survives, so navigation is still possible.
            expect(screen.getByRole('banner')).toBeInTheDocument();
            expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
            expect(screen.getAllByRole('main')).toHaveLength(1);
        });

        it('recovers a route after its error boundary catches', async () => {
            const user = createUser();
            failingRoutes.add('stats');
            renderApp();
            await user.click(screen.getByRole('link', { name: /Stats/i }));
            expect(await screen.findByRole('alert')).toBeInTheDocument();

            // Every route renders the same boundary component in the same tree
            // position, so without a per-route key React reused one instance for
            // all of them: the fallback latched on and every later navigation -
            // including this one - kept rendering the same error panel.
            failingRoutes.delete('stats');
            await navigateToRoute({ user, linkName: /Tracker/i, isReady: hasHeading(routeHeadings.tracker) });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 1, name: routeHeadings.tracker })).toBeInTheDocument();

            await navigateToRoute({ user, linkName: /Stats/i, isReady: hasHeading(routeHeadings.stats) });

            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByRole('table', { name: /Study metrics by subject/i })).toBeInTheDocument();
        });

        it('keeps a second route healthy while the first one is showing its fallback', async () => {
            const user = createUser();
            failingRoutes.add('stats');
            renderApp();
            await user.click(screen.getByRole('link', { name: /Stats/i }));
            expect(await screen.findByRole('alert')).toBeInTheDocument();

            // The failing boundary must not be a shared one: the review route
            // still has to render its own content.
            await navigateToRoute({ user, linkName: /Review/i, isReady: hasHeading(routeHeadings.review) });
            expect(screen.getByRole('heading', { name: 'Output Checklist' })).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('lets two routes fail one after the other without the first one latching', async () => {
            // The regression this pins is a *missing key*, not a broken
            // boundary: with one shared instance, the first throw leaves the
            // fallback latched and the second route shows a panel describing a
            // page the user never opened.
            const user = createUser();
            failingRoutes.add('todo');
            renderApp();

            await user.click(screen.getByRole('link', { name: /Todo/i }));
            const firstAlert = await screen.findByRole('alert');
            expect(firstAlert).toHaveTextContent(/todo route exploded/);

            failingRoutes.delete('todo');
            failingRoutes.add('focus');
            await user.click(screen.getByRole('link', { name: /Focus/i }));

            const secondAlert = await screen.findByRole('alert');
            expect(secondAlert).toHaveTextContent(/focus route exploded/);
            expect(secondAlert).not.toHaveTextContent(/todo route exploded/);

            failingRoutes.delete('focus');
            await navigateToRoute({ user, linkName: /Tracker/i, isReady: hasHeading(routeHeadings.tracker) });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    it('leaves the error log alone outside the per-route error boundary block', () => {
        // The pin on that block's suppression: it is installed only for tests that
        // throw on purpose, and it is removed again, so a genuine uncaught error
        // anywhere else in the suite is still reported. Dispatching one here and
        // finding it *not* default-prevented is the observable half; the console
        // spy is restored by the same `afterEach` as this listener. Declared outside
        // the `describe`, so the block's own `beforeEach` is not in effect.
        const event = new ErrorEvent('error', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it('keeps unsaved review edits when navigating away and back', async () => {
        const user = createUser();
        renderApp();

        await navigateToRoute({ user, linkName: /Review/i, isReady: hasHeading('Review') });
        const objective = screen.getByRole('textbox', { name: 'Checklist objective 1' });
        await user.clear(objective);
        await user.type(objective, 'Revise ledgers');
        expect(objective).toHaveValue('Revise ledgers');

        await navigateToRoute({ user, linkName: /Tracker/i, isReady: hasHeading('Study tracker') });
        await navigateToRoute({ user, linkName: /Review/i, isReady: hasHeading('Review') });

        expect(screen.getByRole('textbox', { name: 'Checklist objective 1' })).toHaveValue('Revise ledgers');
    });

    describe('header overflow menu', () => {
        /**
         * The control a forward Tab out of the open menu is supposed to land on.
         *
         * Mirrors what the menu does, so the assertion is about *how many steps*
         * the caret moved rather than about which control a particular viewport
         * happens to render first.
         */
        const nextFocusableAfter = (panel: HTMLElement): Element | undefined => {
            const focusable = getFocusableElements(document);
            const lastInside = focusable.filter((element) => panel.contains(element)).at(-1);
            return lastInside === undefined ? undefined : focusable[focusable.indexOf(lastInside) + 1];
        };

        const openMenu = async () => {
            const user = createUser();
            renderApp();
            await settle();
            const trigger = screen.getByRole('button', { name: 'More options' });
            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            expect(trigger).not.toHaveAttribute('aria-controls');
            await user.click(trigger);
            return { user, trigger };
        };

        it('exposes a labelled vertical menu and moves focus into it', async () => {
            const { trigger } = await openMenu();

            const menu = screen.getByRole('menu', { name: 'More options' });
            expect(trigger).toHaveAttribute('aria-expanded', 'true');
            expect(trigger).toHaveAttribute('aria-controls', 'header-more-menu');
            expect(menu).toHaveAttribute('aria-orientation', 'vertical');
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus());
        });

        it('walks the menu with arrow keys, Home and End', async () => {
            const { user } = await openMenu();
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus());

            await user.keyboard('{ArrowDown}');
            expect(screen.getByRole('menuitem', { name: 'Restore' })).toHaveFocus();
            await user.keyboard('{End}');
            expect(screen.getByRole('menuitem', { name: /Check Updates/i })).toHaveFocus();
            await user.keyboard('{ArrowDown}');
            expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus();
            await user.keyboard('{Home}');
            expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus();
        });

        it('closes on Escape, restores focus, and stops announcing itself as expanded', async () => {
            const { user, trigger } = await openMenu();
            await waitFor(() => expect(screen.getByRole('menu', { name: 'More options' })).toBeInTheDocument());

            await user.keyboard('{Escape}');

            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            expect(trigger).toHaveFocus();
            await waitFor(() => expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument());
        });

        it('closes when Tab moves focus out of the menu', async () => {
            const { user, trigger } = await openMenu();
            const menu = await screen.findByRole('menu', { name: 'More options' });
            // Focus is being moved by hand, so the browser's own Tab must not
            // run as well: it moved focus a second time, in the same direction,
            // and the second move won - so Tab left the caret two controls past
            // the menu instead of one, and nobody could tell from the menu
            // merely having closed.
            const expected = nextFocusableAfter(menu);

            await user.keyboard('{Tab}');

            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            expect(document.activeElement).toBe(expected);
            await waitFor(() => expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument());
        });

        it('hands focus backwards on Shift+Tab rather than jumping forwards', async () => {
            const { user, trigger } = await openMenu();
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus());

            await user.keyboard('{Shift>}{Tab}{/Shift}');

            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            // A backwards Tab that always moved forwards dropped the user past
            // the control they had just opened the menu from, so the one way out
            // that a keyboard user reaches for first sent them the wrong way.
            expect(trigger).toHaveFocus();
            await waitFor(() => expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument());
        });

        it('closes when clicking outside the menu', async () => {
            const { user, trigger } = await openMenu();
            await waitFor(() => expect(screen.getByRole('menu', { name: 'More options' })).toBeInTheDocument());

            await user.click(document.body);

            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            await waitFor(() => expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument());
        });

        it('runs the backup action, closes the menu and hands focus back to the trigger', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(downloadBackup).mockResolvedValue(2);

            const trigger = screen.getByRole('button', { name: 'More options' });
            await user.click(trigger);
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Backup' })).toBeInTheDocument());
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Backup' })).toHaveFocus());
            await user.click(screen.getByRole('menuitem', { name: 'Backup' }));

            expect(await screen.findByText('Backup downloaded! 2 days exported.')).toBeInTheDocument();
            expect(trigger).toHaveAttribute('aria-expanded', 'false');
            // The panel unmounts while it still holds focus; without an explicit
            // hand-off the caret lands on <body> and the tab order restarts.
            expect(trigger).toHaveFocus();
        });
    });

    describe('backup and restore accuracy', () => {
        const openMenuItem = async (user: ReturnType<typeof createUser>, name: RegExp | string) => {
            await user.click(screen.getByRole('button', { name: 'More options' }));
            await waitFor(() => expect(screen.getByRole('menuitem', { name })).toBeInTheDocument());
            await user.click(screen.getByRole('menuitem', { name }));
        };

        it('reports how many days the backup actually contains', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(downloadBackup).mockResolvedValue(3);

            await openMenuItem(user, 'Backup');

            expect(await screen.findByText('Backup downloaded! 3 days exported.')).toBeInTheDocument();
        });

        it('uses the singular form for a one-day backup', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(downloadBackup).mockResolvedValue(1);

            await openMenuItem(user, 'Backup');

            // "1 days exported" is the kind of message that makes a user doubt
            // the count they are being shown.
            expect(await screen.findByText('Backup downloaded! 1 day exported.')).toBeInTheDocument();
        });

        it('warns instead of claiming success when the backup holds no days', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(downloadBackup).mockResolvedValue(0);

            await openMenuItem(user, 'Backup');

            // "Backup downloaded! 0 days exported." read as a success even though
            // the produced file contained no study data at all.
            const warning = await screen.findByRole('alert');
            expect(warning).toHaveTextContent(/No saved days to export yet/i);
            expect(screen.queryByText(/Backup downloaded!/)).not.toBeInTheDocument();
        });

        it('reports a failed backup', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(downloadBackup).mockRejectedValue(new Error('disk full'));

            await openMenuItem(user, 'Backup');

            expect(await screen.findByText(/Export failed/)).toBeInTheDocument();
        });

        it('reports how many records the import applied, and keeps the toast on screen', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(handleFileImport).mockResolvedValue(2);
            const reload = vi.fn();
            const originalLocation = window.location;
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { ...originalLocation, reload },
            });

            try {
                const input = screen.getByLabelText('Backup file') as HTMLInputElement;
                const file = new File(['{}'], 'backup.json', { type: 'application/json' });
                await user.upload(input, file);

                expect(await screen.findByText('Import successful. 2 records applied.')).toBeInTheDocument();
                // `importData` already reloads the day and the todo list; a full
                // page reload destroyed the confirmation before it could be read.
                expect(reload).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
            }
        });

        it('uses the singular form for a single imported record', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(handleFileImport).mockResolvedValue(1);

            const input = screen.getByLabelText('Backup file');
            await user.upload(input, new File(['{}'], 'backup.json', { type: 'application/json' }));

            expect(await screen.findByText('Import successful. 1 record applied.')).toBeInTheDocument();
        });

        it('warns instead of claiming success when the import applied nothing', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(handleFileImport).mockResolvedValue(0);

            const input = screen.getByLabelText('Backup file');
            await user.upload(input, new File(['{}'], 'backup.json', { type: 'application/json' }));

            expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was imported/i);
            expect(screen.queryByText(/Import successful/)).not.toBeInTheDocument();
        });

        it('reports a rejected import and clears the picker so the same file can be retried', async () => {
            const user = createUser();
            renderApp();
            await settle();
            vi.mocked(handleFileImport).mockRejectedValue(new Error('Invalid JSON file'));

            const input = screen.getByLabelText('Backup file') as HTMLInputElement;
            await user.upload(input, new File(['{'], 'broken.json', { type: 'application/json' }));

            expect(await screen.findByText(/Import failed/)).toBeInTheDocument();
            // Leaving the value in place means a second pick of the same file
            // fires no `change` event and the retry silently does nothing.
            expect(input.value).toBe('');

            vi.mocked(handleFileImport).mockResolvedValue(1);
            await user.upload(input, new File(['{}'], 'broken.json', { type: 'application/json' }));
            expect(await screen.findByText('Import successful. 1 record applied.')).toBeInTheDocument();
        });
    });

    describe('global alarm overlay', () => {
        const fireNotificationReceived = async (actionType: string) => {
            const initListeners = vi.mocked(NotificationService.initListeners);
            await settle();
            const lastCall = initListeners.mock.calls.at(-1);
            expect(lastCall).toBeDefined();
            const onNotification = lastCall?.[1] as
                | ((data: { originalId: string; actionType: string }) => void)
                | undefined;
            expect(onNotification).toBeDefined();
            await act(async () => {
                onNotification?.({ originalId: '1', actionType });
            });
        };

        const fireNotificationAction = async (type: string) => {
            const initListeners = vi.mocked(NotificationService.initListeners);
            await settle();
            const onAction = initListeners.mock.calls.at(-1)?.[0] as
                | ((data: { originalId: string; type: string }) => void)
                | undefined;
            expect(onAction).toBeDefined();
            await act(async () => {
                onAction?.({ originalId: '1', type });
            });
        };

        it('cancels the vibration pattern when the alarm is stopped', async () => {
            // `vibrate(0)` is the only thing that actually cancels the pattern
            // `playGlobalAlarm` started. Stopping the audio and hiding the overlay
            // left the device buzzing out the rest of it, which is the one part of
            // the alarm the user cannot see and cannot reason about.
            const user = createUser();
            const vibrate = vi.mocked(navigator.vibrate);
            vibrate.mockClear();
            renderApp();
            await settle();

            await fireNotificationReceived('SYSTEM');
            expect(await screen.findByRole('dialog', { name: 'Alarm!' })).toBeInTheDocument();
            expect(vibrate).toHaveBeenCalledWith([1000, 500, 1000, 500, 1000, 500, 1000]);

            await user.click(screen.getByRole('button', { name: /stop alarm/i }));

            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alarm!' })).not.toBeInTheDocument());
            expect(vibrate).toHaveBeenCalledWith(0);
        });

        it('stops an alarm from a notification tap, and that tap silences the vibration too', async () => {
            // Any action performed on a ringing notification is the user
            // dismissing it, so the app-level alarm always stops. This used to
            // compare the action type against a `'FOCUS_ALARM'` value that nothing
            // registers with the plugin, so the branch was unreachable and the
            // comparison was the only thing keeping the stop from running.
            const vibrate = vi.mocked(navigator.vibrate);
            vibrate.mockClear();
            renderApp();
            await settle();

            await fireNotificationReceived('ALARM_ACTIONS');
            expect(await screen.findByRole('dialog', { name: 'Alarm!' })).toBeInTheDocument();

            await fireNotificationAction('todo');

            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alarm!' })).not.toBeInTheDocument());
            expect(vibrate).toHaveBeenCalledWith(0);
        });

        it('takes the keyboard from an open dialog while it is ringing, and gives it back', async () => {
            // The overlay paints above every layer, but a dialog that still believes
            // it is the top layer installs its own `keydown`/`focusin` handlers: one
            // Escape would stop the alarm *and* close the dialog, and the dialog's
            // focus containment would pull the caret out of the stop button. The
            // alarm joins the shared modal stack, so neither happens.
            const user = createUser();
            renderApp();
            await settle();

            await user.click(screen.getByRole('button', { name: 'More options' }));
            const menu = await screen.findByRole('menu');
            expect(menu).toBeInTheDocument();

            await fireNotificationReceived('SYSTEM');
            const stopButton = await screen.findByRole('button', { name: /stop alarm/i });
            await waitFor(() => expect(stopButton).toHaveFocus());

            // Escape now belongs to the alarm alone, so the menu stays open.
            await act(async () => {
                stopButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });
            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alarm!' })).not.toBeInTheDocument());
            expect(screen.getByRole('menu')).toBeInTheDocument();
        });

        it('claims focus while it covers the page and hands it back when dismissed', async () => {
            const user = createUser();
            renderApp();
            await settle();
            const trigger = screen.getByRole('button', { name: 'More options' });
            trigger.focus();
            expect(trigger).toHaveFocus();

            await fireNotificationReceived('SYSTEM');

            const overlay = await screen.findByRole('dialog', { name: 'Alarm!' });
            expect(overlay).toHaveAttribute('aria-modal', 'true');
            const stopButton = within(overlay).getByRole('button', { name: /stop alarm/i });
            await waitFor(() => expect(stopButton).toHaveFocus());

            await user.click(stopButton);

            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alarm!' })).not.toBeInTheDocument());
            // Dismissing without restoring focus drops the caret on <body> and
            // restarts the tab sequence from the top of the page.
            expect(trigger).toHaveFocus();
        });

        it('lets Escape dismiss the overlay from its stop control', async () => {
            renderApp();
            await settle();
            await fireNotificationReceived('SYSTEM');

            const stopButton = await screen.findByRole('button', { name: /stop alarm/i });
            await waitFor(() => expect(stopButton).toHaveFocus());

            await act(async () => {
                stopButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });

            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alarm!' })).not.toBeInTheDocument());
        });

        it('keeps Tab inside the overlay it declares modal', async () => {
            const user = createUser();
            renderApp();
            await settle();
            const behind = screen.getByRole('link', { name: /Tracker/i });
            behind.focus();
            expect(behind).toHaveFocus();

            await fireNotificationReceived('SYSTEM');

            const overlay = await screen.findByRole('dialog', { name: 'Alarm!' });
            const stopButton = within(overlay).getByRole('button', { name: /stop alarm/i });
            await waitFor(() => expect(stopButton).toHaveFocus());

            // The overlay claims `aria-modal`, so the page behind it is supposed
            // to be unreachable. Without a loop, Tab walks straight out of the
            // dialog and into the very controls the dialog is covering.
            await user.tab();
            expect(stopButton).toHaveFocus();
            await user.tab({ shift: true });
            expect(stopButton).toHaveFocus();
            expect(overlay).toContainElement(document.activeElement as HTMLElement);
        });

        it('owns the ringing overlay for the focus-alarm source too, on the focus route', async () => {
            const user = createUser();
            renderApp(['/focus']);
            await waitForRouteCommit(hasHeading(routeHeadings.focus));

            await fireNotificationReceived('FOCUS_ALARM');

            // The shell is the single in-app owner. The focus card used to answer
            // this source and paint a `WAKE UP!` dialog of its own, so the user
            // got two `aria-modal` stop dialogs and two tones for one alarm - and
            // which of the two they had to press depended on the route.
            const overlay = await screen.findByRole('dialog', { name: 'Alarm!' });
            expect(screen.getAllByRole('dialog')).toHaveLength(1);
            expect(overlay).toHaveAttribute('aria-modal', 'true');

            // Navigating away must not hand the alarm to anything: there is nothing
            // else that can render it.
            await navigateToRoute({ user, linkName: /Tracker/i, isReady: hasHeading(routeHeadings.tracker) });
            expect(await screen.findByRole('dialog', { name: 'Alarm!' })).toBeInTheDocument();
            expect(screen.getAllByRole('dialog')).toHaveLength(1);
        });

        it('owns the ringing overlay however the path is spelled', async () => {
            // `react-router` matches every route pattern case-insensitively, so
            // `/FOCUS/` is genuinely the focus route. The ownership decision used
            // to compare the raw path against `'/focus'`, so which dialog a user
            // got - and which control they had to press to stop the alarm -
            // depended on the capitalisation of the URL.
            renderApp(['/FOCUS/']);
            expect(await waitForRouteCommit(hasHeading(routeHeadings.focus))).toBe(true);

            await fireNotificationReceived('FOCUS_ALARM');

            expect(await screen.findByRole('dialog', { name: 'Alarm!' })).toBeInTheDocument();
            expect(screen.getAllByRole('dialog')).toHaveLength(1);
        });

        it('keeps a subject reminder on the focus route, which is not the focus route ringing', async () => {
            renderApp(['/focus']);
            expect(await waitForRouteCommit(hasHeading(routeHeadings.focus))).toBe(true);

            // A study reminder can fire while the user is looking at the focus
            // timer. It is the shell's alarm, so the shell has to show it - the
            // focus route has no in-built alarm ringing to stand in for it.
            await fireNotificationReceived('ALARM_ACTIONS');

            expect(await screen.findByRole('dialog', { name: 'Alarm!' })).toBeInTheDocument();
            expect(screen.queryByRole('dialog', { name: 'WAKE UP!' })).not.toBeInTheDocument();
        });
    });

    describe('persistence failures', () => {
        it('surfaces the error carried by a data persistence event', async () => {
            renderApp();
            await settle();

            await act(async () => {
                window.dispatchEvent(new CustomEvent('study-data-error', { detail: new Error('Disk full') }));
            });

            expect(await screen.findByText('Disk full')).toBeInTheDocument();
        });

        it('falls back to a generic persistence message when the event carries no error', async () => {
            renderApp();
            await settle();

            await act(async () => {
                window.dispatchEvent(new Event('study-data-error'));
            });

            expect(await screen.findByText(/Progress could not be saved/i)).toBeInTheDocument();
        });

        it('reports a persistence failure once per window instead of on every autosave tick', async () => {
            // A save that keeps failing is announced by the debounced flush, the
            // periodic flush, the page-hide flush and the date switcher. One
            // toast per attempt means a nag every ten seconds for as long as the
            // user leaves the app open - and three toasts are all that fit on
            // screen, so the newest one pushes the older copy away.
            renderApp();
            await settle();

            const fail = async (message: string) => {
                await act(async () => {
                    window.dispatchEvent(new CustomEvent('study-data-error', { detail: new Error(message) }));
                });
            };

            await fail('Disk full');
            expect(await screen.findByText('Disk full')).toBeInTheDocument();

            await fail('Disk full');
            await fail('Disk full');
            expect(screen.getAllByText('Disk full')).toHaveLength(1);

            // A different failure is not the same news, so it is not swallowed.
            await fail('Store unavailable');
            expect(screen.getByText('Store unavailable')).toBeInTheDocument();
        });

        it('reports a persistence failure again once its window has lapsed', async () => {
            renderApp();
            await settle();

            const fail = async () => {
                await act(async () => {
                    window.dispatchEvent(new CustomEvent('study-data-error', { detail: new Error('Disk full') }));
                });
            };
            await fail();
            expect(await screen.findByText('Disk full')).toBeInTheDocument();

            // The cooldown is measured against the clock, so moving past it is
            // the only way to prove the window closes at all.
            const nowSpy = vi.spyOn(Date, 'now');
            try {
                nowSpy.mockReturnValue(Date.now() + PERSISTENCE_NOTICE_COOLDOWN_MS);
                await fail();
                expect(screen.getAllByText('Disk full')).toHaveLength(2);
            } finally {
                nowSpy.mockRestore();
            }
        });

        it('reports a failure that comes back after a successful write', async () => {
            // The two windows are deliberately different lengths - the provider's
            // 30s event window and this 10s presentation window - and both used to
            // re-arm only on data change. The shell cannot infer recovery from the
            // failure events alone: it hears that something broke, never that
            // something worked afterwards. So a store that failed, recovered and
            // failed again a second later was reported as nothing at all, for the
            // rest of the window.
            renderApp();
            await settle();

            const fail = async () => {
                await act(async () => {
                    window.dispatchEvent(new CustomEvent('study-data-error', { detail: new Error('Disk full') }));
                });
            };

            await fail();
            expect(await screen.findByText('Disk full')).toBeInTheDocument();

            await act(async () => {
                window.dispatchEvent(new Event('study-data-recovered'));
            });
            await fail();

            expect(await screen.findAllByText('Disk full')).toHaveLength(2);
        });
    });

    describe('update flow', () => {
        it('reports a successful manual update check', async () => {
            const user = createUser();
            const { checkForUpdate } = await import('../services/updateService');
            vi.mocked(checkForUpdate).mockResolvedValue({ available: true, tag: 'v9.9.9' });

            renderApp();
            await settle();

            await user.click(screen.getByRole('button', { name: 'More options' }));
            await waitFor(() => expect(screen.getByRole('menuitem', { name: /Check Updates/i })).toBeInTheDocument());
            await user.click(screen.getByRole('menuitem', { name: /Check Updates/i }));

            expect(await screen.findByText('Update found: v9.9.9')).toBeInTheDocument();
        });

        it('reports when the app is already up to date', async () => {
            const user = createUser();
            const { checkForUpdate } = await import('../services/updateService');
            vi.mocked(checkForUpdate).mockResolvedValue({ available: false });

            renderApp();
            await settle();

            await user.click(screen.getByRole('button', { name: 'More options' }));
            await waitFor(() => expect(screen.getByRole('menuitem', { name: /Check Updates/i })).toBeInTheDocument());
            await user.click(screen.getByRole('menuitem', { name: /Check Updates/i }));

            expect(await screen.findByText('You are on the latest version')).toBeInTheDocument();
        });

        it('reports a failed manual update check', async () => {
            const user = createUser();
            const { checkForUpdate } = await import('../services/updateService');
            vi.mocked(checkForUpdate).mockRejectedValue(new Error('offline'));

            renderApp();
            await settle();

            await user.click(screen.getByRole('button', { name: 'More options' }));
            await waitFor(() => expect(screen.getByRole('menuitem', { name: /Check Updates/i })).toBeInTheDocument());
            await user.click(screen.getByRole('menuitem', { name: /Check Updates/i }));

            expect(await screen.findByText(/Unable to check for updates/)).toBeInTheDocument();
        });

        it('remembers a dismissed update version so it is not offered again', async () => {
            const user = createUser();
            const { checkForUpdate } = await import('../services/updateService');
            vi.mocked(checkForUpdate).mockResolvedValue({ available: true, tag: 'v9.9.9' });

            const first = renderApp();
            const dialog = await screen.findByRole('dialog', { name: 'Update Available' });
            await user.click(within(dialog).getByRole('button', { name: 'Remind Me Later' }));
            expect(localStorage.getItem('ignoredUpdateVersion')).toBe('v9.9.9');
            first.unmount();

            renderApp();
            await settle();
            expect(screen.queryByRole('dialog', { name: 'Update Available' })).not.toBeInTheDocument();
        });
    });
});
