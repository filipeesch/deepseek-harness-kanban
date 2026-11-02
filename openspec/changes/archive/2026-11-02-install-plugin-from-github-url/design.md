# Design

## Context

See [proposal.md](proposal.md) for motivation. The current state that shapes the approach:

- `package.json` exports `./lib/index.js`, `./lib/client.js`, and declarations under `lib/types/`, but `lib/` is gitignored and the manifest has no `prepare` script. A Git install therefore produces a package whose exports cannot resolve.
- `scripts/build.mjs` builds the host bundles, the wrapped browser module, and both declaration projects in one script. `scripts/check.mjs` repeats the two TypeScript no-emit checks and then calls the build.
- DSH's **Add plugin** accepts a Git address and installs it with the profile's pnpm. For a Git-hosted package, pnpm runs `prepare`; pnpm 11 blocks that lifecycle until `allowBuilds` contains the exact package key. On the inspected `0.2.1-rc.5` host that block is `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, which DSH reports as a generic failed installation with the key in its details and log; it does not offer the **Allow these scripts and retry** action, which is reserved for the `Ignored build scripts` condition. The key names the resolved commit, so a new commit needs its own key.
- DSH checks `engines.dsh` with `semver.satisfies(..., { includePrerelease: true })`. For a Git spec the check runs after the package is fetched and built, and a refusal restores the profile, reports `incompatible-version`, and points to the exact-version exemption path.
- The installed runtime is `0.2.1-rc.5`; the README and `docs/operations.md` still name `0.2.1-rc.2`. The plugin's SDK versions remain `0.2.1-rc.2`: they are development dependencies for building and peer ranges for the host-supplied runtime.
- Non-official plugins have no in-place Update action. DSH upgrades them by uninstalling and reinstalling.
- The repository has no CI and no tags. AGENTS.md already requires isolated verification and forbids using the owner's DSH home or profile.

## Goals / Non-Goals

**Goals:**

- Make the GitHub address the primary, sufficient installation input, with the blocked Git build's exact `allowBuilds` key as the only manual step.
- Keep source as the single source of truth: no generated bundles committed to the repository.
- Declare compatibility that admits the verified runtime and the 0.2.x line while refusing the next minor line.
- Make the distribution public and legally usable under MIT.
- Make the install contract repeatable and verifiable without touching the developer's environment.
- Reduce duplication in the build scripts and installation documentation.

**Non-Goals:**

- Publishing to npm, adding an in-place update mechanism, or listing in the official plugin market.
- Changing Kanban runtime, domain, host, client, stored data, or DSH core behavior.
- Bumping the host-supplied DSH package versions from the `0.2.1-rc.2` development baseline.
- Adding CI or release automation.
- Supporting installation without GitHub reachability or without network access for the package manager.

## Decisions

### Build during installation instead of shipping artifacts

The package declares `"prepare": "node scripts/build.mjs"`. pnpm installs the package's development dependencies in the fetched Git package, runs the build, and only then packs the installed copy. The repository continues to gitignore `lib/`.

Alternatives considered:

- **Commit `lib/`**: removes the blocked-build step and shortens installation, but every source commit must ship rebuilt output, stale artifacts become a real failure mode, and review noise grows. Rejected.
- **Publish to npm**: prompt-free and fast, but the primary input stops being the GitHub URL and adds registry and release work. Rejected by scope.

Consequences: the first install requires copying the reported `allowBuilds` key into the profile and retrying; local `pnpm install` also runs `prepare`, which contributors can skip with `--ignore-scripts` when they only need dependencies.

### Compose the build from small units

Split `scripts/build.mjs` into focused modules with one responsibility each:

- host bundles (`src/index.ts`, `src/remote.ts`) through esbuild;
- the wrapped browser module (`src/client.tsx`) through esbuild plus the module-loader wrapper;
- declaration emit for the two TypeScript build projects;
- an orchestrator that runs the steps in order and reports failures.

Each unit receives its build/execute/write functions rather than importing them directly, so composition is testable and the script is not a god module. `prepare`, `build`, and `check` call the same orchestrator instead of duplicating commands. Output paths, bundle format, externals, and declaration output stay unchanged.

### Declare DSH runtime packages as peers, not dependencies

The DSH packages the host entry imports move from `dependencies` to `peerDependencies`, and stay in `devDependencies` at `0.2.1-rc.2` so the local build and typechecks work. Plugin-specific runtime packages (CodeMirror, Lezer, `react-markdown`, `yaml`, `zod`) stay in `dependencies`; `react` and `react-dom` remain peers. Every host-provided peer is also marked optional in `peerDependenciesMeta`, because a profile with `autoInstallPeers: true` would otherwise auto-install the peer into the profile root and reintroduce the shadowing; the isolated verification asserts that the installed profile has no `@deepseek-ai` entry.

This was discovered during the isolated Web acceptance: with the SDK packages declared as dependencies, pnpm hoisted `@deepseek-ai/dsh-session`, `dsh-tools`, and `dsh-storage-domain` at `0.2.1-rc.2` into the profile. DSH's own rows then resolved those rc.2 copies against the rc.5 runtime, were denied as incompatible, and startup failed with missing required services. With the peer layout, the profile installs no `@deepseek-ai` copies, the host rows stay active, and the Kanban page loads.

Alternatives considered:

- **Pin the dependencies to `0.2.1-rc.5`**: would work for this runtime but repeats the failure at the next DSH patch and keeps a second copy of the host's packages in the profile. Rejected.
- **Depend on a hoisting configuration**: the profile owns its linker settings; a plugin cannot change them. Rejected.
- **Bundle the DSH packages into the plugin**: the host contract requires a single runtime composition and would duplicate service identities. Rejected.

### Declare `engines.dsh` as a caret range

Set `"engines": { "node": ">=20.19", "dsh": "^0.2.1-rc.2" }`. With DSH's `includePrerelease` matching, this admits `0.2.1-rc.2`, `0.2.1-rc.5`, `0.2.2`, and `0.2.2` prereleases, and rejects `0.3.0` and `0.3.0` prereleases.

Alternatives considered:

- **Exact `0.2.1-rc.2`**: rejected by the installed `0.2.1-rc.5` runtime today. Rejected.
- **No declaration**: DSH imposes no constraint and incompatibility surfaces as a runtime failure. Rejected.
- **Peer dependencies instead of a compatibility declaration**: the DSH packages are declared as optional host-provided peers, but `engines.dsh` remains the single compatibility decision; a second set of peer ranges would duplicate it.

The runtime check for a Git spec happens after fetch and build, so the documentation states that an incompatible host may pay the download and build cost before DSH refuses. Also declare `dsh.manifestVersion: 1` for manifest completeness.

### Publish under MIT and keep `private: true`

Add an MIT `LICENSE` (copyright holder Filipe Esch, 2026), set `"license": "MIT"` and a `repository` field, and remove the README statements that the package is private and UNLICENSED. Keep `"private": true` so an accidental `npm publish` stays blocked; it does not affect Git installation. The copyright holder and year are assumptions recorded for review.

Alternatives considered: Apache-2.0 (more ceremony for a plugin of this size) and publishing to npm (out of scope).

### Verify with an isolated local Git installation

Add `scripts/verify-install-from-git.mjs`. It snapshots the working tree into a temporary Git repository (tracked files plus untracked non-ignored files, so uncommitted packaging changes are exercised), creates a temporary `DSH_HOME` and profile, installs `git+file://<snapshot>` with `dsh plugin add`, parses the `allowBuilds` key from the blocked first attempt, writes it, retries, and asserts:

