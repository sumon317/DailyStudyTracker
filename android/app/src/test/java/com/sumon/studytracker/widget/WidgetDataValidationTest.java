package com.sumon.studytracker.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.GregorianCalendar;
import java.util.Locale;

public class WidgetDataValidationTest {

    @Test
    public void acceptsLocalDateKeys() {
        assertTrue(WidgetDataStore.isValidDate("2026-09-25"));
    }

    @Test
    public void rejectsMalformedDateKeys() {
        assertFalse(WidgetDataStore.isValidDate("2026-9-25"));
        assertFalse(WidgetDataStore.isValidDate(null));
    }

    @Test
    public void acceptsLeapDayInLeapYearAndRejectsItOtherwise() {
        assertTrue(WidgetDataStore.isValidDate("2024-02-29"));
        assertFalse(WidgetDataStore.isValidDate("2026-02-29"));
    }

    @Test
    public void rejectsOutOfRangeComponents() {
        assertFalse(WidgetDataStore.isValidDate("0000-01-01"));
        assertFalse(WidgetDataStore.isValidDate("2026-00-10"));
        assertFalse(WidgetDataStore.isValidDate("2026-13-10"));
        assertFalse(WidgetDataStore.isValidDate("2026-01-00"));
        assertFalse(WidgetDataStore.isValidDate("2026-01-32"));
    }

    @Test
    public void rejectsWrongLengthAndSeparatorPlacement() {
        assertFalse(WidgetDataStore.isValidDate(""));
        assertFalse(WidgetDataStore.isValidDate("2026-09-2"));
        assertFalse(WidgetDataStore.isValidDate("2026-09-255"));
        assertFalse(WidgetDataStore.isValidDate("2026/09/25"));
        assertFalse(WidgetDataStore.isValidDate("2026-09-25T00"));
    }

    /**
     * Regression: the shipped check resolved the candidate through a lenient {@code Calendar} and
     * then compared the requested day against the maximum of the month it rolled into, so every
     * impossible day that rolls forward into a 31 day month was accepted.
     */
    @Test
    public void rejectsImpossibleDaysInThirtyDayMonths() {
        assertFalse(WidgetDataStore.isValidDate("2026-04-31"));
        assertFalse(WidgetDataStore.isValidDate("2026-06-31"));
        assertFalse(WidgetDataStore.isValidDate("2026-09-31"));
        assertFalse(WidgetDataStore.isValidDate("2026-11-31"));
        assertTrue(WidgetDataStore.isValidDate("2026-04-30"));
        assertTrue(WidgetDataStore.isValidDate("2026-06-30"));
    }

    @Test
    public void rejectsEveryImpossibleDayOfAFebruary() {
        for (int year = 2000; year <= 2400; year++) {
            int maximum = WidgetDataStore.isLeapYear(year) ? 29 : 28;
            assertTrue(
                    year + "-02-" + maximum + " should be valid",
                    WidgetDataStore.isValidDate(String.format(Locale.US, "%04d-02-%02d", year, maximum))
            );
            if (maximum == 28) {
                assertFalse(
                        year + "-02-29 should be invalid",
                        WidgetDataStore.isValidDate(String.format(Locale.US, "%04d-02-29", year))
                );
            }
        }
    }

    @Test
    public void appliesFullGregorianLeapYearRule() {
        // Divisible by 4 is not enough: centuries are leap years only when divisible by 400.
        assertFalse(WidgetDataStore.isLeapYear(1900));
        assertFalse(WidgetDataStore.isValidDate("1900-02-29"));
        assertTrue(WidgetDataStore.isLeapYear(2000));
        assertTrue(WidgetDataStore.isValidDate("2000-02-29"));
        assertFalse(WidgetDataStore.isLeapYear(2026));
        assertTrue(WidgetDataStore.isLeapYear(2024));
        assertFalse(WidgetDataStore.isLeapYear(2023));
    }

