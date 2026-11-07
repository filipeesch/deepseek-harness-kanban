# Proposal

## Why

Installing the published `dsh-kanban.tgz` into a profile that also carries another plugin's older SDK copy fails to activate the bundle:

```
failed to import: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './remote-info'
is not defined by "exports" in .../profiles/web/node_modules/@deepseek-ai/dsh-typert-protocol/package.json
imported from .../profiles/web/node_modules/dsh-kanban/lib/index.js
```

The host build keeps every `@deepseek-ai/*` package external, so Node resolves the plugin's bare imports from the profile's `node_modules` first and only falls back to the DSH installation when the name is absent. `dsh-codex` transitively installs `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2`, which does not export `./remote-info`; the DSH installation ships a newer copy that does. The plugin's peer-only assumption ("the host provides the SDK packages, so the profile never gains a second copy") does not hold, and the failure surfaces as an opaque import error after a nominally successful install.

The same release process also makes an installed artifact indistinguishable from its predecessor: the manifest stays at `0.1.1` and every merge re-uploads to the same tag with `--clobber`, so there is no version to report, pin, or update to.

## What Changes

- The host build bundles `@deepseek-ai/dsh-typert-protocol` into `lib/index.js` and `lib/remote.js` instead of keeping it external, mirroring what the client build already does for the same module. The published artifact no longer resolves that package from the profile at runtime.
- A new `src/host-sdk/` seam becomes the single place that imports the Typert contract, so the rest of the host code never depends on how the SDK helper is obtained.
- `package.json` declares `engines.dsh: ">=0.2.1-rc.2 <0.3.0"` so DSH's native admission check decides compatibility and reports an incompatible host instead of failing at import time.
- `@deepseek-ai/dsh-typert-protocol` moves from `peerDependencies` to `devDependencies`; it is build-time only after the bundle. **BREAKING** for hosts outside the declared range: they are refused by admission instead of being silently admitted.
- The release workflow publishes exactly one immutable release per manifest version. It fails when the version tag or asset already exists, and it no longer uses `--clobber`. The version is bumped in the pull request that changes the artifact.
- The README keeps `releases/latest/download/dsh-kanban.tgz` as the install address and documents pinning an exact tag, updating an installed profile, and the diagnostic for a stale SDK copy in the profile.
- Not in this change: no automated regression test for the shadowed-package scenario, no split of `apply()`/`openHubSharing`, no split of `src/remote.ts`, no deduplication of the client external list between `scripts/build.mjs` and `package.json`, and no board, drawer, chat, or storage behavior change.

## Capabilities

### New Capabilities

- `plugin-distribution`: how the published plugin artifact is built, declared compatible with a DSH range, released immutably, and installed or updated from its release asset.

### Modified Capabilities

<!-- None: no existing capability's requirements change. Board, task, conversation, sharing, and worktree behavior are untouched. -->

## Impact

- `package.json`: `engines.dsh`, protocol dependency class, version bump to `0.1.2`.
- `scripts/build.mjs`: host bundle resolution rule that inlines the protocol helper while keeping the rest of the SDK external.
- `src/remote.ts` and the new `src/host-sdk/typert.ts`: the Typert descriptor seam.
- `.github/workflows/release.yml`: immutable release creation and version guard.
- `README.md`, `docs/operations.md`, `AGENTS.md`: install, update, and compatibility guidance.
- Verification: an isolated `DSH_HOME` profile that installs the real tarball and plants `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2` before boot.
