# Proposal

## Why

A card's first execution starts without the two decisions that determine where and how it will run. Today moving a card into an instructed stage, or activating its run action, makes the host create the task's first native conversation in the base project when no worktree exists, and that conversation always uses the deployment default model. Because a DSH session header is immutable, that conversation can never move to the worktree the user creates afterwards; this is the same defect the deferred first conversation change removed for the explicit start. The model, in turn, can only be changed once a conversation exists, which is already too late for the first execution.

## What Changes

- A board drop into an instructed stage and the card's run action SHALL first open a preparation dialog when the task has no native conversation yet.
- The dialog SHALL ask whether to create a worktree only when the task has no worktree, no recorded base-project choice and a Git-backed project. Creating uses the existing title-derived defaults; declining records the persisted base-project choice.
- After the worktree is ready, or after the base choice is recorded, the dialog SHALL create the task's first native conversation and then present DSH's native model selector for it.
- The model selector SHALL show the deployment default without submitting anything until the user changes it. A changed selection applies to the created conversation and, as in every native DSH surface, also updates the deployment default.
- A worktree binding in `preparing` or `error` SHALL block the first execution. The dialog SHALL explain the state, name the Git section as the recovery surface, and the card SHALL NOT move.
- **BREAKING** for the product flow: dropping on a permitted stage no longer moves the card immediately when it would start the task's first execution; the move follows the preparation. The existing restricted-transition confirmation SHALL still be presented before the preparation.
- After preparation, a move SHALL apply and arm the existing five-second countdown; the run action SHALL send immediately. Canceling the dialog after provisioning SHALL keep the created worktree and conversation and leave the card in place.
- When DSH's native model selector is not composed, the dialog SHALL omit the model step and the execution SHALL use the deployment default. When neither a worktree question nor a model step applies, no dialog SHALL be presented and the current flow SHALL run unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: a board drop and the card run action prepare the task's first execution before moving or sending; the preparation order relative to the restricted-transition confirmation; the timed instruction is armed only after preparation.
- `task-conversations`: the first conversation is created by the preparation dialog before a first execution and carries the model chosen in DSH's native model selector.
- `worktree-management`: the worktree choice is requested before a card's first execution, and a binding in an error or preparing state blocks that execution.

## Impact

- Client: the move pipeline in `src/client/board.tsx` is extracted so preparation can run before the move is applied; a new preparation module, dialog view, native model-seat adapter and run-action interception; `src/client.tsx` passes the native slot and locale sources to the board.
- Host: the implicit first-conversation creation performed for a stage instruction in `src/host/app.ts` no longer bypasses an unresolved worktree binding.
- Shared: a preparation predicate beside `src/shared/worktree-decision.ts`, reused by the client gate and the host rule.
- Specs for `kanban-board`, `task-conversations` and `worktree-management`; README; unit, client, browser and real-composition tests. No DSH source change and no conversation header rewrite.
