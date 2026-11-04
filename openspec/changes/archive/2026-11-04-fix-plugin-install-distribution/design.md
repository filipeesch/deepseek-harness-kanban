# Design

## Context

The package is compiled, not committed: `scripts/build.mjs` writes the Node entries to `lib/index.js` and `lib/remote.js`, emits the lazy client module to `lib/client.js`, and runs the two TypeScript declaration builds into `lib/types/`. `.gitignore` excludes `lib/`, while `package.json` publishes `files: ["lib", "cordis.patch.yml", "README.md"]` and points every `exports` target into `lib/`.

The host installs a bundle by running `pnpm add <spec>` inside the profile directory. It accepts four spec forms: a registry name, a Git address, a tarball URL, and an absolute local path. It does not run a build as part of that step, and after `pnpm add` it validates only that the package declares `dsh.bundle`, that the bundle patch exists, and that the version is compatible. It does not check that the package's `exports` targets exist.

Two pnpm behaviors, verified against the pnpm 11.28.5 that the host bundles, constrain the approach:

- A Git-hosted dependency with any lifecycle build script is refused with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` unless `allowBuilds` permits it. Once permitted, pnpm runs the dependency's own package manager over the clone (`preferredPM`, so pnpm here because the checkout carries `packageManager` and a lockfile), then its prepack/prepare/postpack scripts, and packs the result according to `files`.
- The host turns a failed install into a guided retry only when pnpm prints `Ignored build scripts:`, which this refusal does not. `recordPendingBuilds` therefore yields nothing for this case, and the Web dialog offers no approval button.

A packed tarball installs with no scripts at all, honoring `files`, and its `exports` resolve immediately.

A profile installs with `nodeLinker: hoisted` and `autoInstallPeers: false`. Because of the hoisted linker, any `@deepseek-ai` package the plugin lists under `dependencies` is placed at the profile root, where the host finds it when resolving its own plugin rows. A plugin pinned to `0.2.1-rc.2` therefore makes an `0.2.1-rc.5` host report those rows as incompatible and disable them; the profile fails to start with required rows waiting for services, even though the plugin itself imports correctly. Measured on an isolated `0.2.1-rc.5` host: the baseline profile starts, and the same profile fails after installing a plugin that lists the SDK packages as dependencies.

## Goals / Non-Goals

**Goals:**

- One install instruction that works on a clean profile with no build step and no approval step.
- A git-spec install can no longer produce an enabled bundle that fails to import on the next start.
- The released artifact is reproducible from a commit, not assembled by hand.
- Installing the plugin does not shadow or downgrade the host's own packages.
- Documentation tells the truth about which spec form uses the release artifact.

**Non-Goals:**

- Changing how the plugin builds or what it exports.
- Repairing profiles that are already broken; that remains a host recovery operation.
- Publishing to a registry, or versioning build output.
- Adding new packaging gates or validation scripts; the existing `pnpm check` stays the verification gate.

## Decisions

### Decision 1: Distributed as a release tarball with a fixed asset name

The release workflow packs the package and uploads it as `dsh-kanban.tgz` on every `v*` release. The install spec is therefore a constant:

```text
https://github.com/filipeesch/deepseek-harness-kanban/releases/latest/download/dsh-kanban.tgz
```

The host classifies that URL as a tarball, not as a Git repository, because its path has more than the three segments a hosted-repository URL allows. That is what makes it take the script-free path.

Alternatives considered:

- **Publish to npm.** Cleanest spec (a bare package name), but it requires removing `private: true`, deciding a license for a package that is currently `UNLICENSED`, and holding a publish token. Out of scope by decision.
- **Commit `lib/` to `main`.** Makes the repository URL itself work, at the cost of versioning build output, large diffs, and drift between source and artifact.
- **Commit `lib/` on a release branch or tag.** Same drift risk, and it still requires a `#ref`, so the plain repository URL keeps failing.
- **Keep `link:` as the only documented path.** Leaves the reported failure reachable for anyone who pastes the repository URL.

A fixed asset name is chosen over a versioned one (`dsh-kanban-0.1.1.tgz`) so that `/releases/latest/download/` resolves to the newest artifact without the README's instruction changing between releases. The installed version stays visible in the package and in the release tag.

### Decision 2: `prepare` as a safety net, not as the distribution path

`package.json` gains `"prepare": "node scripts/build.mjs"`. The intent is not to make Git installs the supported path; it is to make them fail at install time instead of succeeding with an unimportable package.

Because pnpm refuses the script without approval, the Git install now fails, and the host restores `package.json` and `pnpm-lock.yaml` before the bundle is selected. The host keeps starting. Users who still want the Git spec can approve the build by copying the exact `dsh-kanban@<spec>#<commit>` key that pnpm prints in the refusal under `allowBuilds` in the profile's `pnpm-workspace.yaml`. A name-only key is not enough on the bundled pnpm 11.28.5, and the printed key names the resolved commit, so it has to be repeated whenever the ref moves. An approved run then needs the profile's package manager on `PATH` and registry access, because pnpm installs the dependency and runs its build.

