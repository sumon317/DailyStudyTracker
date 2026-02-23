import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export const NotificationService = {
    // Convert long ID (Date.now()) to 32-bit int for Android
    safeId(id) {
        // Simple hash to ensure it fits in 32-bit int
        // Android notification IDs must be int (approx -2B to +2B)
        // We handle string or number inputs
        const strId = String(id);
        let hash = 0;
        for (let i = 0; i < strId.length; i++) {
            const char = strId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Ensure strictly positive 31-bit integer to avoid any signed/unsigned confusion
        // We also xor with a magic number to scramble it further from common patterns
        return (Math.abs(hash) ^ 0x5F3759DF) & 0x7FFFFFFF;
    },

    // Check if exact alarm permission is granted (Android 12+)
    async checkExactAlarmPermission() {
        if (!Capacitor.isNativePlatform()) return true; // Web always "has" permission

        try {
            // Use Capacitor's checkPermissions which includes exactAlarm on newer plugin versions
            const result = await LocalNotifications.checkPermissions();
            // On Android 12+, exactAlarm will be 'denied' if not granted
            // Some plugin versions return this, some don't
            if (result.exactAlarm !== undefined) {
                return result.exactAlarm === 'granted';
            }
            // Fallback: assume granted if not reported
            return true;
        } catch (error) {
            console.error('Failed to check exact alarm permission:', error);
            return true; // Assume granted on error
        }
    },

    // Open system settings for exact alarm permission
    async openExactAlarmSettings() {
        if (!Capacitor.isNativePlatform()) return;

        try {
            // This opens the app's alarm permission settings on Android 12+
            // We use the App plugin if available, otherwise fallback to manual intent
            const { App } = await import('@capacitor/app');
            // Unfortunately, Capacitor doesn't have a direct API for this
            // We'll use a workaround by opening app info
            await App.openUrl({ url: `package:${await this.getPackageName()}` });
        } catch (error) {
            // Fallback: just alert the user
            console.error('Could not open settings:', error);
            alert('Please go to Settings > Apps > Daily Study Tracker > Alarms & Reminders and enable the permission.');
        }
    },

    // Get package name helper
    async getPackageName() {
        try {
            const { App } = await import('@capacitor/app');
            const info = await App.getInfo();
            return info.id;
        } catch {
            return 'com.sumon.studytracker';
        }
    },

    // Request permissions
    async requestPermissions() {
        try {
            const result = await LocalNotifications.requestPermissions();
            return result.display === 'granted';
        } catch (error) {
            console.error('Failed to request permissions:', error);
            return false;
        }
    },

    // Initialize/Create Channel (Android specific functionality for better control)
    async initialize() {
        if (!Capacitor.isNativePlatform()) return;

        try {
            // New channel ID to bypass Android immutability
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
                        actions: [
                            { id: 'mark-done', title: 'Mark as Done', foreground: true }
                        ]
                    },
                    {
                        id: 'ALARM_ACTIONS',
                        actions: [
                            { id: 'dismiss', title: 'Dismiss', foreground: false }
                        ]
                    }
                ]
            });

            console.log('NotificationService: Channels and Actions initialized');
        } catch (error) {
            console.error('NotificationService: Initialization failed', error);
        }
    },

    // Listener setup
    initListeners(onActionCallback, onReceiveCallback) {
        // Remove existing listener if any (manual cleanup if needed, but Capacitor handles duplicate listeners better now)
        LocalNotifications.removeAllListeners();

        LocalNotifications.addListener('localNotificationReceived', (notification) => {
            console.log('Notification received (fired):', notification);
            const originalId = notification.extra?.originalId || notification.id;
            const actionType = notification.actionTypeId;

            if (onReceiveCallback) {
                onReceiveCallback({ originalId, actionType });
            }
        });

        LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
            console.log('Notification action performed:', notification);
            const originalId = notification.notification.extra?.originalId;
            const actionId = notification.actionId;
            const actionType = notification.notification.actionTypeId;

            if (originalId && onActionCallback) {
                onActionCallback({ originalId, actionId, actionType });
            }
        });
    },

    // Schedule a notification
    async scheduleNotification(originalId, title, body, date, actionType = 'ALARM_ACTIONS') {
        try {
            const id = this.safeId(originalId);

            // Ensure permissions
            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) return { success: false, error: 'Permission not granted' };
            }

            // Schedule
            await LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id,
                    schedule: { at: date, allowWhileIdle: true },
                    smallIcon: 'ic_stat_icon_config_sample',
                    channelId: 'study-alarms-v3', // Match initialize()
                    actionTypeId: actionType,
                    ongoing: true,
                    autoCancel: true,
                    extra: { originalId }
                }]
            });
            return { success: true };
        } catch (error) {
            console.error('Failed to schedule notification:', error);
            return { success: false, error: error.message || JSON.stringify(error) };
        }
    },

    // Schedule a daily recurring notification
    async scheduleDailyNotification(originalId, title, body, hour, minute, actionType = 'TODO_ACTIONS') {
        try {
            const id = this.safeId(originalId);

            // Ensure permissions
            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) return { success: false, error: 'Permission not granted' };
            }

            // Schedule recurring daily
            await LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id,
                    schedule: {
                        on: { hour, minute },
                        allowWhileIdle: true,
                        repeats: true
                    },
                    smallIcon: 'ic_stat_icon_config_sample',
                    channelId: 'study-alarms-v3', // Match initialize()
                    actionTypeId: actionType,
                    ongoing: true,
                    autoCancel: true,
                    extra: { originalId }
                }]
            });
            return { success: true };
        } catch (error) {
            console.error('Failed to schedule daily notification:', error);
            return { success: false, error: error.message || JSON.stringify(error) };
        }
    },

    // Cancel a notification
    async cancelNotification(originalId) {
        try {
            const id = this.safeId(originalId);
            await LocalNotifications.cancel({ notifications: [{ id }] });
            return true;
        } catch (error) {
            console.error('Failed to cancel notification:', error);
            return false;
        }
    },

    // Check permissions
    async checkPermissions() {
        try {
            const result = await LocalNotifications.checkPermissions();
            return result.display === 'granted';
        } catch (error) {
            console.error('Failed to check permissions:', error);
            // On web/dev environment where plugin might fail
            return false;
        }
    },

    // Get all pending
    async getPending() {
        try {
            const result = await LocalNotifications.getPending();
            return result.notifications;
        } catch (error) {
            return [];
        }
    }
};
