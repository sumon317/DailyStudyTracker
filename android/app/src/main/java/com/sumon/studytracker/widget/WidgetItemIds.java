package com.sumon.studytracker.widget;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Stable {@code AdapterView} ids for the widget's RemoteViews list.
 *
 * <p>The factory answers {@code hasStableIds() == true}, so an id has to be unique inside a data set
 * and has to stay the same for the same row from one load to the next, otherwise the launcher
 * discards every cached view and rebinds the whole list. Two things make that non-trivial: the
 * source payload can repeat a subject id, and the host asks for the id of a position more than
 * once (on every re-layout and every re-measure). The first question for a position therefore
 * memoises its answer, so the second question returns the very same id instead of colliding with
 * the id the row was already given.
 *
 * <p>Deliberately free of {@code org.json} and of the framework so the JVM unit tests can drive it.
 */
final class WidgetItemIds {

    /**
     * The host is free to hand back any id, and a negative id is reserved by
     * {@code RemoteViewsService.RemoteViewsFactory#getItemId} callers to mean "no row here", so the
     * synthesised fallbacks start below that.
     */
    private static final long MAX_UNASSIGNED_ID = -2L;

    private final List<Long> byPosition = new ArrayList<>();
    private final Set<Long> assigned = new HashSet<>();

    /**
     * @param position row index, as reported by the host
     * @param rawId    the row's own id as published by the web layer; may be null or unusable
     * @param name     and {@code time} seed the fallback so a row keeps its id across a reorder
     * @return the stable id for {@code position}, or {@code -1} when there is no such row
     */
    long idAt(int position, String rawId, String name, String time) {
        // Bounded by MAX_ITEMS, so a bogus index cannot make the memo grow without limit.
        if (position < 0 || position >= WidgetTimeUtils.MAX_ITEMS) {
            return -1L;
        }
        while (byPosition.size() <= position) {
            byPosition.add(null);
        }
        Long memoised = byPosition.get(position);
        if (memoised != null) {
            return memoised;
        }
        long id = assign(parseStableId(rawId), WidgetTimeUtils.stableSeedId(name, time), position);
        byPosition.set(position, id);
        return id;
    }

    /** Drops every memoised id so the next data set is numbered from scratch. */
    void reset() {
        byPosition.clear();
        assigned.clear();
    }

    /**
     * The source data can legitimately repeat a subject id and {@code String.hashCode()} can
     * collide, so anything already taken falls back to a negative id that is unique by construction.
     */
    private long assign(long parsedId, long seed, int position) {
        long candidate = parsedId >= 0L ? parsedId : seed;
        if (assigned.add(candidate)) {
            return candidate;
        }
        long fallback = position == 0 ? MAX_UNASSIGNED_ID : -(position + 1L);
        while (!assigned.add(fallback)) {
            fallback--;
        }
        return fallback;
    }

    /**
     * @return the numeric id, a non-negative hash of a non-numeric label, or {@code -1} when the
     *         value is absent or cannot be a stable id at all
     */
    static long parseStableId(String raw) {
        if (raw == null || raw.isEmpty() || raw.length() > 19) {
            return -1L;
        }
        try {
            long parsed = Long.parseLong(raw.trim());
            return parsed < 0L ? -1L : parsed;
        } catch (NumberFormatException exception) {
            return raw.hashCode() & 0x7fffffffL;
        }
    }
}
