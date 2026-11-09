# Proposal

## Why

The workflow diagram is the board's other presentation of the same workflow, but it has no way to enter work: the only New task action lives at the top of the column board's initial column. A user reading the flow, arranging stages, and watching cards travel through the diagram cannot create a task without switching presentations first. The creation pipeline itself — the dialog, the command, the receipt check, and the first-execution start — is already presentation-independent, so this is a missing affordance, not a missing capability.

## What Changes

- The workflow diagram's initial stage gains a New task action in its stage header: an icon button with an accessible name and a native tooltip, opening the existing New task dialog.
- The action is present only on the stage that is the workflow's configured initial stage. No other stage gains it, and no stage gains the ability to receive a task directly.
- The action opens the unchanged New task dialog and always creates in the configured initial stage, so the column board and the diagram collect the same inputs and produce the same result.
- The action is available regardless of the diagram's layout lock and regardless of board selection mode, because it creates data rather than editing layout. It is unavailable only when the active Hub has no registered project, matching the column board.
- Pressing the action never starts a stage drag and never stores a workflow change, a placement-history entry, or a save.
- The creation flow moves out of the board component into one shared `useTaskCreation` hook, instantiated once by the board and consumed by both presentations, so the two New task actions cannot drift in label, enablement, receipt handling, or first-execution start.
- Supporting cleanups within scope: one shared module for the empty-stage copy, removal of the unused `column` argument from the New task button renderer, and extraction of the Hub and board creation dialog state from the board component into its own hook, kept separate from task creation.

Non-goals: creating a task into a stage other than the initial one, a New task action in the board header (still prohibited), a stage select inside the dialog, changes to the New task dialog's fields or copy, and a per-stage empty-state creation affordance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-view`: the diagram's initial stage presents a task creation action in its header, present only on that stage, available while the layout is locked and during selection mode, disabled without a registered project, and never initiating a stage drag or a workflow change.
- `kanban-board`: the Top-level task creation requirement describes one action per presentation instead of naming only the column board, keeping the project, Auto mode, and Start execution now rules, the initial-stage target, and the prohibition on a board-header action.

## Impact

- **Client, workflow view**: `src/client/workflow-view/stage-node.tsx` (header action and its gesture isolation), `src/client/workflow-view/canvas.tsx` (the stage's creatable flag in the node signature), `src/client/workflow-view/workflow-view.tsx` (derives the initial stage and supplies the creation port), `src/client/workflow-view/stage-node.tsx` callbacks contract.
- **Client, board**: `src/client/board.tsx` consumes the shared hook and sheds creation state; new `src/client/use-task-creation.ts`; `src/client/board/board-columns-view.tsx` and `src/client/board/board-dialogs.tsx` follow the extracted hooks.
- **Shared**: one module for the empty-stage copy used by both presentations.
- **Unchanged**: `src/client/forms.tsx` (the New task dialog), the host command surface, wire schemas, the domain, and the first-execution pipeline.
- **Tests**: `tests/client/workflow-view.test.tsx` (stub canvas renders the action; drag isolation, lock, selection mode, and initial-stage-only coverage) and `tests/client/board.test.tsx` (creation regressions through the extracted hook).
- **Specs**: deltas for `workflow-view` and `kanban-board`.
