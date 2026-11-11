# Spec Delta

## MODIFIED Requirements

### Requirement: Connection re-anchoring and route adjustment

While the layout lock is off, the diagram SHALL let the user move either end of a drawn connection, including the dashed connection derived from a stage without configured transitions. Pointing at a connection SHALL reveal a handle at each end and a handle on each adjustable segment; while the layout lock is on, pointing at a connection SHALL reveal the same marks without making them operable. Dragging an end handle and releasing it inside that end's own stage SHALL move the end to the anchor point nearest the pointer and SHALL store the layout. Releasing an end handle over a different stage SHALL change that connection's destination instead, as defined by Re-pointing a connection. Moving the pointer SHALL NOT store the workflow. A press that never moves SHALL change nothing and SHALL store nothing. Dragging a segment handle SHALL move that segment perpendicular to itself, SHALL settle the segment's line on the nearest lattice point while snapping is on, and SHALL store the layout on release. A cancelled gesture SHALL leave the connection as it was. An adjustment SHALL change no stage, no card, no transition, and no other connection; only the end-drag release defined by Re-pointing a connection changes a transition.

#### Scenario: Reveal the handles on hover

- **WHEN** the user points at a connection
- **THEN** the diagram marks each end of that connection and each adjustable segment
- **AND** the marks are absent while the connection is not pointed at

#### Scenario: Re-anchor the source end

- **WHEN** the user drags a connection's source handle to another side of its stage
- **THEN** the connection leaves the stage through that side
- **AND** the change is stored

#### Scenario: Snap to the nearest anchor point

- **WHEN** the user releases an end handle between two anchor points
- **THEN** the end settles on the nearer of the two
- **AND** no position between anchor points is stored

#### Scenario: Adjust a route segment

- **WHEN** the user drags a segment handle perpendicular to that segment
- **THEN** the segment follows the pointer at right angles to its own direction, settling on the nearest lattice point while snapping is on
- **AND** the rest of the path reconnects orthogonally
- **AND** the change is stored on release

#### Scenario: Cancel an adjustment

- **WHEN** the user cancels a connection adjustment while dragging
- **THEN** the connection returns to the layout it had before the gesture
- **AND** nothing is stored

#### Scenario: Press without moving

- **WHEN** the user presses a handle and releases it without moving
- **THEN** the connection is unchanged
- **AND** no history entry is added and nothing is stored

#### Scenario: Adjust a dashed connection

- **WHEN** the user moves an end of the dashed connection a stage without configured transitions receives
- **THEN** the change is stored for that connection
- **AND** the stage's transitions are unchanged

#### Scenario: Change no stage or transition

- **WHEN** the user adjusts a connection end inside its own stage, or a route segment
- **THEN** no stage moves or resizes
- **AND** no transition, card, or other connection changes

#### Scenario: Hand a release over another stage to re-pointing

- **WHEN** the user releases a connection's end handle over a stage that end does not belong to
- **THEN** the connection's destination changes as defined by Re-pointing a connection
- **AND** the end is not re-anchored

### Requirement: Placement history

The workflow view SHALL keep an undo and redo history for the diagram's authored workflow: stage placement, stage size, connection layout, and the transitions a connection gesture created, re-pointed, re-owned, or removed. Each completed stage drag, stage resize, connection adjustment, connection creation, connection re-pointing, connection re-owning, connection deletion, connection condition edit, and each Organize SHALL be one history entry. Undo SHALL restore the authored state that entry replaced, and redo SHALL reapply it. A restored step SHALL store its result through the same writes the gesture that produced it used: transitions through the per-stage workflow write the stage editor uses, and connection layout through the whole-document save a drag uses. A step that restores both SHALL restore the connection layout before the transitions, so a restored connection never lacks the layout entry that belongs to it. The history SHALL be reachable through Cmd or Ctrl+Z, Cmd or Ctrl+Shift+Z, and controls with accessible names, which SHALL be unavailable when there is nothing to undo or redo. The history SHALL be per board, SHALL be bounded, SHALL live only in memory, and SHALL be cleared by a reload. Card movement, navigation, the choice of presentation, and presenting an authored transition before the host acknowledges it SHALL NOT add a history entry. Undo SHALL cancel a pending coalesced layout save so that the stored workflow matches the restored layout.

#### Scenario: Undo a stage drag

- **WHEN** the user undoes after dragging a stage
- **THEN** the stage returns to its previous position
- **AND** the stored workflow matches that position

#### Scenario: Redo a stage drag

- **WHEN** the user redoes after undoing a stage drag
- **THEN** the stage returns to the dragged position

#### Scenario: Undo a stage resize

