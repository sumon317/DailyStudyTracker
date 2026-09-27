import { render, screen } from '@testing-library/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createUser,
    flushMicrotasks,
    isRouteSettled,
    MAX_SUSPENSE_FLUSHES,
    navigateToRoute,
    preloadRouteModules,
    ROUTE_LOADING_SELECTOR,
    ROUTE_SETTLE_TURNS,
    waitForRouteCommit,
} from './test-utils';

/**
 * The harness refuses to spin forever. A test that pins "bounded, not
 * unbounded" needs the same number the harness uses, not a second copy of it -
 * and "bounded" only means anything if the bound itself is a single constant.
 */
const MAX_TURN_BUDGET = MAX_SUSPENSE_FLUSHES;

/**
 * Enough room for a wait that burns the entire budget, on a machine where each
 * turn costs tens of milliseconds rather than one.
 */
const GIVE_UP_TIMEOUT_MS = 30_000;

/**
 * The harness is load-bearing: a wall-clock dependency or a predicate that
 * returns early turns every route assertion in the suite into a coin flip, and
 * it does so silently. These tests pin the contract the other suites rely on.
 */
const LazyPanel = lazy(async () => {
    // A real chunk resolve, so the readiness contract is exercised against the
    // same two-queue settle a route change actually needs.
    await Promise.resolve();
    return { default: () => <p>lazy panel ready</p> };
});

const HostWithLazyChild = () => (
    <Suspense fallback={<div {...{ [ROUTE_LOADING_SELECTOR.slice(1, -1)]: 'panel' }}>loading panel</div>}>
        <LazyPanel />
    </Suspense>
);

const TaskQueueCommit = ({ onReady }: { onReady: (ready: boolean) => void }) => {
    const [value, setValue] = useState('pending');
    useEffect(() => {
        setValue('committed');
    }, []);
    useEffect(() => {
        // The own commit is on the microtask queue; a test that has to see it
        // needs the task queue drained as well.
        const timer = setTimeout(() => onReady(value === 'committed'), 0);
        return () => clearTimeout(timer);
    }, [onReady, value]);
    return <span>{value}</span>;
};

