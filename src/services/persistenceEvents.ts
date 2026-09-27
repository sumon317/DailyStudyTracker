/**
 * The two events that describe the health of the canonical store.
 *
 * `study-data-error` is the failure signal the shell turns into a toast. It is
 * dispatched by `DataProvider` and, independently, by the date picker (which
 * writes outside the provider's flush path), so it is a *window* event by design
 * rather than a context value the three unrelated writers would have to be
 * nested inside each other to reach.
 *
 * `study-data-recovered` is the other half, and it used to not exist. Both the
 * provider and the shell keep their own rate-limit window, and both of them
 * re-armed only on data change - so a store that failed, recovered, and failed
 * again inside the shell's window was reported as nothing at all, for the rest
 * of that window. The shell cannot see the provider's recovery from events
 * alone: it only ever learns that a failure happened, never that a write
 * succeeded afterwards. This is that signal.
 *
 * The two windows are deliberately different lengths and deliberately ordered:
 *
 * - the provider's is the *event* window (30s). Its job is to not generate a
 *   flood - one broken write is reported by the debounce, the periodic tick, a
 *   lifecycle flush and the unmount drain at once;
 * - the shell's is the *presentation* window (10s). Its job is to not paint two
 *   toasts for one fault, including the case the provider's window cannot cover
 *   (a direct dispatch from the date picker, which has no window of its own).
 *
 * The shell's window is therefore the shorter of the two, so it only ever
 * removes duplicates the event layer let through, and a recovered store
 * re-arms both.
 */

export const PERSISTENCE_ERROR_EVENT = 'study-data-error';
export const PERSISTENCE_RECOVERED_EVENT = 'study-data-recovered';

/**
 * Announces a failed write.
 *
 * A `window` that cannot carry events (a test double, a non-DOM runtime) is not an
 * error: the store has already refused the write either way, and only the toast
 * is lost.
 */
export const announcePersistenceError = (error: unknown): void => {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent(PERSISTENCE_ERROR_EVENT, { detail: error }));
};

/**
 * Announces that a write the store accepted ended the failure episodes in
 * progress, so the next fault is news again however soon it arrives.
 */
export const announcePersistenceRecovered = (): void => {
    if (typeof window === 'undefined' || typeof Event === 'undefined') {
        return;
    }
    window.dispatchEvent(new Event(PERSISTENCE_RECOVERED_EVENT));
};

/** Subscribes to failed writes. Returns the unsubscribe function. */
export const subscribeToPersistenceErrors = (listener: (error: unknown) => void): (() => void) => {
    if (typeof window === 'undefined') {
        return () => undefined;
    }
    const handle = (event: Event) => {
        listener(event instanceof CustomEvent ? event.detail : undefined);
    };
    window.addEventListener(PERSISTENCE_ERROR_EVENT, handle);
    return () => window.removeEventListener(PERSISTENCE_ERROR_EVENT, handle);
};

/** Subscribes to recoveries. Returns the unsubscribe function. */
export const subscribeToPersistenceRecovered = (listener: () => void): (() => void) => {
    if (typeof window === 'undefined') {
        return () => undefined;
    }
    const handle = () => {
        listener();
    };
    window.addEventListener(PERSISTENCE_RECOVERED_EVENT, handle);
    return () => window.removeEventListener(PERSISTENCE_RECOVERED_EVENT, handle);
};
