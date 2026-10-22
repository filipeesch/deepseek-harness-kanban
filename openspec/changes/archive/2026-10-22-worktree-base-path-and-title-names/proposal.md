# Proposal

## Why

Every task worktree destination must be typed by hand, and generated branches carry a UUID (`task/<uuid>-<slug>`), so branch names and checkout paths are hard to read and remember. The board needs one base directory for new task worktrees and a destination derived from the task title, while preserving the ability to override a single task's destination.

## What Changes

- Add a **General** configuration section, presented first and opened by default, with an optional worktree base path.
- Setting, changing, or clearing that path affects only future worktree defaults; existing worktrees, branches, and recorded destinations are untouched.
- A non-empty base path must be an existing absolute directory; the canonical directory is stored.
- Derive the default new-branch name from the task title: lowercase ASCII slug with diacritics transliterated, hyphen-separated, up to 48 characters, falling back to `task`. The `task/` prefix is removed.
- When a base path is configured, the default worktree destination is the base path joined with the branch name.
- Avoid collisions by appending `-2`, `-3`, and so on to both the branch and the destination until both are free.
- Prefill the Git worktree creation form with the suggested branch and destination. Both remain editable; the destination follows the branch until the user edits it, and a reset action restores the derived value.
- Keep existing-branch creation tied to its existing branch name, without counters.
- Compute the suggestion on the host when the form opens. Manually entered names remain authoritative and are validated by Git when the worktree is created.
- Keep the empty-board **Configure projects** action opening Projects while the configuration icon opens General.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: adds General board configuration, including the optional worktree base path and its validation and persistence behavior.
- `worktree-management`: adds title-derived branch and destination defaults, collision counters, and editable prefilled fields.
- `harness-navigation`: configuration exposes General alongside Projects and Workflow.

## Impact

- Persisted board state gains an optional `settings` object. The board data version is not bumped because the field is additive and optional.
- New `settings.save` command and read-only `worktreeDefault` host lookup.
- Client configuration surface, Git worktree form, and board configuration entry points.
- Domain, host, bridge, and client tests covering settings validation, naming, collisions, and form defaults.
- README configuration and worktree documentation.
