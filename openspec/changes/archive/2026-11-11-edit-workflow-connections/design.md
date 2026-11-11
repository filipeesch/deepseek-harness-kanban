# Design

## Context

See proposal.md - Why. The constraints that shape this design:

- A board stores its workflow twice: `board.workflowYaml` is the authored text and `board.workflow`
  is `parseWorkflow` of that text. The parser already accepts an empty `allowed_transitions`
  list, and `workflowGraph` already draws no connection for it; only the writers and the stage
  editor reject or erase that state.
- `src/domain/stage-update.ts` owns one stage's authored fields by text range: name, entry
  instruction, allowed transitions, identifier, and the initial stage. It rejects an empty
  transition list, and for an empty list it removes the field, which is the opposite of what a
  terminal stage needs.
- `workflowGraph` derives one connection per authored target, plus one dashed connection to the
  next stage in workflow order for a stage that authors no transitions. A connection's identity is
  its source and target pair, which is also the key of its authored layout entry.
- `src/client/workflow-view/workflow-view.tsx` (478 lines, nine hooks) owns the placement, size
  and connection overrides, the coalesced save, the history, the card travel, the lock, the
  snapping preference, and the viewport. `canvas.tsx` (425 lines) owns the React Flow surface, the
  stage drag, the anchor and segment connection drags, and the gesture preview map.
- `usePlacementSaver` composes only layout into authored text and sends `board.workflow.save`
  after a 400 ms coalesce, keeping the revision from each acknowledgement and rebasing layout onto
  a newer acknowledged workflow. The stage editor sends `board.stage.update` through
  `useWorkflowSave`, which does not keep a revision. Nothing serializes the two.
- The history stores before and after layout values and replays them through the saver.
- Optimistic presentation already exists per field, as an override layer merged over the stored
  value: `usePlacementOverrides` for positions and sizes, `useConnectionOverrides` for connection
  layout.
- Card dragging already hides hit-testing behind a port, `CardDropResolver`, whose contract is a
  `data-column-id` element under the pointer, so the board and the diagram share one resolver.
- Sharing compares `workflowMeaning`, which includes the allowed transitions and excludes the
  layout, and merges each layout field per key when the meanings agree.
- `nextStage` answers the next stage in workflow order for the card's advance action and does not
  consult the transition rules.

## Goals / Non-Goals

**Goals:**

- One owner per concern after the change: one layout hook, one gesture controller, one connection
  layout composition, one transition writer, and one write queue. Each new capability is added to
  the smallest module that can own it, instead of to the component that already happens to be
  there.
- A connection gesture that changes transitions and connection layout stays one history step and
  cannot produce a workflow document that contradicts itself.
- A stage with no destination has the same meaning in the stored document, in the diagram, in the
  card, and in the editor, and it is reachable and reversible from both surfaces.

**Non-Goals:**

- Pruning dormant route offsets or orphaned connection entries that no gesture produced.
- Changing the published transport, the sharing merge, or the workflow meaning.
- Renaming `PlacementStep`, `usePlacementSaver`, or the requirement they belong to.
- Reaching connection authoring by keyboard from the diagram.

## Decisions

### D1. A transition owns its connection layout entry

A connection layout entry is keyed by the pair of stages the transition joins, so it exists only as
long as that pair does. Changing a connection's destination, moving it to another source, and
deleting it each remove the superseded pair's entry, and each history step carries that entry so
undo restores it with the transition.

Rejected alternatives: leaving the entry orphaned, which is what the document already tolerates,
because a later gesture that authors the same pair would then resurrect a route the user did not
adjust for it; migrating the entry to the new pair, because a target's anchors have no meaning at a
different target and undo could not restore the original.

Consequence, stated in `workflow-view`: a reload after the write keeps the pruned document, so the
adjustment is lost outside the session in which it was pruned. That is the cost of not accumulating
orphans on every gesture.

### D2. A drawn connection authors only the destination that was drawn

When the source stage authors no transitions, or authors an empty list, the created transition is
authored as the only destination. A stage that already authors a non-empty list gains the drawn
destination and keeps the others with their conditions.

Rejected alternatives: materializing the dashed default destination alongside the new one, which
preserves what the diagram currently draws but authors a path the user did not name and hides the
restriction behind a silent default; refusing to draw from a stage that allows any other stage,
which adds a step to the common case.

