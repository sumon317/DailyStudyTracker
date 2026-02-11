import { registerPlugin } from '@capacitor/core';

const WidgetData = registerPlugin('WidgetData');

export const updateWidget = async (subjects) => {
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Filter relevant data and exclude subjects whose planned time has passed
        const widgetData = subjects
            .map(s => ({
                name: s.name,
                planned: s.planned,
                actual: s.actual,
                kpi: s.kpi,
                time: s.time,
                reminder: s.reminder
            }))
            .filter(s => {
                // Keep subjects with no time set (show them)
                if (!s.time) return true;
                // Parse time and check if it's in the future
                try {
                    const [hours, minutes] = s.time.split(':').map(Number);
                    // Add planned minutes to scheduled time to get end time
                    const plannedMinutes = parseInt(s.planned) || 0;
                    const endTotalMinutes = hours * 60 + minutes + plannedMinutes;
                    const currentTotalMinutes = currentHour * 60 + currentMinute;
                    return currentTotalMinutes < endTotalMinutes;
                } catch (e) {
                    return true; // Keep if can't parse
                }
            })
            .sort((a, b) => {
                // Sort by time ascending, empty time goes to bottom
                if (!a.time && !b.time) return 0;
                if (!a.time) return 1;
                if (!b.time) return -1;
                return a.time.localeCompare(b.time);
            });

        const data = JSON.stringify(widgetData);
        await WidgetData.updateData({ data });
        console.log('Widget data updated');
    } catch (e) {
        // Ignore errors on web or if plugin missing
        console.warn('Widget update skipped:', e);
    }
};
