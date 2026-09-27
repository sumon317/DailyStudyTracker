package com.sumon.studytracker.alarm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.app.PendingIntent;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class NativeAlarmValidationTest {

    private static final long NOW = 1_700_000_000_000L;

    @Test
    public void acceptsPositive31BitIds() {
        assertTrue(NativeAlarmPlugin.isValidAlarmId(1));
        assertTrue(NativeAlarmPlugin.isValidAlarmId(Integer.MAX_VALUE));
    }

    @Test
    public void rejectsNonPositiveIds() {
        assertFalse(NativeAlarmPlugin.isValidAlarmId(0));
        assertFalse(NativeAlarmPlugin.isValidAlarmId(-1));
        assertFalse(NativeAlarmPlugin.isValidAlarmId(Integer.MIN_VALUE));
        assertFalse(NativeAlarmPlugin.isValidAlarmId((long) Integer.MAX_VALUE + 1L));
    }

    @Test
    public void requestCodeRangeStaysNonNegativeAndBounded() {
        // PendingIntent request codes are ints, so the accepted range must stay within int bounds.
        assertEquals(0x7fffffffL, NativeAlarmPlugin.MAX_ALARM_ID);
        assertTrue(NativeAlarmPlugin.MAX_ALARM_ID <= Integer.MAX_VALUE);
    }

    @Test
    public void acceptsWholeNumberInputsFromTheBridge() {
        assertEquals(Long.valueOf(1L), NativeAlarmPlugin.exactLong(Integer.valueOf(1)));
        assertEquals(Long.valueOf(1L), NativeAlarmPlugin.exactLong(Double.valueOf(1.0d)));
        assertEquals(Long.valueOf(1L), NativeAlarmPlugin.exactLong(Long.valueOf(1L)));
        assertEquals(Long.valueOf(1780000000000L), NativeAlarmPlugin.exactLong(
                Long.valueOf(1780000000000L)
        ));
    }

    @Test
    public void rejectsFractionalAndOverflowingInputs() {
        assertNull(NativeAlarmPlugin.exactLong(Double.valueOf(1.5d)));
        assertNull(NativeAlarmPlugin.exactLong(Double.valueOf(1.0E20d)));
        // A value that still fits in a long is returned and rejected later by the range check.
        assertEquals(
                Long.valueOf(Long.MAX_VALUE),
                NativeAlarmPlugin.exactLong(Long.valueOf(Long.MAX_VALUE))
        );
    }

    @Test
    public void rejectsNonNumericInputs() {
        assertNull(NativeAlarmPlugin.exactLong(null));
        assertNull(NativeAlarmPlugin.exactLong("1"));
        assertNull(NativeAlarmPlugin.exactLong(Boolean.TRUE));
        assertNull(NativeAlarmPlugin.exactLong(Double.valueOf(Double.NaNd)));
    }

    @Test
    public void acceptsAlarmTimesInsideTheHorizon() {
        assertTrue(NativeAlarmPlugin.isValidAlarmTime(NOW, NOW + 1L));
        assertTrue(NativeAlarmPlugin.isValidAlarmTime(0L, NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS));
        assertTrue(NativeAlarmPlugin.isValidAlarmTime(Long.MAX_VALUE - 1L, Long.MAX_VALUE));
    }

    @Test
    public void rejectsAlarmTimesThatAreNotStrictlyInTheFuture() {
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(NOW, NOW));
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(NOW, NOW - 1L));
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(Long.MAX_VALUE, Long.MAX_VALUE));
    }

    @Test
    public void rejectsAlarmTimesBeyondTheHorizonWithoutOverflowing() {
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(0L, NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS + 1L));
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(0L, Long.MAX_VALUE));
        assertFalse(NativeAlarmPlugin.isValidAlarmTime(NOW, Long.MAX_VALUE));
    }

    @Test
    public void horizonIsBoundedAndNotZero() {
        assertTrue(NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS > 0L);
        assertTrue(NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS >= 365L * 24L * 60L * 60L * 1000L);
    }

    @Test
    public void horizonAcceptsStaleTimesButRejectsUnreachableOnes() {
        // A timestamp in the past is a normal entry (the alarm just fired) and is only refused
        // by isValidAlarmTime, never by the horizon gate on its own.
        assertTrue(NativeAlarmPlugin.isWithinHorizon(NOW, NOW - 1L));
        assertTrue(NativeAlarmPlugin.isWithinHorizon(NOW, 1L));
        assertTrue(NativeAlarmPlugin.isWithinHorizon(
                NOW,
                NOW + NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS
        ));
        assertFalse(NativeAlarmPlugin.isWithinHorizon(
                NOW,
                NOW + NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS + 1L
        ));
        assertFalse(NativeAlarmPlugin.isWithinHorizon(NOW, Long.MAX_VALUE));
    }

    @Test
    public void horizonRejectsNonPositiveTimestampsWithoutOverflowing() {
        assertFalse(NativeAlarmPlugin.isWithinHorizon(NOW, 0L));
        assertFalse(NativeAlarmPlugin.isWithinHorizon(NOW, -1L));
        assertFalse(NativeAlarmPlugin.isWithinHorizon(NOW, Long.MIN_VALUE));
        // A negative "now" cannot be produced by the clock, and the guard has to keep the
        // subtraction from wrapping rather than trusting its caller.
        assertFalse(NativeAlarmPlugin.isWithinHorizon(-1L, Long.MIN_VALUE));
    }

    @Test
    public void everyPendingIntentIsImmutable() {
        // FLAG_IMMUTABLE is a compile-time constant, so this stays JVM-safe. The platform has
        // required an explicit mutability flag since API 31, and minSdk is already 24.
        assertEquals(PendingIntent.FLAG_IMMUTABLE, NativeAlarmPlugin.immutablePendingIntentFlag());
        assertTrue(
                (NativeAlarmPlugin.immutablePendingIntentFlag() & PendingIntent.FLAG_MUTABLE) == 0
        );
    }

    @Test
    public void exactIdEnforcesTheThirtyOneBitRange() {
        assertEquals(Integer.valueOf(1), NativeAlarmPlugin.exactId(Long.valueOf(1L)));
        assertEquals(Integer.valueOf(0x7fffffff), NativeAlarmPlugin.exactId(Long.valueOf(0x7fffffffL)));
        assertNull(NativeAlarmPlugin.exactId(Long.valueOf(0L)));
        assertNull(NativeAlarmPlugin.exactId(Long.valueOf(-1L)));
        assertNull(NativeAlarmPlugin.exactId(Long.valueOf(0x80000000L)));
        assertNull(NativeAlarmPlugin.exactId(Double.valueOf(1.5d)));
        assertNull(NativeAlarmPlugin.exactId("7"));
        assertNull(NativeAlarmPlugin.exactId(null));
        // A whole double inside the range is still an acceptable id, matching the ids the web
        // layer computes.
        assertEquals(Integer.valueOf(7), NativeAlarmPlugin.exactId(Double.valueOf(7.0d)));
    }

    @Test
    public void retainArmableDropsExpiredDefinitions() {
        List<NativeAlarmPlugin.AlarmDefinition> stored = new ArrayList<>();
        stored.add(new NativeAlarmPlugin.AlarmDefinition(1, NOW - 1L, "expired", "b"));
        stored.add(new NativeAlarmPlugin.AlarmDefinition(2, NOW + 1L, "due", "b"));
        stored.add(new NativeAlarmPlugin.AlarmDefinition(3, NOW - 60_000L, "older", "b"));

        List<NativeAlarmPlugin.AlarmDefinition> armable =
                NativeAlarmPlugin.retainArmable(stored, NOW);
        assertEquals(1, armable.size());
        assertEquals(2, armable.get(0).id());
        // The same store one millisecond later has nothing left to arm.
        assertTrue(NativeAlarmPlugin.retainArmable(stored, NOW + 2L).isEmpty());
    }

    @Test
    public void retainArmableKeepsTheOriginalOrderAndInstances() {
        List<NativeAlarmPlugin.AlarmDefinition> stored = new ArrayList<>();
        stored.add(new NativeAlarmPlugin.AlarmDefinition(4, NOW - 1L, "old", "b"));
        stored.add(new NativeAlarmPlugin.AlarmDefinition(9, NOW + 60_000L, "live", "b"));
        stored.add(new NativeAlarmPlugin.AlarmDefinition(11, NOW + 120_000L, "live2", "b"));

        List<NativeAlarmPlugin.AlarmDefinition> armable =
                NativeAlarmPlugin.retainArmable(stored, NOW);
        assertEquals(2, armable.size());
        assertEquals(9, armable.get(0).id());
        assertEquals(11, armable.get(1).id());
        // The survivors are the same objects, not copies: callers arm and persist this list.
        assertSame(stored.get(1), armable.get(0));
    }

    @Test
    public void retainArmableDropsUnreachableTimestampsAndIsNullSafe() {
        List<NativeAlarmPlugin.AlarmDefinition> stored = new ArrayList<>();
        stored.add(new NativeAlarmPlugin.AlarmDefinition(
                5,
                NOW + NativeAlarmPlugin.MAX_ALARM_HORIZON_MILLIS + 1L,
                "far",
                "b"
        ));
        assertTrue(NativeAlarmPlugin.retainArmable(stored, NOW).isEmpty());
        assertTrue(NativeAlarmPlugin.retainArmable(null, NOW).isEmpty());
        assertTrue(NativeAlarmPlugin.retainArmable(
                Collections.<NativeAlarmPlugin.AlarmDefinition>emptyList(),
                NOW
        ).isEmpty());
    }

    @Test
    public void retainArmableReturnsAMutableListTheStoreCanBeWrittenFrom() {
        // The pruned list is passed straight to upsertDefinition/persistDefinitions, so it has to
        // be a fresh list rather than a read-only view of the loaded store.
        List<NativeAlarmPlugin.AlarmDefinition> armable =
                NativeAlarmPlugin.retainArmable(definitions(1), NOW);
        armable.add(new NativeAlarmPlugin.AlarmDefinition(2, NOW + 1L, "t", "b"));
        assertEquals(2, armable.size());
    }

    @Test
    public void pruningIsWhatKeepsTheStoreBelowTheDefinitionCap() {
        // The store is bounded, and the web layer re-schedules without ever replacing the whole
        // store, so without pruning a long-lived install would fill it and then refuse every
        // alarm. A full store of expired entries must therefore still accept a new alarm.
        List<NativeAlarmPlugin.AlarmDefinition> full = new ArrayList<>();
        for (int id = 1; id <= NativeAlarmPlugin.MAX_DEFINITIONS; id++) {
            full.add(new NativeAlarmPlugin.AlarmDefinition(id, NOW - 1L, "t", "b"));
        }
        List<NativeAlarmPlugin.AlarmDefinition> armable =
                NativeAlarmPlugin.retainArmable(full, NOW);
        assertEquals(0, armable.size());
        assertTrue(armable.size() < NativeAlarmPlugin.MAX_DEFINITIONS);
    }

    @Test
    public void shouldRewriteWhenPruningRemovedSomething() {
        // 5 entries on disk, 5 loaded, 3 still armable: the two expired ones have to go.
        assertTrue(NativeAlarmPlugin.shouldRewriteStore(5, 5, 3));
    }

    @Test
    public void shouldNotRewriteWhenTheStoreIsAlreadyExactlyRight() {
        assertFalse(NativeAlarmPlugin.shouldRewriteStore(4, 4, 4));
        // The empty store is the common case: nothing persisted, nothing loaded, nothing to arm.
        assertFalse(NativeAlarmPlugin.shouldRewriteStore(0, 0, 0));
    }

    @Test
    public void shouldRewriteWhenTheLoadDroppedEntriesEvenIfNothingExpired() {
        // This is the case the size comparison used to miss. The store held 5 entries, the
        // loader could only make sense of 3 (a duplicate id, a non-numeric time), and all 3 are
        // still armable - so comparing the two list sizes reports "clean" and the store keeps
        // the 2 entries the loader silently skipped, losing those alarms for good. Comparing
        // against what was persisted is what catches it.
        assertTrue(NativeAlarmPlugin.shouldRewriteStore(5, 3, 3));
    }

    @Test
    public void shouldRewriteAnUnparseableStore() {
        // persistedCount is reported as a negative sentinel when the blob could not be parsed,
        // which can never equal a real count, so a corrupt store is replaced by a clean one.
        assertEquals(
                -1,
                NativeAlarmPlugin.UNPARSED_STORE
        );
        assertTrue(NativeAlarmPlugin.UNPARSED_STORE < 0);
        assertTrue(NativeAlarmPlugin.shouldRewriteStore(
                NativeAlarmPlugin.UNPARSED_STORE,
                0,
                0
        ));
    }

    @Test
    public void shouldRewriteWhenPruningAndLossyLoadHappenTogether() {
        assertTrue(NativeAlarmPlugin.shouldRewriteStore(9, 6, 1));
    }

    @Test
    public void storedDefinitionsReportsAnEmptyStoreConsistently() {
        // Nothing persisted must read back as zero persisted and zero loaded, so the two
        // counts agree and a reconcile pass does no pointless write on a fresh install.
        assertEquals(0, NativeAlarmPlugin.StoredDefinitions.empty().persistedCount());
        assertTrue(NativeAlarmPlugin.StoredDefinitions.empty().definitions().isEmpty());
        assertFalse(NativeAlarmPlugin.shouldRewriteStore(
                NativeAlarmPlugin.StoredDefinitions.empty().persistedCount(),
                NativeAlarmPlugin.StoredDefinitions.empty().definitions().size(),
                0
        ));
    }

    @Test
    public void deliveryFallbacksAreDistinctFromTheSchedulingDefaults() {
        // The two pairs answer different questions: DEFAULT_* is what the web layer sends when
        // the user named nothing, FALLBACK_* is what the alarm shows when it fires with no
        // usable wording attached. The notification, the activity and activity_alarm.xml all
        // render the fallback, so it has to be the user-facing wording.
        assertEquals("Time's Up!", NativeAlarmPlugin.FALLBACK_TITLE);
        assertEquals(
                "Your scheduled time has finished.",
                NativeAlarmPlugin.FALLBACK_BODY
        );
        assertFalse(NativeAlarmPlugin.FALLBACK_TITLE.equals(NativeAlarmPlugin.DEFAULT_TITLE));
        assertFalse(NativeAlarmPlugin.FALLBACK_BODY.equals(NativeAlarmPlugin.DEFAULT_BODY));
    }

    @Test
    public void theFallbacksFitInsideTheSanitisedLimits() {
        // The delivery side runs the fallbacks through sanitizeText with these same limits, so
        // a fallback longer than its limit would be silently truncated on every single alarm.
        assertTrue(NativeAlarmPlugin.FALLBACK_TITLE.length()
                <= NativeAlarmPlugin.MAX_TITLE_LENGTH);
        assertTrue(NativeAlarmPlugin.FALLBACK_BODY.length()
                <= NativeAlarmPlugin.MAX_BODY_LENGTH);
    }

    @Test
    public void sanitizeTextNeverSplitsASurrogatePair() {
        // "a" + U+1F600 is 3 UTF-16 units but 2 code points. A limit of 2 lands between the
        // halves of the emoji, and a naive substring would emit a lone surrogate - not a valid
        // character, and one that does not survive the round trip through a Bundle to the
        // system server as the same string.
        String emoji = "a\uD83D\uDE00";
        String truncated = NativeAlarmPlugin.sanitizeText(emoji, "fallback", 2);
        assertEquals("a", truncated);
        // No unpaired surrogate may survive in the result.
        assertFalse(hasUnpairedSurrogate(truncated));
    }

    @Test
    public void sanitizeTextKeepsWholeCodePointsWhenTheBoundaryIsSafe() {
        // A limit that lands after the emoji keeps it, and the length is allowed to come out
        // one under the limit rather than splitting.
        assertEquals("a\uD83D\uDE00", NativeAlarmPlugin.sanitizeText("a\uD83D\uDE00b", "fb", 3));
        // A limit that lands on the leading high surrogate drops just that one unit.
        assertEquals("a", NativeAlarmPlugin.sanitizeText("a\uD83D\uDE00", "fb", 2));
    }

    @Test
    public void sanitizeTextHandlesAnUnpairedSurrogateInTheInput() {
        // A string that already contains a lone surrogate is not made worse: the truncation
        // point is not inside a pair, so the input's own contents are preserved as given.
        String loneHigh = "ab\uD83D";
        assertEquals(loneHigh, NativeAlarmPlugin.sanitizeText(loneHigh, "fallback", 3));
        // And an unpaired low surrogate before a genuine pair is not mistaken for one.
        assertEquals("a\uDC00", NativeAlarmPlugin.sanitizeText("a\uDC00\uD83D\uDE00", "fb", 3));
    }

    @Test
    public void sanitizeTextTruncatesAsciiAtTheExactLimit() {
        // The non-surrogate path must still be a plain cut at the limit, not one short.
        assertEquals("0123456789", NativeAlarmPlugin.sanitizeText("0123456789abc", "fb", 10));
        assertEquals(10, NativeAlarmPlugin.sanitizeText("0123456789abc", "fb", 10).length());
    }

    @Test
    public void sanitizeTextTruncatesToNothingAtALimitOfOneBeforeAnyPair() {
        // maxLength 1 with an emoji first: the only unit in range is a high surrogate, so the
        // result is empty rather than a lone surrogate.
        assertEquals("", NativeAlarmPlugin.sanitizeText("\uD83D\uDE00abc", "fallback", 1));
        assertFalse(hasUnpairedSurrogate(
                NativeAlarmPlugin.sanitizeText("\uD83D\uDE00abc", "fallback", 1)
        ));
    }

    @Test
    public void alarmVibrationPatternIsSharedAndDefensivelyCopied() {
        // AlarmActivity drives the Vibrator with this and the notification channel is created
        // from it, so a caller that mutated the array would corrupt the other consumer.
        long[] first = NativeAlarmPlugin.alarmVibrationPattern();
        long[] second = NativeAlarmPlugin.alarmVibrationPattern();
        assertTrue(first.length > 0);
        assertArrayEquals(first, second);
        assertNotSame(first, second);
        // Mutating the returned copy must not reach the constant.
        first[0] = 999L;
        assertFalse(999L == NativeAlarmPlugin.alarmVibrationPattern()[0]);
    }

    @Test
    public void storeAndTextLimitsAreBounded() {
        assertTrue(NativeAlarmPlugin.MAX_DEFINITIONS > 0);
        assertTrue(NativeAlarmPlugin.MAX_TITLE_LENGTH > 0);
        assertTrue(NativeAlarmPlugin.MAX_BODY_LENGTH >= NativeAlarmPlugin.MAX_TITLE_LENGTH);
    }

    @Test
    public void sanitizeTextFallsBackForMissingValues() {
        assertEquals("fallback", NativeAlarmPlugin.sanitizeText(null, "fallback", 16));
        assertEquals("fallback", NativeAlarmPlugin.sanitizeText("", "fallback", 16));
        assertEquals("", NativeAlarmPlugin.sanitizeText(null, null, 16));
    }

    @Test
    public void sanitizeTextKeepsValuesWithinTheLimit() {
        assertEquals("abc", NativeAlarmPlugin.sanitizeText("abc", "fallback", 16));
        String exact = "0123456789abcdef";
        assertEquals(exact, NativeAlarmPlugin.sanitizeText(exact, "fallback", exact.length()));
    }

    @Test
    public void sanitizeTextTruncatesOversizedValues() {
        assertEquals("0123456789", NativeAlarmPlugin.sanitizeText("0123456789abc", "fallback", 10));
        assertEquals("", NativeAlarmPlugin.sanitizeText("abc", "fallback", 0));
    }

    @Test
    public void syncCancelsOnlyIdsMissingFromTheIncomingStore() {
        List<NativeAlarmPlugin.AlarmDefinition> existing = definitions(1, 2, 3);
        List<NativeAlarmPlugin.AlarmDefinition> incoming = definitions(2, 3);
        assertEquals(Collections.singleton(1), NativeAlarmPlugin.idsToCancel(existing, incoming));
    }

    @Test
    public void syncIsOrderIndependentAndNeverCancelsAKeptId() {
        List<NativeAlarmPlugin.AlarmDefinition> existing = definitions(5, 6, 7);
        List<NativeAlarmPlugin.AlarmDefinition> incoming = definitions(7, 6, 5);
        assertTrue(NativeAlarmPlugin.idsToCancel(existing, incoming).isEmpty());
    }

    @Test
    public void syncCancelsEverythingWhenTheIncomingStoreIsEmptyOrAbsent() {
        List<NativeAlarmPlugin.AlarmDefinition> existing = definitions(1, 2);
        assertEquals(setOf(1, 2), NativeAlarmPlugin.idsToCancel(existing, Collections.emptyList()));
        assertEquals(setOf(1, 2), NativeAlarmPlugin.idsToCancel(existing, null));
    }

    @Test
    public void syncCancelsNothingWhenThereIsNoExistingStore() {
        assertTrue(NativeAlarmPlugin.idsToCancel(null, definitions(1)).isEmpty());
        assertTrue(NativeAlarmPlugin.idsToCancel(
                Collections.emptyList(),
                definitions(1)
        ).isEmpty());
    }

    @Test
    public void syncReportsDuplicateStoreIdsOnce() {
        List<NativeAlarmPlugin.AlarmDefinition> existing = definitions(9, 9, 8);
        Set<Integer> cancelled = NativeAlarmPlugin.idsToCancel(existing, definitions(8));
        assertEquals(Collections.singleton(9), cancelled);
    }

    @Test
    public void definitionCarriesTheValidatedFields() {
        NativeAlarmPlugin.AlarmDefinition definition =
                new NativeAlarmPlugin.AlarmDefinition(42, NOW + 5L, "title", "body");
        assertEquals(42, definition.id());
        assertEquals(NOW + 5L, definition.time());
        assertEquals("title", definition.title());
        assertEquals("body", definition.body());
    }

    private static List<NativeAlarmPlugin.AlarmDefinition> definitions(int... ids) {
        List<NativeAlarmPlugin.AlarmDefinition> definitions = new ArrayList<>();
        for (int id : ids) {
            definitions.add(new NativeAlarmPlugin.AlarmDefinition(id, NOW + 1L, "t", "b"));
        }
        return definitions;
    }

    private static Set<Integer> setOf(int... values) {
        Set<Integer> result = new HashSet<>();
        for (int value : values) {
            result.add(value);
        }
        return result;
    }

    /**
     * True when the string holds a high or low surrogate with no partner on either side, which
     * is what truncating inside a pair would produce. Iterated by code point so a well-formed
     * pair reads as one 2-unit character and is never reported.
     */
    private static boolean hasUnpairedSurrogate(String value) {
        for (int index = 0; index < value.length(); ) {
            char unit = value.charAt(index);
            if (Character.isHighSurrogate(unit)) {
                if (index + 1 >= value.length()
                        || !Character.isLowSurrogate(value.charAt(index + 1))) {
                    return true;
                }
                index += 2;
            } else if (Character.isLowSurrogate(unit)) {
                return true;
            } else {
                index++;
            }
        }
        return false;
    }
}
