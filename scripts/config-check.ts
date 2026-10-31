import { readText, runCheck } from './lib/io';

/**
 * Configuration gate.
 *
 * Parses every configuration file the project actually uses, and checks the two things that
 * silently break a build when they are wrong: a workflow that does not have the shape the
 * release process expects, and a GitHub Action that is pinned to a tag or a branch instead of an
 * immutable commit.
 */

const JSON_FILES = [
    'package.json',
    'biome.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.scripts.json',
    'capacitor.config.json',
];

const YAML_FILES = ['render.yaml', '.github/workflows/ci.yml', '.github/workflows/release.yml'];

const WORKFLOW_FILES = ['.github/workflows/ci.yml', '.github/workflows/release.yml'];

/**
 * A workflow action has to name an immutable commit.
 *
 * A tag can be moved and a branch can be rewritten, so either one lets a change to someone
 * else's repository run inside this project's CI with this project's secrets. The 40-character
 * form is a git object id.
 */
const PINNED_ACTION = /^[^@]+@[0-9a-f]{40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const checkWorkflow = (file: string, workflow: unknown): void => {
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        throw new Error(`Invalid workflow structure: ${file}`);
    }
    for (const job of Object.values(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) {
            throw new Error(`Workflow job has no steps: ${file}`);
        }
        for (const step of job.steps) {
            if (!isRecord(step)) {
                continue;
            }
            const uses = step.uses;
            if (typeof uses === 'string' && !PINNED_ACTION.test(uses)) {
                throw new Error(`Unpinned workflow action: ${uses}`);
            }
        }
    }
};

await runCheck('Configuration check', async () => {
    for (const file of JSON_FILES) {
        JSON.parse(await readText(file));
    }
    for (const file of YAML_FILES) {
        Bun.YAML.parse(await readText(file));
    }
    for (const file of WORKFLOW_FILES) {
        checkWorkflow(file, Bun.YAML.parse(await readText(file)));
    }
    return 'Configuration syntax is valid.';
});