- **WHEN** the user undoes after resizing a stage
- **THEN** the stage returns to its previous size

#### Scenario: Undo a connection adjustment

- **WHEN** the user undoes after anchoring a connection end or moving a route segment
- **THEN** that connection returns to its previous layout
- **AND** the stored workflow matches that layout

#### Scenario: Undo a created connection

- **WHEN** the user undoes after creating a connection
- **THEN** the source stage authors no destination where it authored none before
- **AND** the drawn connection disappears
- **AND** one step is consumed

#### Scenario: Undo a re-pointed connection

- **WHEN** the user undoes after changing a connection's destination
- **THEN** the transition points at its previous destination again
- **AND** the connection layout entry the gesture removed is restored
- **AND** the restored connection is drawn with that layout

#### Scenario: Undo a deleted connection

- **WHEN** the user undoes after deleting a connection
- **THEN** the transition is authored again on the same source stage
- **AND** the stored layout entry of that connection is restored

#### Scenario: Undo a condition edit

- **WHEN** the user undoes after editing a connection's condition
- **THEN** the connection authors the condition it had before the edit
- **AND** one step is consumed

#### Scenario: Undo an Organize action

- **WHEN** the user undoes after using Organize
- **THEN** every stage returns to the placement it had before Organize
- **AND** one step is consumed

#### Scenario: Exclude a card move from the history

- **WHEN** the user moves a card between stages in the diagram
- **THEN** the history gains no entry

#### Scenario: Exclude navigation from the history

- **WHEN** the user pans or zooms the diagram
- **THEN** the history gains no entry

#### Scenario: Clear the history on reload

- **WHEN** the user reloads the board
- **THEN** the history is empty

#### Scenario: Keep a separate history per board

- **WHEN** the user moves a stage on one board and switches to another board
- **THEN** the other board's history contains only that board's steps

#### Scenario: Disable an unavailable history action

- **WHEN** there is nothing to undo or nothing to redo
- **THEN** the corresponding control is unavailable

### Requirement: Layout editing lock

The diagram SHALL provide a layout lock that is on by default every time the diagram is presented. The lock SHALL gate every gesture that changes which connections the diagram draws or where they are drawn: stage move, stage resize, connection re-anchoring, connection creation, connection re-pointing, connection deletion, route segment adjustment, Organize, Undo, and Redo SHALL NOT be available while the lock is on and SHALL NOT change the workflow. While the lock is off, those actions SHALL be available subject to their own availability rules. The lock SHALL NOT gate card activation, card drag, selection, the run action, the advance action, the stage edit action, editing a connection's condition, pan, zoom, or the shared search and project filter. Unlocking and locking SHALL NOT change board data, and the lock SHALL NOT persist across a reload.

#### Scenario: Start locked

- **WHEN** the user opens the workflow diagram
- **THEN** the layout lock is on
- **AND** the layout actions are unavailable

#### Scenario: Block layout editing while locked

- **WHEN** the layout is locked and the user drags a stage header, a stage resize handle, a connection end, or a route segment, or activates Organize, Undo, or Redo
- **THEN** no stage moves, resizes, or is reorganized
- **AND** no connection changes
- **AND** no command is sent

#### Scenario: Block connection authoring while locked

- **WHEN** the layout is locked and the user points at a stage, presses a connection, or presses a delete action for a connection
- **THEN** no connection port is presented, no connection is selected, and no transition changes
- **AND** no command is sent

#### Scenario: Edit a condition while locked

- **WHEN** the layout is locked and the user double-clicks a drawn connection and saves a condition
- **THEN** the condition is stored
- **AND** the diagram still refuses stage moves, resizes, connection creation, connection re-pointing, connection deletion, and route adjustments

#### Scenario: Rearrange after unlocking

- **WHEN** the user turns the lock off and drags a stage
- **THEN** the stage moves to the dropped position
- **AND** the placement is stored

#### Scenario: Keep card work available while locked

- **WHEN** the layout is locked and the user opens a card, drags a card between stages, or activates a card action
- **THEN** that action proceeds as usual

#### Scenario: Reset to locked on reload

- **WHEN** the user unlocks the layout and reloads the board
- **THEN** the layout lock is on again

## ADDED Requirements

### Requirement: Authoring a connection from the diagram

While the layout lock is off, pointing at a stage SHALL reveal a connection port on that stage's boundary, and pressing that port and dragging SHALL present the connection being drawn together with the stage under the pointer as its candidate destination. Releasing over another stage SHALL author a transition from the pointed stage to that stage. Releasing over no stage, over the pointed stage itself, or over a stage the pointed stage already permits SHALL change nothing and SHALL store nothing. Escape and a cancelled pointer SHALL leave the workflow as it was.

