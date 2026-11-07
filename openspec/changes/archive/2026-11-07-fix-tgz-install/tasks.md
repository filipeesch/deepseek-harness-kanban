# Tasks

## 1. Baseline

- [x] 1.1 Install dependencies with `pnpm install --frozen-lockfile` and run `pnpm run check`; confirm the baseline is green before any edit.

## 2. Build and SDK seam

- [x] 2.1 Create `src/sdk/typert.ts` exporting `createTypertContribution(spec, zod)` that returns `{ remote, host }`, holding the only runtime import of `@deepseek-ai/dsh-typert-protocol/remote-info`, with a comment stating that the build must inline that package; verify `pnpm run typecheck` passes.
- [x] 2.2 Point `src/remote.ts` at the seam so `TYPERT_REMOTE` and `TYPERT_HOST` keep their existing names, and verify `grep -n "dsh-typert-protocol" src/remote.ts src/sdk/typert.ts` shows the runtime import only in the seam and type-only imports elsewhere.
- [x] 2.3 Replace `packages: 'external'` in the host esbuild call with an `onResolve` filter that marks every bare specifier external except `@deepseek-ai/dsh-typert-protocol` and its subpaths; run `pnpm run build` and verify no import specifier of that package remains (`grep -nE "^import .*@deepseek-ai/dsh-typert-protocol|import\(\"@deepseek-ai/dsh-typert-protocol" lib/index.js lib/remote.js` prints nothing) while `grep -c createTypertRemoteInfo` reports at least one per entry; esbuild's source-path comments naming the package are expected and are not imports.
- [x] 2.4 Confirm the client entry still builds from the same seam; verify `pnpm run build` succeeds and `lib/client.js` contains no import specifier of the package (only esbuild's source-path comment), because the module is inlined.

## 3. Manifest

- [x] 3.1 Add `"engines": { "dsh": ">=0.2.1-rc.2 <0.3.0" }` (preserving `node`), move `@deepseek-ai/dsh-typert-protocol` from `peerDependencies` to `devDependencies`, and bump `version` to `0.1.2`; verify `npm pkg get engines version` and `npm pkg get peerDependencies` show the new values without the protocol entry.
- [x] 3.2 Pack the artifact with `pnpm pack --pack-destination dist` and verify the tarball manifest with `tar -xOf dist/dsh-kanban-0.1.2.tgz package/package.json` shows `engines.dsh`, version `0.1.2`, and no `@deepseek-ai/dsh-typert-protocol` under dependencies or peerDependencies.
- [x] 3.3 Run `pnpm run check` and confirm both typechecks, the test suite, and the build pass with the new manifest.

## 4. Release workflow

- [x] 4.1 Replace the `gh release view` → `gh release upload --clobber` branch in `.github/workflows/release.yml` with a guard that exits non-zero when `v<version>` exists as a remote tag or as a release, then runs only `gh release create --target "$GITHUB_SHA"`; verify `grep -n "clobber\|release upload" .github/workflows/release.yml` returns nothing and the tag check, `--target`, and `release create` are present.
- [x] 4.2 Verify the fixed-asset contract is intact: the workflow still copies `dist/dsh-kanban-*.tgz` to `dsh-kanban.tgz` and publishes exactly that file, and does not mark the release prerelease, so `releases/latest/download/dsh-kanban.tgz` resolves to the newest version.

## 5. Documentation

- [x] 5.1 Update `README.md`: keep the `latest` install address as recommended, add the exact-tag address for the installed version, add the profile update command (`dsh plugin --profile <name> update dsh-kanban`), and correct the claim that peer dependencies prevent a second SDK copy in the profile.
- [x] 5.2 Update `docs/operations.md` with the stale-SDK diagnostic: the failing signature, `dsh plugin --profile <name> why <package>`, inspecting `profiles/<name>/node_modules/@deepseek-ai`, and the remedy (update or remove the plugin that hoists the old copy).
- [x] 5.3 Confirm the release rule added to `AGENTS.md` ("## Releases") matches the implemented workflow, and adjust its wording only if the implementation diverged.

## 6. Isolated verification

- [x] 6.1 Create a throwaway `DSH_HOME` (`mktemp -d`), clone the shipped `web` template into a smoke profile with `dsh --from-default-profile web --dump-config`, and install the packed tarball with `dsh plugin --profile <smoke> add file:<worktree>/dist/dsh-kanban-0.1.2.tgz`; verify the profile's `package.json` lists `dsh-kanban` in `dsh.profile.bundles`.
- [x] 6.2 Plant the failing condition with `dsh plugin --profile <smoke> add @deepseek-ai/dsh-typert-protocol@0.2.0-rc.2`, record the copy's resolved version and install path, then boot the smoke profile and confirm no `kanban (dsh-kanban)` entry appears among the entries that did not activate and that `ERR_PACKAGE_PATH_NOT_EXPORTED` is absent; open **Kanban** and capture the rendered board, not only the sidebar entry.
- [x] 6.3 Capture the evidence (control and fixed activation logs, the resolved plugin and protocol versions, and the rendered Kanban board) under `.verification/install-tgz/` with no tokens or owner data, then stop the instance and remove the throwaway `DSH_HOME`.

## 7. Final gates

- [x] 7.1 Run `pnpm run check` and confirm host/client typechecks, the vitest suite, and the build are green with the final tree.
- [x] 7.2 Run `openspec validate fix-tgz-install --strict` and confirm the change validates with no errors.
