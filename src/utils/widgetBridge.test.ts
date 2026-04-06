import { describe, expect, it, vi } from 'vitest';
import { updateWidget } from './widgetBridge';

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => ({
        updateData: vi.fn(),
    })),
}));

describe('widgetBridge', () => {
    describe('updateWidget', () => {
        it('should not throw when called with empty subjects', async () => {
            await expect(updateWidget([])).resolves.not.toThrow();
        });

        it('should handle subjects without time', async () => {
            const subjects = [
                { id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time: '', reminder: false },
            ];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });

        it('should handle subjects with time', async () => {
            const now = new Date();
            const futureHour = now.getHours() + 1;
            const time = `${futureHour.toString().padStart(2, '0')}:00`;

            const subjects = [{ id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time, reminder: false }];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });

        it('should filter out past subjects', async () => {
            const now = new Date();
            const pastHour = now.getHours() - 1;
            const time = `${pastHour.toString().padStart(2, '0')}:00`;

            const subjects = [{ id: 1, name: 'Math', planned: '60', actual: '30', kpi: 'Y', time, reminder: false }];
            await expect(updateWidget(subjects as never)).resolves.not.toThrow();
        });
    });
});
