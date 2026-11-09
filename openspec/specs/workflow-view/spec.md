# workflow-view Specification

## Purpose
Presents an active board's workflow as a navigable node diagram so the configured flow, its fan-outs, and the cards moving through it are visible at a glance, while keeping the column board as the other presentation of the same workflow.

## Requirements

### Requirement: Workflow diagram of the active board

The workflow view SHALL present the active board's workflow as a diagram of stages. Each stage SHALL be a bounded region with rounded corners that shows its stage title and the cards currently in that stage. The diagram SHALL present every stage of the active board's workflow and no other board's stages. Each stage SHALL present its cards with the board's task card, so a task presents the same card regions, controls, states, and actions in either presentation: the project name, the unread, awaiting-reply, and failure attention indicators, the auto-mode control, the run action, the advance action, and the status strip SHALL be the same ones the board defines. A card SHALL keep its identity, SHALL remain focusable, and SHALL open the task drawer when activated, except that in selection mode activating a card SHALL toggle its selection and SHALL NOT open the drawer.

#### Scenario: Present the active board's workflow

- **WHEN** the user opens the workflow view for a board whose workflow has four stages
- **THEN** the diagram presents four stage regions with their titles
- **AND** each region presents the cards that the board presents in that stage

#### Scenario: Activate a card in a stage region

- **WHEN** the user activates a card presented in a stage region
- **THEN** the task drawer opens for that task

#### Scenario: Present the same card as the board

- **WHEN** a task is presented in a stage region
- **THEN** it presents the board's task card with its context, activity, and status regions
- **AND** its auto-mode control, attention indicators, run action, and advance action behave as they do on the board

#### Scenario: Select a card in the diagram

- **WHEN** selection mode is active and the user activates a card in a stage region
- **THEN** the card's selection is toggled
- **AND** the task drawer does not open

#### Scenario: Open a workflow with a single stage

- **WHEN** the active board's workflow has one stage
- **THEN** the diagram presents that one stage
- **AND** no connection is drawn

#### Scenario: Present an empty stage

- **WHEN** a stage has no cards
- **THEN** its region remains present in the diagram without cards

#### Scenario: Present another board

- **WHEN** the user switches to another board
- **THEN** the diagram presents the stages and cards of that board only

### Requirement: Connections derived from configured transitions

The diagram SHALL derive a stage's outgoing connections from its configured transitions only. Each configured transition target SHALL be drawn as a solid connection from the source stage to that target. A stage that does not configure transitions SHALL have exactly one dashed connection to the next stage in workflow order, presenting the default path while any other stage remains allowed. A stage whose configured transitions are empty SHALL have no outgoing connection. A configured target equal to the stage itself SHALL NOT be drawn as a connection.

A connection SHALL be drawn as an orthogonal path with rounded corners and an arrowhead at its target. A connection whose ends are not authored SHALL leave its source's right edge and enter its target's left edge when the target follows the source in workflow order and sits to its right. When stages are rearranged so those edges would cross a stage region, the automatic route SHALL step around the outside instead, below the stages or through a side gutter for two stages that share a column. A connection whose target precedes its source in workflow order SHALL leave and enter through the bottom edges. When a stage has more than one outgoing connection and their ends are not authored, each connection SHALL leave from a distinct point of the stage boundary so the separate paths are visible. A connection whose end is authored SHALL leave or enter through the side that end names, perpendicular to that side. An automatic connection SHALL NOT pass through the interior of its own source or target stage when the two stages do not overlap, and a connection whose target precedes its source in workflow order SHALL be routed outside both stage regions. When stages are arranged so a path passes over a third stage region, both the automatic and the adjusted route MAY cross it. Each connection SHALL mark its contact with the stage boundary at both ends. The drawn path, its departure points, its clearance, and its contact marks SHALL follow a stage's position and size while that stage is moved or resized, without waiting for the change to be stored.

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
- **THEN** the diagram draws the connection routed below the stage column, entering the target's bottom edge
- **AND** the connection does not cross a stage region

#### Scenario: Draw an orthogonal path

- **WHEN** the diagram draws a forward connection between two stages
- **THEN** the path leaves the source's right edge horizontally, turns at right angles, and enters the target's left edge horizontally
- **AND** the corners of the path are rounded

#### Scenario: Reveal the contact points on hover

- **WHEN** the user points at a connection
- **THEN** a mark appears at the connection's contact with each end of the stage boundary
- **AND** the marks are absent while the connection is not pointed at

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

