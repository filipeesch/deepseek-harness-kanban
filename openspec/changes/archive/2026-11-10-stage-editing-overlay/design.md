# Design

## Context

See proposal.md - Why. The constraints that shape this design:

- A board stores its workflow twice: `board.workflowYaml` is the authored text and `board.workflow` is `parseWorkflow` of that text (`src/domain/workflow.ts`). Every save goes through `saveBoardWorkflow` (`src/domain/hub-operations.ts`), which parses, refuses to orphan a task's stage (`WORKFLOW_ORPHAN_COLUMNS`), and stores both.
- The authored YAML is user-authored text with comments and a free key order. Three writers already edit it by text range instead of re-serializing it: `src/domain/yaml-map-fields.ts` (numeric map fields: `position`, `size`) and `src/domain/workflow-connections-text.ts` (connection layouts). `setStagePositions`, `setStageSizes`, and `writeConnections` compose those edits.
- `applyWorkflowEdits` (`src/domain/workflow-edit.ts`) applies literal replacements that must match exactly once, which is why it suits tool callers with full context and not a form that only knows a stage name.
- A stage identifier is referenced from four places in the workflow document: `initial_column`, `groups[].columns`, other stages' `allowed_transitions[].to`, and `connections[].from`/`to`. A task references it from six: `columnId`, `pendingTransition.fromColumnId`, `pendingTransition.columnId`, `recordedTransition.fromColumnId`, `recordedTransition.columnId`, and `instructionPending.columnId`. `src/domain/hub-schema.ts` validates that every task's stage exists.
- The client already has a modal (`Modal` in `src/client/ui.tsx`), an action runner (`useAction`/`RunCommand`), and an editor pattern: a pure draft module plus a hook and a dialog, as in `src/client/settings/schedules/`.
- The diagram's stage header (`StageHeader` in `src/client/workflow-view/stage-node.tsx`) is exported specifically so tests render the markup the canvas paints, and the header doubles as the stage drag handle, which is why the task creation action stops its pointer event.
- The column board renders its header as inline JSX inside `src/client/board/board-columns-view.tsx`, a single expression, with no shared header component to extend.

## Goals / Non-Goals

**Goals:**

- One stage editing surface shared by both presentations, with the same fields, validation, and effects.
- Stage edits that touch only the fields being edited, preserving every other authored character of the workflow.
- A stage identifier rename that is atomic: it cannot partially migrate tasks or references.
- A client that stays thin: the editor sends a patch, not a workflow document, and never needs to know how a rename cascades.
- Components small enough to test in isolation: header, dialog, section, draft, hook.

**Non-Goals:**

- Creating, deleting, reordering, resizing, or repositioning stages from the editor. Position and size keep their diagram gestures.
- Editing `description` (the parser accepts it but the domain model drops it) or the workflow's own name and default presentation.
- Changing the published workflow transport. Publishing still sends the whole YAML; the line-level diff discussion is a separate card.
- Any change to the stored Hub or board schema.

## Decisions

### Decision: one host command carries the whole stage patch

Add `board.stage.update` to the command union (`src/shared/types.ts`), its remote schema (`src/remote.ts`), and the dispatch table (`src/host/app.ts`), next to `board.workflow.save`.

```ts
{ type: 'board.stage.update'; hubId: string; boardId: string; stageId: string; expectedRevision?: number; patch: StagePatch }
```

`StagePatch` carries only what the form can change, each field optional so an untouched field is never rewritten: `name`, `onEnterPrompt` (nullable to clear), `initial` (requesting that the stage become initial), `allowedTransitions` (`null` meaning unrestricted), and `id` (the new identifier, present only when it changed).

*Why not the client building the YAML and calling `board.workflow.save`?* The rename has to migrate tasks in the same transaction as the YAML, and the existing save rejects rather than migrates. Sending a patch also keeps the range-writing logic and the cascade in one place instead of duplicating them in the client.

*Why not a second command just for the rename?* Two write paths for one form would need two revision checks and two failure models, and would allow a name save to land while the identifier save is rejected.

*Alternative considered:* a generic `board.workflow.edit` taking literal text edits. Rejected: the form cannot produce unique anchors, and `WORKFLOW_EDIT_AMBIGUOUS` would surface as a confusing user error.

### Decision: a field-level range writer generalized from the existing map writer

`src/domain/yaml-map-fields.ts` already locates one column inside the `columns` sequence by its `id` and rewrites one key by text range. Generalize it to a field descriptor rather than adding a parallel module:

