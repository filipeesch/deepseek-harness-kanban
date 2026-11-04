# Tasks

## 1. Manifest and version

- [x] 1.1 Bump `version` in `package.json` to `0.1.1` and verify with `node -p "require('./package.json').version"`.
- [x] 1.2 Add `"prepare": "node scripts/build.mjs"` to `package.json` scripts and verify `pnpm install --frozen-lockfile` completes with `lib/index.js`, `lib/client.js`, and `lib/remote.js` present.
- [x] 1.3 Verify `pnpm pack` produces an archive whose contents include `lib/index.js`, `lib/client.js`, `lib/remote.js`, `cordis.patch.yml`, and `package.json` (`tar -tzf dsh-kanban-0.1.1.tgz`).
- [x] 1.4 Verify the packed tarball still resolves its public entries: install it into a throwaway directory and import `dsh-kanban` and `dsh-kanban/remote`.

## 2. Release workflow

- [x] 2.1 Create `.github/workflows/release.yml` triggered by `push` of tags matching `v*`, running on Node 24 with pnpm, that installs with `--frozen-lockfile`, runs `pnpm check`, runs `pnpm pack`, copies the archive to `dsh-kanban.tgz`, and publishes it with `gh release create "$GITHUB_REF_NAME" dsh-kanban.tgz`.
- [x] 2.2 Verify the workflow file parses as valid YAML and that its step commands match the local sequence by running that sequence locally end to end (`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm pack`, `cp`, then `ls -l dsh-kanban.tgz`).
- [x] 2.3 Verify the workflow's asset name matches the documented install URL by checking that `dsh-kanban.tgz` appears in both `.github/workflows/release.yml` and `README.md`.

## 3. Documentation

- [x] 3.1 Rewrite the README installation section to lead with the release asset spec `https://github.com/filipeesch/deepseek-harness-kanban/releases/latest/download/dsh-kanban.tgz`, and keep the `link:` checkout flow labelled as development only.
- [x] 3.2 Add a README note that pasting the repository URL is a Git spec that does not use the release asset, including the exact `dsh-kanban@<spec>#<commit>` key pnpm prints under `allowBuilds` in the profile's `pnpm-workspace.yaml`, and the fact that the host offers no guided approval for it.
- [x] 3.3 Update `docs/operations.md` installation diagnostics with the observed signatures: a package installed without `lib/` that the host accepted at install time, a Git install refused for build permission, and host packages shadowed by a plugin's own dependencies.
- [x] 3.4 Verify the documented commands and URL are internally consistent by re-reading both files and confirming no stale instruction still presents the repository URL as the supported install path.

## 4. Cleanup

- [x] 4.1 Delete `issue.txt` from the repository root and verify it no longer appears in `git ls-files`.

## 5. End-to-end verification

- [x] 5.1 With a throwaway `DSH_HOME` and a profile created from the shipped template, install the packed tarball through the plugin manager and verify the bundle imports and the application starts after a restart. (First pass ran before the peer-dependency move; 6.3 re-verified the final artifact.)
- [x] 5.2 With a throwaway `DSH_HOME`, attempt a Git-spec install of a committed checkout that declares `prepare` and verify it is refused for build permission, that `package.json` and `pnpm-lock.yaml` in the profile are unchanged, and that the application still starts.
- [x] 5.3 Verify the working tree contains only the intended change files and no throwaway artifacts (`git status --short`, with build output remaining gitignored under `lib/`).

## 6. Dependency model (added during implementation)

- [x] 6.1 Move `@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`, and `@deepseek-ai/schemastery` from `dependencies` to `peerDependencies` with `^0.2.1-rc.2`, `^4.0.5`, and `^3.18.5` ranges, and verify `pnpm install` resolves the lockfile with the build still running.
- [x] 6.2 Re-run `pnpm check` after the move and verify the typechecks and the full test suite still pass.
- [x] 6.3 Install the repacked tarball into a throwaway profile and verify no `@deepseek-ai` directory is hoisted into the profile and that the application starts on two consecutive boots.
