/**
 * Controllable `window.matchMedia` double.
 *
 * Theme and reduced-motion providers read the system preference once during the
 * first render and then only from the `change` subscription. A test therefore
 * needs three things at once: a *live* `matches` value (so a later read agrees
 * with what the subscriber was told), a way to flip that value, and a way to put
 * `window.matchMedia` back exactly as it was. Assigning `globalThis.matchMedia`
 * directly and hoping the next test overwrites it is what made the theme suite
 * order-dependent, so every test now installs this controller and restores it.
 */

type MediaQueryListener = (event: MediaQueryListEvent) => void;

/** Which subscription surface the returned `MediaQueryList` exposes. */
export type MatchMediaApiSurface = 'modern' | 'legacy' | 'none';

export interface MatchMediaController {
    /** Replace `window.matchMedia` with this controller, remembering the original. */
    install(): void;
    /** Put the previous `window.matchMedia` back. Safe to call more than once. */
    restore(): void;
    /** Flip a query and notify every live subscriber of it. */
    setMatches(query: string, matches: boolean): void;
    /** Current match state for a query, or `false` when it was never queried. */
    matches(query: string): boolean;
    /** Live subscription count, optionally narrowed to one query. */
    listenerCount(query?: string): number;
    /**
     * Choose which listener API the next `matchMedia()` result exposes. Providers
     * must fall back from `addEventListener` to `addListener` and then to a
     * no-op, so all three surfaces need to be reachable from a test.
     */
    setApiSurface(surface: MatchMediaApiSurface): void;
    /** Every query string `matchMedia` was called with, in order. */
    readonly calls: string[];
}

interface TrackedQuery {
    media: string;
    matches: boolean;
    modern: Set<MediaQueryListener>;
    legacy: Set<MediaQueryListener>;
}

const buildEvent = (media: string, matches: boolean): MediaQueryListEvent =>
    ({ matches, media }) as MediaQueryListEvent;

export function createMatchMediaController(
    initial: Record<string, boolean> = {},
    { preferDark = false, surface = 'modern' as MatchMediaApiSurface } = {},
): MatchMediaController {
    const queries = new Map<string, TrackedQuery>();
    const calls: string[] = [];
    let apiSurface = surface;
    let original: typeof window.matchMedia | undefined;

    const track = (media: string): TrackedQuery => {
        const existing = queries.get(media);
        if (existing) {
            return existing;
        }
        const seeded = initial[media] ?? (media.includes('prefers-color-scheme') ? preferDark : false);
        const created: TrackedQuery = { media, matches: seeded, modern: new Set(), legacy: new Set() };
        queries.set(media, created);
        return created;
    };

    const makeMediaQueryList = (tracked: TrackedQuery): MediaQueryList => {
        const list: Record<string, unknown> = {
            media: tracked.media,
            get matches() {
                return tracked.matches;
            },
            onchange: null,
            dispatchEvent: () => true,
        };

        if (apiSurface === 'modern') {
            list.addEventListener = (type: string, listener: unknown) => {
                if (type === 'change' && typeof listener === 'function') {
                    tracked.modern.add(listener as MediaQueryListener);
                }
            };
            list.removeEventListener = (type: string, listener: unknown) => {
                if (type === 'change' && typeof listener === 'function') {
                    tracked.modern.delete(listener as MediaQueryListener);
                }
            };
        }

        if (apiSurface === 'modern' || apiSurface === 'legacy') {
            list.addListener = (listener: unknown) => {
                if (typeof listener === 'function') {
                    tracked.legacy.add(listener as MediaQueryListener);
                }
            };
            list.removeListener = (listener: unknown) => {
                if (typeof listener === 'function') {
                    tracked.legacy.delete(listener as MediaQueryListener);
                }
            };
        }

        return list as unknown as MediaQueryList;
    };

    const install = (): void => {
        original = window.matchMedia;
        window.matchMedia = ((query: string) => {
            calls.push(query);
            return makeMediaQueryList(track(query));
        }) as typeof window.matchMedia;
    };

    const restore = (): void => {
        if (original) {
            window.matchMedia = original;
            original = undefined;
        }
        for (const tracked of queries.values()) {
            tracked.modern.clear();
            tracked.legacy.clear();
        }
    };

    const setMatches = (query: string, matches: boolean): void => {
        const tracked = track(query);
        if (tracked.matches === matches) {
            return;
        }
        tracked.matches = matches;
        const event = buildEvent(tracked.media, matches);
        for (const listener of [...tracked.modern, ...tracked.legacy]) {
            listener(event);
        }
    };

    return {
        install,
        restore,
        setMatches,
        matches: (query: string) => queries.get(query)?.matches ?? false,
        listenerCount: (query?: string) => {
            if (query === undefined) {
                return [...queries.values()].reduce(
                    (total, tracked) => total + tracked.modern.size + tracked.legacy.size,
                    0,
                );
            }
            const tracked = queries.get(query);
            return tracked ? tracked.modern.size + tracked.legacy.size : 0;
        },
        setApiSurface: (next: MatchMediaApiSurface) => {
            apiSurface = next;
        },
        calls,
    };
}

/** Convenience wrapper: build a controller, install it and start using it. */
export const installMatchMedia = (
    initial: Record<string, boolean> = {},
    options: { preferDark?: boolean; surface?: MatchMediaApiSurface } = {},
): MatchMediaController => {
    const controller = createMatchMediaController(initial, {
        preferDark: options.preferDark ?? false,
        surface: options.surface ?? 'modern',
    });
    controller.install();
    return controller;
};

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
