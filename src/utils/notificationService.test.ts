import { describe, expect, it } from 'vitest';
import { NotificationService } from './notificationService';

describe('NotificationService', () => {
    describe('safeId', () => {
        it('should return a positive integer', () => {
            const result = NotificationService.safeId('test');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(2147483647);
        });

        it('should return consistent results for same input', () => {
            const result1 = NotificationService.safeId('test123');
            const result2 = NotificationService.safeId('test123');
            expect(result1).toBe(result2);
        });

        it('should handle numeric IDs', () => {
            const result = NotificationService.safeId(12345);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        it('should handle large numeric IDs', () => {
            const result = NotificationService.safeId(9999999999999);
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(2147483647);
        });

        it('should handle empty string', () => {
            const result = NotificationService.safeId('');
            expect(result).toBeGreaterThanOrEqual(0);
        });

        it('should handle special characters', () => {
            const result = NotificationService.safeId('test@#$%');
            expect(result).toBeGreaterThan(0);
        });

        it('should produce different results for different inputs', () => {
            const result1 = NotificationService.safeId('abc');
            const result2 = NotificationService.safeId('xyz');
            expect(result1).not.toBe(result2);
        });

        it('should handle unicode characters', () => {
            const result = NotificationService.safeId('hello你好');
            expect(result).toBeGreaterThan(0);
        });
    });
});
