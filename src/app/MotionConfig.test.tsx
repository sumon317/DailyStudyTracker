import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchMediaController } from '../test/matchMedia';
import { createMatchMediaController, REDUCED_MOTION_QUERY } from '../test/matchMedia';
import MotionConfig from './MotionConfig';
import { REDUCE_MOTION_CLASS } from './reducedMotion';

// The real component is what is under test here, so framer-motion is replaced
// with a probe that reports the `reducedMotion` it was handed. Everything else -
// the media query, the subscription, the `<html>` class - is the real thing.
const framerProbe = vi.hoisted(() => ({ modes: [] as string[] }));

vi.mock('framer-motion', () => ({
    MotionConfig: ({ reducedMotion, children }: { reducedMotion: string; children: React.ReactNode }) => {
        framerProbe.modes.push(reducedMotion);
        return <div data-testid="probe">{children}</div>;
    },
}));

let media: MatchMediaController | undefined;

const installMedia = (matches: boolean): MatchMediaController => {
    const controller = createMatchMediaController({ [REDUCED_MOTION_QUERY]: matches });
    controller.install();
    media = controller;
    return controller;
};

describe('MotionConfig', () => {
    afterEach(() => {
        media?.restore();
        media = undefined;
        framerProbe.modes.length = 0;
    });

    it('honours a reduced-motion preference on the very first render', () => {
        installMedia(true);
        render(
            <MotionConfig>
                <span>child</span>
            </MotionConfig>,
        );

        // Not 'user' first and 'always' after an effect: the shell must not
        // animate at full strength for a frame before correcting itself.
        expect(framerProbe.modes[0]).toBe('always');
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(true);
    });

    it('leaves motion to the user when the preference is off', () => {
        installMedia(false);
        render(
            <MotionConfig>
                <span>child</span>
            </MotionConfig>,
        );

        expect(framerProbe.modes[0]).toBe('user');
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(false);
    });

    it('follows the preference after it changes', () => {
        const controller = installMedia(false);
        render(
            <MotionConfig>
                <span>child</span>
            </MotionConfig>,
        );
        expect(framerProbe.modes.at(-1)).toBe('user');

        act(() => {
            controller.setMatches(REDUCED_MOTION_QUERY, true);
        });

        expect(framerProbe.modes.at(-1)).toBe('always');
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(true);
    });

    it('resolves the media query once for the read and once for the subscription', () => {
        const controller = installMedia(true);
        render(
            <MotionConfig>
                <span>child</span>
            </MotionConfig>,
        );

        // One list for the whole mount: a browser that hands out a fresh
        // `MediaQueryList` per call would otherwise deliver change events to a
        // list the value is no longer read from.
        expect(controller.listenerCount(REDUCED_MOTION_QUERY)).toBe(1);
        expect(controller.calls).toEqual([REDUCED_MOTION_QUERY]);
    });

    it('unsubscribes and takes the class back off <html> on unmount', () => {
        const controller = installMedia(true);
        const { unmount } = render(
            <MotionConfig>
                <span>child</span>
            </MotionConfig>,
        );
        expect(controller.listenerCount(REDUCED_MOTION_QUERY)).toBe(1);
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(true);

        unmount();

        // `<html>` outlives the component, so a leaked class would keep every CSS
        // animation neutralised for whatever renders next.
        expect(controller.listenerCount(REDUCED_MOTION_QUERY)).toBe(0);
        expect(document.documentElement.classList.contains(REDUCE_MOTION_CLASS)).toBe(false);
    });

    it('still renders its children in an environment with no matchMedia at all', () => {
        const original = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
        try {
            render(
                <MotionConfig>
                    <span>child</span>
                </MotionConfig>,
            );
            expect(framerProbe.modes[0]).toBe('user');
        } finally {
            Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
        }
    });
});
