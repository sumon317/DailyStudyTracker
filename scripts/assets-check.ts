import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileSize, pngSize, readText, runCheck, walkFiles } from './lib/io';

/**
 * Public asset gate.
 *
 * Every asset the app refers to has to exist in `public/`, has to be a non-empty file, and - for
 * the PNGs whose size is part of their filename - has to actually have the dimensions that name
 * claims. A missing icon is a blank space on the home screen; a 192x192 icon that is really
 * 512x512 is an install prompt the platform rejects.
 */

/**
 * An asset reference in a source file.
 *
 * The reference is a quoted, root-absolute path, which is how both the HTML and the source
 * refer to the files in `public/`.
 */
const ASSET_REFERENCE =
    /['"](\/(?:assets\/)?[A-Za-z0-9._/-]+\.(?:png|ico|svg|webp|jpg|jpeg|mp3|m4a|aac|wav|woff2?))['"]/g;

/** The size a PNG's filename declares, or `null` when the name does not declare one. */
const declaredSize = (name: string): { width: number; height: number } | null => {
    const declared = /^([0-9]+)x([0-9]+)/.exec(name);
    return declared ? { width: Number(declared[1]), height: Number(declared[2]) } : null;
};

/** Every asset path referenced by a piece of source text. */
const collectReferences = (text: string): Set<string> => {
    const found = new Set<string>();
    for (const match of text.matchAll(ASSET_REFERENCE)) {
        if (match[1]) {
            found.add(match[1]);
        }
    }
    return found;
};

/** The source files that can refer to an asset. */
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|css|html)$/;

await runCheck('Public asset check', async () => {
    const problems: string[] = [];
    const warnings: string[] = [];
    /** Every referenced asset, and the files that refer to it. */
    const referenced = new Map<string, string[]>();
    /** Every piece of source text that was read, so a reference can be found in any form. */
    const texts: string[] = [];

    const record = (reference: string, source: string): void => {
        const sources = referenced.get(reference) ?? [];
        sources.push(source);
        referenced.set(reference, sources);
    };

    for (const file of ['index.html', 'vite.config.ts']) {
        const text = await readText(file);
        texts.push(text);
        for (const reference of collectReferences(text)) {
            record(reference, file);
        }
    }

    for (const file of walkFiles('src')) {
        if (!SOURCE_EXTENSIONS.test(file)) {
            continue;
        }
        const text = await readText(file);
        texts.push(text);
        for (const reference of collectReferences(text)) {
            record(reference, file);
        }
    }

    for (const [reference, sources] of referenced) {
        const normalized = reference.replace(/^\//, '');
        const onDisk = join('public', normalized);
        if (!existsSync(onDisk)) {
            problems.push(`Missing public asset ${normalized} (referenced by ${sources.join(', ')})`);
            continue;
        }
        if (fileSize(onDisk) === 0) {
            problems.push(`Empty public asset ${normalized}`);
            continue;
        }
        const declared = declaredSize(normalized);
        if (declared && normalized.endsWith('.png')) {
            const size = pngSize(onDisk);
            if (!size) {
                problems.push(`${normalized} is not a readable PNG`);
            } else if (size.width !== declared.width || size.height !== declared.height) {
                problems.push(
                    `${normalized} is ${size.width}x${size.height} but its filename declares ${declared.width}x${declared.height}`,
                );
            }
        }
    }

    for (const file of walkFiles('public')) {
        const normalized = file
            .split(String.fromCharCode(92))
            .join('/')
            .replace(/^public\//, '');
        if (!referenced.has(`/${normalized}`) && !texts.some((text) => text.includes(normalized))) {
            warnings.push(`Unreferenced public asset: ${normalized}`);
        }
    }

    for (const warning of warnings) {
        // biome-ignore lint/suspicious/noConsole: a gate's output is its interface.
        console.warn(`warning: ${warning}`);
    }
    if (problems.length > 0) {
        throw new Error(`Public asset validation failed:\n - ${problems.join('\n - ')}`);
    }
    return `Public assets are valid (${referenced.size} referenced, ${warnings.length} unreferenced).`;
});
