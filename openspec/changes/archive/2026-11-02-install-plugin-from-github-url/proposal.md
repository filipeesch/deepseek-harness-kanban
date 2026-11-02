# Proposal

## Why

Installing dsh-kanban today requires cloning the repository, running `pnpm install` and `pnpm build`, and adding a local `link:` path to the DSH profile. The loadable bundles are gitignored and the package has no `prepare` script, so pasting the GitHub URL into DSH's **Add plugin** installs a package that cannot load. DSH already accepts a Git address and builds git-hosted plugins on install through `prepare`; the remaining gap is packaging, compatibility metadata, licensing, and documentation.

## What Changes

- Add a `prepare` lifecycle build so a Git install produces the host bundle, the client bundle, and declarations before DSH validates the package.
- Move DSH runtime packages from `dependencies` to `peerDependencies`, keeping them in `devDependencies` for building, so a profile installation does not shadow the host's own `@deepseek-ai` copies with the pinned versions.
- Declare `engines.dsh: ^0.2.1-rc.2` so DSH refuses incompatible runtimes with its existing actionable exemption path. The range covers the installed `0.2.1-rc.5` runtime and rejects `0.3.0` and its prereleases.
- Publish the repository under MIT: add `LICENSE`, set `license` in the package manifest, and remove the README statements that the package is private and UNLICENSED. Repository visibility changes outside this repository.
- Document URL-first installation, the blocked Git prepare build and its exact `allowBuilds` remediation, updates by uninstall and reinstall, and troubleshooting for GitHub reachability, blocked scripts, and incompatible runtimes. Keep the local `link:` development flow as a separate section.
- Add an isolated install verification script that installs from a temporary Git snapshot into a temporary `DSH_HOME`, writes the reported `allowBuilds` key, and asserts the built entry points, the absence of plugin-installed `@deepseek-ai` copies, and the composed enabled `kanban` entry.
- Refactor `scripts/build.mjs` into small units shared by `build`, `prepare`, and `check`, without changing the produced bundles.
- Add distribution metadata (`repository`, `license`, `dsh.manifestVersion`) and correct stale `0.2.1-rc.2` requirement text.
- Do not change Kanban runtime behavior: no domain, host, client, stored-data, or DSH-core changes.

## Capabilities

### New Capabilities

- `plugin-distribution`: installing the plugin from its public GitHub URL, the install-time build and its blocked-build remediation, the DSH compatibility declaration, public licensing, and repeatable install verification.

### Modified Capabilities

None. No existing capability's requirements change.

## Impact

- `package.json`: scripts, `engines.dsh`, `license`, `repository`, `dsh.manifestVersion`, the DSH runtime peer/dev dependency layout, and removal of the README statements that call the package private and UNLICENSED.
- `LICENSE`, `README.md`, and the installation diagnostics in `docs/operations.md`.
- `scripts/build.mjs` refactor, a new install verification script, and reuse from `scripts/check.mjs`.
- External prerequisites: the GitHub repository is public (verified) with the MIT copyright holder and year chosen for the license; client machines must reach GitHub and the npm registry, and DSH reports the blocked prepare build whose exact `allowBuilds` key is added to the profile before retrying.
- No changes to `src/`, tests' runtime expectations, stored data, or the DSH core.
