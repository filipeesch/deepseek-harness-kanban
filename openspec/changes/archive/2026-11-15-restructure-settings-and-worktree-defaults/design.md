# Design

## Context

See `proposal.md` for motivation and the delta specs for the required behavior. What shapes the
approach:

- **Configuration shell.** `src/client/settings/configuration.tsx` builds a section list, maps each
  section id to a width (`SECTION_SIZE`), and owns the unsaved-work guards. Its leave guard is a
  name check — `selected === 'Board' && boardDirty` — so the shell knows one section by name and
  nothing about any other section's draft.
- **Board configuration today.** `src/client/settings/board-settings.tsx` renders five sub-sections
  from a single `BoardState` and reports an aggregate dirty flag upward. It reads only its props:
  the workflow editor compares against `state.workflowYaml` and sends `hubId`/`boardId` it was
  given. It is not bound to the active board.
- **Any board is already projectable.** `boardView(hub, board, settings)` in
  `src/client/board-projection.ts` is a pure projection of the Hub aggregate, and every `board.*`
  command carries `hubId` and `boardId` explicitly (`scopedCommand` passes them through untouched).
  Editing a board that is not active needs no host change.
- **Modal layering today.** `Modal` in `src/client/ui.tsx` portals into the plugin root. A nested
  modal (the project editor inside configuration) already stacks, but only because of DOM order: both
  backdrops share one z-index and each dialog owns its own Escape handler.
- **Overlay geometry today.** `.kb-dialog-settings` is `960px` and `.kb-dialog-settings-wide` is
  `1320px`; both cap `max-height` in `vh` and grow with their content, which is why General opens at
  about `960x380` and Board at about `1320x650`.
- **Team Settings today.** `team-settings.tsx` stacks `ConnectionArea` and `ChangesArea` in one
  column. `ConnectionArea` branches three ways on `sharing.status` inside one component.
- **Worktree decision today.** Three places must agree: the client gate
  (`src/client/execution-preparation/gate.ts`), the drawer notice and the withheld plus action
  (`src/client/drawer.tsx`), and the host invariant `WORKTREE_DECISION_REQUIRED`
  (`src/host/app.ts`). All three read `requiresWorktreeDecision`. `planFirstExecution` already
  models `create-default` but only the automatic mode returns it; the interactive path only ever
  returns `ask`, `none`, or `blocked`. The preparation loads its defaults *after* the dialog opens.
- **Project records are local.** A published layout carries boards — name, workflow, project keys —
  and never a project record. A project field therefore cannot leak to the team.
- **Pre-existing defect.** `openspec/specs/worktree-management/spec.md` stores a requirement whose
  final sentence was truncated to a literal `(line truncated to 2000 chars)` marker. The delta for
  that requirement restores the lost sentence from the version that introduced it, matching the
  requirement's existing scenario `Blocked binding does not affect later executions`.

## Goals / Non-Goals

**Goals:**

- One door per board in the configuration: the Boards list for management, the overlay for editing.
- A configuration surface whose geometry never changes as the user navigates.
- An explicit modal layering contract that a third modal can reuse.
- A project worktree policy that the client and the host decide with one function, so the notice, the
  withheld action, the preparation, the automatic start, and the host invariant cannot disagree.
- Keep every existing host command and stored document shape; the only stored addition is one
  optional project field.

**Non-Goals:**

- Reordering boards in the list; no command exists for it and this change does not add one.
- Showing the worktree policy in the project list or as a badge on cards.
- Restyling the interior of DSH's native model selector; only its container and spacing are ours.
- Changing what the Changes area computes, publishing semantics, or per-board publication isolation.
- Adding storage providers or changing how a storage binds.
- Changing how an `Ask` task records its own base-project choice.

## Decisions

### D1. The board overlay reuses `BoardSettings` over a projected board

The overlay is a container that owns a target `boardId` and derives that board's `BoardState` with
`boardView(hub, board, settings)`; it renders the existing `BoardSettings` unchanged. The active
board is no longer an input to configuration.

- *Alternative rejected:* swapping the content of the same dialog. Cheaper, but the user asked for a
  separate overlay, and a drill-down would still need a back affordance inside the same surface.
- *Alternative rejected:* keeping `BoardSettings` fed by the page's active `state`. That would make
  editing a non-active board impossible and keep the coupling this change removes.
- Consequence: the workflow draft moves into the overlay container, keyed by the target board, so
  closing the overlay discards it and the configuration shell no longer needs to know about drafts.

### D2. Layer the modal instead of relying on DOM order

`Modal` gains an explicit layer, set by the shell for the overlay it opens. A layer owns its z-index,
receives Escape and backdrop dismissal only while it is the topmost open layer, and marks the layers
beneath it inert (`inert`/ `aria-hidden`) so the focus trap of the lower layer cannot steal focus.
Layers are counted by the shell, not inferred from the DOM.

- *Alternative rejected:* DOM order. It works by accident and breaks the moment a modal is portaled
  earlier, and it gives no single owner for Escape.
- *Alternative rejected:* one dialog that swaps content. Rejected with D1.

### D3. Fixed geometry through a size variant, not a global CSS change

