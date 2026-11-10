# Tasks

## 1. Baseline

- [x] 1.1 Run `pnpm install --frozen-lockfile`, `pnpm run check`, and `pnpm run test:browser` on the rebased tree; record the passing counts (3,685 unit tests across 276 files; 185 browser tests) as the baseline the pipeline must reproduce.

## 2. Pipeline

- [x] 2.1 Delete `.github/workflows/release.yml`, confirming nothing else in the repository references it or its `dsh-kanban.tgz` asset name outside the archived OpenSpec changes.
- [x] 2.2 Add `.github/workflows/ci.yml` with one `ubuntu-latest` job, `contents: read`, and `pull_request`, `push: [main]`, and `workflow_dispatch` triggers.
- [x] 2.3 Run `pnpm/action-setup@v4` at `10.15.1` and `actions/setup-node@v4` with `cache: pnpm`, then `pnpm install --frozen-lockfile` so the lockfile is enforced on every run.
- [x] 2.4 Install the Chromium browser before the browser lane, then run `pnpm run check` followed by `pnpm run test:browser`; verify neither step publishes, uploads, tags, or calls a real model.

## 3. Installation guidance

- [x] 3.1 Rewrite the `AGENTS.md` **Releases** section around the repository URL: install address, the `prepare` build approval for the resolved commit, committish pinning, the manifest version bump, and an explicit instruction not to document `releases/latest/download/dsh-kanban.tgz`.
- [x] 3.2 Rewrite `README.md` **Install**: install from the repository URL with the refusal and `allowBuilds` retry, verify `lib/index.js` in the installed copy, re-resolve semantics for `dsh plugin update`, and committish pinning; fold the old "do not use the repository URL" warning into what the repository install builds.
- [x] 3.3 Update `docs/operations.md`: install step 2 documents the repository URL and the build approval, the unbuilt-entries signature points at the missing approval instead of a reinstall from the release asset, and the network note no longer contrasts a published asset with the Git path.
- [x] 3.4 Grep the tracked tree for `releases/latest`, `dsh-kanban.tgz`, and `release workflow`; confirm the only remaining mentions are the prohibition in `AGENTS.md` and the archived OpenSpec changes.

## 4. Verification

- [x] 4.1 Re-run `pnpm run check` after the documentation edits; confirm the typechecks, the vitest suite, and the build stay green.
- [ ] 4.2 Confirm the first `ci.yml` run on `ubuntu-latest` reproduces both gates. The first run reported 3 failures in `tests/browser/board-header.spec.ts` that pass on macOS: the first-row controls are pinned to `32px` while `.kb-hub-tab` measures `31px` with the runner fonts, so the equality only held on the authoring platform.
