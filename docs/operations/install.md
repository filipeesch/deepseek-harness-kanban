# Install and Update

The plugin is an independent host and client bundle for **DeepSeek Harness (DSH)**, installed from this repository's URL. No build is published to download, so the host resolves that address as a Git dependency and the profile builds it during installation.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0-0`. The manifest declares `engines.dsh`, so DSH refuses a bundle outside that range with its own incompatibility report instead of failing later at import time. A supported host keeps the Kanban entry and its controller.
- Node.js `>=24.9.0`, aligned with that DSH baseline.
- pnpm 10.15.1, as declared by `packageManager` in [the manifest](<../../package.json>).
- Git available to the host for worktree operations, and an existing local project or Git repository.
- Native DSH file policy permitting the requested paths. Changing the working directory does not grant access.

The package is private and marked `UNLICENSED`; these instructions do not grant a license.

## Install from the repository URL

Install the plugin from this repository's URL. The installed copy is always the commit the address resolved.

1. Open **Plugins → Add plugin**.
2. Paste the repository URL into the package field:

   ```text
   https://github.com/filipeesch/deepseek-harness-kanban
   ```

3. Allow the plugin build when pnpm refuses it. A clone has no `lib/`, because that directory is build output ignored by Git, and the manifest's `prepare` script is what produces it; pnpm does not run the build script of a Git dependency unless the profile permits it, so the first attempt fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and the host restores the profile's `package.json` and `pnpm-lock.yaml`. Copy the exact key pnpm prints in the refusal into the profile's `pnpm-workspace.yaml` and add the plugin again:

   ```yaml
   allowBuilds:
     "dsh-kanban@git+https://github.com/filipeesch/deepseek-harness-kanban#<commit>": true
   ```

   The key names the resolved commit, so it changes whenever the ref moves; pin the address to keep one key.
4. Enable **dsh-kanban** and inspect the native installation and application result. The approved run installs the checkout's own dependencies and runs the build, so it needs the profile's package manager on `PATH` plus registry access.
5. Confirm the installed copy carries its entries before trusting the result: `$DSH_HOME/profiles/<profile>/node_modules/dsh-kanban/lib/index.js` must exist. A copy without `lib/` can report a successful installation and fail to import on the next start.
6. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar. Use the URL the host printed on launch.

Most DSH SDK packages are peer dependencies that the host installation provides, so the profile does not need its own copy. The Typert protocol helper is compiled into the built entries instead: a profile can hoist an older copy of that package, and Node resolves the profile copy before the host installation. pnpm also downloads the artifact's own runtime dependencies from the registry, so installation needs registry access for the build and for those dependencies.

## Installation failure signatures

**A package installed without built entries.** A Git-spec installation clones the repository, and a clone has no `lib/` because that directory is build output ignored by Git. The host checks the bundle patch after `pnpm add` but not the package's public entry points, so the installation reports success and the failure only appears on the next start as an import error for `lib/index.js`. This is the ordinary result of an install whose build was never approved: allow the build for the resolved commit, then reinstall.

**A stale profile override disables the Kanban row.** A user-layer `cordis.patch.yml` survives a plugin reinstall. An entry such as `- id: kanban` with `disabled: true` keeps the bundle off even when the package is installed and `dsh.profile.bundles` lists it, so the sidebar item never appears. Confirm the composed row:

```sh
dsh --profile <profile> --dump-config | grep -A2 'id: kanban'
```

If the row is disabled, enable Kanban in the plugin manager or remove that user-layer override, then restart the profile. Do not delete the profile or reinstall the package to fix a user-layer disable.