The consequence is deliberate and visible: the dashed default path stops being drawn because the
stage no longer permits it. The design does not add a warning surface for it; the diagrams's own
change is the signal.

### D3. An end release is resolved by a pure decision over the stage under the pointer

A press on an end handle starts one gesture. While it moves, the diagram shows the connection being
re-anchored and marks the stage under the pointer as the candidate destination. On release, one pure
function decides what the gesture means from the source stage, the end being dragged, the stage
under the pointer, and the workflow:

- the stage the end belongs to, or no stage: re-anchor, the behavior that exists today;
- another stage, target end: re-point the transition on the same source;
- another stage, source end: move the transition to the new source stage;
- the stage that would make the transition point at its own source: nothing.

The stage under the pointer is found through a `ConnectionDropResolver` port with the same
`data-column-id` contract `CardDropResolver` uses, so the diagram supplies it, a test substitutes
it, and the pure decision is asserted without a browser.

Rejected alternatives: a separate drag affordance for re-pointing, because it would compete with the
re-anchor handle that already marks the exact point the user holds; inferring the target from the
nearest stage rectangle, which disagrees with what the user sees under the pointer when stages
overlap.

### D4. A write that removes something runs last

Re-pointing needs two documents to agree: the stage's transitions, reached through
`board.stage.update`, and the pruned connection layout, reached through the whole-document save.
Moving the transition owner needs two stage patches. Both are ordered so that nothing is removed
before its replacement exists:

- target end: author the new destination, then prune the superseded layout entry;
- source end: author the transition on the receiver, then remove it from the previous source;
- undo or redo of a step that carries both: restore the layout entry, then restore the transitions.

A failure that leaves a duplicate transition, or an orphaned layout entry, is reported and is
visibly repairable. A failure that lost the transition would not be.

A destination that is drawn but authored nowhere, the dashed default path, is edited the same
way from the other side: removing it authors no destination for its stage, and moving its owner
authors the destination on the receiving stage and no destination on the previous one. Refusing
both would leave a connection the user can see and cannot act on.

One gesture's writes run in one reserved slot of the write queue, so the stage patches and the
layout prune of a single gesture cannot be split by another write.

Rejected alternative: a command that applies several stage patches and a document in one
transaction. It would make every step atomic, but it adds a second write path for stage fields next
to `board.stage.update`, which the approved scope did not include.

### D5. A step declares what it restores

A step carries a `restores` discriminator: `layout` for a drag, a resize, an adjustment, or
Organize (the default), `transitions` for a connection gesture that only authored or removed
destinations, and `both` for one that also pruned a layout entry. Replay reads it, because a
transition-only step's positions are the shown snapshot rather than authored coordinates, and
storing them would author a placement nobody asked for. Replay also stops when the layout it
restores could not be stored: the transitions a step carries belong on top of that layout.

The earlier wording called this a union of step types; a discriminator on one step type carries
the same information without a second construction path for every layout gesture.

`PlacementStep` keeps the layout fields and gains the transitions a connection gesture changed, as
before and after values per stage. A step that changes only layout replays through the whole-document
save, a step that changes only transitions replays through the per-stage patch, and a step that
carries both replays in the order D4 fixes. The type names stay as they are, as decided, and
`undoStep`/`redoStep` return which writes the step needs instead of only positions and layouts.

Rejected alternative: keeping transitions out of the history and offering a confirmation on delete,
which is what the earlier decision would have done; it was replaced by extending the history, so the
history must now be able to say which write it replays.

### D6. One write port serializes every workflow write of a board

`WorkflowWritePort` owns three things and nothing else: the revision the next write targets, one
write in flight at a time, and the order the queued writes run in. `usePlacementSaver` keeps its
composition, its 400 ms coalescing, its rebase and its reset; it stops sending and calls the port.
The transition writer calls the same port for each stage patch.

The layout saver composes against a *document* read inside its slot, never against one captured
when the edit was queued: the intended values are the source of truth, and the document is built
from the board snapshot, or from the last document this saver stored while that snapshot still
lags behind it. A pending layout edit is pinned to the board and the writer that own it, so a
presentation handed another board cannot redirect the save.

