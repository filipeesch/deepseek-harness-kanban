# Development Setup

## Prerequisites

Use a normal Node development installation, not the hardened executable embedded in the DSH app, with the Node and pnpm versions declared by [the manifest](<../../package.json>).

```sh
node --version
pnpm --version
pnpm install --ignore-scripts --frozen-lockfile
```

The hardened bundled Node has failed loading the Rollup native addon because of a Team ID and code-signing mismatch. That does not justify disabling library validation, removing signatures or quarantine, or re-signing the app. Run the suite under normal Node instead, and keep that environment failure distinct from test assertions.

## Commands

```sh
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
# Combined fast gate: both typechecks, the vitest suite, then the build
pnpm run check
```

`pnpm run check` covers host and client typechecks, the full vitest suite, and the build. The suite includes the documentation gate described in [the documentation standard](../AGENTS.md). `pnpm run test:browser` is the separate Playwright harness for real CSS layout, editor, and animation behavior; it is intentionally not part of `pnpm run check`, which stays portable.

The real-composition lane is manual and needs an installed and built DSH checkout:

```sh
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only messages
```

It accepts any installed and built checkout, reports the checkout version, warns when it differs from the plugin's pinned SDK, copies the plugin-owned scenario templates into that checkout's web test tree, runs them with replay-only model fixtures, and removes them afterward. It requires every workspace package and dependency of that checkout to be installed and built; never substitute the developer's profile. [Verification](verification.md) lists the scenario names and the acceptance rules.

## TypeScript programs

Host and client native SDK augmentations belong to separate TypeScript programs: [host typecheck](<../../tsconfig.host.json>) and [client typecheck](<../../tsconfig.client.json>). Declaration output is also separate via [host declarations](<../../tsconfig.build.json>) and [client declarations](<../../tsconfig.build.client.json>). Do not fix augmentation conflicts by combining programs or patching the installed SDK or core.

[The build](<../../scripts/build.mjs>) emits host ESM, the browser module-loader bundle, the native guard module, and separate public declarations. It uses external native host packages and wraps the client bundle for DSH's browser module loader; the result is not a standalone app. [The check script](<../../scripts/check.mjs>) runs both typechecks, the tests, and the build with the invoking Node executable.

## Browser harness

`pnpm run test:browser` builds its own browser harness, renders the real client components with the host theme fixture in [the theme fixture](<../../tests/browser/theme-fixture.ts>), emulates `prefers-color-scheme`, asserts the rendered host tokens and contrast, and writes screenshots under the ignored `.verification/` directory. [Verification](verification.md) states the evidence rules for those screenshots.

## Source installation

To load the checkout into a running DSH GUI, follow [Install](../operations/install.md). A linked checkout is not a promise of source hot reload: run `pnpm run build`, reconcile the rebuilt bundle through the native Plugin Manager, and refresh the same GUI URL.
