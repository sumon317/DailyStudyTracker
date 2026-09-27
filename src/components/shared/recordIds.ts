/**
 * Row identity for the editable record lists (planner subjects, checklist
 * objectives, quality criteria, error-log records).
 *
 * New rows used to be minted with `Math.max(lastId, Date.now()) + 1`, seeded
 * from the ids already in the list. That breaks twice at the safe-integer
 * ceiling, and both breaks are reachable from ordinary use:
 *
 * - `storage.ts` accepts any id up to `Number.MAX_SAFE_INTEGER` and its own
 *   suite round-trips exactly that value, so a JSON backup can hand the planner
 *   a ceiling-bound id. `MAX_SAFE_INTEGER + 1` is the first float64 past the
 *   safe range, and adding one to *it* rounds back to itself, so the second
 *   row added afterwards is handed the same id as the first.
 * - A duplicate id is not just a duplicate value: it is a duplicate React key
 *   and a duplicate of every DOM id derived from it (`checklist-item-<id>-*`,
 *   `desktop-subject-name-<id>`, the planner's validation-message map), so the
 *   two rows fight over the same elements.
 *
 * Reserving against the ids actually in use closes both holes without seeding
 * from them: a candidate already taken is stepped off, so the stored ceiling
 * no longer matters, and the walk is bounded by the pigeonhole argument that
 * with `n` ids taken at least one of `1..n + 1` is free.
 */
const MAX_RECORD_ID = Number.MAX_SAFE_INTEGER;

/**
 * A fresh id for a new record, greater than `lastId` where that is possible
 * and never equal to anything in `taken`.
 */
export const reserveRecordId = (lastId: number, taken: readonly number[]): number => {
    const used = new Set(taken);
    let candidate = lastId >= MAX_RECORD_ID ? 1 : Math.max(lastId, Date.now()) + 1;
    // `probe < used.size` is the pigeonhole bound: at most `used.size` distinct
    // ids can collide, and the walk always moves forward, so it terminates on a
    // free id rather than cycling forever.
    for (let probe = 0; probe < used.size && used.has(candidate); probe += 1) {
        candidate = candidate >= MAX_RECORD_ID ? 1 : candidate + 1;
    }
    return candidate;
};
