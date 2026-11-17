# Proposal

## Why

Dragging a card onto an instructed stage, pressing the card's advance action, or using the play action
blocks the whole board behind a preparation dialog while the host creates a worktree and the first
conversation. The card cannot move, its actions are unavailable, and a modal takes over the screen for
the duration of a Git checkout.

The work itself is mechanical; only the worktree decision needs a person. The move should be immediate
and the slow, host-owned context work should run in the background with progress on the card.

## What Changes

- **The execution preparation no longer precedes the move.** The Ask-policy worktree question is still
  asked before the move and closes as soon as it is answered; once answered, the card moves immediately
  and the rest of the preparation continues in the background. A worktree binding in the preparing or
  error state still blocks the first execution with the short explanation dialog.
- **Worktree creation becomes a background context operation on the host.** `worktree.create` accepts a
  background admission that hands the Git work to the existing per-repository operation lane and
  journal, returns immediately, publishes progress through the snapshot feed, and finishes across a
  client reload. The Git section and the missing-worktree notice keep their current synchronous
  behavior.
- **The first conversation is created by the client once the worktree is ready**, and the five-second
  countdown arms only after that conversation exists. A reload between readiness and the conversation
  keeps the worktree, creates no conversation, and leaves the entry unresolved with the run action
  available.
- **The model step is removed from the preparation.** The first conversation uses the board's default
  model when the board names an available one and the deployment default otherwise; the native model
  selector remains DSH's own per-conversation control. The preparation dialog, its controller, and the
  native model seat wiring shrink accordingly.
- **A failed background creation stays on the card.** The card keeps its destination stage, the failure
  appears in the card status region, the drawer operation status, and the Git section, and the existing
  Retry, Return, and Discard recovery remains the way to resolve it. The run action stays unavailable
  while a failed operation is recorded.
- **Task creation with Start execution now follows the same flow.** The worktree is admitted in the
  background and the countdown arms when the conversation exists, so the created task no longer depends
  on the creating board remaining mounted for the worktree, only for the conversation and the countdown.
- **The agent tool surface keeps its contract.** `create_card` still prepares and dispatches the first
  execution in the same call and reports the outcome, but it shares the background admission and waits
  for it instead of running a synchronous creation that holds the whole command lane.
- **Background creation gets product language on the card.** A creation operation's status names the
  step in progress, such as creating the worktree or preparing the conversation, instead of exposing a
  raw operation phase.

Out of scope: the Git section and missing-worktree notice creation paths, which are already inline;
automatic advance and decision routing, which create a first conversation without asking; and any new
agent action for starting a card.

## Capabilities

### New Capabilities

None. The behavior belongs to the existing workflow, conversation, and worktree capabilities.

### Modified Capabilities

- `kanban-board`: execution preparation before a first execution, automatic first execution on task
  creation, direct stage manipulation, the card run action, the card advance action, the timed stage
  instruction, and the card status strip.
- `task-conversations`: the drawer stage control and the next-stage action move without waiting for the
  preparation, the first conversation is created in the background after the worktree is ready, and the
  preparation no longer presents a model selection step.
- `worktree-management`: the worktree choice is answered before the move while the creation runs in the
  background; creation failures and an underivable destination are reported on the card instead of in a
  preparation dialog.
- `workflow-view`: a diagram drag follows the same preparation-then-move order as the board.

## Impact

- Client: the execution preparation module (`src/client/execution-preparation/`), the board move
  pipeline (`src/client/board-moves.tsx`), task creation (`src/client/use-task-creation.tsx`), the
  operation and status presentation (`src/client/operation-description.ts`,
  `src/client/card-status-entries.ts`), and the removal of the native model seat wiring
  (`src/client/execution-preparation/model-seat.tsx`, `src/client.tsx`, `src/client/board.tsx`).
- Host: worktree coordination and the background admission (`src/host/worktrees.ts`,
  `src/host/app.ts`), automatic first execution for the agent surface
  (`src/host/first-execution.ts`), and removal of the `task.prepareFirstExecution` command
  (`src/remote.ts`, `src/shared/types.ts`).
- Docs: `docs/user/execution.md`, `docs/user/git-worktrees.md`, `docs/user/getting-started.md`.
- Tests: client preparation and operation tests, the browser preparation and move-override specs, host
  first-execution and worktree tests, and the end-to-end templates that click the removed model step.
