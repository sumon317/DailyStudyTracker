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
        /**
         * The default 5s budget is a wall-clock limit, not a measure of whether the code under
         * test is correct. On a loaded machine - a CI runner sharing a core, a laptop with a
         * browser open - the slowest suites here exceeded it and failed for no reason but
         * timing. These tests drive real timers, real promises and a jsdom document, so they
         * need room to finish when the machine is busy.
         */
        testTimeout: 15000,
        hookTimeout: 15000,
        /**
         * Half the available cores rather than all of them. Each worker is a forked process with
         * its own jsdom, and running one per core on a machine that is already loaded starves
         * the workers that are mid-assertion. The suite is small enough that the wall-clock
         * difference is a few seconds.
         */
        maxWorkers: '50%',
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
            /**
             * The regression floor for the whole suite.
             *
             * These were 25/20/20/25 while the suite actually measured 93/86/93/93, which made
             * the gate pass on a codebase that had lost most of its tests. The floor now sits
             * below the real numbers and well above the old ones, so a change that drops a
             * meaningful amount of coverage fails CI - and a contributor adding a feature with
             * tests still has room to do it.
             */
            thresholds: {
                statements: 85,
                branches: 75,
                functions: 85,
                lines: 85,
            },
        },
    },
});
