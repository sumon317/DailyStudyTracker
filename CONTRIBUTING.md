# Contributing to Daily Study Tracker

Thanks for taking the time. This document covers everything you need to get the project running, the conventions it follows, and what the maintainer expects from a pull request.

The short version: install with Bun, make `bun run verify` pass, and write the comment that explains *why* your change is correct.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.4.0 or newer | The package manager and the script runner. CI pins the exact version in `package.json`. |
| Node.js | 24.x | Only for the Vitest coverage provider. CI provisions a pinned Node runtime because the Istanbul coverage provider is not fully supported under Bun alone. |
| Git | any | Obviously. |
| Android Studio | 2025.2.1 or newer | Only for the Android app. |

**Use Bun.** Do not use npm, Yarn or pnpm, and do not generate a `package-lock.json`. CI checks for one and fails if it finds it. `bun.lock` is committed and installs are frozen outside local development.

## Getting started

```bash
git clone https://github.com/sumon317/DailyStudyTracker.git
cd DailyStudyTracker
bun install
bun run dev
```

If the test runner crashes with a segmentation fault, your `node_modules` is corrupt. Remove it and install again:

```bash
rm -rf node_modules
bun install --frozen-lockfile
```

The Android project needs the web assets synced into it before it will build:

```bash
bun run verify
bun run android:sync
bun run android:open
```

## The gates

`bun run verify` runs the same checks CI runs, in the same order. It is the one command that tells you whether a change is ready.

| Gate | What it protects |
| --- | --- |
| `config:check` | Every configuration file parses, and every GitHub Action is pinned to an immutable commit. |
| `assets:check` | Every referenced asset exists, is not empty, and - for PNGs whose size is in the filename - actually has the dimensions the name claims. |
| `lint` | Biome formatting and lint rules. |
| `typecheck` | The app, the build configs and the repository scripts. |
| `test:coverage` | The test suite, with global coverage floors. |
| `build` | The production web bundle. |
| `pwa:check` | The built output: manifest, icons, and a precache manifest that covers every built file. |

The gates live in `scripts/` as ordinary TypeScript files. If a gate is wrong, change the gate - but change it in the same commit as whatever it was supposed to catch, and say why in the commit message.

## Code conventions

**Comments explain constraints, not mechanics.** The codebase is heavily commented, and the bar is high: a comment earns its place by stating something the code cannot say for itself.

```ts
// Bad: increments the counter
counter += 1;

// Good: explains the rule and where it comes from
// A write that then succeeds re-arms it, so a store that failed, recovered
// and failed again a second later is reported instead of being swallowed
// until the window lapsed.
```

If you cannot explain *why* something is the way it is, ask yourself whether the code needs to change. A lot of the existing code looks strange because it is defending against a specific failure - keep that context when you touch it.

**Defensive by default.** The app reads untrusted files (backup imports), runs on two platforms with different storage semantics, and talks to a native plugin that may be unavailable. Guard the calls that can fail, and surface the failure to the user rather than swallowing it.

**Tests are co-located.** A module's test lives next to it, named `<module>.test.ts`. Tests describe behavior, not implementation: if the test has to change when you rename a private function, the test was testing the implementation.

**Relative imports only.** There is no path alias configuration.

**Pure helpers live in `src/utils/`.** If a function touches the DOM, the network or the store, it does not belong there.

## Adding things

**A new page:** add the component to `src/pages/`, lazy-load it in `src/app/App.tsx`, give it its own `ErrorBoundary` with a key unique to the route, and add it to `src/components/layout/BottomNavigation.tsx`.

**A new stored field:** it has to survive a round trip through a backup file. Add it to the type, to the validator in `src/services/storage/validation.ts`, to the backup envelope, and to the merge policy in `src/services/storage/backup.ts`. A field that is stored but not validated will be read back as `undefined` from a file that does not have it.

**A new native capability:** write the plugin under `android/app/src/main/java/com/sumon/studytracker/`, register it in `MainActivity`, and bind it in `src/native/`. Keep the plugin name, the intent action strings and the `SharedPreferences` names stable - changing them orphans data already on a user's device.

## Commit messages

Conventional Commits:

```
fix: keep a working reminder when its replacement has a corrupt date
feat(todo): add repeating reminders
docs: explain the Android alarm delivery path
```

The subject says what changed, in the imperative. The body says why. A reviewer reading only the subject should know which part of the app is affected.

## Pull requests

- `bun run verify` passes.
- New behavior has a test that fails without the change.
- The README is updated if you changed a command, a file layout or a behavior it documents.
- Android changes are verified on a device or emulator before they are merged. The JVM unit tests do not cover alarm delivery, exact-alarm permission, foreground services, widgets or release updates.

## Reporting bugs

Open an issue with what you did, what you expected and what happened. A backup file helps enormously when the bug is about data: it is plain JSON, and you can look at it in any editor. **Check it for anything private before you attach it** - backup files contain study notes, todos and mistakes in the clear.

## Code of conduct

Be decent to each other. Assume good faith, critique the code rather than the person, and assume the person who wrote the line had a reason you have not thought of yet.