#### Scenario: Follow a moved stage

- **WHEN** the user drags a stage that has connections
- **THEN** every connection attached to that stage follows its position while the drag is in progress
- **AND** the connections settle at the stored position when the drag ends

#### Scenario: Follow a resized stage

- **WHEN** the user resizes a stage that has connections
- **THEN** the connection endpoints follow the stage's new edges

### Requirement: Automatic layered placement

A stage without a stored placement SHALL be placed automatically. Each stage SHALL be placed to the right of every stage that connects to it, a stage with no incoming connection SHALL be placed in the first placement column, and stages that share a placement column SHALL be ordered from top to bottom by workflow order. Stages that belong to the same group SHALL be placed next to each other. Automatic placement SHALL remain stable while the view stays open, so cards entering or leaving a stage do not move stage regions. The Organize action SHALL recompute the automatic placement and SHALL store the result for every stage. Adding a stage to the workflow SHALL place that stage without moving a stage that already has a stored placement, and removing a stage SHALL remove only that stage and its connections.

#### Scenario: Place stages automatically

- **WHEN** a workflow with connected stages has no stored placements
- **THEN** each stage appears to the right of every stage that connects to it
- **AND** stages that share a placement column appear in workflow order from top to bottom

#### Scenario: Keep automatic placement stable

- **WHEN** cards enter or leave a stage while the workflow view is open
- **THEN** the stage regions do not change position

#### Scenario: Organize the diagram

- **WHEN** the user activates Organize after moving stages
- **THEN** the diagram recomputes the automatic placement
- **AND** the resulting placement is stored for every stage

#### Scenario: Add a stage to the workflow

- **WHEN** the workflow gains a stage while other stages have stored placements
- **THEN** the new stage is placed automatically
- **AND** no stored placement changes

#### Scenario: Remove a stage from the workflow

- **WHEN** the workflow loses a stage
- **THEN** that stage and its connections disappear from the diagram
- **AND** the stored placements of the other stages are unchanged

### Requirement: Persisted stage placement

Dragging a stage region SHALL place that stage at the dropped position and SHALL store the placement in the board's workflow configuration as that stage's position. Only the dragged stage's position SHALL change. A stored position SHALL survive a reload, a switch of presentation, and another installation that receives the board through team sharing. Saves produced by dragging SHALL be coalesced so that one completed drag produces one stored workflow change. A position that is not a finite number or that lies outside the accepted coordinate range SHALL be rejected as an invalid workflow, and the last valid workflow SHALL be retained.

#### Scenario: Persist a dragged stage

- **WHEN** the user drags a stage region and releases it
- **THEN** the stage stays at the dropped position
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

### Requirement: Card movement along the diagram

While the workflow view is open, a task whose stage changes SHALL be presented moving from its source stage region to its destination stage region. When the diagram draws a connection between the two stages, the movement SHALL follow the drawn path of that connection, including a route the user adjusted; otherwise the movement SHALL take the direct path between the two stage regions. The movement SHALL begin and end with a short fade. A same-stage reorder SHALL NOT animate a travel between stage regions. The task's state SHALL reflect its new stage immediately and SHALL NOT wait for the movement. More than eight tasks moving in one change SHALL settle immediately without travel, and the reduced-motion preference SHALL settle every movement immediately without travel or fade.

#### Scenario: Travel along a connection

- **WHEN** a task moves from a stage to a stage that the diagram connects
- **THEN** the card is presented travelling along that connection
- **AND** the task is already presented in the destination stage

#### Scenario: Travel along an adjusted connection

- **WHEN** a task moves along a connection whose route the user adjusted or whose ends the user anchored
- **THEN** the card travels along the path the diagram draws for that connection
- **AND** it does not travel along the unadjusted route

#### Scenario: Travel without a connection

- **WHEN** a task moves to a stage that the diagram does not connect to its source
- **THEN** the card is presented travelling directly between the two stage regions

#### Scenario: Reorder within a stage

- **WHEN** a task changes position inside its stage
- **THEN** no travel between stage regions is presented

#### Scenario: Settle a large batch

- **WHEN** one change moves more than eight tasks between stages
- **THEN** no travel is presented for those tasks

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** a stage change is presented without travel and without fade
- **AND** the task's content and activation are unchanged

#### Scenario: Keep interaction available during travel

