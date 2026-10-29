# Proposal

## Why

Project registration is the entry point to every task, yet it is the weakest part of the product: creation and management share one panel, the macOS folder chooser opens a panel whose file list cannot be clicked, and Git detection silently degrades — a failed `git rev-parse` is reported as "the Git root is the project path" and the default branch is never detected at all. Users therefore register contexts that look valid and fail later, when a worktree operation is attempted.

## What Changes

- **Separate inclusion from management.** Configuration → Projects becomes the Hub's project registry list. Add and Edit open a dedicated Project editor dialog with explicit Save and Cancel; Delete keeps its inline confirmation.
- **Fix directory picking.** The plugin prefers the desktop-injected native picker (`__DSH_DIRECTORY_PICKER__`) and falls back to the host directory picker. Picker failures become typed problems instead of silent `null`; manual path entry remains available.
- **Add project location detection.** Probing a folder reports either a Git-backed location (Git root plus a suggested default branch) or a folder project, or a typed error. Detection never substitutes the project path for a Git root.
- **Allow folder projects.** **BREAKING** for the persisted project shape: `gitRootPath` becomes optional and its absence means a folder project. Git and worktree features are unavailable for folder projects, and the task drawer hides the Git section and the missing-worktree notice.
- **Validate at save.** Saving a Git-backed project requires its Git root to be the repository top; the client suggestion is not authoritative.
- **Support conversion.** A project can gain or lose its Git association at any time. Task conversations in a checkout keep running there; the checkout becomes a plain checkout, loses every Git action, and is never deleted by the plugin.
- **Refactor the configuration surface.** `forms.tsx` splits into configuration sections plus a project slice, a single directory-picker port replaces prop-drilled picker callbacks, and Git operations accept a narrowed `GitProject` instead of an optional-path `Project`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `project-contexts`: the registry accepts folder projects with an optional Git root; project location detection reports the Git root and a default-branch suggestion; saving validates repository identity; folder projects are excluded from Git-backed operations.
- `harness-navigation`: the Projects configuration section is a registry list, and project creation and editing happen in a dedicated dialog instead of the embedded form.
- `worktree-management`: worktree affordances apply only to Git-backed projects; after Git association is removed, the checkout becomes a plain checkout with no Git actions and is retained when its task is deleted.

## Impact

- **Domain and wire**: `Project`/`ProjectInput` shape, project schemas, `ProjectProbe` port, `GitPort` contracts, the `kanban/detectProject` remote, and the command payload for `project.save`.
- **Host**: project save validation, host-level read-only Git probing outside the session sandbox, and the deletion path for a checkout whose project no longer has Git.
- **Client**: the configuration dialog, a new project registry and editor dialog, a directory-picker port at the composition root, and Git-conditional task drawer sections.
- **Persisted data**: no migration; existing records keep `gitRootPath` and remain valid.
- **Docs**: README and the affected capability specs.
