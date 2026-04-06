import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { NotificationScheduleResult } from '../types';

export const NotificationService = {
    safeId(id: string | number): number {
        const strId = String(id);
        let hash = 0;
        for (let i = 0; i < strId.length; i++) {
            const char = strId.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return (Math.abs(hash) ^ 0x5f3759df) & 0x7fffffff;
    },

    async checkExactAlarmPermission(): Promise<boolean> {
        if (!Capacitor.isNativePlatform()) {
            return true;
        }

        try {
            const result = await LocalNotifications.checkPermissions();
            const resultObj = result as unknown as Record<string, string>;
            if (resultObj.exactAlarm !== undefined) {
                return resultObj.exactAlarm === 'granted';
            }
            return true;
        } catch (_error) {
            return true;
        }
    },

    async openExactAlarmSettings(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        try {
            const { App } = await import('@capacitor/app');
            const openUrl = (App as unknown as Record<string, (opts: { url: string }) => Promise<void>>).openUrl;
            if (openUrl) {
                await openUrl({ url: `package:${await this.getPackageName()}` });
            }
        } catch (_error) {
            alert('Please go to Settings > Apps > Daily Study Tracker > Alarms & Reminders and enable the permission.');
        }
    },

    async getPackageName(): Promise<string> {
        try {
            const { App } = await import('@capacitor/app');
            const info = await App.getInfo();
            return info.id;
        } catch {
            return 'com.sumon.studytracker';
        }
    },

    async requestPermissions(): Promise<boolean> {
        try {
            const result = await LocalNotifications.requestPermissions();
            return result.display === 'granted';
        } catch (_error) {
            return false;
        }
    },

    async initialize(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        try {
            const channelId = 'study-alarms-v3';

            await LocalNotifications.createChannel({
                id: channelId,
                name: 'Study Alarms (High Volume)',
                description: 'Persistent and loud alarms for study tasks',
                importance: 5,
                visibility: 1,
                vibration: true,
                sound: 'alarm_loop.mp3',
            });

            await LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: 'TODO_ACTIONS',
                        actions: [{ id: 'mark-done', title: 'Mark as Done', foreground: true }],
                    },
                    {
                        id: 'ALARM_ACTIONS',
                        actions: [{ id: 'dismiss', title: 'Dismiss', foreground: false }],
                    },
                ],
            });
        } catch (_error) {
            // Silently ignore notification channel creation errors
        }
    },

    initListeners(
        onActionCallback: (data: { originalId: string | number; actionId: string; actionType: string }) => void,
        onReceiveCallback: (data: { originalId: string | number; actionType: string | undefined }) => void,
    ): void {
        LocalNotifications.removeAllListeners();

        LocalNotifications.addListener('localNotificationReceived', (notification) => {
            const extra = notification.extra as Record<string, string | number> | undefined;
            const originalId = extra?.originalId ?? notification.id;
            const actionType = notification.actionTypeId;

            if (onReceiveCallback) {
                onReceiveCallback({ originalId, actionType });
            }
        });

        LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
            const extra = notification.notification.extra as Record<string, string | number> | undefined;
            const originalId = extra?.originalId;
            const actionId = notification.actionId;
            const actionType = notification.notification.actionTypeId;

            if (originalId && onActionCallback) {
                onActionCallback({ originalId, actionId, actionType: actionType ?? '' });
            }
        });
    },

    async scheduleNotification(
        originalId: string | number,
        title: string,
        body: string,
        date: Date,
        actionType = 'ALARM_ACTIONS',
    ): Promise<NotificationScheduleResult> {
        try {
            const id = this.safeId(originalId);

            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) {
                    return { success: false, error: 'Permission not granted' };
                }
            }

            await LocalNotifications.schedule({
                notifications: [
                    {
                        title,
                        body,
                        id,
                        schedule: { at: date, allowWhileIdle: true },
                        smallIcon: 'ic_stat_icon_config_sample',
                        channelId: 'study-alarms-v3',
                        actionTypeId: actionType,
                        ongoing: true,
                        autoCancel: true,
                        extra: { originalId },
                    },
                ],
            });
            return { success: true };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            return { success: false, error: message };
        }
    },

    async scheduleDailyNotification(
        originalId: string | number,
        title: string,
        body: string,
        hour: number,
        minute: number,
        actionType = 'TODO_ACTIONS',
    ): Promise<NotificationScheduleResult> {
        try {
            const id = this.safeId(originalId);

            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) {
                    return { success: false, error: 'Permission not granted' };
                }
            }

            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(hour, minute, 0, 0);

            if (tomorrow.getTime() < Date.now()) {
                tomorrow.setDate(tomorrow.getDate() + 1);
            }

            await LocalNotifications.schedule({
                notifications: [
                    {
                        title,
                        body,
                        id,
                        schedule: {
                            at: tomorrow,
                            repeats: true,
                        },
                        smallIcon: 'ic_stat_icon_config_sample',
                        channelId: 'study-alarms-v3',
                        actionTypeId: actionType,
                        autoCancel: true,
                        extra: { originalId },
                    },
                ],
            });
            return { success: true };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            return { success: false, error: message };
        }
    },

    async cancelNotification(originalId: string | number): Promise<boolean> {
        try {
            const id = this.safeId(originalId);
            await LocalNotifications.cancel({ notifications: [{ id }] });
            return true;
        } catch (_error) {
            return false;
        }
    },

    async checkPermissions(): Promise<boolean> {
        try {
            const result = await LocalNotifications.checkPermissions();
            return result.display === 'granted';
        } catch (_error) {
            return false;
        }
    },

    async getPending(): Promise<LocalNotification[]> {
        try {
            const result = await LocalNotifications.getPending();
            return result.notifications.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                extra: n.extra as Record<string, unknown> | undefined,
            }));
        } catch (_error) {
            return [];
        }
    },
};

interface LocalNotification {
    id: number;
    title?: string;
    body?: string;
    extra?: Record<string, unknown>;
    actionTypeId?: string;
    schedule?: Record<string, unknown>;
}
