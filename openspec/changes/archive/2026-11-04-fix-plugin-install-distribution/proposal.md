# Proposal

## Why

Installing the plugin straight from GitHub produces a package without its built `lib/` directory, so the next DSH start fails to import `lib/index.js`. Because the bundle is enabled in the profile, the failure takes down the whole application and repeats on every relaunch until the profile is repaired by hand.

The current README only documents a local `link:` install, so pasting the repository URL into **Plugins → Add plugin** is the natural thing a user tries, and it fails silently at install time: the host validates the bundle patch but never checks that the package's public entry points exist.

## What Changes

- **Publish a release artifact instead of relying on a build during installation.** A tag push builds the plugin once and attaches a single tarball asset with a fixed name (`dsh-kanban.tgz`) to the release, so the install spec is stable across versions: `https://github.com/filipeesch/deepseek-harness-kanban/releases/latest/download/dsh-kanban.tgz`. The host already accepts tarball specs and installs them without running dependency build scripts.
- **Add a `prepare` script** so an install that uses a git spec builds the entries or fails during installation. A failed install restores the profile manifest and lockfile, so the host keeps starting. The `allowBuilds` approval that pnpm requires for this path is documented, since the host does not surface a guided approval for it.
- **Add a GitHub Actions release workflow** triggered by a `v*` tag push: install dependencies, run the existing `pnpm check` gate, pack, and upload the asset.
- **Bump the version to `0.1.1`** and tag `v0.1.1`, so the fixed artifact is distinguishable from the `0.1.0` that broke profiles.
- **Rewrite the installation documentation** around the release asset, and state explicitly that the repository URL is a Git spec that does not use the release asset. Document that fallback and the exact `allowBuilds` key it requires.
- **Declare the DSH SDK packages as peer dependencies** so the host installation provides them. Listing them as dependencies made the profile's hoisted install shadow the host's own packages, so an `0.2.1-rc.5` host disabled its plugin rows as incompatible and failed startup even when the plugin itself loaded.
- **Remove `issue.txt`** from the repository root.

Not a breaking change for the plugin's runtime behavior or for linked-development installs.

## Capabilities

### New Capabilities

None. The scope decision for this change excludes a new capability spec, so installation and release behavior is documented as packaging and tooling rather than as product behavior.

### Modified Capabilities

None. This change does not alter how the Kanban product behaves; it changes how the built package is produced, published, and installed. The change therefore declares `skip_specs: true` instead of inventing a requirement to satisfy validation.

## Impact

- `package.json`: version `0.1.1`, a `prepare` script that delegates to the existing `scripts/build.mjs`, and the DSH SDK packages moved from `dependencies` to `peerDependencies`. `files` and `exports` stay as they are. `pnpm-lock.yaml` is re-resolved.
- New `.github/workflows/release.yml`: tag-triggered verification, build, pack, and asset upload.
- `README.md` and `docs/operations.md`: the installation section and its diagnostics.
- `issue.txt`: removed from the repository.
- No changes to `src/`, to the client bundle, or to any host or remote entry point. No public API change.
- Assumption recorded for review: the workflow runs on Node 24, matching the runtime the host application bundles, and is triggered by a `v*` tag push.
- Already-broken profiles are not repaired by this change; recovering them stays a manual, documented-by-DSH operation.