The port also reserves a slot for a whole gesture: `atomically` runs the writes one gesture needs
back to back, so a layout save queued by an earlier drag cannot land between a move's receiver
patch and the removal from its previous source. A rejected write reaches the caller with its
problem, and the port keeps the acknowledged revision so a later write still targets something
valid. This is what makes D4's ordering meaningful: two
writes of one step cannot interleave with a third write from another gesture.

Rejected alternatives: one `board.workflow.save` for everything, which gives a step a single
atomic write but turns the layout saver into a document editor and moves stage validation entirely
to the parser; a new atomic command, which the approved scope excluded.

The stage editor keeps `useWorkflowSave`. It is a modal that blocks the diagram, a pending layout
save that lands while it is open is already handled by its revision precondition and its inline
conflict, and migrating it onto the port is a follow-up that changes no behavior.

### D7. An authored transition is presented before it is acknowledged

`useTransitionOverrides` holds the transitions the diagram should present per stage, in the same
shape and with the same lifecycle as `useConnectionOverrides`: an override survives until the
acknowledged workflow matches it, or until another writer replaces that stage's transitions. The
view derives one presented workflow from the stored workflow plus the overrides and feeds it to the
graph, the scene, and the travel path, so every surface reads the same transitions.

A rejected write clears the override and reports the problem, so the diagram returns to the
acknowledged workflow instead of keeping a connection the host refused.

Rejected alternatives: waiting for the acknowledgement, which leaves the primary gesture of this
change with no result until a round trip completes; applying the change only to the drawn edges,
which would leave the card's advance action and the history disagreeing with the diagram.

### D8. A stage with no destination is a mode, not an absent field

Three states are now distinct and each has one spelling:

| Intent | Authored form | Drawn |
| --- | --- | --- |
| allows any other stage | field omitted | dashed default path |
| permits a chosen set | non-empty list | one solid connection per target |
| permits nothing | empty list | no connection |

`updateStage` accepts an empty list and renders `allowed_transitions: []` in both block and flow
style; it removes the field only for `null`. The stage draft distinguishes `undefined` from an empty
array, so the unrestricted mode and the terminal mode never collapse into each other. The editor
presents a restricted draft with no destination as a problem that names the terminal mode, so a
stage that permits nothing is always reached through that mode rather than through an incomplete
checklist.

The card must stop offering an advance action in such a stage. `nextStage` answers the next stage in
workflow order without consulting the rules, so the card's destination is resolved through a
transition-aware helper instead, and a stage that authors no destination presents no advance action.

Rejected alternatives: treating an empty list as unrestricted, which loses the state the whole
change is about; making the terminal state unrepresentable in the editor, which would leave a stage
created by a deletion uneditable.

### D8b. The default path is authored when its condition is saved

A condition write names one destination, and the writer adds that destination when the
stage does not author it. So double-pressing the dashed default path opens the editor for the
transition it stands for, and saving authors the transition and its condition as one change and
one history entry. Dismissing authors nothing, which is what a user expects from a gesture that
only opened an editor.

Rejected alternative: authoring the transition as soon as the editor opens, so that the editor
only ever edits an existing rule. It needs no inserting path in the writer, but it leaves a
stored transition behind when the user dismisses the editor, and the step it records is neither
the gesture nor the save.

### D9. One condition field, two surfaces

`condition-field.tsx` is a multiline text field the user can resize, and it is the only editor for a
transition condition. The stage editor's single-line input and its expand action go away, and
`condition-editor.tsx` is deleted. The connection's editor is a popover anchored to the connection:
it positions itself in the diagram's own shell, clamped inside the viewport, commits with an
explicit save or Cmd/Ctrl+Enter, and discards with Escape, a cancel action, or a press outside.

Rejected alternatives: reusing the nested modal, which the approved scope replaced with a resizable
field; keeping the two surfaces in sync, which is exactly the drift the shared field removes.

### D10. A connection without a condition is marked, not labelled

A dashed hollow ring at the path's midpoint identifies a connection the workflow authors without a
condition; a filled dot read as a waypoint in review, and a dashed ring reads as unset. It is not drawn for a connection that authors one, and not drawn for the dashed default
path, which the diagram already distinguishes. It counter-scales with the zoom through the custom
property the contact marks already use, so it stays readable at every zoom level. It is decorative
and stays out of the keyboard order; the connection ends announce whether their connection authors a
condition, so the same fact reaches assistive technology.

