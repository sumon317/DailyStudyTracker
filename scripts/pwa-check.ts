import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileSize, pngSize, readText, runCheck, walkFiles } from './lib/io';

/**
 * PWA output gate.
 *
 * Runs against the built `dist/` directory, so it checks what the browser will actually get:
 * that the manifest is linked and registered, that every icon exists with the size the manifest
 * declares, and that every built file is in the precache manifest - because a file that is not
 * precached is a file the app cannot load while offline.
 */

const BUILD_OUTPUT = ['dist/index.html', 'dist/manifest.webmanifest', 'dist/registerSW.js', 'dist/sw.js'];

/** The precache entries the service worker declares. */
const PRECACHE_ENTRY = /url:"([^"]+)"/g;

/**
 * Files that are generated at runtime and so are not expected to be precached.
 *
 * The service worker and the workbox runtime are loaded by the browser itself, and a source map
 * is only fetched by a developer tool.
 */
const isBuildRuntimeFile = (relative: string): boolean =>
    relative === 'sw.js' || /^workbox-[^/]*\.js$/.test(relative) || relative.endsWith('.map');

await runCheck('PWA output check', async () => {
    const problems: string[] = [];
    let precacheBytes = 0;
    let precachedSet = new Set<string>();

    for (const file of BUILD_OUTPUT) {
        if (!existsSync(file) || readFileSync(file).length === 0) {
            problems.push(`Missing or empty build output: ${file}`);
        }
    }

    // Every check below reads a file the block above proved exists. Without that guard a missing
    // build would report a dozen consequences of the one cause that actually matters.
    if (problems.length === 0) {
        const html = await readText('dist/index.html');
        if (!/<link[^>]*rel="manifest"/.test(html)) {
            problems.push('dist/index.html has no manifest link');
        }
        if (!/<script[^>]*src="\/registerSW\.js"/.test(html)) {
            problems.push('dist/index.html does not load /registerSW.js');
        }
        if (/<script(?![^>]*\bsrc=)[^>]*>\s*[^<>\s][^<>]*<\/script>/.test(html)) {
            problems.push('dist/index.html contains an inline script that the deployed script-src policy blocks');
        }

        const manifest = (await Bun.file('dist/manifest.webmanifest').json()) as {
            icons?: Array<{ src: string; sizes?: string }>;
            start_url?: string;
            scope?: string;
            shortcuts?: Array<{ url?: string }>;
        };
        const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
        if (icons.length === 0) {
            problems.push('dist/manifest.webmanifest declares no icons');
        }
        if (manifest.start_url !== '/' || manifest.scope !== '/') {
            problems.push('Manifest start_url/scope must be /');
        }
        for (const icon of icons) {
            const file = join('dist', icon.src.replace(/^\//, ''));
            if (!existsSync(file)) {
                problems.push(`Manifest icon missing from dist: ${icon.src}`);
                continue;
            }
            const declared = /^([0-9]+)x([0-9]+)$/.exec(icon.sizes ?? '');
            if (declared && icon.src.endsWith('.png')) {
                const size = pngSize(file);
                if (!size) {
                    problems.push(`${icon.src} is not a readable PNG`);
                } else if (size.width !== Number(declared[1]) || size.height !== Number(declared[2])) {
                    problems.push(
                        `${icon.src} is ${size.width}x${size.height} but the manifest declares ${icon.sizes}`,
                    );
                }
            }
        }

        const serviceWorker = readFileSync('dist/sw.js', 'utf8');
        const precached = [...serviceWorker.matchAll(PRECACHE_ENTRY)].map((match) => match[1] ?? '');
        if (precached.length === 0) {
            problems.push('dist/sw.js has an empty precache manifest');
        }
        for (const url of new Set(precached)) {
            if (!existsSync(join('dist', url))) {
                problems.push(`Precached URL missing from dist: ${url}`);
            }
        }
        precachedSet = new Set(precached);

        for (const file of walkFiles('dist')) {
            const relative = file.replaceAll(String.fromCharCode(92), '/').slice('dist/'.length);
            if (precachedSet.has(relative)) {
                precacheBytes += fileSize(file);
                continue;
            }
            if (isBuildRuntimeFile(relative)) {
                continue;
            }
            problems.push(
                `Built file is not precached and so is unavailable offline: ${relative} (${fileSize(file)} bytes). ` +
                    'Raise workbox.maximumFileSizeToCacheInBytes in vite.config.ts, extend workbox.globPatterns, or drop the file.',
            );
        }

        /**
         * The plugin injects the manifest and its own icon entries into the precache manifest
         * *and* `workbox.globPatterns` matches the same five URLs, so each of them appears
         * exactly twice. Both copies carry the same revision and workbox keys the precache by
         * URL, so the overlap is harmless. Excluding them with `globIgnores` was tried and
         * reverted: it removes the plugin-injected entries too, which silently dropped the
         * manifest and all four icons from the offline cache.
         */
        const duplicated = new Map<string, number>();
        for (const url of precached) {
            duplicated.set(url, (duplicated.get(url) ?? 0) + 1);
        }
        for (const [url, count] of duplicated) {
            const injectedByPlugin = url === 'manifest.webmanifest' || /^assets\/pwa-[^/]*\.png$/.test(url);
            if (count > 2 || (count > 1 && !injectedByPlugin)) {
                problems.push(`Duplicate precache entries: ${url} appears ${count} times`);
            }
        }

        for (const icon of icons) {
            if (!precached.includes(icon.src.startsWith('/') ? icon.src.slice(1) : icon.src)) {
                problems.push(`Manifest icon is not precached: ${icon.src}`);
            }
        }
        for (const shortcut of Array.isArray(manifest.shortcuts) ? manifest.shortcuts : []) {
            if (typeof shortcut.url !== 'string' || !shortcut.url.startsWith('/')) {
                problems.push(`Manifest shortcut url must be a root-relative path: ${JSON.stringify(shortcut.url)}`);
            }
        }
    }

    if (problems.length > 0) {
        throw new Error(`PWA output validation failed:\n - ${problems.join('\n - ')}`);
    }
    return `PWA output is valid (${precachedSet.size} precached URLs, ${(precacheBytes / 1048576).toFixed(2)} MiB precached).`;
});
