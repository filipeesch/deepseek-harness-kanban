# Spec Delta

## MODIFIED Requirements

### Requirement: Connections derived from configured transitions

The diagram SHALL derive a stage's outgoing connections from its configured transitions only. Each configured transition target SHALL be drawn as a solid connection from the source stage to that target. A stage that does not configure transitions SHALL have exactly one dashed connection to the next stage in workflow order, presenting the default path while any other stage remains allowed. A stage whose configured transitions are empty SHALL have no outgoing connection. A configured target equal to the stage itself SHALL NOT be drawn as a connection.

A connection SHALL be drawn as an orthogonal path with rounded corners and an arrowhead at its target. A connection whose ends are not authored SHALL leave its source's right edge and enter its target's left edge when the target follows the source in workflow order and sits to its right. When stages are rearranged so those edges would cross a stage region, the automatic route SHALL step around the outside instead, below the stages or through a side gutter for two stages that share a column. A connection whose target precedes its source in workflow order SHALL leave and enter through the bottom edges. When a stage has more than one outgoing connection and their ends are not authored, each connection SHALL leave from a distinct point of the stage boundary so the separate paths are visible. A connection whose end is authored SHALL leave or enter through the side that end names, perpendicular to that side. An automatic connection SHALL NOT pass through the interior of its own source or target stage when the two stages do not overlap, and a connection whose target precedes its source in workflow order SHALL be routed outside both stage regions. When stages are arranged so a path passes over a third stage region, both the automatic and the adjusted route MAY cross it.

A connection's clearance corridor SHALL be the region its own drawn route occupies: the departure leg at its source, the arrival leg at its target, and the run that joins them. A route that must clear stage regions SHALL be cleared only against the stages that corridor crosses. Moving, resizing, or adding a stage that the corridor does not cross SHALL NOT change that connection's drawn path, its clearance, or the displacements the user authored for it. Each connection SHALL mark its contact with the stage boundary at both ends while the layout is unlocked; a locked diagram presents no contact mark. The drawn path, its departure points, its clearance, and its contact marks SHALL follow the position and size of the stage at each end and of the stages the corridor crosses, while one of those stages is moved or resized, without waiting for the change to be stored.

#### Scenario: Draw configured transitions

- **WHEN** a stage configures two transition targets
- **THEN** the diagram draws two solid connections from that stage, one to each configured target
- **AND** each connection leaves from a distinct point of the stage boundary

#### Scenario: Draw the default path for an unrestricted stage

- **WHEN** a stage does not configure transitions
- **THEN** the diagram draws one dashed connection from that stage to the next stage in workflow order
- **AND** no other connection leaves that stage

#### Scenario: Draw no connection for an empty transition list

- **WHEN** a stage configures an empty transition list
- **THEN** no connection leaves that stage

#### Scenario: Ignore a self transition

- **WHEN** a stage configures itself as a transition target
- **THEN** the diagram does not draw a connection for that target
- **AND** the stage remains a valid same-stage reorder destination

#### Scenario: Draw a returning connection

- **WHEN** a stage configures a target that precedes it in workflow order and neither end is authored
- **THEN** the diagram draws the connection routed below the stages its corridor crosses, entering the target's bottom edge
- **AND** the connection does not cross a stage region it passes

#### Scenario: Draw an orthogonal path

- **WHEN** the diagram draws a forward connection between two stages
- **THEN** the path leaves the source's right edge horizontally, turns at right angles, and enters the target's left edge horizontally
- **AND** the corners of the path are rounded

#### Scenario: Reveal the contact points on hover

- **WHEN** the layout is unlocked and the user points at a connection
- **THEN** a mark appears at the connection's contact with each end of the stage boundary
- **AND** the marks are absent while the connection is neither pointed at nor selected

#### Scenario: Leave through the authored side

- **WHEN** a connection's source end is anchored on the stage's top side
- **THEN** the path leaves the stage upward, perpendicular to that side
- **AND** the connection does not leave the right edge

#### Scenario: Allow an adjusted route to cross a stage region

- **WHEN** a route the user adjusted passes over another stage region
- **THEN** the diagram draws it as adjusted
- **AND** the workflow is not rejected and no warning is presented

#### Scenario: Route a reversed connection outside both stages

- **WHEN** a stage configures a target that precedes it in workflow order and the two stages overlap horizontally
- **THEN** the automatic route avoids the interior of both stages
- **AND** it does not pass through either stage region