- the installed package contains the host, client, remote, and declaration entry points;
- the profile installed no `@deepseek-ai` copies of the host packages;
- the profile lists `dsh-kanban` in its bundle selection;
- `--dump-config` contains an enabled top-level `id: kanban` / `name: dsh-kanban` row.

The script cleans up its temporary home and profile and never reads or writes the developer's `DSH_HOME`. Its runner, filesystem, environment, and temporary-root dependencies are injectable for tests, and it exits non-zero with the failed stage. The focused tests cover the blocked-then-retry flow, every failure stage, cleanup, YAML merging, and the composition assertion. It stays outside `pnpm check` because it needs network, pnpm, and a Git install.

Alternative considered: a GitHub Actions workflow. Rejected for this change because the repository has no CI and the decision was to verify locally.

### URL-first documentation with a separate development path

Restructure the README installation section to lead with **Add plugin** plus the repository address, then prerequisites, the blocked-build remediation, updates by uninstall and reinstall, and troubleshooting. Keep the `link:` development flow in its own section. Keep the end-user steps in the README and the deeper diagnostics (compatibility, Inspector) in `docs/operations.md`, correcting every `0.2.1-rc.2` requirement reference to the declared 0.2.x range and naming `0.2.1-rc.5` as the verified runtime.

Troubleshooting covers: GitHub unreachable (the mainland mirror supplies registry packages, not the repository), the blocked Git build (the details contain the exact `allowBuilds` key; there is no Web approval button for this pnpm error), incompatible runtime (the `incompatible-version` result and the exemption command with `--profile`), and a failed prepare build (the returned diagnostic log).

