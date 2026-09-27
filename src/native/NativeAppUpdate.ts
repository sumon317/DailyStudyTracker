import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeAppUpdateInstallPermission {
    granted: boolean;
}

export interface NativeAppUpdatePlugin {
    checkInstallPermission(): Promise<NativeAppUpdateInstallPermission>;
    openInstallPermissionSettings(): Promise<void>;
    installApk(options: { path: string }): Promise<void>;
}

/**
 * The one platform predicate for "this build can hand an APK to the installer".
 *
 * The update dialog and the download service both have to answer it before they
 * touch the bridge, and they used to answer it differently: the dialog treated a
 * missing `getPlatform` as "assume Android", the service as "assume not". That
 * gap is a real failure, not a theoretical one - a stubbed or partial
 * `Capacitor` (a test bridge, a wrapper, a future web runtime) would send the
 * dialog down the native path and the service straight back out, and the user
 * would get a dialog whose button does nothing.
 *
 * Fails closed for the same reason the service already did: a bridge that cannot
 * name its platform is not a known Android installer, and guessing "yes" hands
 * an APK to whatever native layer happens to answer.
 */
export const isAndroidInstallTarget = (): boolean => {
    if (!Capacitor.isNativePlatform()) {
        return false;
    }
    const getPlatform = (Capacitor as unknown as { getPlatform?: () => string }).getPlatform;
    return typeof getPlatform === 'function' && getPlatform() === 'android';
};

/**
 * The one wording for a refused install permission.
 *
 * The dialog and the download service both report this, and the two copies had
 * already drifted in their surroundings: a user who was told one thing by the
 * pre-flight check and another by the transfer had no way to tell which was
 * current.
 */
export const INSTALL_PERMISSION_ERROR = 'Android permission to install packages is required.';

/**
 * The plugin always resolves with `{ granted: boolean }`, but a Capacitor
 * bridge that is not registered (older native build, or a platform that never
 * shipped the plugin) rejects instead, and a mocked/partial bridge can resolve
 * with `undefined`. Anything that is not an explicit `granted: true` counts as
 * "not granted" so the UI can never claim permission it does not have.
 */
export const isInstallPermissionGranted = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && (value as { granted?: unknown }).granted === true;

const NativeAppUpdate = registerPlugin<NativeAppUpdatePlugin>('NativeAppUpdate');

export default NativeAppUpdate;
