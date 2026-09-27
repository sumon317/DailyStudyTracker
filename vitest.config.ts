import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        pool: 'forks',
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            // V8 range merging in @bcee/v8-coverage is unstable under Bun; Istanbul is deterministic.
            provider: 'istanbul',
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.test.{ts,tsx}',
                'src/**/*.spec.{ts,tsx}',
                'src/app/main.tsx',
                'src/test/setup.ts',
                'src/test/test-utils.tsx',
                'src/vite-env.d.ts',
            ],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: './coverage',
            clean: true,
            thresholds: {
                statements: 25,
                branches: 20,
                functions: 20,
                lines: 25,
            },
        },
    },
});
