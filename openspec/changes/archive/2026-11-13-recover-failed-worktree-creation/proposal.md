# Proposal

## Why

A worktree creation that fails after Git has started leaves a state the product cannot name or recover. The journal records that the host invoked `git worktree add` at a destination that was absent, but the only recovery route requires a *registered* worktree, so a half-written checkout produces `GIT_FAILED` in a retry loop while a vanished one blocks Retry, Return, and Delete. The incident repeated twice on one card in a single day and was only cleared by editing the directory, the branch, and the worktree registration by hand.

Three structures cause it: every Git command shares one 60-second deadline regardless of repository size; the failure classifier equates "the destination directory exists" with "Git registered a checkout"; and the branch that `worktree add -b` creates survives every failure, so a later attempt cannot even recreate it.

## What Changes

- A creation attempt records the resolved source commit and the observed destination state — directory present, empty, or absent, and registration registered, orphan, or none — when it fails.
- A failed creation with no remaining effect disarms its attempt, so Retry, Return, and Delete work again. This heals journals that are already stuck, without manual intervention.
- A new recovery action discards an incomplete checkout with explicit consent and retries in the same operation. It removes the canonical attempt path when it is not a registered worktree, clears an orphan registration for that exact path, and removes the empty parent directories above the checkout up to but excluding the configured worktree base.
- The host clears an orphan worktree registration whose directory no longer exists, targeted to the attempt path, without asking for consent, because it removes metadata only.
- A retry reuses the branch a failed attempt created instead of failing on the name. Reuse requires the branch tip to be the attempt's recorded source commit, and the panel states that the retry reuses it.
- Git commands that touch a checkout's working tree get a long deadline class, and the running operation can be cancelled explicitly. Cancelling aborts only that command and records `OPERATION_CANCELLED` with the same recovery options.
- The operation status names the checkout state instead of a single "Not completed" line, and labels a last-action failure as not saved so it is not read as a second recorded failure.
- **BREAKING** for downgrade: the persisted operation record gains optional fields, and a plugin build older than this release rejects a Hub that contains them.

## Capabilities

### New Capabilities

None. The behavior belongs to capabilities the project already defines.

### Modified Capabilities

- `worktree-management`: creation-attempt states, explicit discard of an incomplete checkout, orphan-registration cleanup, branch reuse after a failed creation, and the creation deadline with explicit cancellation.
- `task-conversations`: the visible operation status gains the discard and cancel actions, names the checkout state, and marks a last-action failure as not saved.

## Impact

- **Host Git layer**: `src/host/native.ts` and `src/host/host-command.ts` gain a deadline class per command; `src/host/git-repository.ts` stops dropping orphan registrations from `git worktree list`.
- **Host coordination**: `src/host/worktrees.ts` is split into `CreateAttempt` (value object), `CheckoutStateProbe`, `CreateRecovery`, and `CreateFailureClassifier`, leaving the coordinator to orchestrate. `src/host/worktree-reader.ts` and `src/host/worktree-writer.ts` gain the state probe and the orphan cleanup.
- **Shared contract**: `src/shared/types.ts` gains the attempt fields and the discard and cancel commands; `src/shared/ports.ts` gains the Git deadline; `src/remote.ts` validates the new commands.
- **Client**: `operation-description.ts`, `operation-status.tsx`, `operation-recovery-actions.ts`, `operation-actions.tsx`, and `git.tsx` present the new state facts and actions.
- **Persistence**: the Hub operation schema accepts the optional attempt fields; no migration is required, and older journals are re-resolved once.
- **Docs**: `docs/operations.md` recovery guidance is updated with the new states and actions.
- **Tests**: `tests/worktrees` gains real-Git fixtures for a partial checkout and an orphan registration plus injected-kill cases; `tests/host/failed-operation-recovery.test.ts` and the client tests cover the new recovery surface.
