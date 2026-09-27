import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
}));

import NativeAppUpdate, { isInstallPermissionGranted } from './NativeAppUpdate';

describe('NativeAppUpdate bridge contract', () => {
    it('registers under the name the native plugin declares', () => {
        expect(NativeAppUpdate).toEqual({ __plugin: 'NativeAppUpdate' });
    });

    it('treats only an explicit granted:true as permission', () => {
        expect(isInstallPermissionGranted({ granted: true })).toBe(true);
    });

    it('refuses to infer permission from a missing or partial bridge result', () => {
        // A Capacitor bridge that is not registered rejects, and a partially
        // initialised bridge can resolve with nothing at all. Neither is a grant.
        expect(isInstallPermissionGranted({ granted: false })).toBe(false);
        expect(isInstallPermissionGranted(undefined)).toBe(false);
        expect(isInstallPermissionGranted(null)).toBe(false);
        expect(isInstallPermissionGranted({})).toBe(false);
        expect(isInstallPermissionGranted('granted')).toBe(false);
        expect(isInstallPermissionGranted(1)).toBe(false);
    });
});
