# Tasks

## 1. One task-removal cascade in the domain

- [x] 1.1 In `src/domain/hub-operations.ts`, extract the task-removal cascade into an exported function that removes the task, its shared notes, and every relation where it is an endpoint, in one mutation, and make `deleteTask` call it. Verify with `pnpm vitest run tests/domain/card-relation.test.ts` that a deleted card leaves no relation behind and that unrelated relations survive.

- [x] 1.2 Make the final transaction of `src/host/destructive-operation.ts` call the extracted cascade instead of removing tasks and notes inline, keeping its operation-identity check in the surrounding transaction. Verify that the file no longer filters `state.tasks` or `state.notes` directly, and run `pnpm vitest run tests/host/background-deletion.test.ts`.

- [x] 1.3 Add a host test that deletes, through `task.delete`, a card that takes part in an epic relation and in a symmetric relation, and verify the deletion completes, the card incident relations are gone, the other relation survives, and the Hub passes its own schema validation.

- [x] 1.4 Remove the unused `HubRepository.deleteTask` method from `src/host/hub-repository.ts` and move the cascade assertion in `tests/domain/card-relation.test.ts` to the domain function. Verify with `pnpm run typecheck` that nothing still calls the removed method.


## 2. Shared Hub scope resolution

- [x] 2.1 In `src/host/tools/scope.ts`, extract the rule that resolves the calling scope as an explicit Hub or the Hub of the calling task, and make `src/host/tools/cards.ts` use it so card listing and card deletion share one implementation. Verify with `pnpm vitest run tests/host/board-tools.test.ts` that Hub-scoped and task-scoped card listing still behave as before.

- [x] 2.2 Add a unit test for the extracted scope rule that verifies an explicit Hub wins, a task conversation falls back to its own Hub, a mismatched Hub and board pair is refused, and an ordinary chat with neither is refused with the existing board-context problem.


## 3. Consequence preview

- [x] 3.1 Create `src/host/deletion-preview.ts` exporting a preview function that reports the conversation count with the closed count, the note count, the relation count, the checkout path, branch, and ownership, whether the project is a plain folder, the unclaimed checkout list, and whether local changes require discard consent, composed from the existing deletion-target resolution and the Git local-change read, with every fact degrading to an unavailable value instead of throwing. Verify with unit tests over cards with a worktree, without a worktree, with a plain folder project, and with a failing Git read.

- [x] 3.2 Verify the preview performs no mutation: assert in a test that calling it leaves the Hub revision, the task operation, and the Git removal record unchanged.


## 4. The `delete_card` tool

- [x] 4.1 Create `src/host/tools/deletion.ts` exporting a tool factory that declares a narrow port (task lookup, Hub scope resolution, consequence preview, one confirmed deletion command) and returns `delete_card`, with parameters for an optional task identifier, a required confirmation flag, and an optional Hub identifier, and with no worktree path, discard, or force parameter. Verify the tool description states the explicit-user-request rule and that a stage instruction or a peer message does not authorize the deletion.

- [x] 4.2 Implement the tool body: resolve the target from the task identifier or from the owning conversation, refuse a call that names neither, refuse a task of another Hub with a scope-mismatch problem distinct from a missing task, refuse a call without the confirmation flag before recording anything, read the preview, and issue the confirmed deletion command with the worktree path it just read. Verify with tests for each of those paths.

- [x] 4.3 Register the tool in `src/host/tools/index.ts` and add `delete_card` to `PRODUCT_TOOL_NAMES` in `src/host/tools/names.ts` in alphabetical position. Verify with `pnpm vitest run tests/host/product-tool-names.test.ts` that the catalog still names exactly the registered tools with no duplicate.

- [x] 4.4 Declare the tool as not concurrency-safe, beside the other card writes, so a deletion never joins a parallel call group. Verify with a test that reads the declaration through the registered definition.

- [x] 4.5 Add host tests for the admitted paths: a user-confirmed deletion of another card of the same Hub reports the card, the Hub, the queued phase, and the consequences, removes the card after the background work settles, and keeps the branch; a deletion of the card that owns the calling conversation is admitted without a task identifier and completes once its conversations are idle. Verify the tool returns without waiting for the cleanup and never reports the card as deleted.

- [x] 4.6 Add host tests for the refusals and the deferred outcomes: a task of another Hub, a call with no resolvable target, a call without the confirmation flag, a card with local changes whose queued preflight records the failure on the card rather than discarding, and a card whose conversation is running so the operation is recorded as waiting without stopping it.


## 5. Role visibility

- [x] 5.1 Add `delete_card` to the planner allowlist in `cordis.patch.yml` and leave the manager allowlist unchanged. Verify with `pnpm vitest run tests/host/workflow-architect-preset.test.ts` that the planner allowlist contains the tool, the manager allowlist does not, and every allowlisted name is still a product tool.

- [x] 5.2 Extend the preset tests so the planner surface assertion includes card deletion and the manager surface assertion explicitly excludes it, and verify the operator and architect surfaces still receive it without a mask.


## 6. Documentation

- [x] 6.1 Update `docs/user/agent-tools.md`: add the tool to the surface table, describe its parameters, the Hub-scope rule, the consequence payload, and the immediate return, and replace the statements that say there is no tool to delete cards.

- [x] 6.2 Update `docs/development/presets.md` and `docs/user/presets.md` so the planner is described as holding card deletion and the manager still holds no card write.

