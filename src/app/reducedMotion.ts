/**
 * Reduced-motion plumbing for the app shell.
 *
 * This used to live inline in `main.tsx`, which made it untestable: the module
 * calls `createRoot` at import time, so no test could ever assert that the
 * `prefers-reduced-motion` preference is read, subscribed to and mirrored onto
 * `<html>`. Keeping it here means `main.tsx` is the only file that knows how the
 * app is mounted, and this file can be exercised on its own.
 *
 * The subscription deliberately supports three surfaces. `addEventListener` is
 * the modern API, `addListener` is the deprecated one that older WebViews (the
 * Android shell in particular) still expose, and some environments expose
 * neither - a missing `matchMedia` must degrade to "no preference" rather than
 * throwing while the app is still mounting.
 */

export type MediaQueryListener = (event: MediaQueryListEvent) => void;

type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: MediaQueryListener) => void;
    removeListener?: (listener: MediaQueryListener) => void;
};

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCE_MOTION_CLASS = 'reduce-motion';

/**
 * Resolves a media query against the current environment.
 *
 * A missing `matchMedia` (SSR, an ancient WebView) and a `matchMedia` that
 * throws for an unsupported query both degrade to "no list" rather than
 * propagating out of a render.
 */
export function resolveMediaQuery(query: string): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }
    try {
        return window.matchMedia(query);
    } catch {
        return null;
    }
}

export function getReducedMotionQuery(): MediaQueryList | null {
    return resolveMediaQuery(REDUCED_MOTION_QUERY);
}

export function subscribeToReducedMotion(listener: MediaQueryListener): () => void {
    return subscribeToMediaQuery(getReducedMotionQuery(), listener);
}

/**
 * Shared subscription helper. `ThemeProvider` has the same three-surface
 * requirement for `(prefers-color-scheme: dark)`; the behaviour lives here once
 * so the fallback order cannot drift between the two callers.
 */
export function subscribeToMediaQuery(mediaQuery: MediaQueryList | null, listener: MediaQueryListener): () => void {
    if (!mediaQuery) {
        return () => undefined;
    }

    const legacyQuery = mediaQuery as LegacyMediaQueryList;
    if (typeof legacyQuery.addEventListener === 'function' && typeof legacyQuery.removeEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        return () => mediaQuery.removeEventListener('change', listener);
    }

    if (typeof legacyQuery.addListener === 'function') {
        legacyQuery.addListener(listener);
        return () => legacyQuery.removeListener?.(listener);
    }

    return () => undefined;
}

/**
 * Reads the preference once and keeps the returned getter pointed at a single
 * `MediaQueryList`.
 *
 * The previous version called `matchMedia` twice per subscribe - once to read
 * `matches` and once inside the subscription helper - which handed out two
 * distinct objects in browsers that return a fresh list per call. The value was
 * then read from one list while the listener was attached to the other, so a
 * test (or a browser) that only wires up one of them silently stopped receiving
 * preference changes.
 *
 * The list is resolved eagerly so `getSnapshot()` is correct *before* anything
 * subscribes. Reading it lazily meant a first render that asked for the snapshot
 * always saw `false`, and the corrected value only arrived on the second paint -
 * a visible flash of full-strength animation for a user who had asked for
 * reduced motion.
 */
export function createReducedMotionPreference(): {
    getSnapshot: () => boolean;
    subscribe: (onChange: (reduced: boolean) => void) => () => void;
} {
    const mediaQuery = getReducedMotionQuery();
    let current = mediaQuery?.matches ?? false;

    return {
        getSnapshot: () => current,
        subscribe: (onChange) => {
            // Re-read rather than trust the snapshot: the system preference can
            // change between construction and subscription, and the listener is
            // attached to this very list.
            current = mediaQuery?.matches ?? false;
            onChange(current);
            return subscribeToMediaQuery(mediaQuery, (event) => {
                current = event.matches;
                onChange(current);
            });
        },
    };
}

/**
 * Mirrors the preference onto `<html>` so the stylesheet can neutralise CSS
 * animations that Framer's `reducedMotion` prop does not drive.
 */
export function applyReduceMotionClass(reduced: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.classList.toggle(REDUCE_MOTION_CLASS, reduced);
}
