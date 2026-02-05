import { LocalNotifications } from '@capacitor/local-notifications';

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
    async scheduleNotification(originalId, title, body, date) {
        try {
            const id = this.safeId(originalId);

            // Ensure permissions
            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                const granted = await this.requestPermissions();
                if (!granted) return { success: false, error: 'Permission not granted (request rejected)' };
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
                    extra: { originalId } // Keep original ID in extras just in case
                }]
            });
            return { success: true };
        } catch (error) {
            console.error('Failed to schedule notification:', error);
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