    @Test
    public void reportsDaysPerMonth() {
        assertEquals(31, WidgetDataStore.daysInMonth(2026, 1));
        assertEquals(28, WidgetDataStore.daysInMonth(2026, 2));
        assertEquals(29, WidgetDataStore.daysInMonth(2024, 2));
        assertEquals(30, WidgetDataStore.daysInMonth(2026, 4));
        assertEquals(31, WidgetDataStore.daysInMonth(2026, 12));
        assertEquals(0, WidgetDataStore.daysInMonth(2026, 0));
        assertEquals(0, WidgetDataStore.daysInMonth(2026, 13));
    }

    @Test
    public void todayKeyIsWellFormedAndNotAnOlderDay() {
        String today = WidgetDataStore.todayKey();
        assertNotEquals("2000-01-01", today);
        assertEquals(10, today.length());
        assertTrue(WidgetDataStore.isValidDate(today));
    }

    @Test
    public void todayKeyMatchesTheGregorianLocalDate() {
        // todayKey() re-reads the clock itself, so it is sampled first and the independent
        // GregorianCalendar read follows. A midnight rollover between the two can only push the
        // key one day ahead of the calendar, so the following day is accepted too, for the same
        // reason todayKeyIgnoresTheDeviceLocaleCalendar allows a year of margin.
        String today = WidgetDataStore.todayKey();
        GregorianCalendar calendar = new GregorianCalendar();
        int year = calendar.get(GregorianCalendar.YEAR);
        int month = calendar.get(GregorianCalendar.MONTH) + 1;
        int day = calendar.get(GregorianCalendar.DAY_OF_MONTH);
        String expected = WidgetDataStore.formatDateKey(year, month, day);
        assertTrue(
                "expected " + today + " to be " + expected + " or the following day",
                today.equals(expected)
                        || today.equals(WidgetDataStore.formatDateKey(year, month, day + 1))
        );
        assertTrue(
                "isToday must accept the current day key",
                WidgetDataStore.isToday(today)
                        || WidgetDataStore.isToday(WidgetDataStore.formatDateKey(year, month, day + 1))
        );
    }

    /**
     * Regression: {@code Calendar.getInstance()} follows the default locale's calendar system, so
     * on a Buddhist locale such as {@code th-TH} it reported the year as 2569. The web layer sends
     * a proleptic Gregorian key, so the widget would never recognise "today" and would stay
     * permanently empty.
     */
    @Test
    public void todayKeyIgnoresTheDeviceLocaleCalendar() {
        Locale original = Locale.getDefault();
        try {
            Locale.setDefault(new Locale("th", "TH"));
            String thai = WidgetDataStore.todayKey();
            assertTrue("th-TH key must still be well formed", WidgetDataStore.isValidDate(thai));

            int gregorianYear = new GregorianCalendar().get(GregorianCalendar.YEAR);
            int reportedYear = Integer.parseInt(thai.substring(0, 4));
            // Allow a one year margin so a midnight rollover during the test cannot flake.
            assertTrue(
                    "expected a year near " + gregorianYear + " but got " + reportedYear,
                    Math.abs(reportedYear - gregorianYear) <= 1
            );
        } finally {
            Locale.setDefault(original);
        }
    }

    @Test
    public void dateValidationIgnoresTheDeviceLocale() {
        Locale original = Locale.getDefault();
        try {
            for (Locale locale : new Locale[]{
                    new Locale("th", "TH"),
                    new Locale("ar", "SA"),
                    new Locale("en", "US"),
                    Locale.ROOT,
            }) {
                Locale.setDefault(locale);
                assertEquals(locale.toString(), 28, WidgetDataStore.daysInMonth(2026, 2));
                assertFalse(locale.toString(), WidgetDataStore.isValidDate("2026-02-29"));
                assertTrue(locale.toString(), WidgetDataStore.isValidDate("2024-02-29"));
            }
        } finally {
            Locale.setDefault(original);
        }
    }

    @Test
    public void currentMinutesOfDayIsWithinTheDay() {
        int minutes = WidgetDataStore.currentMinutesOfDay();
        assertTrue("minutes out of range: " + minutes, minutes >= 0 && minutes < 24 * 60);
    }

    @Test
    public void formatsDateKeysInFixedWidth() {
        assertEquals("2026-01-02", WidgetDataStore.formatDateKey(2026, 1, 2));
        assertEquals("0007-12-31", WidgetDataStore.formatDateKey(7, 12, 31));
    }
}