#### Scenario: Clear every stage the corridor crosses

- **WHEN** a returning connection's run passes under a third stage
- **THEN** the route clears that stage's bottom
- **AND** the connection does not cross that stage region

#### Scenario: Keep a connection when an unrelated stage moves

- **WHEN** the user moves, resizes, or adds a stage that a connection's corridor does not cross
- **THEN** that connection's drawn path, clearance, and authored displacements are unchanged
- **AND** no stored connection layout changes

#### Scenario: Follow a moved stage

- **WHEN** the user drags a stage that has connections
- **THEN** every connection attached to that stage follows its position while the drag is in progress
- **AND** the connections settle at the stored position when the drag ends

#### Scenario: Follow a resized stage

- **WHEN** the user resizes a stage that has connections
- **THEN** the connection endpoints follow the stage's new edges

### Requirement: Connection re-anchoring and route adjustment

While the layout lock is off, the diagram SHALL let the user move either end of a drawn connection, including the dashed connection derived from a stage without configured transitions. Pointing at a connection SHALL reveal a handle at each end and a handle on each adjustable segment. Those marks SHALL be presented above the stage regions, so a handle that sits on a stage boundary or under the arrowhead is still presented and still receives a press. Each handle SHALL present a pointer target of at least 24 screen pixels across at every zoom level the diagram allows. While the layout lock is on, no mark SHALL be presented on a connection and no gesture SHALL change one; a press on a connection SHALL still select it, as defined by Inspecting a connection while the layout is locked.

Pressing a handle and dragging SHALL start that adjustment in one step. A press on a handle that never moves SHALL select the connection and SHALL NOT adjust it. While the layout is unlocked, a selected connection SHALL keep its marks presented and operable. A press on a stage or on the empty surface SHALL clear the selection in either mode, and with it any presented marks. Dragging an end handle and releasing it inside that end's own stage SHALL move the end to the anchor point nearest the pointer and SHALL store the layout. While an end handle is dragged over a stage that end does not belong to, the diagram SHALL mark that stage as the candidate destination, with the same presentation the creation gesture uses for its candidate. Releasing an end handle over a different stage SHALL change that connection's destination instead, as defined by Re-pointing a connection. Moving the pointer SHALL NOT store the workflow. A press that never moves SHALL change nothing and SHALL store nothing. Dragging a segment handle SHALL move that segment perpendicular to itself, SHALL settle the segment's line on the nearest lattice point while snapping is on, and SHALL store the layout on release. A cancelled gesture SHALL leave the connection as it was. An adjustment SHALL change no stage, no card, no transition, and no other connection; only the end-drag release defined by Re-pointing a connection changes a transition.

#### Scenario: Reveal the handles on hover

- **WHEN** the layout is unlocked and the user points at a connection
- **THEN** the diagram marks each end of that connection and each adjustable segment
- **AND** the marks are absent while the connection is neither pointed at nor selected

#### Scenario: Present every handle above the stage regions

- **WHEN** the user points at a connection whose end handle sits on a stage boundary or under its arrowhead
- **THEN** the handle is presented above the stage region and the arrowhead
- **AND** pressing it starts the adjustment instead of selecting or activating anything below it

#### Scenario: Keep every handle target reachable

- **WHEN** the user presses a handle at any zoom level the diagram allows
- **THEN** the pressed point lies inside that handle's pointer target
- **AND** the target measures at least 24 screen pixels across

#### Scenario: Keep the marks of a selected connection

- **WHEN** the layout is unlocked and the user selects a connection and then moves the pointer away from it
- **THEN** the connection's marks stay presented and operable
- **AND** a press on a stage or the empty surface clears the selection and the marks

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
- **THEN** the connection's layout is unchanged
- **AND** the connection is selected
- **AND** no history entry is added and nothing is stored

#### Scenario: Mark the candidate destination

- **WHEN** the user drags a connection's end handle over a stage that end does not belong to
- **THEN** the diagram marks that stage as the candidate destination before the pointer is released
- **AND** moving the pointer off that stage clears the mark

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

### Requirement: Accessible diagram surface