**Host packages shadowed by a plugin's own dependencies.** A profile installs with `nodeLinker: hoisted`, so a `@deepseek-ai` package installed transitively by another plugin lands at the profile root, and Node resolves that physical copy for every plugin row. When the shadowed package is one the plugin imports at runtime, the import fails and the host reports that the bundle did not activate; a copy that predates the subpath the plugin needs fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and a missing package or export fails with `ERR_MODULE_NOT_FOUND` or a missing named export. When the shadowed package participates in host services, DSH can instead report rows as incompatible and disable them, which surfaces as `startup failed` with required rows waiting for services. This plugin compiles the Typert protocol helper into its published entries and declares `engines.dsh`, so a stale copy of that helper no longer breaks activation. Other SDK packages can still be shadowed: identify the culprit with `dsh plugin --profile <profile> why <package>`, inspect `$DSH_HOME/profiles/<profile>/node_modules/@deepseek-ai`, then update or remove the plugin that pins the older copy.

**A Git install refused for build permission.** A Git-spec installation of a checkout that declares `prepare` fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` until the profile permits that dependency's build scripts. The host restores the profile's `package.json` and `pnpm-lock.yaml` and keeps the refusal. Approve the build for the resolved commit and retry once; do not loop installs.

## Network failure during an installation

Every install resolves the checkout's dependencies and the artifact's own runtime dependencies from the registry, so a restricted network can fail the install. A source installation attempt can fail on the default registry path; an explicitly requested **one-shot** `https://registry.npmjs.org` override can succeed without changing registry settings. Treat that as evidence about one attempt, not a universal registry diagnosis or permission to persist new settings.

Check the actual package-manager exit and application result. If an install times out, it may still be running: inspect the current bundle inventory before retrying. Do not loop installs, silently change global registries, disable TLS checks, or treat a timeout as proof that nothing happened.

## Update an installed plugin

A profile keeps the version it resolved, so adding the same address again does not refresh an existing copy. Update it explicitly from the checkout-independent CLI:

```sh
dsh plugin --profile <profile> update dsh-kanban
```

The command runs pnpm in `$DSH_HOME/profiles/<profile>` (by default `~/.dsh/profiles/<profile>`), re-resolves the specification the profile recorded, and reports the new manifest version in **Plugins**. A floating address (the bare repository URL) clones the default branch again, so it builds a new commit and needs a new `allowBuilds` key for it; an address pinned with `#<commit sha>` stays on that commit until you change the specification. Use `--profile desktop` only through the Desktop-owned CLI, which manages that reserved profile.

## Install or pin an exact version

The bare repository URL follows the default branch, so it moves whenever `main` moves. To install a fixed build, append a committish to the same URL:

```text
https://github.com/filipeesch/deepseek-harness-kanban#11edda3
https://github.com/filipeesch/deepseek-harness-kanban#v0.15.0
```

A commit sha is the only pin that cannot move. Tags exist for every version published while the release workflow still ran, and a tag for a later version is created by hand, so confirm the tag exists before pinning to it. Never pin a branch name: a branch is a moving ref, not a fixed build.

No standalone web server is needed. Do not start Vite or a replacement DSH instance to make this plugin visible. The plugin adds navigation beside Automation tasks and Plugins; it does not configure a startup-page override.

## Install a source checkout

Run from this checkout with the required Node and pnpm versions:

```sh
git clone https://github.com/filipeesch/deepseek-harness-kanban.git
cd deepseek-harness-kanban
node --version
pnpm --version
pnpm install --ignore-scripts --frozen-lockfile
pnpm run build
```

Then use the **already-running DSH GUI**:

1. Open **Plugins → Add plugin**.
2. Add the absolute path to the **built package root**, not a source file or build subdirectory:

   ```text
   link:/path/to/deepseek-harness-kanban
   ```

   If the GUI offers a local-path input, select that same absolute directory.
3. Enable **dsh-kanban** and inspect the native installation and application result.
4. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar.

After source changes, deliberately run `pnpm run build` again, explicitly reconcile the rebuilt plugin through the supported native Plugin Manager operation, and refresh that same GUI. A linked checkout is not a promise of source hot reload or automatic compilation; inspect application and errors and honor any native restart-required result instead of reporting a hot update as successful.

## What the repository install builds

