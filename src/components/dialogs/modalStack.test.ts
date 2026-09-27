import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getModalStackVersion,
    MODAL_STACK_BASE_Z_INDEX,
    modalStackDepth,
    pushModalLayer,
    readModalLayer,
    subscribeToModalStack,
} from './modalStack';

const token = (): symbol => Symbol('test-layer');

describe('modalStack', () => {
    const releases: (() => void)[] = [];

    const push = (): symbol => {
        const layer = token();
        releases.push(pushModalLayer(layer));
        return layer;
    };

    afterEach(() => {
        // Released in reverse so a test that pushed several layers cannot leave one
        // registered for the next: the module is deliberately process-wide.
        while (releases.length > 0) {
            releases.pop()?.();
        }
    });

    it('treats a layer that is not registered as the top of a one-layer stack', () => {
        const layer = token();
        expect(readModalLayer(layer)).toEqual({ isTop: true, zIndex: MODAL_STACK_BASE_Z_INDEX });
    });

    it('ranks layers by the order they were raised, not by the order they were created', () => {
        const first = token();
        const second = token();
        const releaseFirst = pushModalLayer(first);
        const releaseSecond = pushModalLayer(second);
        releases.push(releaseFirst, releaseSecond);

        expect(readModalLayer(first)).toEqual({ isTop: false, zIndex: MODAL_STACK_BASE_Z_INDEX });
        expect(readModalLayer(second)).toEqual({ isTop: true, zIndex: MODAL_STACK_BASE_Z_INDEX + 1 });

        releaseSecond();
        releases.length = 0;
        releases.push(releaseFirst);

        // The layer underneath takes the keyboard back rather than being left as a
        // live `aria-modal` dialog with nothing to drive it.
        expect(readModalLayer(first)).toEqual({ isTop: true, zIndex: MODAL_STACK_BASE_Z_INDEX });
    });

    it('ignores a repeat registration of the same layer', () => {
        const layer = token();
        const release = pushModalLayer(layer);
        const second = pushModalLayer(layer);
        releases.push(release, second);

        expect(modalStackDepth()).toBe(1);
        expect(readModalLayer(layer).zIndex).toBe(MODAL_STACK_BASE_Z_INDEX);
    });

    it('ignores a repeat release so a stale cleanup cannot drop a newer layer', () => {
        const layer = token();
        const release = pushModalLayer(layer);
        release();
        release();

        expect(modalStackDepth()).toBe(0);
    });

    it('notifies subscribers whenever the stack changes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToModalStack(listener);
        const before = getModalStackVersion();

        try {
            const layer = push();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(getModalStackVersion()).toBeGreaterThan(before);
            expect(modalStackDepth()).toBe(1);
            void layer;
        } finally {
            unsubscribe();
        }
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
