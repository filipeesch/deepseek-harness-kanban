# Spec Delta

## Purpose

Presents an active board's workflow as a navigable node diagram so the configured flow, its fan-outs, and the cards moving through it are visible at a glance, while keeping the column board as the other presentation of the same workflow.

## ADDED Requirements

### Requirement: Workflow diagram of the active board

The workflow view SHALL present the active board's workflow as a diagram of stages. Each stage SHALL be a bounded region with rounded corners that shows its stage title and the cards currently in that stage. The diagram SHALL present every stage of the active board's workflow and no other board's stages. A card SHALL keep its identity, SHALL remain focusable, and SHALL open the task drawer when activated.

#### Scenario: Present the active board's workflow

- **WHEN** the user opens the workflow view for a board whose workflow has four stages
- **THEN** the diagram presents four stage regions with their titles
- **AND** each region presents the cards that the board presents in that stage

#### Scenario: Activate a card in a stage region

- **WHEN** the user activates a card presented in a stage region
- **THEN** the task drawer opens for that task

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

The diagram SHALL derive a stage's outgoing connections from its configured transitions only. Each configured transition target SHALL be drawn as a solid connection from the source stage to that target. A stage that does not configure transitions SHALL have exactly one dashed connection to the next stage in workflow order, presenting the default path while any other stage remains allowed. A stage whose configured transitions are empty SHALL have no outgoing connection. When a stage has more than one outgoing connection, each connection SHALL leave from a distinct point of the stage boundary so the separate paths are visible. A configured target equal to the stage itself SHALL NOT be drawn as a connection. A connection whose target precedes its source in workflow order SHALL be routed outside the stage column so that it does not cross the stage regions.

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

- **WHEN** a stage configures a target that precedes it in workflow order
- **THEN** the diagram draws the connection routed outside the stage column
- **AND** the connection does not cross a stage region

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

### Requirement: Diagram navigation

The diagram SHALL support panning and zooming within its own surface. Scrolling with a wheel or a touchpad gesture SHALL pan the diagram. Holding ctrl or cmd while scrolling SHALL zoom at the pointer position, and a pinch gesture SHALL zoom at the pointer position. Dragging the empty background SHALL pan the diagram. Zoom in, zoom out, and fit-to-view controls SHALL be available with accessible names, and the zoom level SHALL be bounded so the diagram remains usable at both limits. Navigation SHALL NOT change board data, SHALL NOT be part of the placement history, and SHALL NOT persist across a reload.

#### Scenario: Pan with the wheel

- **WHEN** the user scrolls over the diagram without holding ctrl or cmd
- **THEN** the diagram pans
- **AND** the zoom level does not change

#### Scenario: Zoom at the pointer

- **WHEN** the user holds ctrl or cmd and scrolls over the diagram
- **THEN** the diagram zooms around the pointer position

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

### Requirement: Card movement along the diagram

While the workflow view is open, a task whose stage changes SHALL be presented moving from its source stage region to its destination stage region. When the diagram draws a connection between the two stages, the movement SHALL follow that connection; otherwise the movement SHALL take the direct path between the two stage regions. The movement SHALL begin and end with a short fade. A same-stage reorder SHALL NOT animate a travel between stage regions. The task's state SHALL reflect its new stage immediately and SHALL NOT wait for the movement. More than eight tasks moving in one change SHALL settle immediately without travel, and the reduced-motion preference SHALL settle every movement immediately without travel or fade.

#### Scenario: Travel along a connection

- **WHEN** a task moves from a stage to a stage that the diagram connects
- **THEN** the card is presented travelling along that connection
- **AND** the task is already presented in the destination stage

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

The workflow view SHALL keep an undo and redo history for stage placement only. Each completed drag SHALL be one history entry, and each Organize SHALL be one history entry. Undo SHALL restore the previous stage placements, and redo SHALL reapply them; each SHALL store the restored workflow through the same workflow save as a drag. The history SHALL be reachable through Cmd or Ctrl+Z, Cmd or Ctrl+Shift+Z, and controls with accessible names, which SHALL be unavailable when there is nothing to undo or redo. The history SHALL be per board, SHALL be bounded, SHALL live only in memory, and SHALL be cleared by a reload. Card movement, navigation, and the choice of presentation SHALL NOT add a history entry. Undo SHALL cancel a pending coalesced placement save so that the stored workflow matches the restored placement.

#### Scenario: Undo a stage drag

- **WHEN** the user undoes after dragging a stage
- **THEN** the stage returns to its previous position
- **AND** the stored workflow matches that position

#### Scenario: Redo a stage drag

- **WHEN** the user redoes after undoing a stage drag
- **THEN** the stage returns to the dragged position

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

The diagram SHALL expose each stage region as a labelled region and each card as an activatable control reachable by keyboard. The pan and zoom state SHALL NOT hide a card from assistive technology, and the diagram SHALL NOT trap keyboard focus: focus SHALL be able to leave the diagram through its normal tab order. The zoom and fit controls SHALL expose accessible names.

#### Scenario: Reach a card by keyboard

- **WHEN** the user tabs through the diagram
- **THEN** focus reaches each card in stage order
- **AND** activating a focused card opens the task drawer

#### Scenario: Identify a stage region

- **WHEN** assistive technology reads the diagram
- **THEN** each stage region is announced with its stage title

#### Scenario: Leave the diagram by keyboard

- **WHEN** the user tabs past the last card of the last stage
- **THEN** focus leaves the diagram through the normal tab order

#### Scenario: Name the zoom controls

- **WHEN** assistive technology reads the diagram controls
- **THEN** zoom in, zoom out, and fit-to-view are each announced with an accessible name
