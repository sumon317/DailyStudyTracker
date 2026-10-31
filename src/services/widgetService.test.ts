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

        it('keeps a malformed time rather than hiding the subject', async () => {
            // A corrupt stored time must not make the row disappear from the
            // widget: it cannot be compared with the clock, so the safe answer is
            // to keep showing it.
            const subjects = [
                { id: 1, name: 'Bad', planned: '30', actual: '0', kpi: 'N', time: '9:5', reminder: false },
                { id: 2, name: 'Impossible', planned: '30', actual: '0', kpi: 'N', time: '24:00', reminder: false },
            ];

            await updateWidget(subjects as never);

            const payload = updateData.mock.calls[0]?.[0] as { data: string };
            expect((JSON.parse(payload.data) as Array<{ name: string }>).map((entry) => entry.name)).toEqual([
                'Bad',
                'Impossible',
            ]);
        });

        it('orders timed subjects by start time and leaves untimed ones last', async () => {
            // The order must not depend on the hour the suite happens to run in. A subject is
            // hidden once its planned window has elapsed, so a fixed morning start would
            // vanish from the widget on every evening run - which is exactly what this test
            // used to do.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2024, 0, 15, 0, 0, 0));
            try {
                const subjects = [
                    { id: 3, name: 'Evening', planned: '30', actual: '0', kpi: 'N', time: '18:00', reminder: false },
                    { id: 2, name: 'Untimed', planned: '30', actual: '0', kpi: 'N', time: '', reminder: false },
                    { id: 1, name: 'Morning', planned: '30', actual: '0', kpi: 'N', time: '08:00', reminder: false },
                ];

                await updateWidget(subjects as never);

                const payload = updateData.mock.calls[0]?.[0] as { data: string };
                expect((JSON.parse(payload.data) as Array<{ name: string }>).map((entry) => entry.name)).toEqual([
                    'Morning',
                    'Evening',
                    'Untimed',
                ]);
            } finally {
                vi.useRealTimers();
            }
        });

        it('orders by the time of day rather than by the text of the time', async () => {
            // "9:05" is before "10:00" as a time of day, but after it as a string, because
            // "9" sorts after "1". A widget that ordered by text would show the evening
            // subject above the morning one.
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2024, 0, 15, 0, 0, 0));
            try {
                const subjects = [
                    { id: 1, name: 'Ten', planned: '30', actual: '0', kpi: 'N', time: '10:00', reminder: false },
                    { id: 2, name: 'Nine', planned: '30', actual: '0', kpi: 'N', time: '9:05', reminder: false },
                ];

                await updateWidget(subjects as never);

                const payload = updateData.mock.calls[0]?.[0] as { data: string };
                expect((JSON.parse(payload.data) as Array<{ name: string }>).map((entry) => entry.name)).toEqual([
                    'Nine',
                    'Ten',
                ]);
            } finally {
                vi.useRealTimers();
            }
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
