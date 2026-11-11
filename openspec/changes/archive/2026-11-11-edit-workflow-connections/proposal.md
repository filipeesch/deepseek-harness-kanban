# Proposal

## Why

The diagram can derive, draw, re-route, and re-anchor every connection, but it cannot author
one. Creating a transition, changing the destination it points at, attaching its `when`
condition, and removing it all require leaving the diagram for the stage editor or the YAML.
Stage placement, stage size, and connection geometry are already authorable in place, so
transition policy is the last piece of the diagram's own subject matter that is only reachable
somewhere else — and it is the piece the diagram is best at showing.

The workflow format also cannot express a stage with no destination. A stage that authors no
transitions allows any other stage; the only way to draw no outgoing connection is an empty
list, which the stage editor rejects and the stage writer erases. A user who decides that a
stage is terminal, such as a finished stage, therefore cannot remove its last arrow from the
diagram, and the diagram keeps drawing a path the workflow does not intend.

While editing connections in place, the diagram's undo history, its optimistic presentation,
and its workflow writes are all shaped for layout alone: history restores layout through one
whole-document save, and that save races the per-stage command the stage editor uses. A change
that edits connections from the diagram touches both concerns in a single gesture, so that
split has to be resolved rather than worked around.

## What Changes

- A stage reveals connection ports while the pointer is over it. Dragging a port onto another
  stage creates that transition and closes the gesture, without opening an editor.
- Drawing from a stage that allows any other stage authors only the drawn destination, so the
  stage becomes restricted to it; the default dashed path it no longer allows stops being drawn.
- Dragging a connection end onto a different stage changes that connection's destination. The
  target end re-points the transition; the source end moves the transition to another owner.
- Changing a destination removes the superseded connection layout entry, and undo restores it.
- Double-clicking a connection opens a condition editor anchored to that connection: a
  multiline, user-resizable text field with an explicit save. Double-clicking the dashed default
  path first authors the transition it stands for, then edits its condition.
- A condition field is one shared, resizable text field in both the connection editor and the
  stage editor; the stage editor's single-line field and its nested long-text modal are retired.
- A connection that authors no condition is marked in the diagram, so the absence of a condition
  is visible without opening anything.
- Selecting a connection and pressing Delete, or using the editor's delete action, removes the
  transition and its stored layout entry.
- A stage may author no destination at all. The stage editor gains a third mode for it, the
  diagram draws no outgoing connection, a card never advances there automatically, and every way
  out requires the explicit restricted-move confirmation that already exists.
- The diagram's undo and redo history covers creating, re-pointing, re-owning, deleting, and
  editing the condition of a connection, in the same Cmd or Ctrl+Z stack the layout uses.
- One client-side write queue serializes every workflow write for a board — the coalesced layout
  save and the per-stage command — so a step that changes transitions and layout together cannot
  contradict itself, and the revision it targets is never stale on arrival.
- The diagram presents an authored transition before the host acknowledges it, so a connection
  gesture has an immediate result; a rejected write returns to the acknowledged workflow and
  reports the problem.
- Four refactorings land with the feature: the diagram's layout state leaves the view component,
  the connection gestures leave the canvas component, the connection layout composition becomes
  one function, and the stage writer stops discarding the comments between transition entries
  when it edits one condition.

## Capabilities

### New Capabilities

None. Connection authoring, the terminal stage, and the shared history are behavior of the
workflow diagram, the stage editor, and the workflow format that already exist.

### Modified Capabilities

- `workflow-view`: the diagram creates, re-points, re-owns, and deletes connections; a connection
  without a condition is marked; a stage with no destination draws no outgoing connection; and
  the placement history also restores transitions and the connection layout a transition edit
  removed.
- `stage-editing`: the allowed transitions section gains a third mode for a stage with no
  destination, an empty allowed transitions list is no longer an invalid document to be repaired
  but a mode with its own behavior, and the condition field becomes one resizable multiline text
  field instead of a single-line field plus a nested editor.
- `kanban-board`: the workflow format admits a stage that authors no destination, and the
  restricted-move confirmation it already defines becomes the only way out of such a stage.

## Impact

- Code: `src/domain/stage-update.ts` (authoring an empty transition list instead of erasing it),
  `src/domain/transition-rule.ts` (rule comparison and per-rule authoring), a new transition
  writer that preserves authored comments, `src/client/stage/` (third mode, shared resizable
  condition field, draft and problem rules), and `src/client/workflow-view/` (connection ports,
  end re-targeting, selection, the condition editor, the transition overrides, the extended
  history, the workflow write queue, and the four extractions).
- Specs: `workflow-view`, `stage-editing`, `kanban-board`.
- Docs: the README's workflow diagram and stage editing sections.
- Data: no migration. Every existing workflow keeps parsing and drawing exactly as it does today;
  a workflow that already authors an empty transition list keeps drawing no connection and starts
  being editable as a terminal stage instead of being silently repaired.
- Compatibility: a build without this change keeps rejecting an empty transition list on write,
  so a board saved with a terminal stage by a newer build cannot be edited from the stage editor
  of an older one. The workflow document itself stays valid for both, because the parser already
  accepts an empty list.
- Dependencies: none added.
