# Proposal

## Why

`.github/workflows/release.yml` was the only workflow in the repository. Every merge to `main` with a bumped manifest version built the plugin, packed `dsh-kanban.tgz`, and published it as an immutable GitHub release asset; `AGENTS.md`, `README.md`, and `docs/operations.md` then documented `releases/latest/download/dsh-kanban.tgz` as the install address.

That job never ran a test. It built and published a commit that nothing had verified, and the repository had no lane that a pull request could fail. The plugin has three thousand six hundred unit tests and a Playwright harness; neither gate ran anywhere but on a developer machine.

## What Changes

- `.github/workflows/release.yml` is removed. No workflow packs, uploads, or publishes `dsh-kanban.tgz`, and no workflow creates a version tag.
- `.github/workflows/ci.yml` is added: one `ubuntu-latest` job with `contents: read`, triggered on `pull_request`, on `push` to `main`, and on `workflow_dispatch`. It installs the locked dependencies and the Chromium browser, runs `pnpm run check` (host typecheck, client typecheck, the vitest suite, the local build), then `pnpm run test:browser` (the plugin-owned Playwright harness). It uploads nothing and publishes nothing.
- Installation guidance documents the repository URL `https://github.com/filipeesch/deepseek-harness-kanban` as the install address, including the `prepare` build approval the profile must grant for the resolved commit and pinning with a committish. **BREAKING** for a reader who copied the `releases/latest/download/dsh-kanban.tgz` address: that asset still resolves, but only to the last release published before this change, so it no longer advances.
- The `link:` development checkout path is unchanged.
- Not in this change: no change to what `scripts/build.mjs` produces, no change to `engines.dsh` or to how the Typert protocol helper is bundled, no runner lane for `scripts/e2e-dsh.mjs` (it needs an installed and built DSH checkout, so it stays manual), and no board, drawer, conversation, sharing, or worktree behavior change.

## Capabilities

### New Capabilities

- `verification-pipeline`: how the repository proves a change passes every CI-safe test lane on a pull request and on `main` while producing no distributable artifact.

### Modified Capabilities

- `plugin-distribution`: the immutable release publisher is removed, and the documented install address moves from the release asset to the repository URL with committish pinning.

## Impact

- `.github/workflows/ci.yml` (new) and `.github/workflows/release.yml` (deleted).
- `AGENTS.md` (**Releases**), `README.md` (**Install**), and `docs/operations.md` (**Installation and update diagnostics**) now document the repository URL install.
- Existing releases and their tags stay downloadable; nothing new is published, so a named `v<version>` pin for a future version needs a tag pushed by hand.
- No source, test, or build script changes.
