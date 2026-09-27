/**
 * Who owns the keyboard while more than one modal dialog is on screen.
 *
 * The app shell can have the update dialog and the alarm-permission dialog open
 * at the same time - one is raised by a release check, the other by the exact
 * alarm prompt on resume - and each of them installs its own `keydown` and
 * `focusin` listeners on `document`. That produced three defects at once:
 *
 * - both `focusin` handlers saw focus land outside themselves and pulled it back,
 *   so neither dialog's controls could hold focus at all;
 * - one Escape press closed both;
 * - both painted at `z-50`, so the *visually* upper dialog was whichever one
 *   happened to come later in the tree, which is not the one that had been
 *   raised last.
 *
 * The stack replaces those independent listeners with a single rule: only the
 * topmost layer owns Escape and focus containment, and each layer paints at a
 * z-index that follows its depth. Overlays that are not registered here (the
 * app-level alarm overlay) sit far above every layer, and a dialog that is
 * *not* the top layer no longer fights them for the caret.
 */

/** A dialog that is currently mounted and visible. */
export interface ModalLayer {
    /**
     * Whether this layer is the one the user is meant to be talking to. Read
     * during render, so it has to change together with the stack version.
     */
    readonly isTop: boolean;
    /**
     * Paint order. Strictly increasing with depth, so the layer that owns the
     * keyboard is always the layer on top.
     */
    readonly zIndex: number;
}

type Token = symbol;

/** The base every layer paints above. Matches the shell's ordinary page content. */
export const MODAL_STACK_BASE_Z_INDEX = 50;

const layers: Token[] = [];
const listeners = new Set<() => void>();
let version = 0;

const notify = (): void => {
    version += 1;
    for (const listener of [...listeners]) {
        listener();
    }
};

/**
 * Registers a layer for as long as it is visible. Returns the unregister
 * function, which is safe to call more than once so a cleanup can run after the
 * effect that registered it has already been torn down.
 */
export const pushModalLayer = (token: Token): (() => void) => {
    if (!layers.includes(token)) {
        layers.push(token);
        notify();
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        const index = layers.indexOf(token);
        if (index === -1) {
            return;
        }
        layers.splice(index, 1);
        notify();
    };
};

/** How a token currently ranks. `0` means the layer is not registered. */
const depthOf = (token: Token): number => {
    const index = layers.indexOf(token);
    return index === -1 ? -1 : index;
};

const describeLayer = (token: Token): ModalLayer => {
    const index = depthOf(token);
    if (index === -1) {
        // Between mounting and the registering effect (and after the release,
        // before the next render) the layer is not in the stack. Treating it as
        // the top layer keeps it usable for that single frame; the version bump
        // then re-renders it with its real depth.
        return { isTop: true, zIndex: MODAL_STACK_BASE_Z_INDEX };
    }
    return { isTop: index === layers.length - 1, zIndex: MODAL_STACK_BASE_Z_INDEX + index };
};

/**
 * The stack's render-visible version.
 *
 * `useSyncExternalStore` needs a snapshot it can compare, and the stack itself is
 * mutated in place by `pushModalLayer`, so the version counter is what makes a
 * re-render happen when the depth of this (or another) layer changes.
 */
export const getModalStackVersion = (): number => version;

export const subscribeToModalStack = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const readModalLayer = (token: Token): ModalLayer => describeLayer(token);

/** Test-only: how many layers are registered right now. */
export const modalStackDepth = (): number => layers.length;
