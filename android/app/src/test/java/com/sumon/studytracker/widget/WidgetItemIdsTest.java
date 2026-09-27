package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashSet;
import java.util.Set;

/**
 * Covers the stable id assignment of the widget's RemoteViews list. The class is free of
 * {@code org.json} and of the framework, so all of it runs on a plain JVM unit test task.
 */
public class WidgetItemIdsTest {

    @Test
    public void prefersTheRowIdPublishedByTheWebLayer() {
        WidgetItemIds ids = new WidgetItemIds();
        assertEquals(42L, ids.idAt(0, "42", "Maths", "09:00"));
        assertEquals(0L, ids.idAt(1, "0", "Physics", "10:00"));
    }

    @Test
    public void theSamePositionAlwaysAnswersWithTheSameId() {
        // Regression: the host asks for a position's id again on every re-layout. When the answer
        // was recomputed each time, the second ask saw its own id already taken and handed the row
        // a negative fallback instead, so the id of an unchanged row changed under it and the host
        // threw the whole list away.
        WidgetItemIds ids = new WidgetItemIds();
        long first = ids.idAt(3, "7", "Maths", "09:00");
        for (int repeat = 0; repeat < 5; repeat++) {
            assertEquals(first, ids.idAt(3, "7", "Maths", "09:00"));
        }
    }

    @Test
    public void repeatedAsksForACollisionAlsoStayStable() {
        // The second row duplicates the first row's id, so it lands on a synthesised negative id.
        // That fallback has to be memoised too, or the row would flip between the first and the
        // second layout pass.
        WidgetItemIds ids = new WidgetItemIds();
        assertEquals(7L, ids.idAt(0, "7", "Maths", "09:00"));
        long duplicate = ids.idAt(1, "7", "Physics", "10:00");
        for (int repeat = 0; repeat < 5; repeat++) {
            assertEquals(duplicate, ids.idAt(1, "7", "Physics", "10:00"));
        }
    }

    @Test
    public void aRepeatedRowIdStillProducesTwoDistinctIds() {
        // hasStableIds() is true, so a duplicate in the source payload must not produce a
        // duplicate id: the host would then be unable to key its recycled views.
        WidgetItemIds ids = new WidgetItemIds();
        Set<Long> assigned = new HashSet<>();
        for (int position = 0; position < 6; position++) {
            assertTrue("duplicate id at " + position, assigned.add(ids.idAt(position, "7", "N" + position, "09:00")));
        }
        assertEquals(6, assigned.size());
    }

    @Test
    public void everyIdInOneDataSetIsUniqueAcrossMixedSources() {
        // Numeric ids, an unparseable label, and rows with no id at all, all at once.
        WidgetItemIds ids = new WidgetItemIds();
        Set<Long> assigned = new HashSet<>();
        assertTrue(assigned.add(ids.idAt(0, "1", "Maths", "09:00")));
        assertTrue(assigned.add(ids.idAt(1, "1", "Physics", "10:00")));
        assertTrue(assigned.add(ids.idAt(2, "subject-a", "Biology", "11:00")));
        assertTrue(assigned.add(ids.idAt(3, "subject-a", "Biology", "11:00")));
        assertTrue(assigned.add(ids.idAt(4, "", "Maths", "09:00")));
        assertTrue(assigned.add(ids.idAt(5, "", "Maths", "09:00")));
        assertTrue(assigned.add(ids.idAt(6, null, null, null)));
        assertEquals(7, assigned.size());
    }

    @Test
    public void neverHandsOutTheNegativeSentinelAsARealId() {
        // -1 is what getItemId returns for "there is no such row", so a synthesised fallback has
        // to stay below it or the host could confuse a row with an empty slot.
        WidgetItemIds ids = new WidgetItemIds();
        assertEquals(1L, ids.idAt(0, "1", "Maths", "09:00"));
        for (int position = 0; position < 5; position++) {
            long id = ids.idAt(position, "1", "N" + position, "09:00");
            assertNotEquals(-1L, id);
        }
        assertEquals(-1L, ids.idAt(-1, "1", "Maths", "09:00"));
    }

