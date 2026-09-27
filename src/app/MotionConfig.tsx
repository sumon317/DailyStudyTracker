import { MotionConfig as FramerMotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { applyReduceMotionClass, createReducedMotionPreference } from './reducedMotion';

/**
 * Wires the `prefers-reduced-motion` preference into Framer Motion and onto
 * `<html>`.
 *
 * This used to live inline in `main.tsx`, which made it untestable: that module
 * calls `createRoot` at import time, so nothing could ever assert that the
 * preference is read before the first paint, subscribed to, and mirrored onto
 * the document element. Keeping it in its own module is what lets
 * `reducedMotion.test.ts` cover the wiring and not just the plumbing.
 *
 * The preference object is created once per mount rather than once per effect.
 * The initial state and the subscription then read from the *same* resolved
 * `MediaQueryList`, so a change event can never arrive on a list the value is
 * not read from - and because the object resolves its query eagerly, the very
 * first render already honours the preference instead of animating at full
 * strength for one frame and correcting itself afterwards.
 */
export const MotionConfig = ({ children }: { children: ReactNode }) => {
    const preference = useMemo(() => createReducedMotionPreference(), []);
    const [reduced, setReduced] = useState(() => preference.getSnapshot());

    useEffect(() => {
        // Re-read on mount: the system preference can have changed between the
        // first render and this effect running.
        setReduced(preference.getSnapshot());
        return preference.subscribe(setReduced);
    }, [preference]);

    useEffect(() => {
        applyReduceMotionClass(reduced);
        return () => {
            // The class is on `<html>`, which outlives this component. Leaving
            // it behind would keep every CSS animation neutralised for whatever
            // renders next.
            applyReduceMotionClass(false);
        };
    }, [reduced]);

    return <FramerMotionConfig reducedMotion={reduced ? 'always' : 'user'}>{children}</FramerMotionConfig>;
};

export default MotionConfig;
