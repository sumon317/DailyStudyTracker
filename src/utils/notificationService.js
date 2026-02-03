import { LocalNotifications } from '@capacitor/local-notifications';

export const NotificationService = {
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
    async createChannel() {
        try {
            // High importance (5) with custom sound for alarm-like behavior
            await LocalNotifications.createChannel({
                id: 'study-reminders',
                name: 'Study Reminders',
                description: 'High Importance Alarm for Study',
                importance: 5,
                visibility: 1,
                vibration: true,
                sound: 'alarm_loop.mp3', // Uses res/raw/alarm_loop.mp3
            });
        } catch (error) {
            // Ignore error on web/ios
            console.log('Channel creation skipped or failed');
        }
    },

    // Schedule a notification
    async scheduleNotification(id, title, body, date) {
        try {
            // Ensure permissions
            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) return false;
            }

            // Ensure channel exists
            await this.createChannel();

            // Schedule
            await LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id,
                    schedule: { at: date, allowWhileIdle: true }, // allowWhileIdle helps in doze mode
                    smallIcon: 'ic_stat_icon_config_sample',
                    channelId: 'study-reminders', // Use our high priority channel
                    actionTypeId: '',
                    extra: null
                }]
            });
            return true;
        } catch (error) {
            console.error('Failed to schedule notification:', error);
            return false;
        }
    },

    // Cancel a notification
    async cancelNotification(id) {
        try {
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
