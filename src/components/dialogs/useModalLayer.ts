import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ModalLayer } from './modalStack';
import { getModalStackVersion, pushModalLayer, readModalLayer, subscribeToModalStack } from './modalStack';

/**
 * Joins the shared modal stack for as long as `active`, and reports this
 * dialog's rank in it.
 *
 * A dialog that is not the top layer must not handle Escape, must not contain
 * focus, and must paint below the one that is - otherwise two `aria-modal`
 * dialogs on screen pull the caret away from each other and one Escape press
 * dismisses both.
 */
export const useModalLayer = (active: boolean): ModalLayer => {
    // Created once per instance: the token is the layer's identity in the stack,
    // so a fresh one per render would unregister and re-register on every pass.
    const tokenRef = useRef<symbol | null>(null);
    tokenRef.current ??= Symbol('modal-layer');
    const token = tokenRef.current;

    useEffect(() => {
        if (!active) {
            return;
        }
        return pushModalLayer(token);
    }, [active, token]);

    // The stack is mutated in place, so the version is what tells React that the
    // rank read below is no longer the one it rendered with.
    useSyncExternalStore(subscribeToModalStack, getModalStackVersion, getModalStackVersion);

    return readModalLayer(token);
};
