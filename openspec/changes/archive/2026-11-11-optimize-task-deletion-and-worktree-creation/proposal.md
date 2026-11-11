# Proposal

## Why

Deleting a card and creating a worktree both make the user wait on the same board, and both spend their time on work that decides nothing new. A deletion of a task with a worktree currently runs about two dozen Git processes, resolves the same repository layout once per Git call, clones every Hub record once per task for each sharing scan, reads every conversation log again for each idleness check, and rewrites the whole Hub once per bookkeeping step. Creating a worktree repeats the repository resolution for every Git call and derives the same title defaults twice. The interactive command path already returns before that work starts, so what the user experiences as "slow deletion" is entirely redundant work inside the background lane.

## What Changes

- Resolve the repository layout once per operation — Git root, project path, common directory, and registered worktrees — and reuse it for inspection, creation, and removal instead of recomputing it inside every Git call.
- Run one authoritative destructive preflight per execution instead of repeating the inspection and the sharing scan before removal, and skip local-change detection when discard consent is already recorded.
- Read task bindings and active operations from the existing lightweight task-summary projection instead of cloning the owning Hub once per task.
- Probe conversation idleness once per execution pass, leaving each native port's own pre-removal check as the authority.
- Record only recovery-relevant journal state immediately; accumulate per-conversation progress in memory and flush it at phase boundaries.
- Overlap checkout removal with native conversation archiving after every conversation has returned to the base project, and complete the deletion only when both steps finish.
- Let a new-branch worktree creation request omit the branch and destination; the host then derives the collision-free title defaults at creation time, so the automatic first execution no longer needs a separate defaults round trip.
- Split the destructive executor, the Git adapter, and the sharing guard into narrow injected collaborators: a checkout preflight, a checkout removal, a session archiver, a teardown coordinator, a repository context, and a task-binding index.

Error codes, operation phases, recovery actions, confirmations, and persisted records keep their current meaning. No stored data is migrated.

## Capabilities

### New Capabilities

None. Every change here lands inside capabilities the project already defines.

### Modified Capabilities

- `worktree-management`: creation may omit the branch and destination, in which case the host derives the collision-free title defaults at creation time.
- `task-lifecycle`: checkout removal and native archiving run concurrently after the directory return, and each step records its own failing phase.

## Impact

- Host: `src/host/git.ts`, `src/host/worktrees.ts`, `src/host/destructive-operation.ts`, `src/host/destructive-admission.ts`, `src/host/operation-journal.ts`, `src/host/worktree-sharing.ts`, `src/host/task-locator.ts`, `src/host/first-execution.ts`, `src/host/app.ts`.
- Shared contract: `src/shared/types.ts` (`CreateWorktree` fields become optional for new-branch creation) and `src/shared/ports.ts` only where a port gains an explicit context parameter.
- Client: `src/client/execution-preparation/`, `src/client/worktree-draft.ts`, `src/client/worktree-notice.tsx`, `src/client/git.tsx` only where creation stops sending derived values it does not own.
- Remote: the `worktree.create` command schema in `src/remote.ts` accepts the omitted fields.
- Tests: existing worktree, deletion, and background-deletion suites plus new equivalence tests for the failure and recovery paths.
- Documentation: `docs/operations.md` and `README.md` where they describe the destructive lane's execution sequence.
- Persisted data, storage schema, Git semantics, sandbox policy, and native Session identity are unchanged.
