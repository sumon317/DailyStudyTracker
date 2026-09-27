import { act, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { StrictMode, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import DataProvider from '../providers/DataProvider';
import ThemeProvider from '../providers/ThemeProvider';
import { ToastProvider } from '../providers/ToastProvider';

interface TestWrapperProps {
    children: ReactNode;
    initialEntries?: string[];
}

/**
 * The shell marks its route `Suspense` fallbacks with `data-route-loading`, so
 * "the route has committed" is observable without guessing at a heading: the
 * shell's `<main>` exists on every route, including the ones whose lazy chunk
 * has not arrived yet.
 */
const ROUTE_LOADING_ATTRIBUTE = 'data-route-loading';

/**
 * The marker every route-level `Suspense` fallback carries.
 *
 * `isRouteSettled` is the harness's readiness signal, so the wrapper's own
 * fallback has to speak the same language: a page whose *shell* is still loading
 * is no more committed than one whose route chunk has not arrived.
 */
export const ROUTE_LOADING_SELECTOR = '[data-route-loading]';

export function TestWrapper({ children, initialEntries }: TestWrapperProps) {
    return (
        <StrictMode>
            <MemoryRouter initialEntries={initialEntries}>
                <ThemeProvider>
                    <ToastProvider>
                        <DataProvider>
                            <Suspense
                                fallback={
                                    <div data-testid="loading" {...{ [ROUTE_LOADING_ATTRIBUTE]: 'shell' }}>
                                        Loading...
                                    </div>
                                }
                            >
                                {children}
                            </Suspense>
                        </DataProvider>
                    </ToastProvider>
                </ThemeProvider>
            </MemoryRouter>
        </StrictMode>
    );
}

/**
 * Route chunks are loaded with `React.lazy`. Under CPU contention the module
 * transform that backs a lazy route can take longer than a `findBy*` timeout,
 * which turns navigation assertions into wall-clock races. Resolving the very
 * same modules up front populates the `React.lazy` payload cache, so a later
 * route change settles on the microtask queue instead of on module I/O.
 */
const ROUTE_MODULES: Record<string, () => Promise<unknown>> = {
    tracker: () => import('../pages/TrackerPage'),
    review: () => import('../pages/ReviewPage'),
    stats: () => import('../pages/StatsPage'),
    todo: () => import('../pages/TodoPage'),
    focus: () => import('../pages/FocusPage'),
};

export async function preloadRouteModules(): Promise<void> {
    await Promise.all(Object.values(ROUTE_MODULES).map((load) => load()));
}

/**
 * Upper bound on the event-loop turns a single wait may burn.
 *
 * The bound exists so a route that is never going to commit fails with a
 * readable message instead of hanging. It is deliberately several times the
 * number of turns a healthy route needs, because the promise the contract makes
 * is "a slow machine slows the test down", not "a slow machine fails it": a
 * full-suite run fans out across one worker per test file, and a `React.lazy`
 * transform that took two turns there took twenty-five here, which turned every
 * navigation assertion in the suite into a coin flip that only lost under load.
 *
 * It cannot go much higher than this either. A turn is a whole event-loop
 * iteration, so the cost of a wait that is never going to succeed is the budget
 * itself: at a hundred turns that is a few hundred milliseconds idle and a
 * couple of seconds on a loaded machine, which is the right shape for a test
 * that is *meant* to fail.
 */
export const MAX_SUSPENSE_FLUSHES = 100;

/**
 * Extra `act` turns a tree that already looks ready is given.
 *
 * `React.lazy` suspends only on the *first* mount of a route chunk: every later
 * mount reads the cached payload synchronously, so the route is already on screen
 * the instant `render()` returns. A readiness check that short-circuits on its
 * very first poll therefore returns with no `act` turn at all, and every piece of
 * async work the mount kicked off - the data provider's startup read, the
 * notification bootstrap, the update check - resolves *between* assertions,
 * outside any `act` scope. React reports each of those as "an update ... was not
 * wrapped in act(...)", which buries the one warning a test should ever see under
 * hundreds that say nothing about the code under test.
 *
 * Three turns is deliberate headroom, not a guess at a magic number: a turn
 * drains the microtask queue *and* one macrotask, so any promise chain that does
 * not cross real I/O - which is every store and bridge call in this app - is
 * complete after the first one.
 */
const SETTLE_TURNS = 3;

export const ROUTE_SETTLE_TURNS = SETTLE_TURNS;

/**
 * Yields one macrotask.
 *
 * Draining microtasks alone is not enough to settle a route change: `React.lazy`
 * publishes its payload from a promise continuation, but React's own scheduler
 * and the dynamic `import()` transform both continue on the *task* queue. A
 * navigation that only ever turns the microtask queue can therefore sit
 * unresolved indefinitely, which is what made route assertions a race.
 *
 * Under fake timers a `setTimeout` would never fire, so the yield falls back to
 * a `MessageChannel` round trip, which fake timers leave alone.
 */
const yieldToTaskQueue = (): Promise<void> =>
    new Promise((resolve) => {
        if (!vi.isFakeTimers()) {
            setTimeout(resolve, 0);
            return;
        }
        if (typeof MessageChannel === 'function') {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(undefined);
            return;
        }
        resolve();
    });

/**
 * Yields one macrotask inside `act`, draining the microtask queue as it goes.
 */
const drainTurn = async (): Promise<void> => {
    await act(async () => {
        // A lazy chunk settles on the microtask queue and the scheduler that
        // renders it on the task queue, so each turn has to drain both.
        await Promise.resolve();
        await yieldToTaskQueue();
    });
};

/**
 * Drains pending `act` work until `isReady` reports the lazily loaded route has
 * committed. The bound is a number of event-loop turns, never wall-clock time,
 * so a slow machine slows the test down instead of failing it.
 *
 * Readiness is re-checked *after* every yield, because a caller that passes an
 * always-true predicate (the shell's `<main>` exists on every route) would
 * otherwise get a silent `true` and race the very commit it was waiting for.
 * The loop therefore always runs at least one turn and, once ready, gives the
 * tree `SETTLE_TURNS` more so the async work its mount started lands inside an
 * `act` scope rather than in the gap before the test's next assertion.
 */
export async function waitForRouteCommit(isReady: () => boolean): Promise<boolean> {
    let ready = false;
    for (let attempt = 0; attempt < MAX_SUSPENSE_FLUSHES; attempt += 1) {
        await drainTurn();
        ready = isReady();
        if (ready) {
            break;
        }
    }
    if (!ready) {
        return false;
    }
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
        await drainTurn();
        if (!isReady()) {
            // Unsettled again: something re-rendered the tree mid-drain, so the
            // commit this call was asked to observe is not stable. Reporting
            // `false` lets the caller fail on the route it was waiting for
            // instead of asserting against a half-committed one.
            return false;
        }
    }
    return true;
}

/** Drains the microtask queue once, inside `act`, without any readiness check. */
export async function flushMicrotasks(turns = 1): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

interface NavigateOptions {
    user: UserEvent;
    linkName: string | RegExp;
    isReady: () => boolean;
}

/**
 * Performs a real user navigation and waits (without a wall-clock timeout) for
 * the destination route to render.
 *
 * A route that never commits throws here. Swallowing that and letting the caller
 * continue turns a lazy-chunk regression into a confusing "element not found"
 * several assertions later, far from the navigation that caused it.
 */
export async function navigateToRoute({ user, linkName, isReady }: NavigateOptions): Promise<void> {
    await user.click(screen.getByRole('link', { name: linkName }));
    const committed = await waitForRouteCommit(isReady);
    if (!committed) {
        throw new Error(
            `Route for link ${String(linkName)} never committed within ${MAX_SUSPENSE_FLUSHES} turns. ` +
                'A route that is still on screen is the likely cause; one that is not means the chunk never resolved.',
        );
    }
}

export function createUser(): UserEvent {
    return userEvent.setup();
}

/** The shell's own title. It is in the header, so it renders before any route. */
export const SHELL_TITLE = /Daily Study Tracker/i;

/** True when no route is still resolving. */
export function isRouteSettled(): boolean {
    return document.querySelector(ROUTE_LOADING_SELECTOR) === null;
}

/**
 * Waits for the shell and the destination route.
 *
 * Waiting for the shell title alone is not enough: the header is outside the
 * route outlet, so it is on screen while the lazy route is still resolving. A
 * test that stops there asserts against a half-rendered page, which is a race
 * that only shows up on a loaded machine.
 *
 * Pass `heading` to additionally require a particular route heading. Every route
 * now ships one (see `routeHeadings`), so a caller that wants the commit it is
 * waiting for should name it rather than rely on a structural landmark that is
 * on screen for every route. Omit it only when the test does not care which
 * route it is on.
 */
export async function waitForRoute(heading?: string): Promise<boolean> {
    return waitForRouteCommit(() => {
        if (screen.queryByText(SHELL_TITLE) === null || !isRouteSettled()) {
            return false;
        }
        return heading === undefined || screen.queryByRole('heading', { level: 1, name: heading }) !== null;
    });
}

export const routeHeadings = {
    tracker: 'Study tracker',
    todo: 'Tasks',
    review: 'Review',
    stats: 'Study statistics',
    focus: 'Focus',
} as const;
