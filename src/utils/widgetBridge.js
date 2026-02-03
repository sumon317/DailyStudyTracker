import { registerPlugin } from '@capacitor/core';

const WidgetData = registerPlugin('WidgetData');

export const updateWidget = async (subjects) => {
    try {
        // Filter relevant data to keep JSON small
        const widgetData = subjects.map(s => ({
            name: s.name,
            planned: s.planned,
            actual: s.actual,
            kpi: s.kpi,
            time: s.time,
            reminder: s.reminder
        }));

        const data = JSON.stringify(widgetData);
        await WidgetData.updateData({ data });
        console.log('Widget data updated');
    } catch (e) {
        // Ignore errors on web or if plugin missing
        console.warn('Widget update skipped:', e);
    }
};