- **WHEN** the user activates or focuses a card while cards are travelling
- **THEN** the card responds with its normal focus and activation behavior

#### Scenario: Movement changes no board data

- **WHEN** the diagram presents a card movement
- **THEN** no command is sent and no board data changes because of the movement

### Requirement: Card drag between stages in the diagram

A card SHALL be draggable from one stage region to another, and the resulting stage change SHALL follow the same rules as a card move on the board: a permitted transition moves the card, a restricted transition asks for explicit confirmation before moving, a first execution presents the first-execution preparation, and a move into a stage with an entry instruction arms the same timed instruction. A drop inside the destination stage SHALL place the card at the requested position in that stage. A same-stage drop SHALL reorder the card inside its stage. Canceling a confirmation or a preparation SHALL leave the card in its stage. The diagram SHALL present the card in the destination before the move is confirmed by the host, and SHALL return it to its source when the move fails.

#### Scenario: Drop a card on a permitted stage

- **WHEN** the user drags a card from one stage region and drops it on a permitted stage region
- **THEN** the task moves to that stage
- **AND** the card is presented at the dropped position in that stage

#### Scenario: Drop a card on a restricted stage

- **WHEN** the user drops a card on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation
- **AND** the card remains in its stage until the user confirms

#### Scenario: Drop a card that has no conversation

- **WHEN** the user drops a card on a stage and the task has no conversation
- **THEN** the first-execution preparation is presented before the move is dispatched
- **AND** canceling the preparation leaves the card in its stage

#### Scenario: Drop a card on an instructed stage

- **WHEN** the user drops a card on a stage with an entry instruction
- **THEN** the timed instruction is armed exactly as after a board drop

#### Scenario: Reorder inside a stage

- **WHEN** the user drops a card at a new position inside its current stage
- **THEN** the card is placed at that position
- **AND** no stage change is requested

#### Scenario: Present the optimistic result

- **WHEN** the user drops a card on a destination stage
- **THEN** the diagram presents the card in the destination before the command completes

#### Scenario: Revert a failed move

- **WHEN** the requested stage change fails
- **THEN** the card returns to its source stage
- **AND** the failure is reported

### Requirement: Placement history

The workflow view SHALL keep an undo and redo history for the diagram's layout: stage placement, stage size, and connection layout. Each completed stage drag, stage resize, connection adjustment, and each Organize SHALL be one history entry. Undo SHALL restore the previous layout, and redo SHALL reapply it; each SHALL store the restored workflow through the same workflow save as a drag. The history SHALL be reachable through Cmd or Ctrl+Z, Cmd or Ctrl+Shift+Z, and controls with accessible names, which SHALL be unavailable when there is nothing to undo or redo. The history SHALL be per board, SHALL be bounded, SHALL live only in memory, and SHALL be cleared by a reload. Card movement, navigation, and the choice of presentation SHALL NOT add a history entry. Undo SHALL cancel a pending coalesced layout save so that the stored workflow matches the restored layout.

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

#### Scenario: Undo an Organize action

- **WHEN** the user undoes after using Organize
- **THEN** every stage returns to the placement it had before Organize
- **AND** one step is consumed

#### Scenario: Exclude a card move from the history

- **WHEN** the user moves a card between stages in the diagram
- **THEN** the placement history gains no entry

#### Scenario: Exclude navigation from the history

- **WHEN** the user pans or zooms the diagram
- **THEN** the placement history gains no entry

#### Scenario: Clear the history on reload

- **WHEN** the user reloads the board
- **THEN** the placement history is empty

#### Scenario: Keep a separate history per board

- **WHEN** the user moves a stage on one board and switches to another board
- **THEN** the other board's history contains only that board's placement steps

#### Scenario: Disable an unavailable history action

- **WHEN** there is nothing to undo or nothing to redo
- **THEN** the corresponding control is unavailable

### Requirement: Shared search and project filter

The workflow view SHALL present the same cards as the board view for the active text search and project filter. A stage region SHALL present only the cards that match both filters, and a stage with no matching card SHALL remain present. Changing the search or the project filter SHALL NOT change any stage placement.

#### Scenario: Filter by text

- **WHEN** the user enters a search that matches some cards
- **THEN** only those cards are presented in their stage regions

#### Scenario: Filter by project

- **WHEN** the user selects a project filter
- **THEN** only that project's cards are presented in their stage regions

#### Scenario: Keep an empty stage visible

