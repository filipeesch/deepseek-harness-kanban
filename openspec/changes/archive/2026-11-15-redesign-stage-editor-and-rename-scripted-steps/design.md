# Design

## Context

See `proposal.md` for motivation. The constraints that shape the approach:

- The stage editor is a single `Modal` at the default size. Its sections already live in `src/client/stage/`, but the draft orchestration, the stored-version query and the post-save notice share one component in `stage-editor-dialog.tsx`, and the execution-mode selector is the only field written as inline JSX.
- The editor's save travels `board.stage.update` → `boards.updateStage` → `updateStage` in `src/domain/stage-update.ts`. That function is also called by `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, by the revision journal's materialize step, and by `revert_board`. It is approval-agnostic today and must stay so.
- Approval lives in `DeterministicApprovalService`: `review` resolves an executable version from a capture or from the authored stage, and `approve` validates the version against the stage generation and writes trust for the board and stable stage identity.
- Tabbed surfaces already exist: `Tabs` and `IconTabs` in `ui.tsx`, and `Configuration`/`BoardSettings` show the "one descriptor per section, one shell owning navigation" pattern. Modal sizes are a closed registry in `ui.tsx`.
- CodeMirror is already a dependency with a Bash and TypeScript mapping in `code-view.tsx` (read-only) and a YAML editor in `code-editor.tsx`.
- Workflow writes are surgical text edits that preserve every authored character outside the replaced span, and a stored board is a YAML document that can also be published to a team.

## Goals / Non-Goals

**Goals:**

- One editor shell that owns tab navigation, the draft, validation feedback, the save footer and the approval state, with each tab contributing only its own fields.
- A program surface that is genuinely an editor: syntax highlighting, line numbers, search, resize, and keyboard save.
- An approval model where the author's own inline save is sufficient, the origin of every approval is recorded, and no non-author surface silently grants trust.
- A rename that a stored board, a published workflow and an existing approval all survive.

**Non-Goals:**

- The seven deferred refactors recorded during exploration: splitting `stage-editor-draft.ts`, extracting `ExecutionModeSection`, reusing the workflow surface styles for their own sake, a general `Tabs` redesign, deleting the two unstyled class hooks, preserving prompt and routes across an execution-mode switch, and changing the modal's initial-focus rule.
- An edit-step dirty guard on close. The editor keeps its current dismiss behavior.
- Changing how a workflow document is serialized, indented, or quoted.
- Renaming the workflow diagram, the revision journal or the DSH host surface.

## Decisions

### 1. Five tabs, three of them for a stage without a program

The shell owns `{ Stage, Execution, Routing, Inputs, Approval }`. `Inputs` and `Approval` exist only for a stage that authors a program, because both describe a program that does not exist otherwise. Tab labels are fixed so the same concern is always called the same thing, and the Execution tab covers the entry instruction and the program without renaming itself.

Alternatives rejected: three fixed tabs hid the movement of directory and variables into the Execution tab; always showing five tabs kept two dead controls in the common agent stage; a dynamic label that switches between "Prompt" and "Script" makes the tab row an unstable target for muscle memory and for tests.

### 2. One fixed-size overlay with mounted panels

A new `ModalSize` (`stage`) sets a wide, fixed-height dialog. The tab row and the action footer are `flex-shrink: 0`, and only the active panel scrolls. Panels stay mounted and are hidden with the `hidden` attribute and their `aria-hidden`/`aria-labelledby` wiring, so switching tabs cannot reset a CodeMirror view's undo history or caret, and the overlay cannot resize between tabs.

Alternative rejected: rendering only the active panel, as `Configuration` does. That is correct for static forms, but a code editor loses its undo stack and selection on every remount, which is the behavior this change exists to remove.

### 3. The program surface is a shared language-aware editor

The Bash/TypeScript mapping moves out of `code-view.tsx` into one module that both surfaces import, so the read-only review and the editable program cannot drift in syntax support. The editable surface gets line numbers, search, bracket matching, `Mod-s` bound to the editor's save, and a resizable container. The draft stays the source of truth; the editor is controlled exactly like `CodeEditor` is for YAML.

Alternative rejected: keeping a `textarea`. It costs nothing but leaves the program with the least capable surface in the dialog, which is the complaint this change answers.

### 4. One problem model, one renderer, and a tab that says it holds one

`StageEditorProblem` and `DeterministicField` collapse into one problem type that carries the field it belongs to. A field-to-tab mapping turns that into the tab that must be shown. The shell renders every problem through one inline component, so a message can no longer be presented three different ways. `Tabs` gains an optional per-tab state so a tab can announce that it holds a problem without changing its label; a refused save selects the first tab, in order, that holds one.

Alternatives rejected: a clickable problem list at the top of the form duplicates every message and competes with the inline one; marking the tab without moving to it leaves the author on a tab that shows nothing after pressing save.

### 5. The opening surface names the tab

The dialog takes an `initialTab`. The stage header action passes `Stage`, a diagram connection passes `Routing`, and a card's script panel passes `Execution`. No surface infers a tab from the workflow, so the behavior stays predictable when a stage has no program and the requested tab is unavailable: the shell falls back to `Stage`.