### Keep the install failure behavior owned by DSH

The plugin does not add an `allowBuilds` entry, a postinstall fallback, or a prebuilt rescue path. The package manager and DSH own the block decision; the plugin's job is to build correctly once the key is recorded. DSH's failure result and log carry the exact key, and the README documents the remediation for both the Web and CLI paths.

## Risks / Trade-offs

- **Cold install cost** (about 116 packages plus the build) → document the expectation; keep the build minimal and reuse the existing esbuild path; measure the warm install in the verification lane.
- **`prepare` also runs on local installs** → document `--ignore-scripts` for dependency-only installs; the build is idempotent and fast.
- **The blocked Git build is a hard gate and DSH reports it generically** → the failure details and log carry the exact `allowBuilds` key; the README documents the profile edit and retry, and the verification script proves the retry path. There is no silent bypass, by design.
- **Compatibility is checked after fetch and build for Git specs** → the caret range admits the current runtime and the whole 0.2.x line, so this only affects genuinely incompatible hosts; the error names the exemption path.
- **GitHub reachability** → document it; the registry mirror does not proxy the repository, so a blocked GitHub fails the install regardless of registry choice.
- **Future 0.2.x versions are admitted without verification** → keep the isolated install verification as the release check and narrow the range if a release proves incompatible; exact-version exemptions remain available per profile.
- **Peer-only runtime packages depend on the host resolving them** → the isolated Web acceptance boots the installed profile and asserts the host rows stay active and the Kanban page loads; a regression in package resolution fails that acceptance rather than shipping silently.
- **License and visibility are external changes** → the repository is already public; keep it public and verify an anonymous installation after the merge.
- **No committed build means each install depends on the build succeeding** → the prepare script is exercised by the documented release check (`pnpm verify:install`), not by `pnpm check`.

## Migration Plan

1. Land the packaging, build-refactor, verification, and documentation changes while `link:` installs keep working; run `pnpm check` and the new install verification.
2. Add the MIT license and update the manifest, README, and operations diagnostics; remove the private/UNLICENSED statements.
3. Confirm the GitHub repository is public (already verified) and, after the merge, verify an installation from the anonymous HTTPS address.
4. Existing development installs keep their `link:` dependency; adopting the URL path means uninstalling the link and installing from the address. There is no stored-data migration.
5. Rollback: revert the packaging commit and reinstall from the `link:` path; no persisted state is affected. Reverting the repository visibility is independent.

## Open Questions

None that change the specifications, approach, or task breakdown. Whether to add CI or release automation later is deferrable and does not affect the install contract.