The authored destination set SHALL depend on what the source stage authors before the gesture: a stage that authors no transitions, and a stage that authors an empty list, SHALL afterwards author exactly the drawn destination; a stage that authors a non-empty list SHALL afterwards author its existing destinations with their conditions plus the drawn destination, in authored order. Creating a connection SHALL NOT present a condition editor, SHALL NOT open a task, and SHALL NOT move, resize, or select a stage or a card.

The port SHALL be operable by pointer only. The diagram's keyboard order SHALL remain unchanged, because adding a destination by keyboard and by assistive technology is provided by the stage editor's allowed transitions section.

#### Scenario: Create a connection between two stages

- **WHEN** the layout is unlocked and the user drags a connection port of one stage onto another stage
- **THEN** the source stage authors that destination
- **AND** the diagram draws a solid connection from the source stage to that destination

#### Scenario: Author only the drawn destination

- **WHEN** the source stage authors no transitions or authors an empty list and the user draws a connection to one stage
- **THEN** the source stage authors exactly that destination
- **AND** no other destination the stage previously allowed is authored
- **AND** the default dashed path the stage no longer allows is no longer drawn

#### Scenario: Add a destination to a restricted stage

- **WHEN** the source stage authors two destinations with conditions and the user draws a connection to a third stage
- **THEN** the source stage authors all three destinations
- **AND** the two existing conditions are unchanged

#### Scenario: Draw onto the same stage

- **WHEN** the user releases a connection port over the stage it started from
- **THEN** no transition is authored
- **AND** nothing is stored and no history entry is added

#### Scenario: Draw onto a destination already permitted

- **WHEN** the user releases a connection port over a stage the source stage already authors as a destination
- **THEN** the source stage is unchanged
- **AND** nothing is stored and no history entry is added

#### Scenario: Cancel a drawn connection

- **WHEN** the user cancels a connection drag with Escape or by cancelling the pointer before releasing over a stage
- **THEN** no transition is authored
- **AND** nothing is stored

#### Scenario: Create without disturbing anything else

- **WHEN** the user creates a connection
- **THEN** no stage changes position or size
- **AND** no card changes stage or position
- **AND** no other connection changes

#### Scenario: One creation is one history entry

- **WHEN** the user creates a connection and releases the pointer
- **THEN** one workflow change is stored for that creation
- **AND** the history gains one entry

### Requirement: Condition mark on a connection without a condition

Every connection the workflow authors as a transition and that authors no condition SHALL present a mark on its path distinguishing it from a connection that authors a condition. The mark SHALL be absent from a connection that authors a condition and from the dashed connection a stage that authors no transitions receives, which the diagram already distinguishes as a default path. The mark SHALL be removed when a condition is stored for that connection. The mark SHALL keep a readable size while the diagram zooms and SHALL follow its connection while a stage is moved or resized. The mark SHALL NOT be a control, SHALL NOT enter the diagram's keyboard order, and SHALL NOT change board data when pressed.

The accessible name of each connection end SHALL say whether that connection authors a condition, so the absence of a condition is available to assistive technology without the mark.

#### Scenario: Mark a connection without a condition

- **WHEN** a stage authors a destination with no condition
- **THEN** the connection drawn to that destination presents the mark

#### Scenario: Do not mark a conditioned connection

- **WHEN** a stage authors a destination with a condition
- **THEN** the connection drawn to that destination presents no mark

#### Scenario: Do not mark the default path

- **WHEN** a stage authors no transitions and the diagram draws the dashed default path
- **THEN** that path presents no mark

#### Scenario: Remove the mark when a condition is stored

- **WHEN** the user stores a condition for a connection that had none
- **THEN** the mark is no longer presented for that connection

#### Scenario: Keep the mark out of the keyboard order

- **WHEN** the user tabs through the diagram
- **THEN** the mark is not reachable
- **AND** each connection end it belongs to is still reachable and announces whether the connection authors a condition

#### Scenario: Follow the connection

- **WHEN** the user moves or resizes a stage whose connections carry the mark
- **THEN** each mark stays on its connection's path
- **AND** it keeps a readable size

### Requirement: Editing a connection's condition

Double-clicking a drawn connection SHALL open a condition editor anchored to that connection. The editor SHALL present the connection's condition as editable multiline text whose field the user can resize, a save action, and a cancel action. The save action SHALL store the condition; Escape, the cancel action, and dismissing the editor SHALL close it without storing. No change SHALL be stored while the text is being edited. An empty or whitespace-only condition SHALL be stored as no condition.