### 6. Automatic approval belongs to the command, not to the stage write

The `board.stage.update` command handler decides whether this write is an author save, and only that handler may record the approval after the write succeeds. `updateStage` stays approval-agnostic, so the agent tools, the journal materialize step and `revert_board` cannot grant trust by accident.

The rule the handler applies: the patch changed the stage's scripted definition, the resolved source is inline, and the write came from the stage editor command. It then resolves the executable version with the same planning path the review uses, records the approval for the board and stable stage identity with an author-save origin, and wakes the entries waiting on the previous version.

Alternatives rejected: approving inside `updateStage` would let a product tool, a journal replay or a revert approve. Approving in the client would make trust a client-side claim that a stale tab could send.

### 7. Approval provenance is part of the approval record

The approval record gains the origin (author save or explicit review) and the moment. Records written before this change carry no origin and are presented as explicit reviews, which is what they were. The editor's Approval tab, the waiting card and the board queue all read the same record, so no surface has to infer provenance.

Alternative rejected: a separate provenance log. It would create a second source of truth for one fact and could disagree with the trust record it describes.

### 8. The authored key is written new and read both ways

The workflow parser accepts `scripted:` and `deterministic:`, rejects a stage that authors both, and the writer emits `scripted:` for the stage it rewrites while leaving every stage it does not name exactly as authored. The write path already accepts a list of alternative keys when it looks a field up, so the alias rides the existing mechanism. The YAML diagnostics and the field-scoped edit vocabulary accept both spellings for the same reason.

Alternatives rejected: a hard rename stops every stored board and published workflow from loading; a bulk rewrite would touch every stage and republish a document the user did not edit.

### 9. The capability directory rename is the first implementation task

OpenSpec has no capability-rename operation: a delta cannot move a capability, and a `MODIFIED` block is refused for a capability that does not exist. The change therefore renames `openspec/specs/deterministic-steps` to `openspec/specs/scripted-steps` as a repository edit before the behavior deltas are archived, and the deltas in this change are written against the renamed requirement and scenario labels. `openspec validate --strict` reports this as information until that task lands, and `openspec validate --specs` plus archive must run after it.

Alternative rejected: expressing the rename as `REMOVED` of all 31 requirements plus `ADDED` of all 31 renamed copies. It archives in any order, but it duplicates the whole capability inside the change and can leave an empty capability behind.

### 10. The execution token changes once, with a dual-name sweep

The guard writes `DSH_SCRIPTED_RUN` and, for one release, still sweeps a process that carries `DSH_DETERMINISTIC_RUN`, so an execution started before the upgrade can still be proven clean. The sweep logic is unchanged in every other respect.

## Risks / Trade-offs

- **[Archiving before the capability rename lands]** → the rename is task 1, the design states the ordering, and the verification task runs `openspec validate --specs` before archive.
- **[Automatic approval widens trust]** → the rule is narrower than "the user saved something": only the stage editor command, only an inline source, only when the scripted definition changed. External files, tool writes, shared updates, publishing and restores all keep requiring review, and each of those cases has its own scenario.
- **[A restore or replay inheriting trust]** → approval is recorded at the write, and a write that is not the author's save records none, so a restore never manufactures an author approval. Approval is keyed by the executable version, so restoring bytes that were approved before reads back as approved; only a version whose bytes were never approved returns to review.
- **[A rename that changes a fingerprint]** → canonical equality and fingerprint inputs are untouched by identifiers; the verification task asserts that an unchanged program keeps its approved fingerprint.
- **[A very large mechanical diff hides behavior changes]** → the code rename is its own commit series after the behavior work, and the review reads the behavior commits first; only the capability directory rename runs early, because the deltas are written against it.
- **[A downgrade cannot read `scripted:`]** → an older build does not know the new key. The migration note records that downgrading across this release requires rewriting the stage key back, and the alias makes the reverse trip mechanical.
- **[Mounted hidden panels cost a render]** → five small panels plus one code editor; the editor re-measures when its tab is revealed.
- **[The legacy key never disappears on its own]** → deliberate. A stage migrates when someone edits it, and a board that is never edited keeps loading correctly.

## Migration Plan

1. Land the domain alias first: stored boards load unchanged, and nothing writes the new key yet.
2. Land the approval origin and the command-boundary rule; existing approvals read as explicit reviews.
3. Land the tabbed editor and the code surface; the editor's behavior reaches users only after this step.
4. Land the rename as its own commit series, capability directory first, then code identifiers, then prose and documentation.
5. Ship the token change with the dual-name sweep in the same release.
6. Rollback: the first three steps are independently revertible. Reverting after the rename means restoring both the code and the authored key, which the alias makes possible but does not automate.

## Open Questions

- Two scenario labels in `stage-editing` still name the historical term, because a `MODIFIED` delta may not drop a scenario the stored spec has. Renaming them needs its own pass after this change archives; nothing in the implementation depends on it.