- scalar text fields (`label`/`name`, `on_enter_prompt`) with quoting chosen from what the value needs
- sequence-of-maps fields (`allowed_transitions`) rendered as a block sequence at the column's indentation
- removal of a field when the value is null
- writing a new key at the column's field indentation, reusing the existing indentation discovery

The stage identifier is written the same way, and the cascade rewrites only the scalars that name the stage: `initial_column` (a top-level scalar), the matching scalar inside each group's `columns`, each `allowed_transitions[].to` value, and both ends of `connections[]` entries. `replaceListScalars` replaces those scalar ranges instead of re-rendering the surrounding collection, so a comment between transition entries, the quoting of a condition, the block style of a group list, and the order of the connection list all survive a rename.

*Why not re-serialize the parsed workflow with the YAML library?* It would discard comments, key order, quoting, and blank lines that the author wrote, which is the same reason the position and size writers exist.

*Alternative considered:* reuse `applyWorkflowEdits`. Rejected for the form path: it needs exact unique text, and a stage named "Done" can appear many times.

### Decision: the cascade lives in one pure domain operation

Add `src/domain/stage-update.ts`:

```ts
export interface StageUpdateInput { text: string; stageId: string; patch: StagePatch }
export interface StageUpdateResult { text: string; renamedFrom?: string; renamedTo?: string; rewrittenReferences: number }
export function updateStage(input: StageUpdateInput): StageUpdateResult
```

It is pure text-and-patch in, text-and-metadata out. It does not know about Hubs or tasks; the host operation feeds it the authored YAML and then applies the returned rename to tasks and validates. This keeps the hard part (range edits plus reference rewriting) testable without a store, and keeps the host operation thin.

The host side is a new `updateBoardStage` in `src/domain/hub-operations.ts` next to `saveBoardWorkflow`: it requires the board, builds the new text through `updateStage`, migrates idle tasks, and stores through the existing `saveBoardWorkflow` path so the orphan invariant and the parsed `board.workflow` are unchanged. `BoardAdministration` gains `updateStage` following the shape of `saveWorkflow`/`editWorkflow`, including `expectedRevision` and the publishing policy.

*Why a separate pure module instead of growing `workflow.ts`?* `workflow.ts` is the parser; mixing document rewriting and cascading into it would make one file own parsing, writing, and migration.

### Decision: the activity gate is enforced twice, with the host as the authority

The gate is defined by the spec: a running conversation, a pending transition, an armed automatic advance, an unresolved stage instruction, an operation in progress, or a worktree being prepared or in error.

- The client computes it from the board state and attention data it already projects, to disable the identifier field and explain why. It reuses the facts the card and drawer already render, so no new command or subscription is needed.
- The host recomputes it inside `updateBoardStage` from persisted task state plus the session facts service, and rejects a rename that would migrate under in-flight work (`STAGE_RENAME_IN_FLIGHT`). The modal shows that rejection inline.

The persisted reasons are checked a second time inside `updateBoardStage` against the transaction draft, so a task that gained a pending transition or armed auto mode after the caller's read still blocks the rename. Session facts stay in the port because only the host can read them; their race window is accepted and documented.

*Why not trust the client?* A stale snapshot or a second tab could migrate a task whose conversation is running. *Why not only the host?* The field would look editable and then fail, which is worse UX. Both sides share one predicate: `conversationStageActivity` treats a running conversation or a background job as busy, so the client and the host cannot disagree.

### Decision: one shared stage header with two presentation adapters

Extract the header into `src/client/stage/stage-header.tsx` with a props model covering the title, the card count, the optional task creation action, and the stage edit action. The diagram's `StageHeader` becomes an adapter that keeps the pointer-down drag wiring and the `nopan`/`nodrag` classes; the column board passes the same data without drag wiring. The stage edit action is an icon button that stops pointer propagation for the same reason the creation action does.

`board-columns-view.tsx` is broken into a column section component and a header usage, so the board no longer renders its header as one inline expression.

*Why not put the pencil in each surface separately?* Two headers would drift; the diagram's header is already exported for tests precisely to avoid a second copy of the markup.

### Decision: the editor follows the draft + hook + dialog pattern

- `src/client/stage/stage-editor-draft.ts`: pure draft type, `fromStage`, `toPatch`, `validate`, and the duplicate-name check. No React.
- `src/client/stage/use-stage-editor.ts`: `draft`, `change`, `pending`, `error`, `problems`, `save`, `cancel`, built on `useAction` and receiving `run` by injection.
- `src/client/stage/stage-editor-dialog.tsx`: the `Modal`, composing four small sections (identity for name and identifier, instruction, transitions, initial) plus `condition-editor` for the nested long-text modal.

Each section receives its slice of the draft and one change callback, so none of them needs the whole draft and none can save. This keeps the dialog a composition instead of a god component, and lets browser tests target one section at a time.

