import { registerPlugin } from '@capacitor/core';
import type { Subject } from '../types';
import { getTodayLocalDate, isValidDateKey } from '../utils/dateUtils';

interface WidgetDataPlugin {
    updateData: (options: { data: string; date: string }) => Promise<void>;
}

const WidgetData = registerPlugin<WidgetDataPlugin>('WidgetData');

/**
 * Upper bound on the subjects a single widget renders, mirrored from
 * `WidgetTimeUtils.MAX_ITEMS` in
 * `android/app/src/main/java/com/sumon/studytracker/widget/WidgetTimeUtils.java`.
 *
 * The day record itself allows far more (see `MAX_SUBJECTS` in `storage.ts`), so a day can hold
 * more rows than the widget will ever show. Both ends of the bridge therefore *validate* against
 * this cap and reject: the web layer refuses to publish a payload past it and the plugin refuses
 * to accept one. The native plugin used to truncate instead, which meant the web layer had no
 * idea the cap existed and the widget quietly rendered a prefix of the day with nothing anywhere
 * saying the rest had been dropped.
 */
export const MAX_WIDGET_ITEMS = 200;

/**
 * Minutes since midnight for a usable `H:MM` or `HH:MM` time, or `null` when the value is not
 * one.
 *
 * Mirrors `WidgetTimeUtils.timeOfDayMinutes` on the native side. The native widget re-sorts and
 * re-filters the payload it is given, so both ends have to agree on which strings count as a
 * time: a row this layer treats as untimed but the native treats as timed would move under the
 * user while they are looking at it. `9:05` is a time; `9:5` is not - the minute part is always
 * two digits, exactly as the native side has always documented.
 */
function getTimeInMinutes(time: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        return null;
    }
    const hours = Number.parseInt(match[1] ?? '', 10);
    const minutes = Number.parseInt(match[2] ?? '', 10);
    if (hours > 23 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

/**
 * Planned minutes for a subject, or `0` when the value is not a usable number.
 *
 * A non-finite value parses as a number but would make the row immortal: its window would never
 * end, so it would outlive every other subject on the day. The native side rejects the same
 * values for the same reason.
 */
function getPlannedMinutes(planned: string): number {
    const parsed = Number.parseFloat(planned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const updateWidget = async (subjects: Subject[], date?: string): Promise<void> => {
    const today = getTodayLocalDate();
    const selectedDate = isValidDateKey(date) ? date : today;

    try {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const widgetData = subjects
            .map((subject) => ({
                id: subject.id,
                name: subject.name,
                planned: subject.planned,
                actual: subject.actual,
                kpi: subject.kpi,
                time: subject.time,
                reminder: subject.reminder,
            }))
            .filter((subject) => {
                const startMinutes = getTimeInMinutes(subject.time);
                if (startMinutes === null) {
                    // No usable window to close, so the row stays visible.
                    return true;
                }
                return currentMinutes < startMinutes + getPlannedMinutes(subject.planned);
            })
            .sort((first, second) => {
                // Ordered by actual time of day rather than lexically, so "9:05" sorts before
                // "10:00". Times that cannot be read sort last, and rows that tie keep the order
                // they were stored in - the same contract as the native comparator, which sorts
                // the payload again when it renders.
                const firstMinutes = getTimeInMinutes(first.time);
                const secondMinutes = getTimeInMinutes(second.time);
                if (firstMinutes === null && secondMinutes === null) {
                    return 0;
                }
                if (firstMinutes === null) {
                    return 1;
                }
                if (secondMinutes === null) {
                    return -1;
                }
                return firstMinutes - secondMinutes;
            });

        // Refused here rather than published and truncated on the other side. The
        // caller is the provider's widget publication, which treats a rejection as
        // "the widget is out of date" and says nothing about it - so the honest
        // place for this refusal to be visible is in the payload never being sent.
        if (widgetData.length > MAX_WIDGET_ITEMS) {
            return;
        }

        await WidgetData.updateData({ data: JSON.stringify(widgetData), date: selectedDate });
    } catch {
        return;
    }
};

/**
 * The native widget only renders the record whose stored date is today, so publishing a
 * non-today day would blank the widget instead of refreshing it.
 */
export const shouldPublishWidget = (date: string, today = getTodayLocalDate()): boolean => date === today;
