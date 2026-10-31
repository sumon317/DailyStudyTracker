/**
 * The one piece of state the storage backends and the public API have to agree on.
 *
 * It lives in its own module because both sides need it, and a shared mutable flag has to be
 * shared by reference: two copies of a boolean would each be set by one side and read by the
 * other, and the two would never agree.
 */
export const importState = {
    /**
     * Whether an import is currently rewriting the canonical store.
     *
     * An import is the one write that replaces everything, so the backends have to know it is
     * running: a read that lands in the middle of one would otherwise see a half-written store
     * and treat it as the day's data.
     */
    authoritativeImportPending: false,
};
