import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const vendorChunk = (id: string): string | undefined => {
    const normalizedId = id.replaceAll('\\', '/');

    if (!normalizedId.includes('/node_modules/')) {
        return undefined;
    }
    if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(normalizedId)) {
        return 'react-vendor';
    }
    if (
        normalizedId.includes('/node_modules/@capacitor/') ||
        normalizedId.includes('/node_modules/@capacitor-community/') ||
        normalizedId.includes('/node_modules/@capawesome-team/')
    ) {
        return 'capacitor-vendor';
    }
    if (normalizedId.includes('/node_modules/jspdf/') || normalizedId.includes('/node_modules/jspdf-autotable/')) {
        return 'pdf-vendor';
    }
    if (
        normalizedId.includes('/node_modules/framer-motion/') ||
        normalizedId.includes('/node_modules/motion-dom/') ||
        normalizedId.includes('/node_modules/motion-utils/')
    ) {
        return 'motion-vendor';
    }

    return 'vendor';
};

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: 'script-defer',
            // Assets under public/ are already precached by workbox.globPatterns below. Repeating them
            // in includeAssets adds duplicate entries to the generated precache manifest.
            manifest: {
                id: '/',
                name: 'Daily Study Tracker',
                short_name: 'StudyTracker',
                description: 'Track study sessions, tasks, focus time, and progress locally.',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                background_color: '#f7f9fc',
                theme_color: '#0062a0',
                orientation: 'any',
                categories: ['education', 'productivity'],
                icons: [
                    {
                        src: '/assets/pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any',
                    },
                    {
                        src: '/assets/pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any',
                    },
                    {
                        src: '/assets/pwa-192x192-maskable.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/assets/pwa-512x512-maskable.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
                shortcuts: [
                    {
                        name: 'Open focus timer',
                        short_name: 'Focus',
                        url: '/focus',
                        icons: [{ src: '/assets/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
                    },
                    {
                        name: 'Open todos',
                        short_name: 'Todos',
                        url: '/todo',
                        icons: [{ src: '/assets/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
                    },
                ],
            },
            workbox: {
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: true,
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],
                // `mp3` covers `public/alarm_loop.mp3`, the single alarm tone the
                // web build ships (see `src/services/alarmAudio.ts`). It is
                // precached rather than fetched on demand because the alarm has to
                // sound with no network, which is the only situation it matters in.
                // At ~1.4 MiB it stays well under maximumFileSizeToCacheInBytes; a
                // larger encode would silently drop out of the precache manifest,
                // so `bun run pwa:check` guards the served copy existing.
                globPatterns: ['**/*.{html,js,css,ico,png,svg,webmanifest,mp3}'],
                // vite-plugin-pwa adds the generated manifest and its own icon entries to the
                // precache manifest itself, so globPatterns matches them a second time. Duplicates
                // are harmless (identical revision, workbox dedupes by key), whereas excluding them
                // via globIgnores would drop them from the precache entirely. `bun run pwa:check`
                // enforces that the overlap stays at exactly two copies of these five URLs.
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
            },
            devOptions: {
                enabled: false,
            },
        }),
    ],
    build: {
        target: 'es2022',
        minify: 'terser',
        cssCodeSplit: true,
        sourcemap: false,
        chunkSizeWarningLimit: 600,
        terserOptions: {
            compress: {
                drop_debugger: true,
            },
            format: {
                comments: false,
            },
        },
        rollupOptions: {
            output: {
                manualChunks: vendorChunk,
            },
        },
    },
    optimizeDeps: {
        include: ['react', 'react-dom', 'react-router-dom'],
    },
});
