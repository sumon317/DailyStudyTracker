/**
 * The one signal that a restore has replaced the canonical store.
 *
 * Some state in this app is owned by a component and mirrored into
 * `localStorage` rather than read from storage on every render: the theme, and
 * the focus alarm list. Both read their value once, at mount, so a restore that
 * changed them left the screen showing the pre-import values with no visible
 * reason - a theme that did not follow the backup, a focus alarm list that no
 * longer matched the one the user just restored.
 *
 * A window event rather than a context value because the owners are three
 * unrelated trees (`DataProvider`, `ThemeProvider`, the focus alarm card) that
 * must not have to be nested inside each other to hear about it. The name and
 * the subscribe helper live here so the three cannot drift apart, exactly as
 * `study-data-error` does for the failure path.
 */
export const DATA_IMPORTED_EVENT = 'study-data-imported';

export interface DataImportedDetail {
    /** Day records the restore applied. `0` means the file held none. */
    appliedDays: number;
}

/**
 * Announces a completed restore. A `window` that cannot carry events (a test
 * double, a non-DOM runtime) is not an error: the store is still updated, only
 * the mirrors are not refreshed.
 */
export const announceDataImported = (detail: DataImportedDetail): void => {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent<DataImportedDetail>(DATA_IMPORTED_EVENT, { detail }));
};

/** Subscribes to restores. Returns the unsubscribe function. */
export const subscribeToDataImported = (listener: (detail: DataImportedDetail) => void): (() => void) => {
    if (typeof window === 'undefined') {
        return () => undefined;
    }
    const handle = (event: Event) => {
        const detail = event instanceof CustomEvent ? (event.detail as DataImportedDetail | undefined) : undefined;
        listener(detail ?? { appliedDays: 0 });
    };
    window.addEventListener(DATA_IMPORTED_EVENT, handle);
    return () => window.removeEventListener(DATA_IMPORTED_EVENT, handle);
};
