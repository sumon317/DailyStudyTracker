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

function getTimeInMinutes(time: string): number | null {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(time);
    if (!match) {
        return null;
    }
    const hours = Number.parseInt(match[1] ?? '', 10);
    const minutes = Number.parseInt(match[2] ?? '', 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
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
                if (!subject.time) {
                    return true;
                }
                const startMinutes = getTimeInMinutes(subject.time);
                if (startMinutes === null) {
                    return true;
                }
                const plannedMinutes = Number.parseFloat(subject.planned) || 0;
                return currentMinutes < startMinutes + Math.max(0, plannedMinutes);
            })
            .sort((first, second) => {
                if (first.time !== second.time) {
                    if (!first.time) {
                        return 1;
                    }
                    if (!second.time) {
                        return -1;
                    }
                    return first.time.localeCompare(second.time);
                }
                return first.id - second.id;
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
