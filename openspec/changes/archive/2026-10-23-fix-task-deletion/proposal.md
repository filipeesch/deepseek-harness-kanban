# Proposal

## Why

Deleting a task can fail with `SHARED_WORKTREE` even when no other task or user conversation uses the checkout. The guard excludes only the task's top-level sessions, so a continuable subagent child spawned by one of those sessions is misclassified as foreign. The task then cannot be deleted, and retrying repeats the same false positive.

The delete confirmation and recovery surfaces make this worse: the dialog is a dense paragraph, closes before the command finishes, does not identify the branch or an attached checkout, and leaves failures in a different drawer section with generic "Worktree operation" and "Conversations switched" copy.

## What Changes

- Define a task's native conversation lineage: its retained top-level conversations plus their direct and nested `origin: subagent` descendants. Forks and unrelated sessions remain foreign.
- Use that lineage in the destructive sharing preflight so a task's own subagent children do not block worktree removal, while genuinely shared checkouts still do.
- Treat an already-absent worktree directory as already removed instead of failing the sharing preflight.
- Reuse the same ownership closure when deciding whether an owned worktree workspace is still in use.
- Replace the single-task delete confirmation with a structured, client-owned dialog: card/notes deletion, conversation count and retained histories, worktree path/branch/ownership, unclaimed checkouts, running conversations, and the separate local-changes consent. One explicit destructive action confirms normal deletion. Attached checkouts are identified as removable, and the branch is always described as kept.
- Keep the dialog open while the command runs; show inline busy and failure states with retry/return recovery. Do not claim success on failure.
- Apply the same structured confirmation and result language to bulk deletion, including skipped tasks and reasons.
- Move task operation status above the drawer tabs for every operation kind. Use kind- and phase-aware copy that says what completed and what remains; offer Retry and, only when permitted, Return; hide Return once archiving has begun.
- Perform targeted extraction: a pure lineage helper, a narrow session-topology port, a `WorktreeSharingGuard`, destructive dialogs extracted from the board component, and a kind-aware operation descriptor.
- Add no host preflight API, no new dependencies, and no persisted-data migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `worktree-management`: define task-lineage ownership for shared-checkout protection and handle an already-absent checkout during removal.
- `task-lifecycle`: expand the deletion confirmation and failure behavior, clarify subagent-descendant archiving semantics, and align bulk deletion with the same consequence summary.
- `task-conversations`: define native conversation lineage and require visible, kind-aware operation status and recovery across drawer sections.

## Impact

- Host: `src/host/worktrees.ts`, `src/host/native.ts`, `src/host/app.ts`, `src/shared/ports.ts`, plus a new domain lineage helper and sharing guard.
- Client: `src/client/board.tsx` (extraction), new destructive-dialog and operation-status modules, `src/client/drawer.tsx`, `src/client/git.tsx`, `src/client/ui.tsx`, and `src/client/styles.ts`.
- Specs and docs: the three capabilities above; `README.md` and `docs/operations.md` deletion/recovery guidance.
- Verification: fast module and integration suites, focused Playwright specs, and a manual real-DSH deterministic-subagent e2e lane; no real-model calls, and the normal suite does not depend on a DSH checkout.
- Compatibility: persisted boards and operations remain readable. Existing failed operations require only an explicit retry; no migration or data rewrite is needed. No public tool or remote API is added. Native DSH session, archive, Git, and permission behavior remain host-owned.
