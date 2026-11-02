# Tasks

## 1. Packaging and build

- [x] 1.1 Extract the build steps from `scripts/build.mjs` into focused units (host bundles, client wrapper, declaration emit) plus an orchestrator, keeping output paths, format, externals, and declaration targets unchanged; verify with `pnpm run build` and confirm `lib/index.js`, `lib/client.js`, `lib/remote.js`, and `lib/types/` are produced.
- [x] 1.2 Add the `prepare` script that runs the same orchestrator; verify from a clean `lib/` with `pnpm run prepare` and confirm every exported entry point exists.
- [x] 1.3 Declare `engines.dsh: ^0.2.1-rc.2`, `dsh.manifestVersion: 1`, `license: "MIT"`, and `repository`, keeping `private: true`; verify the manifest parses and `node -e` assertions read the expected values.
- [x] 1.4 Reuse the shared build units from `scripts/check.mjs` instead of repeating TypeScript and build commands; verify `pnpm check` still runs both typechecks, vitest, and the build.
- [x] 1.5 Move the host-imported DSH runtime packages from `dependencies` to optional `peerDependencies` (with `peerDependenciesMeta`), add every host-imported package to `devDependencies` (including `dsh-sandbox`), so a profile installation does not hoist a second copy; verify the local build and the isolated install leave the profile free of `@deepseek-ai` runtime copies.

## 2. Install verification

- [x] 2.1 Implement `scripts/verify-install-from-git.mjs` with injectable runner, filesystem, environment, and temporary-root dependencies: snapshot the working tree into a temporary Git repository, create an isolated `DSH_HOME` and profile, install `git+file://<snapshot>`, merge the blocked `allowBuilds` key with a YAML document, retry, and assert the installed host/client/remote/declaration entry points, the absence of `@deepseek-ai` copies, the profile bundle selection, and an exact enabled `kanban` row from `--dump-config`.
- [x] 2.2 Add cleanup and failure reporting so the script removes its temporary home and profile, never touches the developer's `DSH_HOME`, and exits non-zero naming the failed stage; verify with a forced failure (invalid spec) and confirm no temporary directory or profile remains.
- [x] 2.3 Add a `verify:install` package script and focused tests for the blocked-then-retry flow, every failure stage, cleanup, the `allowBuilds` YAML merge, the entry-point and host-copy assertions, and the exact enabled composition row using the injected runner; verify with `pnpm test` on that test file and one successful `pnpm verify:install`.

## 3. Licensing and public distribution

- [x] 3.1 Add an MIT `LICENSE` file (Filipe Esch, 2026) and remove the README and package wording that calls the package private or UNLICENSED; verify with `grep -Rni "unlicensed\|private package" README.md package.json` returning nothing and the license field reading MIT.
- [x] 3.2 Update the README requirements to the declared 0.2.x compatibility and name `0.2.1-rc.5` as the verified runtime; verify no stale `0.2.1-rc.2` requirement claim remains in `README.md` or `docs/operations.md`.
- [x] 3.3 Confirm the GitHub repository is public: verify an anonymous `git ls-remote https://github.com/filipeesch/deepseek-harness-kanban.git` succeeds without credentials.

## 4. Documentation

- [x] 4.1 Rewrite the README installation section URL-first: Add plugin plus the repository address, prerequisites, the blocked Git build and its exact `allowBuilds` remediation (without claiming a Web approval button), updates by uninstall and reinstall, troubleshooting (GitHub unreachable, blocked scripts, incompatible runtime, failed prepare), and a separate development `link:` section; verify the section reads in that order and every failure has an action.
- [x] 4.2 Keep the end-user steps in `README.md` and the deeper installation diagnostics in `docs/operations.md` (compatibility, Inspector, logs), keeping the Inspector helper guidance clearly development-only; verify no step-by-step installation instructions are duplicated and cross-references resolve.
- [x] 4.3 Document the isolated verification command and the compatibility declaration; verify the documented commands match the package scripts and the manifest.

## 5. Integration verification

- [x] 5.1 Run `pnpm check` and confirm both typechecks, vitest, and the build pass with no runtime source changes.
- [x] 5.2 Run `pnpm verify:install` against the working tree; the script commits its snapshot to a temporary Git repository, so the installation exercises the committed Git path rather than a dirty directory.
- [x] 5.3 Confirm the change stays out of the Kanban runtime: `git diff --stat` shows no edits under `src/`, `tests/host`, `tests/client`, or stored-data schemas, and the existing plugin behavior is unchanged.
- [x] 5.4 Perform the end-to-end acceptance in an isolated DSH instance from the local Git snapshot: install, write the exact `allowBuilds` key reported by the failed attempt, retry, boot the Web profile, and confirm the host rows stay active, the Kanban entry appears, and the board loads; record the screenshot without capturing tokens, credentials, or owner data.
- [ ] 5.5 After the change is merged and pushed, repeat the acceptance from the public HTTPS address and confirm an anonymous installation completes.
