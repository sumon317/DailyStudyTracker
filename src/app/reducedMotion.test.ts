import { describe, expect, it, vi } from 'vitest';
import { createMatchMediaController } from '../test/matchMedia';
import {
    applyReduceMotionClass,
    createReducedMotionPreference,
    getReducedMotionQuery,
    REDUCE_MOTION_CLASS,
    REDUCED_MOTION_QUERY,
    resolveMediaQuery,
    subscribeToMediaQuery,
    subscribeToReducedMotion,
} from './reducedMotion';

const withoutMatchMedia = (run: () => void): void => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    try {
        run();
    } finally {
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
    }
};

describe('reduced motion', () => {
    it('resolves an arbitrary query through the same guard the preference uses', () => {
        const media = createMatchMediaController({ '(prefers-color-scheme: dark)': true });
        media.install();
        try {
            expect(resolveMediaQuery('(prefers-color-scheme: dark)')?.matches).toBe(true);
            // `ThemeProvider` shares this resolver; an unsupported query has to
            // come back as "no list" rather than throwing out of a render.
            expect(resolveMediaQuery('(nonsense)')?.matches).toBe(false);
        } finally {
            media.restore();
        }

        withoutMatchMedia(() => {
            expect(resolveMediaQuery('(prefers-color-scheme: dark)')).toBeNull();
        });
    });

    it('reports the preference from a single resolved query', () => {
        const media = createMatchMediaController({ [REDUCED_MOTION_QUERY]: true });
        media.install();
        try {
            expect(getReducedMotionQuery()?.matches).toBe(true);
            // One query resolution, not one per subscriber.
            expect(media.calls).toEqual([REDUCED_MOTION_QUERY]);
        } finally {
            media.restore();
        }
    });

    it('mirrors the preference onto <html> so the stylesheet can react', () => {
        expect(applyReduceMotionClass(true)).toBeUndefined();
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(true);

        applyReduceMotionClass(false);
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(false);
    });

    it('follows live changes after subscribing', () => {
        const media = createMatchMediaController();
        media.install();
        try {
            const seen: boolean[] = [];
            const preference = createReducedMotionPreference();
            const unsubscribe = preference.subscribe((reduced) => seen.push(reduced));

            expect(seen).toEqual([false]);
            media.setMatches(REDUCED_MOTION_QUERY, true);
            expect(seen).toEqual([false, true]);
            expect(preference.getSnapshot()).toBe(true);

            unsubscribe();
            media.setMatches(REDUCED_MOTION_QUERY, false);
            // Unsubscribed: the snapshot freezes at the last delivered value.
            expect(seen).toEqual([false, true]);
            expect(preference.getSnapshot()).toBe(true);
        } finally {
            media.restore();
        }
    });

    it('subscribes through the deprecated addListener surface on older WebViews', () => {
        const media = createMatchMediaController({}, { surface: 'legacy' });
        media.install();
        try {
            const seen: boolean[] = [];
            const unsubscribe = subscribeToReducedMotion((event) => seen.push(event.matches));
            expect(media.listenerCount(REDUCED_MOTION_QUERY)).toBe(1);

            media.setMatches(REDUCED_MOTION_QUERY, true);
            expect(seen).toEqual([true]);

            unsubscribe();
            expect(media.listenerCount(REDUCED_MOTION_QUERY)).toBe(0);
        } finally {
            media.restore();
        }
    });

    it('degrades to a no-op subscription when the list exposes neither listener API', () => {
        const media = createMatchMediaController({}, { surface: 'none' });
        media.install();
        try {
            const listener = vi.fn();
            const unsubscribe = subscribeToReducedMotion(listener);

            media.setMatches(REDUCED_MOTION_QUERY, true);
            expect(listener).not.toHaveBeenCalled();
            expect(() => unsubscribe()).not.toThrow();
        } finally {
            media.restore();
        }
    });

    it('treats a missing matchMedia as no preference instead of throwing', () => {
        withoutMatchMedia(() => {
            expect(getReducedMotionQuery()).toBeNull();
            const seen: boolean[] = [];
            const unsubscribe = subscribeToReducedMotion((event) => seen.push(event.matches));
            unsubscribe();
            expect(seen).toEqual([]);

            const preference = createReducedMotionPreference();
            expect(preference.getSnapshot()).toBe(false);
            preference.subscribe((reduced) => seen.push(reduced));
            expect(seen).toEqual([false]);
        });
    });

    it('treats a throwing matchMedia as no preference instead of failing the mount', () => {
        const original = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation(() => {
            throw new Error('unsupported query');
        }) as unknown as typeof window.matchMedia;
        try {
            expect(getReducedMotionQuery()).toBeNull();
            const preference = createReducedMotionPreference();
            expect(preference.getSnapshot()).toBe(false);
        } finally {
            window.matchMedia = original;
        }
    });

    it('resolves the query eagerly so a first read is not a blind "no preference"', () => {
        // Reading the snapshot before anything subscribes used to return a
        // hard-coded `false`: the query was only resolved inside `subscribe`.
        // A caller that seeds its initial state from the snapshot - which is
        // exactly what the app shell does - therefore rendered one full-motion
        // frame before the correction landed.
        const media = createMatchMediaController({ [REDUCED_MOTION_QUERY]: true });
        media.install();
        try {
            expect(createReducedMotionPreference().getSnapshot()).toBe(true);
            // One resolution for the read, and `subscribe` reuses that same list
            // instead of resolving a second one.
            const preference = createReducedMotionPreference();
            const seen: boolean[] = [];
            const unsubscribe = preference.subscribe((reduced) => seen.push(reduced));
            expect(seen).toEqual([true]);
            expect(media.listenerCount(REDUCED_MOTION_QUERY)).toBe(1);
            unsubscribe();
        } finally {
            media.restore();
        }
    });

    it('re-reads the same list on subscribe so a change between construction and subscription is seen', () => {
        const media = createMatchMediaController({ [REDUCED_MOTION_QUERY]: false });
        media.install();
        try {
            const preference = createReducedMotionPreference();
            expect(preference.getSnapshot()).toBe(false);
            // The system flips before the component's effect subscribes.
            media.setMatches(REDUCED_MOTION_QUERY, true);
            const seen: boolean[] = [];
            const unsubscribe = preference.subscribe((reduced) => seen.push(reduced));
            expect(seen).toEqual([true]);
            expect(preference.getSnapshot()).toBe(true);
            unsubscribe();
        } finally {
            media.restore();
        }
    });

    it('never subscribes a null query list', () => {
        const unsubscribe = subscribeToMediaQuery(null, vi.fn());
        expect(unsubscribe()).toBeUndefined();
    });
});
