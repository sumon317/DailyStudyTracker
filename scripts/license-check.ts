import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runCheck } from './lib/io';

/**
 * Dependency license gate.
 *
 * Every installed package is checked against an explicit allowlist, including nested installs.
 * The check requires that a real install happened - it fails when `node_modules` is missing or
 * when no package was inspected - so it cannot pass by having nothing to look at.
 *
 * It matches on the declared `license`/`licenses` field only, does not read `LICENSE` files and
 * does not evaluate SPDX expressions, so it is a floor rather than a complete audit.
 */

const ALLOWED_LICENSES = new Set([
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-2-Clause-Patent',
    'BSD-3-Clause',
    'BSD-3-Clause-Clear',
    'CC-BY-4.0',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MIT-0',
    'MPL-2.0',
    'Python-2.0',
    'Unicode-3.0',
    'Unlicense',
    'Zlib',
]);

interface PackageManifest {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    licenses?: Array<string | { type?: string }>;
}

const isAccepted = (licenses: string[]): boolean =>
    licenses.some((license) => {
        for (const allowed of ALLOWED_LICENSES) {
            if (license.includes(allowed)) {
                return true;
            }
        }
        return false;
    });

await runCheck('License check', async () => {
    if (!existsSync('node_modules')) {
        throw new Error('node_modules is missing; run bun install --frozen-lockfile before license:check');
    }

    const rejected: string[] = [];
    /** Real paths of the manifests already inspected, so a linked package is not counted twice. */
    const visited = new Set<string>();
    let inspected = 0;

    const inspect = async (directory: string): Promise<void> => {
        const manifestPath = join(directory, 'package.json');
        if (!existsSync(manifestPath)) {
            return;
        }
        const manifestKey = realpathSync(manifestPath);
        if (visited.has(manifestKey)) {
            return;
        }
        visited.add(manifestKey);
        inspected++;

        const pkg = (await Bun.file(manifestPath).json()) as PackageManifest;
        const declared = pkg.license ?? pkg.licenses;
        const values = Array.isArray(declared) ? declared : [declared];
        const licenses = values
            .filter((value): value is string | { type?: string } => Boolean(value))
            .map((value) => (typeof value === 'string' ? value : (value.type ?? '')))
            .filter((value) => value.length > 0);

        if (!isAccepted(licenses)) {
            rejected.push(`${pkg.name}@${pkg.version}: ${licenses.join(' OR ') || 'unknown'}`);
        }

        const nested = join(directory, 'node_modules');
        if (existsSync(nested)) {
            await scan(nested);
        }
    };

    const scan = async (modulesDirectory: string): Promise<void> => {
        for (const entry of readdirSync(modulesDirectory, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) {
                continue;
            }
            const entryPath = join(modulesDirectory, entry.name);
            if (entry.name.startsWith('@')) {
                for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
                    if (!scopedEntry.name.startsWith('.')) {
                        await inspect(join(entryPath, scopedEntry.name));
                    }
                }
            } else {
                await inspect(entryPath);
            }
        }
    };

    await scan('node_modules');

    if (inspected === 0) {
        throw new Error('No installed packages were inspected; license:check would pass vacuously');
    }
    if (rejected.length > 0) {
        throw new Error(`Disallowed or unknown licenses:\n${rejected.join('\n')}`);
    }
    return `Dependency licenses accepted (${inspected} packages inspected).`;
});