### Decision: the transition condition expands into a second modal, not an inline textarea

The compact row stays one line; the expand action opens a nested `Modal` with a textarea. The editor is rendered as a sibling of the stage `<form>` inside the dialog, so it is never a form inside a form, and `Modal` installs its own Escape listener on its own dialog, so Escape closes only the topmost editor and the outer draft keeps its state. Confirming returns text to the parent draft without saving.

*Alternative considered:* rendering the nested editor through a `createPortal` at `document.body`. Rejected on two counts discovered while implementing: the plugin's styles are scoped under `.dsh-kanban`, so a body-level portal loses every style and hit-testing; and a React portal still bubbles events through the component tree, so the nested submit reached the stage form and stored the stage. The sibling placement plus `event.stopPropagation()` in the nested submit handler keeps both guarantees.

*Alternative considered:* an auto-growing inline textarea. Rejected because a stage with several conditions would push the whole form out of view.

### Decision: one small save helper instead of a third independent save path

The editor needs what `workflow-editor.tsx` and `use-placement-saver.ts` each implement separately: a dirty check against the stored revision, `expectedRevision`, and turning a rejection into an inline problem. Extract a small hook that wraps `run` plus revision bookkeeping and use it from the new editor. Migrating the existing two call sites onto it is a follow-up task in this change, kept separate so the stage editor can land and be tested first.

### Decision: the editor freezes the stage and revision it opened with

The dialog receives the stage, the workflow's stage list, the initial stage, and the Hub revision captured at the moment the pencil was pressed. A background snapshot that lands while the editor is open therefore cannot rebase the draft onto newer data or raise the precondition the save targets: an untouched field whose draft mirrors the old value would otherwise be written back over someone else's change instead of surfacing the conflict.

### Decision: an invalid draft can be submitted, and says why it was refused

Save is unavailable only while the draft is unchanged or a save is in flight. Activating it with a problem present sends nothing and shows every problem the draft has next to its field plus one summary line, which is what the spec's invalid-submit scenarios describe. Every problem is rendered per field, not only the first one.

### Decision: duplicate names warn; empty names and duplicate identifiers are rejected

The format requires unique identifiers only (the parser enforces unique column IDs) and permits repeated names. The editor therefore rejects an empty name, rejects an empty or duplicate identifier, and warns without blocking when the name matches another stage, naming that stage.

### Decision: unrestricted transitions are authored as absence

Choosing "any stage" removes `allowed_transitions` from that stage instead of writing an empty list, because an empty list is a stage that permits nothing. Restricted mode requires at least one target.

## Risks / Trade-offs

- **Renaming an identifier on a shared board can orphan another member's tasks** → Accepted, not hidden: the spec states the rename is allowed on a published board, and `sharing/apply.ts` already rejects a team workflow that would orphan a task (`SHARING_ORPHAN_COLUMNS`) and routes it to review instead of corrupting data. The event-sourcing alternative is tracked in its own card, so a member is blocked from applying the change until they review it; nothing is lost silently.
- **Range writing is fragile against unexpected YAML shapes** (block scalars, flow collections, anchors) → The writer locates fields by the column's `id` and reuses the existing indentation discovery, and every result is re-parsed with `parseWorkflow` before storing, so a bad rewrite fails the save instead of storing garbage. Tests cover inline dash columns, block scalars, and flow collections.
- **Concurrent edits by two people** → `expectedRevision` rejects the second save; the editor stays open with the draft and an inline conflict, so the retry composes.
- **The client's gate can disagree with the host's** → The host is authoritative and returns a specific error code; the modal renders it inline. The disabled field is only a hint.
- **A nested modal can break focus on dismissal** → The nested editor restores focus to the row that opened it, and the outer `Modal` restores focus to the pencil on close; browser tests assert both.
- **Browser tests cannot verify the new command** → `tests/browser/fake-api.ts` must learn `board.stage.update` before any UI test can assert a saved edit; that is a prerequisite task, not an afterthought.
- **Extracting the shared header touches two presentations at once** → The extraction lands before the editor is wired in, and the existing diagram header tests keep running against the exported adapter, so a regression in the diagram is caught while the board side is still unwired.

## Migration Plan

No data migration: the stored board and Hub shapes do not change, and a board whose workflow has no new fields keeps working. Rollback is removing the pencil and the command; workflows saved through the editor remain valid documents because they only carry fields the parser already accepts.

## Open Questions

- Whether the sharing transport should move to line-level diffs, and how a rename would then be applied incrementally by each member, is deliberately deferred to the design discussion card. Nothing in this change depends on the answer.
