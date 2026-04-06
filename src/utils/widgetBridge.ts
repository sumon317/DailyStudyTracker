import { registerPlugin } from '@capacitor/core';
import type { Subject } from '../types';

interface WidgetDataPlugin {
    updateData: (options: { data: string }) => Promise<void>;
}

const WidgetData = registerPlugin<WidgetDataPlugin>('WidgetData');

export const updateWidget = async (subjects: Subject[]) => {
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        const widgetData = subjects
            .map((s) => ({
                name: s.name,
                planned: s.planned,
                actual: s.actual,
                kpi: s.kpi,
                time: s.time,
                reminder: s.reminder,
            }))
            .filter((s) => {
                if (!s.time) {
                    return true;
                }
                try {
                    const parts = s.time.split(':');
                    const hours = parts[0] ? Number(parts[0]) : 0;
                    const minutes = parts[1] ? Number(parts[1]) : 0;
                    const plannedMinutes = Number.parseInt(s.planned, 10) || 0;
                    const endTotalMinutes = hours * 60 + minutes + plannedMinutes;
                    const currentTotalMinutes = currentHour * 60 + currentMinute;
                    return currentTotalMinutes < endTotalMinutes;
                } catch (_e) {
                    return true;
                }
            })
            .sort((a, b) => {
                if (!a.time && !b.time) {
                    return 0;
                }
                if (!a.time) {
                    return 1;
                }
                if (!b.time) {
                    return -1;
                }
                return a.time.localeCompare(b.time);
            });

        const data = JSON.stringify(widgetData);
        await WidgetData.updateData({ data });
    } catch (_e) {
        // Silently ignore widget update failures (widget may not be available)
    }
};
