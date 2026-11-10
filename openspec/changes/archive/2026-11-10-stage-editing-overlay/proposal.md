# Proposal

## Why

Editing a stage today means authoring workflow YAML by hand: its display name, its entry instruction, its allowed transitions, its initial-stage flag, and its identifier all live in the board's workflow document, and no board surface exposes them. The stage header already knows how to carry actions — it shows the task creation action on the initial stage and the card count — so it is the natural place to offer a per-stage edit action that opens a focused form instead of a text editor.

## What Changes

- Every stage header, in both the column board and the workflow diagram, gains a pencil action at its top right, placed after the card count. The action is always available; it is not a layout edit, so the diagram's layout lock does not gate it and it never starts a stage move.
- Activating the pencil opens a central modal that edits one stage: its display name, its entry instruction, its allowed transition targets, whether it is the workflow's initial stage, and its identifier.
- Allowed transitions are edited as a checklist of the board's other stages with an optional free-text condition per target, or as "any stage" with no restriction. A condition field expands into a second modal for long text.
- The stage's identifier is editable only when the board has no in-flight work, and the edit rewrites every reference to it — the initial stage, group membership, other stages' transition targets, connection layouts — and migrates idle tasks to the new identifier in the same transaction.
- Saving goes through a single new host command that applies the edits to the authored workflow YAML by text range, preserving comments, key order, and every key the overlay does not touch, then validates the result through the existing parser.
- The stage editor reports validation and revision conflicts inline and keeps the form open so the draft is not lost. A duplicate display name warns without blocking the save.
- New capability `stage-editing`; `workflow-view` and `kanban-board` each gain the pencil action in their stage header.

## Capabilities

### New Capabilities

- `stage-editing`: the per-stage edit action in both presentations, the stage editor form and its fields, the allowed-transition editor with conditions, the initial-stage action, and the identifier rename with its activity gate and reference cascade.

### Modified Capabilities

- `workflow-view`: the diagram's stage header additionally presents the stage edit action, which stays available while the layout is locked and never starts a layout gesture.
- `kanban-board`: the column board's stage header presents the same stage edit action with the same availability and the same editor.

## Impact

- **New host command** `board.stage.update` carrying a stage patch, dispatched next to `board.workflow.save` and validated by the same workflow parser.
- **Domain**: a pure stage-update operation plus an identifier cascade across `Column.allowedTransitions`, `ColumnGroup.columnIds`, `Workflow.initialColumnId`, and `Workflow.connections`, and over task references `columnId`, `pendingTransition.fromColumnId`, `pendingTransition.columnId`, `recordedTransition`, and `instructionPending.columnId`.
- **Workflow text writer**: the existing per-field range writer, which today handles only numeric position and size maps, is generalized to scalar fields and transition lists.
- **Client**: the stage header becomes a shared component for both presentations; `board-columns-view.tsx` is broken up to host it; a stage editor dialog, its draft model, and its save hook follow the existing schedule editor pattern.
- **Sharing**: renaming an identifier on a published board is allowed and left to the sharing review, with the consequence that a member can only migrate their tasks after that review; the alternative of publishing line-level diffs is recorded as a separate design discussion, not part of this change.
- **No schema change** to the stored Hub or board; the workflow YAML accepted shape is unchanged.