- **WHEN** no card in a stage matches the active search or filter
- **THEN** the stage region remains present without cards

#### Scenario: Keep placements across a filter change

- **WHEN** the user changes the search or the project filter
- **THEN** no stage region changes position

### Requirement: Accessible diagram surface

The diagram SHALL expose each stage region as a labelled region and each card as an activatable control reachable by keyboard. The diagram SHALL expose both ends of every drawn connection as focusable controls, each with an accessible name that identifies the connection and the end. The pan and zoom state SHALL NOT hide a card or a connection from assistive technology, and the diagram SHALL NOT trap keyboard focus: focus SHALL be able to leave the diagram through its normal tab order. The control stack SHALL expose an accessible name and a tooltip for every control, and each control's unavailable state SHALL be exposed as disabled rather than hidden. The minimap SHALL expose an accessible name, SHALL be operable by pointer, and SHALL NOT insert itself into the diagram's card tab order.

#### Scenario: Reach a card by keyboard

- **WHEN** the user tabs through the diagram
- **THEN** focus reaches each card in stage order
- **AND** activating a focused card opens the task drawer

#### Scenario: Reach a connection end by keyboard

- **WHEN** the user tabs through the diagram
- **THEN** focus reaches each end of each drawn connection
- **AND** each end is announced with a name naming the connection and the end

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

### Requirement: Diagram zoom and pan

The diagram SHALL support panning and zooming within its own surface. Scrolling the wheel SHALL zoom the diagram at the pointer position without requiring a modifier key. Dragging the empty background SHALL pan the diagram, and a pinch gesture SHALL zoom at the gesture position. Zoom in, zoom out, and fit-to-view SHALL be available through the diagram's control stack, and the zoom level SHALL be bounded so the diagram remains usable at both limits. Navigation SHALL NOT change board data, SHALL NOT be part of the layout history, and SHALL NOT persist across a reload.

#### Scenario: Zoom with the wheel

- **WHEN** the user scrolls the wheel over the diagram without holding any modifier key
- **THEN** the diagram zooms around the pointer position
- **AND** the gesture does not pan the diagram

#### Scenario: Zoom with a modifier key

- **WHEN** the user holds ctrl or cmd and scrolls over the diagram
- **THEN** the diagram zooms around the pointer position

#### Scenario: Zoom at the pointer

- **WHEN** the user zooms with the wheel away from the diagram's center
- **THEN** the point under the pointer stays under the pointer

#### Scenario: Zoom with a pinch gesture

- **WHEN** the user performs a pinch gesture over the diagram
- **THEN** the diagram zooms around the gesture position

#### Scenario: Pan by dragging the background

- **WHEN** the user drags the empty background of the diagram
- **THEN** the diagram pans

#### Scenario: Fit the diagram

- **WHEN** the user activates fit-to-view
- **THEN** every stage region is visible inside the diagram surface

#### Scenario: Respect the zoom limits

- **WHEN** the user zooms beyond the accepted bounds
- **THEN** the zoom level stops at the bound
- **AND** the diagram remains usable

#### Scenario: Navigation changes no board data

- **WHEN** the user pans or zooms the diagram
- **THEN** no command is sent and no board data changes

### Requirement: Stage minimum size

Each stage SHALL have a size that bounds its rendered width and height in the diagram. A stage SHALL NOT render narrower or shorter than its minimum size, and the size the diagram uses today SHALL remain the accepted minimum. A stage SHALL grow beyond its stored size when its cards require more room and SHALL NOT shrink below its minimum size when they require less. A stage size SHALL be stored per stage in the board's workflow configuration as that stage's size, SHALL survive a reload, a switch of presentation, and another installation that receives the board through team sharing, and SHALL be merged by the same sharing path that merges placements.

The user SHALL be able to resize a stage by dragging a resize handle on the stage region while the layout is unlocked. A resize SHALL change only the resized stage's size and SHALL NOT change any stage's placement. A size that is not a finite number, is smaller than the minimum, or lies outside the accepted coordinate range SHALL be rejected as an invalid workflow, and the last valid workflow SHALL be retained.

#### Scenario: Enforce the minimum size

- **WHEN** a stage is presented and its stored size is smaller than the accepted minimum
- **THEN** the stage is rendered at the minimum size

#### Scenario: Grow with the cards

- **WHEN** a stage holds more cards than its stored size can show
- **THEN** the stage grows to fit them
- **AND** its stored size is unchanged

