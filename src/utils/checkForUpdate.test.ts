import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, clearUpdateCache, getCurrentVersion } from './checkForUpdate';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
    },
}));

describe('checkForUpdate', () => {
    beforeEach(() => {
        clearUpdateCache();
    });

    afterEach(() => {
        localStorage.clear();
    });

    describe('getCurrentVersion', () => {
        it('should return the current version from package.json', () => {
            const version = getCurrentVersion();
            expect(version).toBeDefined();
            expect(typeof version).toBe('string');
            expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        });
    });

    describe('checkForUpdate', () => {
        it('should return not available on web platform', async () => {
            const result = await checkForUpdate(true);
            expect(result.available).toBe(false);
        });
    });
});