The diagram SHALL expose each stage region as a labelled region and each card as an activatable control reachable by keyboard. The diagram SHALL expose both ends of every drawn connection as focusable controls, each with an accessible name that identifies the connection and the end. Focusing a connection end while the layout is locked SHALL select that connection so its route can be read from the keyboard, and the selected route SHALL be the focus indication; focusing a connection end while the layout is unlocked SHALL NOT change the selection. The pan and zoom state SHALL NOT hide a card or a connection from assistive technology, and the diagram SHALL NOT trap keyboard focus: focus SHALL be able to leave the diagram through its normal tab order. The control stack SHALL expose an accessible name and a tooltip for every control, and each control's unavailable state SHALL be exposed as disabled rather than hidden. The minimap SHALL expose an accessible name, SHALL be operable by pointer, and SHALL NOT insert itself into the diagram's card tab order.

#### Scenario: Reach a card by keyboard

- **WHEN** the user tabs through the diagram
- **THEN** focus reaches each card in stage order
- **AND** activating a focused card opens the task drawer

#### Scenario: Reach a connection end by keyboard

- **WHEN** the user tabs through the diagram
- **THEN** focus reaches each end of each drawn connection
- **AND** each end is announced with a name naming the connection and the end

#### Scenario: Read a connection by keyboard while locked

- **WHEN** the layout is locked and focus reaches a connection end
- **THEN** that connection is selected
- **AND** its route is presented above the stage regions as the focus indication
- **AND** no mark that would change the connection is presented

#### Scenario: Keep the selection while editing from the keyboard

- **WHEN** the layout is unlocked and focus reaches a connection end
- **THEN** the connection selection is unchanged

#### Scenario: Identify a stage region

- **WHEN** assistive technology reads the diagram
- **THEN** each stage region is announced with its stage title

#### Scenario: Leave the diagram by keyboard

- **WHEN** the user tabs through every card and every connection end
- **THEN** focus leaves the diagram through the normal tab order

#### Scenario: Name the zoom controls

- **WHEN** assistive technology reads the diagram's zoom controls
- **THEN** zoom in, zoom out, and fit-to-view are each announced with an accessible name
- **AND** each presents a tooltip naming its action

#### Scenario: Name the layout controls

- **WHEN** assistive technology reads the diagram's layout controls
- **THEN** undo, redo, organize, and the layout lock are each announced with an accessible name
- **AND** an unavailable control is announced as disabled

#### Scenario: Reach the minimap

- **WHEN** assistive technology reads the diagram
- **THEN** the minimap is announced with an accessible name
- **AND** the diagram's card tab order is unchanged

### Requirement: Layout editing lock

The diagram SHALL provide a layout lock that is on by default every time the diagram is presented. The lock SHALL gate every gesture that changes which connections the diagram draws or where they are drawn: stage move, stage resize, connection re-anchoring, connection creation, connection re-pointing, connection deletion, route segment adjustment, the stage edit action, authoring or editing a connection's condition, Organize, Undo, and Redo SHALL NOT be available while the lock is on and SHALL NOT change the workflow. While the lock is off, those actions SHALL be available subject to their own availability rules. The lock SHALL NOT gate card activation, card drag, selection, the run action, the advance action, pan, zoom, or the shared search and project filter. Selection while the lock is on is reading only: it presents the connection's route without presenting a mark that would change it, opens no editor, and refuses deletion. Unlocking and locking SHALL NOT change board data, and the lock SHALL NOT persist across a reload.

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

- **WHEN** the layout is locked and the user points at a stage or presses a connection
- **THEN** no connection port is presented and no transition changes
- **AND** the pressed connection is selected for reading
- **AND** no command is sent

#### Scenario: Edit a condition while locked

- **WHEN** the layout is locked and the user double-clicks a drawn connection
- **THEN** no condition editor opens
- **AND** no condition is stored and no command is sent

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

### Requirement: Editing a connection's condition

Double-clicking a drawn connection while the layout is unlocked SHALL open a condition editor anchored to that connection. The editor SHALL present the connection's condition as editable multiline text whose field the user can resize, a save action, and a cancel action. The save action SHALL store the condition; Escape, the cancel action, and dismissing the editor SHALL close it without storing. No change SHALL be stored while the text is being edited. An empty or whitespace-only condition SHALL be stored as no condition. The editor SHALL be available only while the layout is unlocked: a locked diagram opens no editor, and locking the layout closes an open editor and discards its draft without storing.

Double-clicking the dashed connection a stage that authors no transitions receives SHALL open the editor for the transition that connection stands for. Saving SHALL author that transition, with the condition it carries, as one workflow change and one history entry; dismissing SHALL author nothing.