#### Scenario: Resize a stage

- **WHEN** the user drags a stage's resize handle while the layout is unlocked
- **THEN** that stage's width and height follow the pointer
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

### Requirement: Layout editing lock

The diagram SHALL provide a layout lock that is on by default every time the diagram is presented. While the lock is on, stage move, stage resize, connection re-anchoring, route segment adjustment, Organize, Undo, and Redo SHALL NOT be available and SHALL NOT change the workflow. While the lock is off, those actions SHALL be available subject to their own availability rules. The lock SHALL NOT gate card activation, card drag, selection, the run action, the advance action, pan, zoom, or the shared search and project filter. Unlocking and locking SHALL NOT change board data, and the lock SHALL NOT persist across a reload.

#### Scenario: Start locked

- **WHEN** the user opens the workflow diagram
- **THEN** the layout lock is on
- **AND** the layout actions are unavailable

#### Scenario: Block layout editing while locked

- **WHEN** the layout is locked and the user drags a stage header, a stage resize handle, a connection end, or a route segment, or activates Organize, Undo, or Redo
- **THEN** no stage moves, resizes, or is reorganized
- **AND** no connection changes
- **AND** no command is sent

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

### Requirement: Diagram controls and minimap

The diagram SHALL present one control stack at its bottom-left with, in order: zoom in, zoom out, fit to view, undo, redo, organize, and the layout lock. Each control SHALL present an icon, a tooltip naming its action, and an accessible name, and undo, redo, organize, and the layout actions SHALL be unavailable when they cannot apply. The diagram SHALL present an always-visible minimap at its bottom-right that shows the stages within their extent and the current viewport, and that pans the diagram when the user drags within it. The minimap SHALL NOT replace the pan and zoom gestures and SHALL NOT change board data. The diagram SHALL NOT present the text action toolbars that previously carried Organize, Undo, and Redo.

#### Scenario: Present the control stack

- **WHEN** the diagram is presented
- **THEN** one stack at the bottom-left presents zoom in, zoom out, fit, undo, redo, organize, and the layout lock in that order
- **AND** no text action toolbar is presented

#### Scenario: Name each control

- **WHEN** assistive technology reads a control in the stack
- **THEN** the control is announced with an accessible name
- **AND** pointing at it presents a tooltip naming its action

#### Scenario: Disable an inapplicable control

- **WHEN** there is nothing to undo, nothing to redo, or the layout is locked
- **THEN** the corresponding control is unavailable

#### Scenario: Show the minimap

- **WHEN** the diagram is presented
- **THEN** a minimap at the bottom-right shows every stage and the current viewport

#### Scenario: Navigate with the minimap

- **WHEN** the user drags inside the minimap
- **THEN** the diagram pans to follow
- **AND** no board data changes

### Requirement: Full-bleed diagram surface

The workflow diagram SHALL occupy the full content area of the board's presentation region. It SHALL NOT add page padding around its canvas and SHALL NOT draw an inner frame, border, or corner radius between the canvas and the board frame. The board header and the board's status notices SHALL remain above the diagram, and the diagram SHALL continue to own the remaining height without introducing page scrolling.

#### Scenario: Fill the board body

- **WHEN** the workflow diagram is presented
- **THEN** the canvas reaches the edges of the board's presentation region
- **AND** no page padding surrounds it

#### Scenario: Keep the header above

- **WHEN** the workflow diagram is presented
- **THEN** the board header and its notices remain above the canvas

#### Scenario: No inner frame

- **WHEN** the workflow diagram is presented
- **THEN** no border, frame, or corner radius is drawn inside the board frame

### Requirement: Persisted connection layout

Each connection's layout SHALL be stored in the board's workflow configuration as an authored entry identified by its source stage and its target stage. An entry MAY carry an anchor for its source end, an anchor for its target end, and an offset for each adjustable segment of its route; an absent part keeps the automatic value. An anchor SHALL name one of the four stage sides and one of five points along that side, at ten, thirty, fifty, seventy, and ninety percent, so a stage boundary offers twenty anchor points. A segment offset SHALL be stored with the axis it applies to, and SHALL be applied to the automatic segment of that axis at the same position along the route. An offset with no corresponding segment SHALL NOT be applied and SHALL remain stored. Only the adjusted connection's entry SHALL change. A stored connection layout SHALL survive a reload, a switch of presentation, and another installation that receives the board through team sharing. An entry that does not identify a drawn connection SHALL be ignored and SHALL NOT make the workflow invalid. An entry that repeats the same source and target SHALL be rejected as an invalid workflow, and so SHALL a side, anchor point, axis, or offset outside the accepted values, leaving the last valid workflow in effect. Saves produced by adjusting a connection SHALL be coalesced so that one completed adjustment produces one stored workflow change.

