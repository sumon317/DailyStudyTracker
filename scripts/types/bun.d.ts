/**
 * The slice of the Bun runtime the repository scripts use.
 *
 * The project standardises on Bun and these scripts are run by Bun, so the runtime is always
 * present. It is declared here rather than through a `@types/bun` dependency because the scripts
 * need four functions, and a dependency that exists only to describe them is one the license
 * check and the dependency audit have to carry forever.
 */
interface BunFileHandle {
    text(): Promise<string>;
    json(): Promise<unknown>;
}

interface BunRuntime {
    file(path: string): BunFileHandle;
    YAML: { parse(text: string): unknown };
}

declare var Bun: BunRuntime;