The editor SHALL take focus while it is open and SHALL return focus to the diagram when it is dismissed. A rejected write SHALL keep the editor open with its text and SHALL present the problem inside the editor. The editor's condition field SHALL be the same field the stage editor presents, so both surfaces edit a condition the same way.

#### Scenario: Open the editor

- **WHEN** the layout is unlocked and the user double-clicks a drawn connection that authors a condition
- **THEN** the editor opens anchored to that connection with that condition as its text
- **AND** nothing is stored

#### Scenario: Open nothing while locked

- **WHEN** the layout is locked and the user double-clicks a drawn connection that authors a condition
- **THEN** no editor opens
- **AND** nothing is stored and no command is sent

#### Scenario: Close the editor when the layout is locked

- **WHEN** the editor is open and the layout is locked
- **THEN** the editor closes and its draft is discarded
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

### Requirement: Deleting a connection

A drawn connection SHALL be selectable by pressing it, and the diagram SHALL present the selected connection distinctly. While a connection is selected and the layout is unlocked, Delete and Backspace SHALL remove that connection's transition and, when it authors one, its stored layout entry. A selected connection SHALL be presented distinctly in either mode, and the layout lock SHALL refuse deletion without clearing that selection. The condition editor SHALL present a delete action for the connection it edits. Selecting a connection SHALL NOT select a stage or a card, pressing a stage or the empty surface SHALL clear the selection, and deleting SHALL clear it.

Removing a stage's last destination SHALL leave that stage authoring no destination, which is a valid stage: the stage SHALL NOT be turned back into a stage that allows any other stage. Deleting a connection SHALL change no other transition, no card, and no other connection. Each deletion SHALL be one history entry that restores the transition and the removed layout entry together.

Selection and deletion SHALL be pointer actions, except that keyboard focus on a connection end selects that connection while the layout is locked. Removing a destination by keyboard and by assistive technology is provided by the stage editor's allowed transitions section.

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

- **WHEN** the layout is locked and a connection is selected and the user presses Delete or Backspace
- **THEN** the connection is still presented as selected
- **AND** nothing is deleted and nothing is stored

## ADDED Requirements

### Requirement: Inspecting a connection while the layout is locked

The diagram SHALL let the user read a drawn connection while the layout is locked without changing the workflow. Pressing a connection while locked SHALL select it and SHALL present the connection distinctly, and a selected connection SHALL present the route the diagram draws for it above the stage regions, so a segment a stage region hides is visible. The presented route SHALL use the same paint as the selected connection in the editable mode, SHALL keep the dashed pattern of a connection a stage that authors no transitions receives, SHALL present its arrowhead, SHALL follow the drawn path at every zoom level the diagram allows and while a stage at either end moves or resizes, and SHALL NOT receive a press. Pointing at a connection while locked SHALL emphasize its drawn stroke, and SHALL present no mark and start no gesture. The inspection SHALL NOT be stored, and a press on a stage or on the empty surface SHALL clear it.

#### Scenario: Select a connection while locked

- **WHEN** the layout is locked and the user presses a drawn connection
- **THEN** that connection is presented as selected
- **AND** no mark that would change it is presented
- **AND** nothing is stored

#### Scenario: Read a route a stage hides

- **WHEN** the layout is locked and a selected connection's route passes over a stage region
- **THEN** the route is presented above that stage region for the whole path it occupies
- **AND** the presented route keeps the selected connection's paint

#### Scenario: Keep the implicit arrow's pattern

- **WHEN** the selected connection is the dashed connection a stage that authors no transitions receives
- **THEN** the route presented above the stage regions is dashed
- **AND** it presents its arrowhead

#### Scenario: Emphasize a connection on hover

- **WHEN** the layout is locked and the user points at a connection
- **THEN** the connection's drawn stroke is emphasized
- **AND** no end handle and no segment handle is presented
- **AND** pressing it starts no gesture

#### Scenario: Follow the drawn path

- **WHEN** the diagram zooms while a locked connection is selected
- **THEN** the presented route stays over the drawn path at every zoom level the diagram allows

#### Scenario: Clear the inspection

- **WHEN** the layout is locked, a connection is selected, and the user presses a stage or the empty surface
- **THEN** the connection is no longer selected
- **AND** the route presented above the stage regions is removed

#### Scenario: Keep the inspection when unlocking

- **WHEN** the layout is unlocked while a connection is selected
- **THEN** the connection stays selected
- **AND** its editable marks are presented