#### Scenario: Persist a re-anchored connection

- **WHEN** the user moves a connection end to another anchor point and releases it
- **THEN** the board's workflow configuration stores that anchor for that connection
- **AND** no other stage, size, or connection changes

#### Scenario: Persist an adjusted route segment

- **WHEN** the user moves a route segment and releases it
- **THEN** the board's workflow configuration stores that segment's offset and axis
- **AND** the offset is stored relative to the automatic position of that segment

#### Scenario: Restore a stored connection layout

- **WHEN** the user reloads the board after adjusting a connection
- **THEN** the connection is presented with the stored anchors and offsets

#### Scenario: Share a stored connection layout

- **WHEN** another installation receives the board with a stored connection layout
- **THEN** it presents that connection with the same anchors and offsets

#### Scenario: Keep an automatic end when only one end is authored

- **WHEN** a connection entry authors its source end only
- **THEN** the source end uses the authored anchor
- **AND** the target end keeps its automatic departure

#### Scenario: Ignore an offset the route does not have

- **WHEN** a stored offset names an axis or position the automatic route does not produce
- **THEN** that offset is not applied to another segment
- **AND** the entry keeps the offset for a route that produces it again

#### Scenario: Ignore an entry whose connection is not drawn

- **WHEN** a stored entry identifies a stage or a pair that the diagram draws no connection for
- **THEN** the workflow remains valid
- **AND** no connection is drawn for that entry
- **AND** the entry is not removed from the configuration

#### Scenario: Reject a duplicated connection entry

- **WHEN** the workflow configuration authors two entries for the same source and target
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Reject an invalid anchor

- **WHEN** an entry names an unknown side, an anchor point outside the five accepted positions, or an offset that is not a finite number
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Coalesce a completed adjustment

- **WHEN** the user drags a connection end or a route segment across the diagram and releases it
- **THEN** one workflow change is stored for that adjustment

### Requirement: Connection re-anchoring and route adjustment

While the layout lock is off, the diagram SHALL let the user move either end of a drawn connection, including the dashed connection derived from a stage without configured transitions. Pointing at a connection SHALL reveal a handle at each end and a handle on each adjustable segment; while the layout lock is on, pointing at a connection SHALL reveal the same marks without making them operable. Dragging an end handle SHALL move that end to the anchor point nearest the pointer, and releasing SHALL store the layout. Moving the pointer SHALL NOT store the workflow. A press that never moves SHALL change nothing and SHALL store nothing. Dragging a segment handle SHALL move that segment perpendicular to itself and SHALL store the layout on release. A cancelled gesture SHALL leave the connection as it was. An adjustment SHALL change no stage, no transition, no card, and no other connection.

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
- **THEN** the segment follows the pointer at right angles to its own direction
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

### Requirement: Keyboard connection adjustment

Each end of each drawn connection SHALL be reachable by keyboard. While a connection end has focus and the layout lock is off, the arrow keys SHALL move that end's anchor to the next or previous anchor point around its stage boundary, Enter SHALL store the chosen anchor, and Escape SHALL restore the anchor the end had when it received focus. Moving between anchor points SHALL NOT store the workflow before it is confirmed, and a change that is not confirmed SHALL NOT add a history entry.

#### Scenario: Move an anchor with the arrow keys

- **WHEN** a focused connection end receives an arrow key while the layout is unlocked
- **THEN** that end moves to the next anchor point in that direction around the stage boundary
- **AND** the workflow is not stored yet

#### Scenario: Confirm the anchor with Enter

- **WHEN** the user confirms a moved anchor with Enter
- **THEN** the anchor is stored for that connection
- **AND** the change is one layout history entry

#### Scenario: Cancel the anchor with Escape

- **WHEN** the user cancels a moved anchor with Escape
- **THEN** the end returns to the anchor it had when it received focus
- **AND** nothing is stored and no history entry is added

#### Scenario: Keep keyboard adjustment unavailable while locked

- **WHEN** a focused connection end receives an arrow key while the layout is locked
- **THEN** the anchor does not move
- **AND** nothing is stored