Double-clicking the dashed connection a stage that authors no transitions receives SHALL open the editor for the transition that connection stands for. Saving SHALL author that transition, with the condition it carries, as one workflow change and one history entry; dismissing SHALL author nothing.

The editor SHALL take focus while it is open and SHALL return focus to the diagram when it is dismissed. A rejected write SHALL keep the editor open with its text and SHALL present the problem inside the editor. The editor's condition field SHALL be the same field the stage editor presents, so both surfaces edit a condition the same way.

#### Scenario: Open the editor

- **WHEN** the layout is unlocked and the user double-clicks a drawn connection that authors a condition
- **THEN** the editor opens anchored to that connection with that condition as its text
- **AND** nothing is stored

#### Scenario: Save a condition

- **WHEN** the user writes text and activates save
- **THEN** the condition is stored for that connection
- **AND** the editor closes

#### Scenario: Discard a condition edit

- **WHEN** the user edits the text and presses Escape or activates cancel
- **THEN** the editor closes
- **AND** the connection keeps the condition it authored before the edit
- **AND** no command is sent

#### Scenario: Clear a condition

- **WHEN** the user empties the text and saves
- **THEN** the connection authors no condition
- **AND** the diagram marks that connection as a connection without a condition

#### Scenario: Author the default path by saving its condition

- **WHEN** the user double-clicks the dashed connection a stage that authors no transitions receives and saves text
- **THEN** the stage authors that destination with that condition, and when it authored no destination before it authors only that one
- **AND** the authored transition and the condition are one workflow change and one history entry

#### Scenario: Dismiss the default path without authoring it

- **WHEN** the user opens the editor for the dashed connection and dismisses it
- **THEN** the stage still authors no transition
- **AND** nothing is stored and no history entry is added

#### Scenario: Resize the condition field

- **WHEN** the editor is open and the user resizes the text field
- **THEN** the field changes size
- **AND** nothing is stored

#### Scenario: Keep the editor open on a rejected write

- **WHEN** a saved condition is rejected
- **THEN** the editor stays open with its text
- **AND** the problem is presented inside the editor
- **AND** no board-level notice is presented for the rejection

#### Scenario: Restore focus on dismissal

- **WHEN** the user dismisses the editor
- **THEN** focus returns to the diagram

### Requirement: Re-pointing a connection

While the layout lock is off, releasing a dragged connection end over a stage other than the one that end belongs to SHALL change that connection's destination to that stage. Releasing the target end SHALL author the transition on the same source stage, replacing the previous destination. Releasing the source end SHALL author the transition on the destination's own stage and SHALL remove it from the previous source stage, so the transition changes owner.

When the stage that receives the transition authors no transitions or authors an empty list, it SHALL afterwards author exactly the moved destination; a stage that authors a non-empty list SHALL keep its existing destinations and conditions and gain the moved destination. The destination a stage already authors SHALL NOT be authored twice. Releasing over the connection's own source stage, over a destination that would make the transition a transition from a stage to itself, or over no stage SHALL change nothing and SHALL store nothing.

The connection layout entry stored for the superseded source and target pair SHALL be removed. The gesture SHALL be one history entry that restores the transition and the removed layout entry together.

Keyboard adjustment SHALL keep moving an end's anchor point only, as defined by Keyboard connection adjustment; changing a destination by keyboard and by assistive technology is provided by the stage editor's allowed transitions section.

#### Scenario: Re-point the target end

- **WHEN** the user drags a connection's target end and releases it over a different stage
- **THEN** the connection's transition is authored on the same source stage pointing at that stage
- **AND** the previous destination is no longer authored by that stage
- **AND** the connection is drawn to the new destination

#### Scenario: Move the transition to another source

- **WHEN** the user drags a connection's source end and releases it over a different stage
- **THEN** the destination stage authors the moved transition
- **AND** the previous source stage no longer authors it
- **AND** the connection is drawn from the new source stage

#### Scenario: Leave a terminal stage behind

- **WHEN** the user moves a stage's only destination to another source stage
- **THEN** the previous source stage authors no destination
- **AND** the diagram draws no outgoing connection from it

#### Scenario: Remove the superseded layout entry

- **WHEN** the user changes a connection's destination
- **THEN** the stored layout entry of the previous source and target pair is removed
- **AND** the new pair keeps the automatic route until it is adjusted

#### Scenario: Do not author a duplicate destination

- **WHEN** the user releases a connection end over a stage the receiving stage already authors as a destination
- **THEN** that destination is authored once
- **AND** its stored condition is unchanged

#### Scenario: Move the owner of the default path