Alternative considered: rely on documentation alone. Rejected because the failure mode after a successful-but-empty install is an application that will not boot, which is the defect being fixed.

### Decision 3: Release workflow runs the existing gate

`.github/workflows/release.yml` runs on `push` of a `v*` tag, on Node 24 to match the runtime the host bundles:

1. `pnpm install --frozen-lockfile`
2. `pnpm check` (host and client typechecks, vitest, then `scripts/build.mjs`)
3. fail the run when the pushed tag is not `v` plus the manifest version, so a fixed asset name can never publish an older archive under a newer tag
4. `pnpm pack --pack-destination dist`, then copy the produced archive to `dsh-kanban.tgz`
5. upload that file as a release asset

No new verification script is introduced. `pnpm check` already rebuilds through the same entry point that `prepare` and the pack step use, so a release is only published from a commit whose build succeeds.

### Decision 4: Version and tag

`package.json` moves to `0.1.1` and the first release is tagged `v0.1.1`. The reported broken install resolved as `0.1.0`, so a patch bump keeps the fixed artifact distinguishable without implying a behavior change in the plugin.

### Decision 5: Documentation is written around the artifact, with the Git path called out

The README installation section leads with the release-asset spec, then keeps the `link:` checkout flow for development. A separate note states that pasting the repository URL is a Git spec, not a release download, and documents the `allowBuilds` step for that case. `docs/operations.md` keeps the diagnostic framing and gains the three observed failure signatures: a package without `lib/` validated successfully at install time, a Git install refused for build permission, and host packages shadowed by a plugin's own dependencies.

### Decision 6: `issue.txt` is deleted

It is a scratch list of UX notes already tracked by the board, unrelated to installation. Deleting it removes a stale root-level artifact rather than relocating it.

### Decision 7: The DSH SDK packages are peer dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`, and `@deepseek-ai/schemastery` move from `dependencies` to `peerDependencies` with ranges that start at the version the plugin is built against (`^0.2.1-rc.2`, `^4.0.5`, `^3.18.5`). The host installation provides them, so the profile gains no `@deepseek-ai` copy and nothing shadows the running host's packages. The build keeps its `devDependencies` pins, because the compiler still needs those types at the version the plugin targets.

The compatibility gate reads `peerDependencies` as semver ranges with prereleases included, so `^0.2.1-rc.2` accepts `0.2.1-rc.5` and the plugin stays enabled instead of being disabled as incompatible.

Alternatives considered:

- **Keep them as dependencies and pin `0.2.1-rc.5`.** Boots on the current host, but every host update requires a new plugin release, and the previous release breaks the profile in the meantime.
- **Use a range in `dependencies` (`^0.2.1-rc.2`).** Resolves to `0.2.1-rc.5` today, then floats to the first stable `0.2.2`, which the running host may not match.
- **Use `0.2.x`.** Semver ranges do not match prereleases without an explicit prerelease comparator, so `0.2.x` resolves to no candidate at all while only release candidates exist.

Verified on an isolated `0.2.1-rc.5` host: with the SDK packages as peers, the profile has no `@deepseek-ai` directory under `node_modules`, the bundle imports, and two consecutive starts succeed.

## Risks / Trade-offs

- **[The `/releases/latest/download/` URL silently breaks if the asset name changes]** → The workflow hardcodes `dsh-kanban.tgz`, and the README states that the name is part of the public install contract. A renamed asset is a documentation change, not an incidental one.
- **[`prepare` runs on ordinary `pnpm install` in the checkout, not only for Git installs]** → The build is idempotent and already required after a fresh install; the cost is a slower local install, not a behavior change. `prepare` is kept as a single delegation to `scripts/build.mjs` so there is one build definition.
- **[An approved Git install builds against the developer's registry configuration and needs pnpm on `PATH`]** → The release asset never builds, so the supported path is unaffected. The Git path is documented as a fallback with those requirements, not as the default.
- **[The host still does not validate `exports` targets after install, so a future bad release could brick startup again]** → The release is only produced by a workflow that requires `pnpm check` and the build to pass. The residual host-side gap is out of scope for this repository and is left documented rather than worked around.
- **[The plugin now relies on the host resolving the SDK packages at runtime]** → Verified on an isolated `0.2.1-rc.5` host: the profile has no `@deepseek-ai` copy, the bundle imports, and two consecutive starts succeed. The alternative, shipping the packages, is what produced the shadowing defect.
- **[Profiles already broken by `0.1.0` are not repaired]** → Out of scope by decision; the change prevents new occurrences and the operations guide points at the host's own recovery.

## Migration Plan

1. Merge the change and tag `v0.1.1`.
2. Confirm the workflow published a release asset named `dsh-kanban.tgz`.
3. Verify a clean-profile install from the asset URL: the bundle installs without a build prompt and the plugin imports on restart.
4. Keep `0.1.0` Git installs untouched; anyone affected must uninstall the bundle and reinstall from the asset URL.

Rollback: delete the release and tag, and pin affected users back to a `link:` checkout of the previous commit. No profile data format changes, so no data rollback is required.

## Open Questions

None that affect the approach. Whether to also publish to a registry is a separate decision and does not change this design.