The repository URL is a Git dependency: pnpm clones the default branch, which does not contain `lib/` because that directory is build output ignored by Git, and the manifest's `prepare` script compiles it. Two consequences follow: the profile must approve the build for the resolved commit before the install can complete, and a copy that got installed without that build reports success and then fails to import on the next start. Confirm `lib/index.js` exists in the installed copy before treating an installation as good.

## Reconcile after a rebuild

Public `pluginManager.setBundleEnabled('dsh-kanban', true)` reconciles changed loaded files in a linked-package target even when the bundle is already enabled. This explicit operation does not require a root source watcher, compile source, or promise automatic source hot reload.

After active task work settles, an authorized operator can rebuild and reconcile through the native Plugin Manager, or through the optional local Inspector helper:

```sh
pnpm run build
node scripts/dsh-inspect.mjs enable --path /path/to/deepseek-harness-kanban --allow-mutation
node scripts/dsh-inspect.mjs inventory --package dsh-kanban
```

Read `application`, `restartReason`, errors, and active plugin state, then refresh **the same existing GUI URL** and verify the changed behavior. `changed: false` means the persisted selection did not change; it can legitimately accompany `application: applied` after reconciliation. Neither field alone proves the feature works. Honor `restart-required`; a failed replacement can leave the old plugin stopped, so do not assume stale code is still serving after an error.

Normal **Plugins disable/enable** remains a supported native lifecycle action, but switching off and on does not guarantee eviction of unchanged bundle modules. Do not call a nonexistent reload method, private manager methods, or arbitrary Inspector evaluation to force a refresh.

## Optional local Inspector helper

[The Inspector helper](<../../scripts/dsh-inspect.mjs>) is optional and targets an **already-running local DSH Inspector**, default `http://127.0.0.1:9230`. Port 9230 is not the GUI port. The helper does not start an Inspector, browser, or server, restart DSH, obtain authentication, edit profiles, or provide arbitrary evaluation verbs. Use it only when the current local Inspector is already available and you are authorized to inspect it.

Read-only examples, from the checkout:

```sh
node scripts/dsh-inspect.mjs --help
node scripts/dsh-inspect.mjs inventory --package dsh-kanban
node scripts/dsh-inspect.mjs clients
node scripts/dsh-inspect.mjs snapshot
# When multiple inspected Clients exist, select the source returned by clients:
node scripts/dsh-inspect.mjs snapshot --client SOURCE_ID
```

`inventory` returns projected public plugin and bundle status, not configuration secrets. `snapshot` distinguishes DSH's Cordis semantic DOM from the rendered browser DOM and returns text and value-free page structure only when a connected Client Inspector realm is available. Host-only semantic output is not visual GUI verification. No connected Client means no rendered-page evidence; do not improvise an authentication-extraction or browser-attachment workaround.

The helper also has **explicit mutations**, never implicit fallbacks. Only an authorized operator choosing this alternative should run them:

```sh
node scripts/dsh-inspect.mjs install --path /path/to/deepseek-harness-kanban --allow-mutation
# Enable is separate; installation deliberately starts disabled.
node scripts/dsh-inspect.mjs enable --path /path/to/deepseek-harness-kanban --allow-mutation
```

Before either mutation, the helper validates the built package's public entries and native bundle patch. It uses public plugin-manager operations, not direct profile edits. Helper exits are **0** for a successful result, **1** for a helper error, **2** for an application result other than applied, and **3** for restart-required. Inspect the returned stage, application, and error data as well; do not report installation success from the outer exit code alone. A timed-out mutation includes a request identity and can remain in progress: inspect inventory before any retry.

[The separate live-verification helper](<../../scripts/live-verify.mjs>) requires explicit owner-test authorization and can launch an ephemeral authenticated HTTP browser client of the existing backend. It is not an ordinary read-only Inspector command, not the original Desktop renderer, and not needed for installation. Do not invoke it without that authorization or capture and share secret-bearing login URLs, credentials, browser state, or native chat contents as evidence.
