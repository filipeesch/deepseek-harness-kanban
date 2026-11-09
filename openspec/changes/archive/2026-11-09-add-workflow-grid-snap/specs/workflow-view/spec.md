# Spec Delta

## ADDED Requirements

### Requirement: Grid snapping of layout edits

The diagram SHALL provide a grid-snapping preference for layout editing. While snapping is on, a completed stage move, a completed stage resize, and a completed route-segment adjustment SHALL settle on a lattice before any layout is stored. The lattice SHALL use a fixed step of 8 diagram units and SHALL be absolute: a settled value SHALL be the lattice point nearest the pointer, not the value the gesture started from plus a whole number of steps. The lattice SHALL be expressed in diagram coordinates, so panning and zooming SHALL NOT change a settled value.

A settled stage size SHALL NOT be smaller than the accepted minimum size. When the nearest lattice point lies below the minimum, the settled size SHALL be the smallest lattice point at or above the minimum. A settled placement or size SHALL remain inside the accepted coordinate ranges of the workflow.

Snapping SHALL apply only to an edit the user performs. Automatic placement, Organize, and the positions, sizes, and connection layouts already stored for a stage SHALL keep their current geometry; a stored position that is not a lattice point SHALL be presented as stored and SHALL settle on the lattice only when the user edits that stage. Connection ends SHALL keep resolving to their anchor points rather than to the lattice.

Holding the bypass modifier, Alt, during a layout gesture SHALL ignore the lattice for the rest of that gesture without changing the preference. A gesture that settles on the value it started from SHALL store no workflow change and SHALL add no placement-history entry.

The preference SHALL start on, SHALL be changeable from the diagram's control stack, and SHALL be remembered for the browser without being stored in the board's workflow or shared with the team. The control SHALL expose an accessible name, a tooltip, and its on or off state, and SHALL remain available while the layout is locked. The diagram SHALL NOT draw the lattice.

#### Scenario: Snap a dragged stage

- **WHEN** the user drags a stage while snapping is on
- **THEN** the stage settles on the lattice point nearest the drop position
- **AND** the stored position is that lattice point

#### Scenario: Use an absolute lattice

- **WHEN** the user drags a stage whose stored position is not a lattice point while snapping is on
- **THEN** the settled position is the lattice point nearest the drop position
- **AND** it is not the stored position plus a whole number of steps

#### Scenario: Snap a resized stage

- **WHEN** the user resizes a stage while snapping is on
- **THEN** the settled width and height are the lattice points nearest the pointer
- **AND** the stored size is that settled size

#### Scenario: Keep the minimum size when snapping a resize

- **WHEN** the lattice point nearest a resized dimension lies below the accepted minimum size
- **THEN** the settled size uses the smallest lattice point at or above the minimum

#### Scenario: Snap an adjusted route segment

- **WHEN** the user drags a route segment while snapping is on
- **THEN** the segment settles with its line on the lattice point nearest the pointer
- **AND** the stored offset describes that line

#### Scenario: Ignore the lattice while the bypass modifier is held

- **WHEN** the user holds Alt during a layout gesture
- **THEN** that gesture settles at the pointer position without using the lattice
- **AND** the snapping preference is unchanged

#### Scenario: Record nothing for an edit that settles in place

- **WHEN** a stage move, a stage resize, or a route-segment adjustment settles on the value it started from
- **THEN** no workflow change is stored
- **AND** no placement-history entry is added

#### Scenario: Turn snapping off

- **WHEN** the user turns snapping off from the control stack
- **THEN** a stage move or resize settles at the pointer position rounded to whole diagram units
- **AND** an adjusted route segment settles at the pointer position rounded to whole diagram units
- **AND** the toggle itself stores no workflow change

#### Scenario: Remember the preference

- **WHEN** the user changes the snapping preference and reloads the board
- **THEN** snapping is presented in the chosen state
- **AND** the board's workflow configuration contains no record of the preference

#### Scenario: Keep automatic placement off the lattice

- **WHEN** the user activates Organize while snapping is on
- **THEN** every stage is placed exactly as the automatic layout places it with snapping off
- **AND** the computed positions are stored as they are

#### Scenario: Present a stored off-lattice placement

- **WHEN** a stage's stored position is not a lattice point
- **THEN** the stage is presented at that stored position
- **AND** it settles on the lattice only after the user edits that stage

#### Scenario: Change snapping while the layout is locked

- **WHEN** the layout is locked and the user activates the snapping control
- **THEN** the preference changes
- **AND** no stage is moved or resized and no workflow change is stored

#### Scenario: Name the snapping control