describe('test harness', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('waitForRouteCommit', () => {
        it('settles a predicate that already holds instead of spinning the whole budget', async () => {
            let checks = 0;
            const ready = await waitForRouteCommit(() => {
                checks += 1;
                return true;
            });

            // One turn to confirm readiness plus the settle turns - never the
            // whole budget. A caller that passes an always-true predicate (the
            // shell's `<main>` is on screen on every route) would otherwise burn
            // the whole budget, and a caller that passes one which is *nearly*
            // always true would race the commit it meant to wait for.
            expect(ready).toBe(true);
            expect(checks).toBe(1 + ROUTE_SETTLE_TURNS);
            expect(checks).toBeLessThan(MAX_TURN_BUDGET);
        });

        it('leaves enough headroom that a loaded machine still reaches the commit', () => {
            // The contract is "a slow machine slows the test down", not "a slow
            // machine fails it". A full-suite run gives each test file its own
            // worker, and the one time this budget was small enough to matter
            // every navigation assertion in the app suite failed together on a
            // loaded machine and passed when the file ran alone.
            expect(MAX_TURN_BUDGET).toBeGreaterThanOrEqual(100);
        });

        it(
            'gives up on a predicate that never holds instead of hanging',
            async () => {
                const ready = await waitForRouteCommit(() => false);
                expect(ready).toBe(false);
            },
            // The whole budget is the cost of this test by design, and a turn is
            // a whole event-loop iteration - so on a loaded machine the default
            // per-test timeout can expire before the harness has finished
            // proving that it gives up. Timing this out would be reporting the
            // harness's own bound as a failure to bound.
            GIVE_UP_TIMEOUT_MS,
        );

        it('waits for a commit that only lands on the task queue', async () => {
            let observed = false;
            render(<TaskQueueCommit onReady={(ready) => (observed = ready)} />);

            // The effect's own `setTimeout(0)` has not run yet.
            expect(observed).toBe(false);
            const ready = await waitForRouteCommit(() => observed);

            expect(ready).toBe(true);
            expect(screen.getByText('committed')).toBeInTheDocument();
        });

        it('still makes progress with fake timers installed', async () => {
            // The yield falls back to a `MessageChannel` round trip under fake
            // timers precisely so this does not deadlock. If that regressed to a
            // plain `setTimeout`, every fake-timer test that waits for a route
            // would hang instead of failing.
            vi.useFakeTimers();
            let turns = 0;
            const ready = await waitForRouteCommit(() => {
                turns += 1;
                return turns > 3;
            });

            expect(ready).toBe(true);
            expect(turns).toBe(4 + ROUTE_SETTLE_TURNS);
        });
    });

    describe('flushMicrotasks', () => {
        it('makes promise continuations observable', async () => {
            // The point of the helper: a chain of `await`s that has already been
            // scheduled has run by the time it returns, so a test can assert on
            // the state it produced without a `waitFor` timeout.
            const seen: string[] = [];
            void Promise.resolve()
                .then(() => seen.push('first'))
                .then(() => seen.push('second'));

            await flushMicrotasks();

            expect(seen).toEqual(['first', 'second']);
        });

        it('commits a state update that arrived through a promise', async () => {
            // The real use: a data load that resolves on the microtask queue
            // drives a `setState`, and the render it produces has to be on screen
            // before the assertion rather than after a timeout.
            const Deferred = () => {
                const [value, setValue] = useState('pending');
                useEffect(() => {
                    void Promise.resolve().then(() => setValue('loaded'));
                }, []);
                return <span>{value}</span>;
            };

            render(<Deferred />);
            expect(screen.getByText('pending')).toBeInTheDocument();

            await flushMicrotasks();

            expect(screen.getByText('loaded')).toBeInTheDocument();
        });
    });

    describe('isRouteSettled', () => {
        it('is false while a route fallback is on screen and true once it clears', async () => {
            render(<HostWithLazyChild />);
            expect(isRouteSettled()).toBe(false);

            const ready = await waitForRouteCommit(isRouteSettled);

            expect(ready).toBe(true);
            expect(screen.getByText('lazy panel ready')).toBeInTheDocument();
        });

        it('is true for a document with no route fallback at all', () => {
            expect(isRouteSettled()).toBe(true);
        });
    });

    describe('navigateToRoute', () => {
        it(
            'names the link it could not navigate to',
            async () => {
                const user = createUser();
                render(
                    <MemoryRouter>
                        <Link to="/nowhere">Nowhere</Link>
                    </MemoryRouter>,
                );

                // Swallowing this and letting the caller continue would surface as
                // an "element not found" several assertions later, far from the
                // navigation that caused it. The bound is named too, because a
                // failure to commit is only actionable next to how long it
                // waited.
                await expect(navigateToRoute({ user, linkName: /Nowhere/i, isReady: () => false })).rejects.toThrow(
                    new RegExp(`Nowhere.*${MAX_TURN_BUDGET} turns`),
                );
            },
            GIVE_UP_TIMEOUT_MS,
        );

        it('returns once the destination route is ready', async () => {
            const user = createUser();
            render(
                <MemoryRouter initialEntries={['/']}>
                    <Link to="/">Home</Link>
                    <Link to="/elsewhere">Elsewhere</Link>
                    <Routes>
                        <Route path="/" element={<p>home route</p>} />
                        <Route path="/elsewhere" element={<p>elsewhere route</p>} />
                    </Routes>
                </MemoryRouter>,
            );

            await navigateToRoute({
                user,
                linkName: /Elsewhere/i,
                isReady: () => screen.queryByText('elsewhere route') !== null,
            });

            expect(screen.getByText('elsewhere route')).toBeInTheDocument();
        });

        it('throws when the link itself is missing', async () => {
            const user = createUser();
            render(<p>no navigation here</p>);

            await expect(navigateToRoute({ user, linkName: /Nowhere/i, isReady: () => true })).rejects.toThrow();
        });
    });

    describe('preloadRouteModules', () => {
        it('is safe to call more than once', async () => {
            // Several suites call it in `beforeAll`; a second call has to be a
            // no-op rather than a re-import that resets the `React.lazy` cache
            // the earlier call just populated.
            await expect(preloadRouteModules()).resolves.toBeUndefined();
            await expect(preloadRouteModules()).resolves.toBeUndefined();
        });
    });
});