- **WHEN** the user drags the source end of the dashed connection a stage that authors no transitions receives onto another stage
- **THEN** the receiving stage authors that destination
- **AND** the previous source stage authors no destination
- **AND** the diagram draws no outgoing connection from it

#### Scenario: Refuse a self transition

- **WHEN** the user releases a connection end over the stage that would make the transition point at its own source
- **THEN** no transition changes
- **AND** nothing is stored and no history entry is added

#### Scenario: Anchor instead of re-pointing

- **WHEN** the user releases a connection's end handle over the stage that end already belongs to
- **THEN** only the anchor point changes
- **AND** no transition changes

#### Scenario: Restore the layout with the transition

- **WHEN** the user undoes a re-pointing
- **THEN** the transition points at its previous destination
- **AND** the removed connection layout entry is restored

### Requirement: Deleting a connection

A drawn connection SHALL be selectable by pressing it, and the diagram SHALL present the selected connection distinctly. While a connection is selected, Delete and Backspace SHALL remove that connection's transition and, when it authors one, its stored layout entry. The condition editor SHALL present a delete action for the connection it edits. Selecting a connection SHALL NOT select a stage or a card, pressing a stage or the empty surface SHALL clear the selection, and deleting SHALL clear it.

Removing a stage's last destination SHALL leave that stage authoring no destination, which is a valid stage: the stage SHALL NOT be turned back into a stage that allows any other stage. Deleting a connection SHALL change no other transition, no card, and no other connection. Each deletion SHALL be one history entry that restores the transition and the removed layout entry together.

Selection and deletion SHALL be pointer actions. Removing a destination by keyboard and by assistive technology is provided by the stage editor's allowed transitions section.

#### Scenario: Select a connection

- **WHEN** the user presses a drawn connection
- **THEN** that connection is presented as selected
- **AND** no stage and no card is selected

#### Scenario: Delete the selected connection

- **WHEN** a connection is selected and the user presses Delete or Backspace
- **THEN** the transition is no longer authored by its source stage
- **AND** the diagram no longer draws that connection
- **AND** the selection is cleared

#### Scenario: Delete from the condition editor

- **WHEN** the user activates the delete action of the condition editor
- **THEN** the transition is removed and the editor closes

#### Scenario: Delete the default path

- **WHEN** the user deletes the dashed connection a stage that authors no transitions receives
- **THEN** that stage authors no destination
- **AND** the diagram draws no outgoing connection from it
- **AND** the stage does not keep drawing the path it no longer permits

#### Scenario: Delete the last destination

- **WHEN** the user deletes the only transition of a stage
- **THEN** that stage authors no destination
- **AND** the diagram draws no outgoing connection from it
- **AND** the stage does not become a stage that allows any other stage

#### Scenario: Clear the selection elsewhere

- **WHEN** a connection is selected and the user presses a stage or the empty diagram surface
- **THEN** the connection is no longer selected
- **AND** nothing is deleted

#### Scenario: Delete without disturbing anything else

- **WHEN** the user deletes a connection
- **THEN** no stage moves, resizes, or is selected
- **AND** no card changes stage or position
- **AND** no other connection changes

#### Scenario: Delete while locked

- **WHEN** the layout is locked and the user presses a drawn connection
- **THEN** no connection is selected
- **AND** nothing is stored

### Requirement: A drawn connection reflects the authored transitions first

After a connection is created, re-pointed, re-owned, deleted, or given a condition, the diagram SHALL present the authored transitions that gesture produced, and the connections it draws, before every write that gesture needs is acknowledged. A rejected write SHALL return the diagram to the acknowledged workflow and SHALL report the problem. Presenting an authored transition early SHALL NOT add a history entry, SHALL NOT store anything by itself, and SHALL NOT change any card's stage, position, or attention. Once the write is acknowledged, the diagram SHALL present the acknowledged workflow, including any other change a teammate stored meanwhile.

#### Scenario: Present a created connection immediately

- **WHEN** the user releases a connection port over a stage
- **THEN** the diagram draws the new connection before the write is acknowledged

#### Scenario: Present a deletion immediately

- **WHEN** the user deletes a connection
- **THEN** the diagram stops drawing it before the write is acknowledged

#### Scenario: Revert a rejected write

- **WHEN** the write that carries a connection edit is rejected
- **THEN** the diagram presents the acknowledged workflow again
- **AND** the problem is reported

#### Scenario: Keep cards still

- **WHEN** an authored transition is presented before it is acknowledged
- **THEN** no card changes stage or position
- **AND** no history entry is added

#### Scenario: Adopt the acknowledged workflow

- **WHEN** a connection write is acknowledged
- **THEN** the diagram presents the acknowledged workflow
- **AND** a change another client stored meanwhile is presented
