import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLocalDate } from '../utils/dateUtils';
import { MAX_WIDGET_ITEMS, shouldPublishWidget, updateWidget } from './widgetService';

const { updateData } = vi.hoisted(() => ({
    updateData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => ({
        updateData,
    })),
}));

describe('widgetBridge', () => {
    beforeEach(() => {
        updateData.mockClear();
        updateData.mockResolvedValue(undefined);
    });

    describe('updateWidget', () => {
        it('sends the selected date and stable subject IDs using the native contract', async () => {
            const subjects = [
                { id: 7, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time: '', reminder: false },
            ];

            await updateWidget(subjects, '2024-01-15');

            expect(updateData).toHaveBeenCalledTimes(1);
            const payload = updateData.mock.calls[0]?.[0] as { data: string; date: string };
            expect(payload.date).toBe('2024-01-15');
            expect(JSON.parse(payload.data)).toEqual([
                {
                    id: 7,
                    name: 'Math',
                    planned: '60',
                    actual: '30',
                    kpi: 'Y',
                    time: '',
                    reminder: false,
                },
            ]);
        });

        it('does not throw when called with empty subjects', async () => {
            await expect(updateWidget([])).resolves.not.toThrow();
        });

        it('handles subjects without time', async () => {
            const subjects = [
                { id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time: '', reminder: false },
            ];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });

        it('handles subjects with time', async () => {
            const now = new Date();
            const futureHour = (now.getHours() + 1) % 24;
            const time = `${futureHour.toString().padStart(2, '0')}:00`;
            const subjects = [{ id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time, reminder: false }];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });

        it('filters out past subjects for the current date', async () => {
            const now = new Date();
            const pastHour = (now.getHours() - 1 + 24) % 24;
            const time = `${pastHour.toString().padStart(2, '0')}:00`;
            const subjects = [{ id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time, reminder: false }];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });

        it('does not push a non-today record, which would blank the today-only widget', async () => {
            const subjects = [
                { id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time: '', reminder: false },
            ];

            expect(shouldPublishWidget('2024-01-15')).toBe(false);
            expect(shouldPublishWidget(formatLocalDate(new Date()))).toBe(true);

            // The service still honours an explicit date; the caller decides what to publish.
            await updateWidget(subjects, '2024-01-15');
            expect(updateData).toHaveBeenCalledTimes(1);
        });

        it('pushes today when the date is omitted or invalid', async () => {
            const today = formatLocalDate(new Date());
            const subjects = [{ id: 3, name: 'Eco', planned: '30', actual: '0', kpi: 'N', time: '', reminder: false }];

            await updateWidget(subjects);
            await updateWidget(subjects, 'not-a-date');

            expect(updateData).toHaveBeenCalledTimes(2);
            for (const call of updateData.mock.calls) {
                expect((call[0] as { date: string }).date).toBe(today);
            }
        });

        it('drops subjects whose scheduled window has already elapsed today', async () => {
            const now = new Date();
            const pastHour = (now.getHours() - 1 + 24) % 24;
            const time = `${pastHour.toString().padStart(2, '0')}:00`;
            const subjects = [
                { id: 1, name: 'Elapsed', planned: '10', actual: '0', kpi: 'N', time, reminder: false },
                { id: 2, name: 'Untimed', planned: '10', actual: '0', kpi: 'N', time: '', reminder: false },
            ];

            await updateWidget(subjects, formatLocalDate(now));

            const payload = updateData.mock.calls[0]?.[0] as { data: string };
            const names = (JSON.parse(payload.data) as Array<{ name: string }>).map((entry) => entry.name);
            expect(names).toEqual(['Untimed']);
        });

        it('keeps a subject whose scheduled window is still open today', async () => {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const time = `${Math.floor(currentMinutes / 60)
                .toString()
                .padStart(2, '0')}:${(currentMinutes % 60).toString().padStart(2, '0')}`;
            const subjects = [
                { id: 1, name: 'InProgress', planned: '60', actual: '5', kpi: 'N', time, reminder: false },
            ];

            await updateWidget(subjects, formatLocalDate(now));

            const payload = updateData.mock.calls[0]?.[0] as { data: string };
            expect(JSON.parse(payload.data)).toHaveLength(1);
        });

        it('swallows plugin failures', async () => {
            updateData.mockRejectedValueOnce(new Error('bridge down'));
            await expect(updateWidget([])).resolves.toBeUndefined();
        });

        it('publishes a list right up to the cap the native side enforces', async () => {
            // `MAX_WIDGET_ITEMS` mirrors `WidgetTimeUtils.MAX_ITEMS`. Both ends
            // validate against the same number, so the boundary itself has to be
            // accepted - an off-by-one here would silently stop publishing a day
            // that renders perfectly well.
            const atCap = Array.from({ length: MAX_WIDGET_ITEMS }, (_unused, index) => ({
                id: index + 1,
                name: `Subject ${index + 1}`,
                planned: '60',
                actual: '0',
                kpi: 'N',
                time: '',
                reminder: false,
            }));

            await updateWidget(atCap as never);

            expect(updateData).toHaveBeenCalledTimes(1);
            const payload = updateData.mock.calls[0]?.[0] as { data: string };
            expect(JSON.parse(payload.data)).toHaveLength(MAX_WIDGET_ITEMS);
        });

        it('refuses a list past the cap instead of publishing one the plugin would truncate', async () => {
            // The native plugin used to truncate silently, so the web layer had no
            // idea the cap existed and the widget rendered a prefix of the day with
            // nothing anywhere saying the rest was dropped. It now rejects the same
            // payload for the same reason, and this side refuses to send it.
            const overCap = Array.from({ length: MAX_WIDGET_ITEMS + 1 }, (_unused, index) => ({
                id: index + 1,
                name: `Subject ${index + 1}`,
                planned: '60',
                actual: '0',
                kpi: 'N',
                time: '',
                reminder: false,
            }));

            await updateWidget(overCap as never);

            expect(updateData).not.toHaveBeenCalled();
        });
    });
});