The configuration dialog gets a fixed height derived from the viewport with an internal scroll region;
the section row and the content area keep their own scroll. Widths become one per overlay: a single
width for the top-level dialog and a single wider width for the board overlay, which carries the
workflow editor. Other dialogs keep their current sizing.

- *Alternative rejected:* `min-height` only. It removes the smallest jumps but Workflow still resizes.
- *Alternative rejected:* a height map per section. It still jumps between sections with different
  content, and it would have to grow with every new section.

### D4. Sections describe their own leave guard

A configuration section descriptor gains `hasDraft()` and `discardDraft()` (or equivalent) so the
shell can guard any section without naming it. The Board entry leaves the registry, and the overlay
adopts the same guard contract for its sub-sections. This is what removes
`selected === 'Board' && boardDirty`.

### D5. Boards section owns list state; deletion has one confirmation

A `BoardsSection` component with a small hook owns creation, the overlay target, and the deletion
confirmation. Deleting from the row and deleting from the overlay's danger zone converge on the same
confirmation component, so the "this installation or the team" choice has one implementation. Row
actions are Edit and Delete only; rename lives in the board's own General sub-section.

### D6. Segmented control is one presentational component

The visual pattern already exists (`.kb-segmented`/`.kb-segment` in the Git section). It becomes a
small shared component with keyboard behavior and an accessible name, used by the board model mode
and the project worktree policy. The model selector stays rendered in both modes and is disabled while
the deployment default is selected, so the Defaults panel does not resize.

### D7. The policy lives on the project record

`ProjectInput` and the registered project gain an optional `worktreePolicy` field
(`'ask' | 'always' | 'never'`); absence means `ask`. The domain save normalizes the value, rejects
any other string, and preserves the stored value when a caller does not send one. The project editor
always sends it.

- *Alternative rejected:* a per-project map in the installation settings document. It would need its
  own storage shape, its own pruning when a project is deleted, and a lookup seam at every consumer.
- *Alternative rejected:* a per-board policy. The user placed it on the project, and a board already
  spans several projects with different needs.
- No document version bump: the field is optional and read-side absence is defined.

### D8. One decision function, three consumers

`shared/worktree-decision.ts` gains `worktreePolicy(project)` and `requiresWorktreeDecision` takes it
into account, so the drawer notice, the withheld plus action, and the host invariant change together.
`planFirstExecution` returns `create-default` for an interactive `Always create` task and `base` for
a `Never` task, keeping the automatic path's existing `create-default`.

The client gate maps that to a new preparation state. The preparation controller keeps its current
phase order: for `create-default` it opens in `provisioning` and loads the defaults first; when the
defaults are unavailable or invalid it moves to the asking phase with the failure visible, which is
the fallback the spec requires. `Never` needs no new phase: the gate returns no worktree part, and the
host stops requiring a per-task dismissal for that project.

### D9. Team Settings sub-tabs reuse the section tab row

`TeamSettings` becomes a container with the same tab primitive the board uses, holding
`ConnectionArea` and `ChangesArea` as panels. `ConnectionArea` splits into a status panel, a
management panel, and the storage-selection state, so the three `sharing.status` branches become
small components instead of three inline layouts. The storage cards keep rendering whenever the Hub
has no binding — including right after a selection but before connecting — and stay hidden while the
Hub is bound; Disconnect is the only way back.

## Risks / Trade-offs

- **Stacked overlay regresses focus or Escape** → the layer contract is tested with two open layers:
  Escape closes only the top one, Tab cycles inside it, and the lower layer is inert.
- **A fixed height wastes space on short sections** → accepted, and mitigated by the content scroll
  region; a section never grows the dialog.
- **Editing a board that is not active may race the page's projection** → the overlay re-projects from
  the latest Hub on every snapshot, and every write carries the revision the form was opened with, so
  a stale write is refused rather than applied.
- **`Always create` can fail where `Ask` would have let the user choose** → the preparation falls back
  to the question with the failure visible, so a preference never blocks a first execution.
- **Deleting the active board from the overlay** → the overlay closes to the list, and the page's
  existing fallback selects the first board; nothing else in the page holds a stale board id.
- **Restoring the truncated spec sentence is a content repair** → it is limited to the sentence the
  requirement lost, and it matches that requirement's existing scenario; the archive step will carry
  the repair into the main spec.
- **Three surfaces now depend on the policy** → mitigated by one function; a divergence would be a
  code defect rather than a design gap.

## Migration Plan

1. Domain and host first: the optional project field, its normalization, and the policy-aware decision
   function, with the host invariant honoring it. Absence means `ask`, so existing data needs no
   migration and a rollback to the previous client is safe.
2. Client worktree surfaces next: project editor control, gate state, preparation fallback, drawer
   notice, Git section.
3. Configuration restructure last, since it is the largest UI move and has the most tests: section
   registry, Boards section, board overlay, layering, fixed geometry.
4. Team Settings sub-tabs and the Defaults control can land independently of the restructure.
5. Docs: update `docs/operations.md` where it points at the Board section.

Rollback is a revert of the client and host changes; a stored `worktreePolicy` is simply ignored by
an older build.

## Open Questions

- Whether the project list should show the stored policy at a glance. It is presentation only, needs no
  spec change, and can be decided after the first implementation pass.
