import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import NativeAlarm from '../native/NativeAlarm';
import type { AlarmPermissionKey } from '../types';

/**
 * The order the grants are asked for. Notifications come first because the
 * ringing notification is the alarm's only delivery path while the app is in the
 * background; the full-screen intent comes last because it only upgrades that
 * notification to a lock-screen takeover.
 */
const PERMISSION_ORDER: readonly AlarmPermissionKey[] = ['notifications', 'exactAlarm', 'fullScreenIntent'];

const isAndroidNative = (): boolean => {
    if (!Capacitor.isNativePlatform()) {
        return false;
    }
    const getPlatform = (Capacitor as unknown as { getPlatform?: () => string }).getPlatform;
    return getPlatform ? getPlatform() === 'android' : true;
};

export const orderAlarmPermissions = (keys: Iterable<AlarmPermissionKey>): AlarmPermissionKey[] => {
    const wanted = new Set(keys);
    return PERMISSION_ORDER.filter((key) => wanted.has(key));
};

/**
 * The alarm grants the platform reports as missing, read from Android itself.
 *
 * Empty off Android, and empty when the read fails: a bridge that could not
 * answer is not a refusal, and a prompt shown on that basis would be shown to
 * users who already granted everything.
 */
export const getMissingAlarmPermissions = async (): Promise<AlarmPermissionKey[]> => {
    if (!isAndroidNative()) {
        return [];
    }
    try {
        const status = await NativeAlarm.checkAlarmPermissions();
        return orderAlarmPermissions(PERMISSION_ORDER.filter((key) => status?.[key] === 'denied'));
    } catch {
        return [];
    }
};

/**
 * Asks for one grant the way Android wants it asked.
 *
 * Notifications get the real runtime dialog first. Android stops showing that
 * dialog after the user has refused it, so a result that is still not `granted`
 * falls through to the system settings screen where the switch can be turned on.
 * Exact alarms and the full-screen intent are special-access grants that have no
 * runtime dialog at all, only a settings screen.
 */
export const requestAlarmPermission = async (key: AlarmPermissionKey): Promise<void> => {
    if (!isAndroidNative()) {
        return;
    }
    if (key === 'notifications') {
        try {
            const result = await LocalNotifications.requestPermissions();
            if (result.display === 'granted') {
                return;
            }
        } catch {
            // Fall through to the settings screen.
        }
    }
    try {
        await NativeAlarm.openAlarmSettings({ type: key });
    } catch {
        // Nothing further to try: the settings screen is the last resort.
    }
};