- **WHEN** assistive technology reads the snapping control
- **THEN** the control is announced with an accessible name and a tooltip
- **AND** its on or off state is exposed

## MODIFIED Requirements

### Requirement: Persisted stage placement

Dragging a stage region SHALL place that stage at the position the drag settles on and SHALL store the placement in the board's workflow configuration as that stage's position. A settled position SHALL be the dropped position rounded to whole diagram units while snapping is off, and the nearest lattice point while snapping is on. Only the dragged stage's position SHALL change. A stored position SHALL survive a reload, a switch of presentation, and another installation that receives the board through team sharing. Saves produced by dragging SHALL be coalesced so that one completed drag produces one stored workflow change. A position that is not a finite number or that lies outside the accepted coordinate range SHALL be rejected as an invalid workflow, and the last valid workflow SHALL be retained.

#### Scenario: Persist a dragged stage

- **WHEN** the user drags a stage region and releases it
- **THEN** the stage stays at the settled position
- **AND** the board's workflow configuration stores that stage's new position

#### Scenario: Restore a stored placement

- **WHEN** the user reloads the board after moving a stage
- **THEN** that stage appears at its stored position

#### Scenario: Share a stored placement

- **WHEN** another installation receives the board with a stored stage position
- **THEN** it presents that stage at the same position

#### Scenario: Coalesce a completed drag

- **WHEN** the user drags a stage across the diagram and releases it
- **THEN** one workflow change is stored for that drag
- **AND** no other stage's position changes

#### Scenario: Reject an invalid position

- **WHEN** the workflow configuration contains a position that is not a finite number or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

### Requirement: Stage minimum size

Each stage SHALL have a size that bounds its rendered width and height in the diagram. A stage SHALL NOT render narrower or shorter than its minimum size, and the size the diagram uses today SHALL remain the accepted minimum. A stage SHALL grow beyond its stored size when its cards require more room and SHALL NOT shrink below its minimum size when they require less. A stage size SHALL be stored per stage in the board's workflow configuration as that stage's size, SHALL survive a reload, a switch of presentation, and another installation that receives the board through team sharing, and SHALL be merged by the same sharing path that merges placements.

The user SHALL be able to resize a stage by dragging a resize handle on the stage region while the layout is unlocked. A resize SHALL change only the resized stage's size and SHALL NOT change any stage's placement. A settled size SHALL be the pointer size rounded to whole diagram units while snapping is off, and the nearest lattice point while snapping is on, and SHALL never be below the accepted minimum size. A size that is not a finite number, is smaller than the minimum, or lies outside the accepted coordinate range SHALL be rejected as an invalid workflow, and the last valid workflow SHALL be retained.

#### Scenario: Enforce the minimum size

- **WHEN** a stage is presented and its stored size is smaller than the accepted minimum
- **THEN** the stage is rendered at the minimum size

#### Scenario: Grow with the cards

- **WHEN** a stage holds more cards than its stored size can show
- **THEN** the stage grows to fit them
- **AND** its stored size is unchanged

#### Scenario: Resize a stage

- **WHEN** the user drags a stage's resize handle while the layout is unlocked
- **THEN** that stage's width and height follow the pointer, settling on the lattice while snapping is on
- **AND** no other stage changes size or position

#### Scenario: Persist a resized stage

- **WHEN** the user finishes a stage resize
- **THEN** the board's workflow configuration stores that stage's new size
- **AND** the stage is presented at that size after a reload

#### Scenario: Share a stored size

- **WHEN** another installation receives the board with a stored stage size
- **THEN** it presents that stage at the same size

#### Scenario: Reject an invalid size

- **WHEN** the workflow configuration contains a stage size that is not finite, is below the minimum, or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

### Requirement: Connection re-anchoring and route adjustment

While the layout lock is off, the diagram SHALL let the user move either end of a drawn connection, including the dashed connection derived from a stage without configured transitions. Pointing at a connection SHALL reveal a handle at each end and a handle on each adjustable segment; while the layout lock is on, pointing at a connection SHALL reveal the same marks without making them operable. Dragging an end handle SHALL move that end to the anchor point nearest the pointer, and releasing SHALL store the layout. Moving the pointer SHALL NOT store the workflow. A press that never moves SHALL change nothing and SHALL store nothing. Dragging a segment handle SHALL move that segment perpendicular to itself, SHALL settle the segment's line on the nearest lattice point while snapping is on, and SHALL store the layout on release. A cancelled gesture SHALL leave the connection as it was. An adjustment SHALL change no stage, no transition, no card, and no other connection.

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

- **WHEN** the user adjusts a connection
- **THEN** no stage moves or resizes
- **AND** no transition, card, or other connection changes