Rejected alternatives: a text label, which the approved scope rejected; a different stroke, which
would collide with the dashed meaning the default path already carries.

### D11. The lock gates structure; text stays editable

The lock keeps gating everything that changes which connections are drawn or where: stage move,
stage resize, connection creation, re-pointing, deletion, anchor adjustment, segment adjustment,
Organize, Undo, and Redo. Editing a condition's text stays available while the lock is on, for the
same reason the stage edit action does: it changes no geometry, and the stage editor that edits the
same text is already reachable while the lock is on.

Rejected alternatives: gating the condition text too, which would make the two surfaces disagree
about the same field.

### D12. Four extractions, each on the boundary of one concern

- `useWorkflowLayout`: positions, sizes, connection layout, the three override layers, the saver,
  the history, and the visual snapshot the history restores. The view keeps composition and JSX.
- `useConnectionGestures`: the anchor drag, the segment drag, the re-point drag, and the gesture
  preview map move out of `canvas.tsx`, which keeps the React Flow surface, the stage drag, and the
  viewport.
- `connectionLayoutOf` in one place: the view's connection edit and the gesture's commit stop
  composing the same layout twice.
- `writeTransitionRule`: changes only the `when` scalar of one authored destination, inserting a
  destination's entry or removing it without re-rendering the surrounding list, so comments between
  transition entries survive a condition edit. The full-list writer stays for the stage editor,
  which may change several destinations at once.

  The narrow writer is reached through one optional `StagePatch` field that names a single
destination and the condition it should carry, rather than through the whole-list field. The host
rejects a patch that carries both, so the two intents cannot contradict each other inside one
command, and the condition popover never needs to know the stage's other destinations.

Rejected alternatives, deferred by decision: unify the committed scene route with the live route,
and rename `PlacementStep` and `usePlacementSaver`. Both remain correct, and neither blocks this
change.

## Risks / Trade-offs

- **A source-owner move needs two stage patches** → the receiver is authored first, so a failure of
  the second write leaves the transition in both places instead of nowhere; the failure is reported
  and one deletion repairs it.
- **Optimistic transitions can show a connection the host rejects** → the override clears on
  rejection and the problem is reported inline on the surface that made the change.
- **Pruning a layout entry is destructive outside the session** → the step carries it, so undo
  restores it; a reload after the write keeps the pruned document, which is what the gesture asked
  for. Recorded in the proposal's compatibility note.
- **The write queue is a new single point of failure** → it owns only ordering and the revision, and
  it is asserted against rejected-then-retried sequences, because a revision bug there would make
  every later write fail.
- **A terminal stage is rejected by the stage editor of an older build** → the document stays
  valid for that build's parser and diagram; only its editor refuses to save that stage until its
  destinations are restored. Noted in the proposal.
- **The card's advance action leaks through `nextStage`** → the card resolves its destination
  through the transition rules instead, and the terminal stage is asserted at that seam.
- **Three override layers on one view could drift** → all three merge into one presented workflow,
  and every surface reads that one value rather than the stored workflow.
- **A condition edit now writes one authored scalar** → the new writer is asserted against block and
  flow lists, comments between entries, quoting, and a destination that must be inserted or removed,
  and every result is re-parsed before it is stored.

## Migration Plan

No data migration: the stored Hub and board shapes do not change. Every existing workflow keeps
parsing and drawing as it does today; a workflow that already authors an empty transition list
keeps drawing no connection and becomes editable as a terminal stage instead of being repaired on
the next save. Rollback is a revert of the change; a board saved with a terminal stage remains valid
for the previous build, whose only difference is that its stage editor refuses to store that stage
again.

## Open Questions

- The requirement named `Placement history` now also covers transitions. Renaming it is a follow-up
  spec edit, deliberately kept out so this change does not also carry a rename.
- Whether Organize should prune dormant route offsets and orphaned connection entries. Carried from
  the previous change; nothing here depends on the answer.
- Whether re-pointing should also be reachable by keyboard from the diagram. The stage editor covers
  the same field today, so this can be decided later without changing the specs.
