# DSH Kanban

An independent host and client plugin for **DeepSeek Harness (DSH)**: Hub-scoped Kanban boards, per-board workflows with a column board and a workflow diagram, optional team publishing, optional Git worktrees, shared task notes, and task drawers that reuse native DSH conversations. It does not replace the DSH core, start another server, or clone the chat and agent runtime.

**Verification boundary:** the plugin is checked through public DSH extension-point contracts, real temporary Git repositories, client integration tests, and isolated real DSH composition lanes. Native conversation, model, scheduler, and history engines remain DSH responsibilities. Acceptance uses a scripted, test-only model adapter; no real-model request is part of the acceptance path. See [verification](docs/development/verification.md).

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0-0`. The manifest declares `engines.dsh`, so DSH refuses a bundle outside that range with its own incompatibility report instead of failing later at import time.
- Node.js `>=24.9.0`, aligned with that DSH baseline.
- pnpm 10.15.1, as declared by `packageManager` in [the manifest](package.json).
- Git available to the host for worktree operations, and an existing local project or Git repository.
- Native DSH file policy permitting the requested paths. Changing the working directory does not grant access.

The package is private and marked `UNLICENSED`; these instructions do not grant a license.

## Install from the repository URL

No build is published to download, so the host resolves this address as a Git dependency and the profile builds it during installation.

1. Open **Plugins → Add plugin** and paste the repository URL into the package field:

   ```text
   https://github.com/filipeesch/deepseek-harness-kanban
   ```

2. Allow the plugin build when pnpm refuses it. A clone has no `lib/`, because that directory is build output ignored by Git, and the manifest's `prepare` script produces it. The first attempt fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and the host restores the profile's manifest and lockfile. Copy the exact key pnpm prints into the profile's `pnpm-workspace.yaml` and add the plugin again:

   ```yaml
   allowBuilds:
     "dsh-kanban@git+https://github.com/filipeesch/deepseek-harness-kanban#<commit>": true
   ```

   The key names the resolved commit, so it changes whenever the ref moves; pin the address to keep one key.
3. Enable **dsh-kanban** and inspect the native installation and application result.
4. Confirm the installed copy carries its entries: `$DSH_HOME/profiles/<profile>/node_modules/dsh-kanban/lib/index.js` must exist. A copy without `lib/` can report success and fail to import on the next start.
5. Refresh the **existing** GUI URL and select **Kanban** in its sidebar.

Most DSH SDK packages are peer dependencies the host provides. The Typert protocol helper is compiled into the built entries. pnpm downloads the artifact's own runtime dependencies from the registry, so installation needs registry access for the build and for those dependencies.

If the item is missing after a reinstall, check for a stale user-layer override before treating it as an activation failure: a `- id: kanban` entry with `disabled: true` in the profile's `cordis.patch.yml` survives reinstalls and hides the row.

[Install](docs/operations/install.md) covers the failure signatures, the registry troubleshooting, the optional Inspector helper, and the reconciliation after a rebuild.

## Update an installed plugin

A profile keeps the version it resolved, so adding the same address again does not refresh an existing copy:

```sh
dsh plugin --profile <profile> update dsh-kanban
```

The command re-resolves the recorded specification and reports the new manifest version in **Plugins**. A floating address clones the default branch again and needs a new `allowBuilds` key; a pinned address stays on its commit.

## Install or pin an exact version

The bare URL follows the default branch. Append a committish to install a fixed build:

```text
https://github.com/filipeesch/deepseek-harness-kanban#11edda3
https://github.com/filipeesch/deepseek-harness-kanban#v0.15.0
```

A commit sha is the only pin that cannot move. A tag is created by hand, so confirm it exists before pinning to it. Never pin a branch name.

## Install a source checkout

Run from the checkout with the required Node and pnpm versions:

```sh
git clone https://github.com/filipeesch/deepseek-harness-kanban.git
cd deepseek-harness-kanban
pnpm install --ignore-scripts --frozen-lockfile
pnpm run build
```

Then use the already-running DSH GUI: **Plugins → Add plugin**, add the absolute built package root as `link:/path/to/deepseek-harness-kanban`, enable **dsh-kanban**, and refresh that same GUI. After source changes, run `pnpm run build` again, reconcile the rebuilt bundle through the native Plugin Manager, and refresh. A linked checkout is not a promise of source hot reload. [Install](docs/operations/install.md) has the procedure.

## First use

1. The installation starts with **My Hub** and a **Kanban** board. Create another Hub or board with **+** beside the tabs, or through **Configuration**. A new Hub starts without boards and presents **Create your first board**.
2. Register a project in **Configuration → Projects**: choose its absolute path, confirm the detected Git root and default branch, keep or change the project key, and choose its **Worktree** policy. Optionally set a global **Worktree base path** in **Configuration → General**.
3. Select **New task** at the top of the initial column, supply a title, a Markdown description, and a project, and optionally enable **Auto mode** or **Start execution now**.
4. Open the card: the drawer carries **Conversations**, **Info**, **Git**, **Notes**, and **History**, with the card's relations before History. A Git-backed task without a worktree resolves the worktree notice before its first conversation.
5. Search titles and descriptions, filter by project, and let the board move cards instead of jumping them.

[Getting started](docs/user/getting-started.md) covers the first run in full.

## What the plugin does

| Area | Guide |
| --- | --- |
| Hubs, boards, project scope, board defaults, and board configuration | [Hubs and boards](docs/user/hubs-and-boards.md) |
| Workflow YAML, stage editor, and the workflow diagram | [Workflows](docs/user/workflows.md) |
| Moving cards, stage instructions, declared transitions, and auto mode | [Execution](docs/user/execution.md) |
| The task drawer, native conversations, notes, history, relations, and question rounds | [Conversations](docs/user/conversations.md) |
| Publishing a Hub through Git, Google Drive, or a local folder, and team files | [Team sharing](docs/user/team-sharing.md) |
| Worktrees, the workspace model, and task deletion | [Git and worktrees](docs/user/git-worktrees.md) |
| Unattended cron schedules | [Schedules](docs/user/schedules.md) |
| The product tools an agent can call | [Agent tools](docs/user/agent-tools.md) |
| The workflow architect, project planner, and project manager presets | [Presets](docs/user/presets.md) |
| Repeatable Bash or TypeScript steps in a stage | [Scripted steps](docs/user/scripted-steps.md) |

## Documentation

The [documentation index](docs/README.md) lists every maintained document, and [the documentation standard](docs/AGENTS.md) states where a new fact belongs and how a document is added, moved, or deleted. [Verification](docs/development/verification.md) states where acceptance evidence belongs.

## Development

`pnpm run check` runs both typechecks, the full vitest suite — including the documentation gate — and the build; `pnpm run test:browser` is the separate browser harness. [Setup](docs/development/setup.md) covers every command, the real-composition lane, and the separate TypeScript programs.

The [workflow architect](docs/user/presets.md), [planner, and manager](docs/user/presets.md) presets ship with the plugin; their maintenance rules are in [Preset maintenance](docs/development/presets.md), and the release and install-address rules are in [Releases](docs/development/releases.md).
