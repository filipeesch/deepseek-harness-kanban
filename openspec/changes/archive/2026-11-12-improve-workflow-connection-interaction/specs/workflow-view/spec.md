# Spec Delta

## MODIFIED Requirements

### Requirement: Connections derived from configured transitions

The diagram SHALL derive a stage's outgoing connections from its configured transitions only. Each configured transition target SHALL be drawn as a solid connection from the source stage to that target. A stage that does not configure transitions SHALL have exactly one dashed connection to the next stage in workflow order, presenting the default path while any other stage remains allowed. A stage whose configured transitions are empty SHALL have no outgoing connection. A configured target equal to the stage itself SHALL NOT be drawn as a connection.

A connection SHALL be drawn as an orthogonal path with rounded corners and an arrowhead at its target. A connection whose ends are not authored SHALL leave its source's right edge and enter its target's left edge when the target follows the source in workflow order and sits to its right. When stages are rearranged so those edges would cross a stage region, the automatic route SHALL step around the outside instead, below the stages or through a side gutter for two stages that share a column. A connection whose target precedes its source in workflow order SHALL leave and enter through the bottom edges. When a stage has more than one outgoing connection and their ends are not authored, each connection SHALL leave from a distinct point of the stage boundary so the separate paths are visible. A connection whose end is authored SHALL leave or enter through the side that end names, perpendicular to that side. An automatic connection SHALL NOT pass through the interior of its own source or target stage when the two stages do not overlap, and a connection whose target precedes its source in workflow order SHALL be routed outside both stage regions. When stages are arranged so a path passes over a third stage region, both the automatic and the adjusted route MAY cross it.

A connection's clearance corridor SHALL be the region its own drawn route occupies: the departure leg at its source, the arrival leg at its target, and the run that joins them. A route that must clear stage regions SHALL be cleared only against the stages that corridor crosses. Moving, resizing, or adding a stage that the corridor does not cross SHALL NOT change that connection's drawn path, its clearance, or the displacements the user authored for it. Each connection SHALL mark its contact with the stage boundary at both ends. The drawn path, its departure points, its clearance, and its contact marks SHALL follow the position and size of the stage at each end and of the stages the corridor crosses, while one of those stages is moved or resized, without waiting for the change to be stored.

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

- **WHEN** the user points at a connection
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

While the layout lock is off, the diagram SHALL let the user move either end of a drawn connection, including the dashed connection derived from a stage without configured transitions. Pointing at a connection SHALL reveal a handle at each end and a handle on each adjustable segment. Those marks SHALL be presented above the stage regions, so a handle that sits on a stage boundary or under the arrowhead is still presented and still receives a press. Each handle SHALL present a pointer target of at least 24 screen pixels across at every zoom level the diagram allows. While the layout lock is on, pointing at a connection SHALL reveal the same marks without making them operable.

Pressing a handle and dragging SHALL start that adjustment in one step. A press on a handle that never moves SHALL select the connection and SHALL NOT adjust it. A selected connection SHALL keep its marks presented and operable while the selection lasts, and a press on a stage or on the empty surface SHALL clear the selection and its marks. Dragging an end handle and releasing it inside that end's own stage SHALL move the end to the anchor point nearest the pointer and SHALL store the layout. While an end handle is dragged over a stage that end does not belong to, the diagram SHALL mark that stage as the candidate destination, with the same presentation the creation gesture uses for its candidate. Releasing an end handle over a different stage SHALL change that connection's destination instead, as defined by Re-pointing a connection. Moving the pointer SHALL NOT store the workflow. A press that never moves SHALL change nothing and SHALL store nothing. Dragging a segment handle SHALL move that segment perpendicular to itself, SHALL settle the segment's line on the nearest lattice point while snapping is on, and SHALL store the layout on release. A cancelled gesture SHALL leave the connection as it was. An adjustment SHALL change no stage, no card, no transition, and no other connection; only the end-drag release defined by Re-pointing a connection changes a transition.

#### Scenario: Reveal the handles on hover

- **WHEN** the user points at a connection
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

- **WHEN** the user selects a connection and then moves the pointer away from it
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

### Requirement: Authoring a connection from the diagram

While the layout lock is off, pointing at a stage SHALL reveal a connection port on each of the four sides of that stage's boundary, and each port SHALL present a pointer target of at least 24 screen pixels across at every zoom level the diagram allows. Pressing any of them and dragging SHALL present the connection being drawn, leaving from the side that port names, together with the stage under the pointer as its candidate destination. While the pointer is over no stage, the connection being drawn SHALL be presented as a line from its port to the pointer. While the pointer is over a candidate destination, the diagram SHALL present the route that the created connection would be drawn with, including its arrowhead, instead of that line. Releasing over another stage SHALL author a transition from the pointed stage to that stage; when the side it was drawn from is not the one the automatic route would use, that side SHALL be authored as the connection's departure, and otherwise the automatic route SHALL be kept. Releasing over no stage, over the pointed stage itself, or over a stage the pointed stage already permits SHALL change nothing and SHALL store nothing. Escape and a cancelled pointer SHALL leave the workflow as it was.

The authored destination set SHALL depend on what the source stage authors before the gesture: a stage that authors no transitions, and a stage that authors an empty list, SHALL afterwards author exactly the drawn destination; a stage that authors a non-empty list SHALL afterwards author its existing destinations with their conditions plus the drawn destination, in authored order. Creating a connection SHALL NOT present a condition editor, SHALL NOT open a task, and SHALL NOT move, resize, or select a stage or a card.

The port SHALL be operable by pointer only. The diagram's keyboard order SHALL remain unchanged, because adding a destination by keyboard and by assistive technology is provided by the stage editor's allowed transitions section.

#### Scenario: Offer a port on each side

- **WHEN** the layout is unlocked and the user points at a stage
- **THEN** the stage presents one connection port on each of its four sides
- **AND** each port's pointer target measures at least 24 screen pixels across

#### Scenario: Present the line being drawn

- **WHEN** the user presses a connection port and drags the pointer without releasing it
- **THEN** the diagram presents the line being drawn from that port to the pointer
- **AND** the line remains presented until the gesture ends

#### Scenario: Preview the route over a candidate destination

- **WHEN** the pointer of a creation drag is over a stage that would receive the connection
- **THEN** the diagram presents the route the created connection would be drawn with, including its arrowhead
- **AND** the candidate stage is presented as the destination of that preview

#### Scenario: Draw a connection from another side

- **WHEN** the user drags the port on the bottom side of a stage onto another stage the automatic route would leave from the right edge
- **THEN** the authored connection leaves the source from its bottom edge
- **AND** the stored layout entry names that side

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