- [x] 6.3 Update the planner skill at `presets/skills/kanban-project-planning/SKILL.md` so deleting a card is listed with creating and editing it as work the person must direct, and so a stage instruction is explicitly not authorization to delete.

- [x] 6.4 Add the new module paths to the documentation gate expectations if the gate enumerates source modules, and verify with `pnpm run check` that links, index entries, and version claims still pass.



## 8. Review corrections

- [x] 8.1 Move the failed-journal refusal into the shared domain predicate `assertFreshDestructiveJournal` in `src/shared/context-operation.ts`, apply it in the command lane before side effects and again inside the coordinator per-task lane, and carry it as a host-only option that a wire request cannot set. Verify with `pnpm vitest run tests/host/card-deletion-tool.test.ts` and by removing each of the two checks in turn.

- [x] 8.2 Resolve the calling task once in the deletion tool for both the fallback target and the scope, reject a blank task identifier, and refuse a Hub that is not the calling conversation boundary or a deletion outside one with no Hub. Verify with `tests/host/card-deletion-tool.test.ts`.

- [x] 8.3 Report the admission receipt captured at admission instead of re-reading the card, and return the card resolved before admission. Verify that the reported phase is the admission phase and that a fast cleanup cannot turn the call into a missing-task failure.

- [x] 8.4 Report an unreadable checkout disposition and an unreadable local-change read as unavailable instead of a clean or retained checkout, and keep admission with the queued preflight. Verify with `tests/host/deletion-preview.test.ts` and an app-level case in `tests/host/card-deletion-tool.test.ts`.

- [x] 8.5 Carry the call cancellation as a host-only admission option and honor it at three points: immediately before issuing the command, before the command side effects, and inside the coordinator per-task lane just before the journal is written. Never interrupt an admitted deletion. Verify by aborting during a gated consequence read and by admitting a delete request with an already-cancelled signal, asserting in both cases that no journal was written.

- [x] 8.6 Correct the contract where it promised more than the queue can deliver: the tool returns without waiting for the cleanup, and the queued work may already have started. Verify with `npx --no-install openspec validate card-deletion-tool --strict`.

- [x] 8.7 Remove the unused `callerHubScope` helper, keep the listing precedence separate from the deletion boundary, and rewrite the scope tests to go through the registered tools. Verify with `pnpm vitest run tests/host/tool-scope.test.ts`.

- [x] 8.8 Extend the role test so it asserts the catalog name and each shipped role surface, and give the manager skill deletion handoff wording. Verify with `pnpm vitest run tests/host/workflow-architect-preset.test.ts`.

- [x] 8.9 Add lifecycle coverage: a full background cleanup that removes notes and incident relations, archives conversations, and leaves the branch list untouched; a restart that resumes an agent-admitted deletion; and the interface refusals reached through the tool. Verify with `pnpm vitest run tests/host/card-deletion-tool.test.ts tests/host/background-deletion.test.ts`.

- [x] 8.10 Close the cancellation window at the real point of no return: the repository transaction runs a commit hook immediately before handing the write to storage, and the deletion passes the caller signal there. Verify with a test that gates the deletion storage write, aborts, and confirms the admission still finishes through its own recovery surfaces.

- [x] 8.11 Refuse a card that still holds a native execution lease without mutating anything: add the read-only `assertNoTaskLease` on the ownership store, `assertContextFree` on the supervisor, and use them for a cancellable admission in place of the destructive context preparation. Verify with the ownership-store tests, the supervisor tests, and an end-to-end case where the tool refuses the deletion with no journal recorded.

- [x] 8.12 Make the two queue cancellation tests deterministic by waiting on the submitted journal transaction instead of a fixed sleep, and replace the flaky command-lane attempt with a storage-gated case that asserts the coordinator was never called.

- [x] 8.13 Read the native execution lease independently of the optional execution runtime, because a lease outlives the host that wrote it: add `createScriptedLease` over the private directory, pass it as an app option from `src/index.ts` outside the optional provider fiber, refuse `attachScriptedRuntime` when it is missing, and check it in a cancellable deletion beside the supervisor assertion. Verify with a case that holds a lease, has no attached runtime, and is still refused with no journal, archive, or checkout removal.

- [x] 8.14 Test the final cancellation hook on its own: wrap the deletion change callback so the abort lands after it returns and before storage receives the draft, then assert storage never saw the journal and the live revision, pending transition, and journal are unchanged.

- [x] 8.15 Give the unreadable-lease refusal a recovery direction: it must tell the person to restore access to the record and resolve the scripted context in the interface. Verify with a filesystem-backed case where the lease record is replaced by an unreadable entry, asserting the diagnostic and that no deletion is recorded.

- [x] 8.16 Keep one filesystem lease reader: the supervisor answers only for this process (in-memory owner and current control) with no timer or file changes, and the independent reader is the sole lease check, so an attached runtime no longer reads the same lease twice.
## 7. Verification

- [x] 7.1 Run `pnpm run typecheck` and confirm both the host and client projects compile with the new modules and the removed repository method.

- [x] 7.2 Run the full host suite with `pnpm test` and confirm no existing deletion, relation, card, or preset test regresses.

- [x] 7.3 Run `npx --no-install openspec validate card-deletion-tool --strict` and confirm the change still validates after implementation.