    @Test
    public void synthesisedFallbacksAreUniqueWhenEveryRowCollides() {
        WidgetItemIds ids = new WidgetItemIds();
        Set<Long> assigned = new HashSet<>();
        for (int position = 0; position < 10; position++) {
            long id = ids.idAt(position, "", "Same", "09:00");
            assertTrue("duplicate fallback at " + position + ": " + id, assigned.add(id));
        }
    }

    @Test
    public void outOfRangePositionsReportNoRow() {
        WidgetItemIds ids = new WidgetItemIds();
        assertEquals(-1L, ids.idAt(-1, "1", "Maths", "09:00"));
        assertEquals(-1L, ids.idAt(WidgetTimeUtils.MAX_ITEMS, "1", "Maths", "09:00"));
        assertEquals(-1L, ids.idAt(Integer.MAX_VALUE, "1", "Maths", "09:00"));
    }

    @Test
    public void aResetDataSetRenumbersFromScratch() {
        // A reorder must not be able to hand a row the id of the row that used to sit there, and a
        // reload of the same data has to reproduce the very same ids.
        WidgetItemIds first = new WidgetItemIds();
        long firstMaths = first.idAt(0, "1", "Maths", "09:00");
        long firstPhysics = first.idAt(1, "2", "Physics", "10:00");

        WidgetItemIds reloaded = new WidgetItemIds();
        assertEquals(firstMaths, reloaded.idAt(0, "1", "Maths", "09:00"));
        assertEquals(firstPhysics, reloaded.idAt(1, "2", "Physics", "10:00"));

        WidgetItemIds reused = new WidgetItemIds();
        reused.idAt(0, "1", "Maths", "09:00");
        reused.idAt(1, "2", "Physics", "10:00");
        reused.reset();
        assertEquals(firstMaths, reused.idAt(0, "1", "Maths", "09:00"));
        assertEquals(firstPhysics, reused.idAt(1, "2", "Physics", "10:00"));
    }

    @Test
    public void asksMayArriveOutOfOrder() {
        // The host is free to measure a row before laying out the ones above it, so the memo has to
        // work for any visiting order, not just a top-down walk.
        WidgetItemIds ids = new WidgetItemIds();
        long fifth = ids.idAt(4, "5", "History", "13:00");
        long first = ids.idAt(0, "1", "Maths", "09:00");
        assertEquals(first, ids.idAt(0, "1", "Maths", "09:00"));
        assertEquals(fifth, ids.idAt(4, "5", "History", "13:00"));
    }

    @Test
    public void parsesNumericIds() {
        assertEquals(42L, WidgetItemIds.parseStableId("42"));
        assertEquals(0L, WidgetItemIds.parseStableId("0"));
        assertEquals(7L, WidgetItemIds.parseStableId(" 7 "));
        assertEquals(Long.MAX_VALUE, WidgetItemIds.parseStableId("9223372036854775807"));
    }

    @Test
    public void rejectsUnusableIds() {
        assertEquals(-1L, WidgetItemIds.parseStableId(null));
        assertEquals(-1L, WidgetItemIds.parseStableId(""));
        // A negative id would be indistinguishable from a synthesised fallback.
        assertEquals(-1L, WidgetItemIds.parseStableId("-7"));
    }

    @Test
    public void fallsBackToNonNegativeHashForNonNumericIds() {
        long parsed = WidgetItemIds.parseStableId("subject-a");
        assertTrue(parsed >= 0L);
        // Deterministic, otherwise the same row would change id between loads.
        assertEquals(parsed, WidgetItemIds.parseStableId("subject-a"));
    }

    @Test
    public void rejectsOverlongNumericIdsWithoutParsingThem() {
        // Beyond 19 digits a value cannot fit a long, so it is treated as a non-numeric label
        // instead of wrapping around into an unrelated id.
        assertEquals(-1L, WidgetItemIds.parseStableId("12345678901234567890"));
    }
}
