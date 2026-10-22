# Design

## Context

See `proposal.md` for motivation and the delta specs for required behavior. The current implementation constrains the approach:

- Configuration is a modal with Projects and Workflow; `BoardState` has no board-level settings, and the schema is a strict object at `DATA_VERSION 2`.
- The Git form starts with an empty destination and generates `task/<task-id>-<slug>` from the task title ([git.tsx](src/client/git.tsx)).
- Project paths are canonicalized and must exist when saved ([app.ts](src/host/app.ts)); worktree targets are canonicalized and policy-checked when created ([git.ts](src/host/git.ts)).
- Git creates missing parent directories for a worktree, so a configured base path does not need to contain the branch directory in advance.
- Shared modules are compiled into both host and browser bundles. A shared naming helper therefore cannot import `node:path`, and the browser cannot stat the filesystem or enumerate Git branches.

## Goals / Non-Goals

**Goals:**

- One board-level base path for future task worktree destinations.
- Readable, title-derived branch and destination defaults without the task UUID or a `task/` prefix.
- Deterministic collision avoidance that keeps `destination = base path + branch`.
- A Git form that is useful before any configuration and remains fully overridable.

**Non-Goals:**

- Renaming existing branches, moving existing worktrees, or migrating UUID-based names.
- Per-project base path overrides.
- Creating a worktree automatically or changing the effective project directory rules.
- Treating the base path as a sandbox or permission boundary.

## Decisions

### 1. Store settings as an optional additive board field

`BoardState` gains `settings?: BoardSettings` with `worktreeBasePath?: string`, and `initialState()` includes `settings: {}`. The schema adds a strict optional `settings` object. No `DATA_VERSION` bump and no migration are needed: previously persisted states simply lack the field, and the client treats a missing value as unset.

**Why not a version 3 migration:** the field is additive and optional, so old data remains valid. A bump would also require a legacy branch in the storage-domain schema union and would touch every test fixture for no behavioral gain. The trade-off is recorded under Risks.

### 2. Add `settings.save` with host-side canonical validation

The domain validates that a present `worktreeBasePath` is a non-empty absolute path. The host command handler resolves it with `realpath`, requires an existing directory, and saves the canonical path. An empty value is normalized to absent and clears the setting. The command carries `expectedRevision` and participates in the existing transaction and snapshot flow; unknown settings keys are rejected. A non-existent or non-directory value fails with `INVALID_WORKTREE_BASE_PATH`.

The whole settings object is replaced on save. With one field this is predictable, and future fields must be included by the client that saves them.

### 3. Put title and path derivation in a shared pure helper

A new `src/shared/worktree-name.ts` exports the naming rules used by both the host suggestion and the client:

- `taskTitleSlug(title)`: `NFKD` normalization, combining-mark removal, lowercase, `[^a-z0-9]+` to `-`, trim, strip trailing hyphens after the 48-character cut, fallback `task`.
- `worktreePathForBranch(basePath, branch)`: returns `''` when the base or branch is empty; rejects empty, `.`, and `..` branch segments; joins with a backslash when the base contains backslashes and no forward slashes, otherwise `/`; strips trailing separators from the base while preserving a root base.

The helper avoids `node:path` so the browser bundle stays valid. The browser path separator is inferred from the base path string, which is a host path returned by the picker or typed by the user.

### 4. Resolve collision counters on the host

A read-only remote method `worktreeDefault(taskId)` returns `{ branchName, path }`. The host derives the slug, lists local branches through the existing `GitPort.branches`, collects occupied destinations from board state (active worktrees, unclaimed checkouts, `operation.createAttempt`, and `pendingTransition.worktreeRequest`), and checks each candidate destination. It tries `slug`, `slug-2`, `slug-3`, and so on until both the branch and destination are free, then returns the pair. With no base path, only branch collisions are checked and `path` is empty.

**Why the host:** Git inventory and filesystem existence are host-owned; a client implementation would duplicate Git semantics and miss on-disk paths. **Alternative considered:** compute in the client from `branches(taskId)` and the board snapshot, with Git failing on remaining collisions. Rejected for the normal case because filesystem presence is not observable in the browser.

The branch listing can fail. In that case the lookup fails and the client keeps the provisional local default (raw slug, joined path) and shows the error; creation remains Git-validated.

### 5. Prefill and synchronize the Git form

`initialWorktree` uses `taskTitleSlug` and `worktreePathForBranch` instead of the task ID, so the form is usable immediately. When `worktreeDefault` resolves, the form replaces both values only if the user has not edited either field. Two touch flags drive the behavior:

- While the destination is untouched, changing the branch recomputes `destination = base + branch`, including when the mode switches to an existing branch.
- Editing the destination clears the destination touch flag's automatic behavior; a "Use default path" action restores the joined value for the current branch.
- Manually entered names are never silently rewritten. The create command carries the displayed branch and destination, and the existing Git validation remains authoritative.

The base path is read from the board snapshot and passed through the drawer. A missing base path leaves the destination empty, as today.

### 6. General tab and entry points

`Configuration` gains `General` as the first tab and default section. `BoardView` tracks the configuration's initial section instead of a boolean; the header configuration icon opens General while the empty-board "Configure projects" action opens Projects. The General panel contains the base path input, a Browse action backed by the existing directory picker, Save, a short explanation, and an example derived destination.

### 7. Validation and failure behavior

- Domain: absolute, non-empty when present; unknown settings keys rejected.
- Host save: canonical existing directory or `INVALID_WORKTREE_BASE_PATH`.
- Suggestion: bounded counter loop; exhaustion returns an actionable error rather than an invalid name.
- Creation: unchanged Git validation for absolute paths, repository boundaries, policy, and branch format. A manual collision surfaces the Git failure.
- Existing tasks: their stored branch and destination are never recomputed.

## Risks / Trade-offs

- **Cross-project path collisions** → the base path is global, so a free branch in one repository can still receive a counter because another project occupies the destination. Branch and destination advance together to preserve the invariant; documented in the spec.
- **Downgrade incompatibility** → the strict schema means an older build rejects a state that contains `settings`. Downgrade requires removing the field or is unsupported; this is an accepted consequence of avoiding a data version bump.
- **Suggestion races** → a branch or directory created between the suggestion and creation makes Git fail; the user retries with a refreshed suggestion. Acceptable for a single-user, serialized command flow.
- **Slug fidelity** → characters outside Latin decompositions are dropped and may fall back to `task`; the counter keeps names unique.
- **Host lookup latency** → the form uses provisional values while the lookup runs, so a slow Git or network base path does not block editing.
- **Base path inside a repository** → Git permits it and the path appears as untracked content. This is allowed rather than blocked; the General hint can mention it.

## Migration Plan

1. Ship the additive `settings` field and `settings.save`; existing stored states load unchanged.
2. Ship the host suggestion and shared helpers before the client uses them.
3. Ship the General tab and the Git form defaults; existing worktrees and branches are untouched.
4. Rollback: remove `settings` from the persisted board before using a build without the field, or accept that downgrade is unsupported.

## Open Questions

None. Remaining naming choices are constrained by the approved decisions and the delta specs.
