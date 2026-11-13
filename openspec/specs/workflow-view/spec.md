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

### Requirement: Card movement along the diagram

While the workflow view is open, a task whose stage changes SHALL be presented by an energy transit along the connection the diagram draws between the two stages: one transit per moved task, presented as a bright core with a halo and a short trail. The transit SHALL follow the drawn path of that connection, including a route the user adjusted or one whose ends the user anchored, and SHALL run at a constant speed whose duration follows that path's length within a bounded range. The transit SHALL begin where the connection leaves the source stage and SHALL end where it reaches the destination stage.

The task's card SHALL NOT be duplicated to present the movement. The task's state SHALL reflect its new stage immediately and SHALL NOT wait for the transit, and no second representation of that card SHALL be presented while a transit runs. When the transit reaches the destination, the destination card SHALL present one brief arrival pulse, and no other card SHALL present one.

A stage change between two stages the diagram draws no connection for SHALL present no transit: the card SHALL still be presented in the destination, with its arrival pulse, and the diagram SHALL NOT draw a temporary connection for that movement. A same-stage reorder SHALL NOT present a transit. More than eight tasks moving in one change SHALL settle immediately without transit and without pulse, and the reduced-motion preference SHALL settle every movement immediately without transit and without pulse, keeping every card's content and activation unchanged.

A running transit SHALL continue without restarting when the presented view re-renders, and exactly one transit SHALL be presented for one stage change. A transit SHALL NOT intercept pointer input, SHALL NOT enter the diagram's focus order, SHALL NOT extend the diagram's or the board's scrollable area, and SHALL leave no interactive remnant once it completes. A card SHALL remain activatable, focusable, and draggable while a transit runs. Presenting a transit SHALL NOT send a command and SHALL NOT change board data.

#### Scenario: Travel along a connection

- **WHEN** a task moves from a stage to a stage that the diagram connects
- **THEN** a transit is presented travelling along that connection
- **AND** the card is presented in the destination when the transit begins
- **AND** no second representation of that card is presented

#### Scenario: Transit along a dashed connection

- **WHEN** a task moves along the dashed connection a stage that authors no transitions receives
- **THEN** the transit follows that dashed path

#### Scenario: Travel along an adjusted connection

- **WHEN** a task moves along a connection whose route the user adjusted or whose ends the user anchored
- **THEN** the transit follows the path the diagram draws for that connection
- **AND** it does not follow the unadjusted route

#### Scenario: Present the arrival pulse

- **WHEN** a transit reaches its destination stage
- **THEN** the destination card presents one brief pulse
- **AND** no other card presents one

#### Scenario: Travel without a connection

- **WHEN** a task moves between two stages the diagram draws no connection for
- **THEN** no transit is presented
- **AND** the diagram draws no temporary connection for that movement
- **AND** the card is presented in the destination with its arrival pulse

#### Scenario: Reorder within a stage

- **WHEN** a task changes position inside its stage
- **THEN** no transit is presented

#### Scenario: Settle a large batch

- **WHEN** one change moves more than eight tasks between stages
- **THEN** no transit and no arrival pulse are presented for those tasks

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** a stage change is presented without transit and without pulse
- **AND** the card's content and activation are unchanged

#### Scenario: Keep one transit through a re-render

- **WHEN** the presented view re-renders while a transit is running
- **THEN** that transit continues without restarting
- **AND** exactly one transit is presented for that stage change

#### Scenario: Keep interaction available during travel

- **WHEN** the user activates or focuses a card while a transit is running
- **THEN** the card responds with its normal focus and activation behavior
- **AND** the transit does not intercept the pointer

#### Scenario: Movement changes no board data

- **WHEN** the diagram presents a transit
- **THEN** no command is sent and no board data changes because of the transit

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

### Requirement: Diagram zoom and pan
The diagram SHALL support panning and zooming within its own surface. Scrolling the wheel SHALL zoom the diagram at the pointer position without requiring a modifier key. Dragging the empty background SHALL pan the diagram, and a pinch gesture SHALL zoom at the gesture position. Zoom in, zoom out, and fit-to-view SHALL be available through the diagram's control stack, and the zoom level SHALL be bounded so the diagram remains usable at both limits. Navigation SHALL NOT change board data and SHALL NOT be part of the layout history. The diagram's pan position and zoom SHALL be stored per board in the browser and SHALL survive a reload. Opening a board SHALL restore the position last stored for that board, and switching from one board to another SHALL restore each board's own stored position. A change to that board's workflow that adds or removes a stage SHALL re-frame the whole diagram, and that framing SHALL become the stored position, because a stage may otherwise be left off screen. A change limited to authored stage positions or sizes SHALL keep the stored position: the user is looking at the layout they just authored, and re-framing it mid-edit would move the diagram away from them. Fit-to-view and organizing the stages SHALL re-frame the diagram, and that framing SHALL become the stored position. The stored position SHALL be local to the browser, SHALL NOT be sent to the host, SHALL NOT change the board's workflow, and SHALL NOT be published to the team.

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
- **AND** that framing is stored for the active board

#### Scenario: Respect the zoom limits
- **WHEN** the user zooms beyond the accepted bounds
- **THEN** the zoom level stops at the bound
- **AND** the diagram remains usable

#### Scenario: Navigation changes no board data
- **WHEN** the user pans or zooms the diagram
- **THEN** no command is sent to the host and no board data changes

#### Scenario: Restore the position of a board
- **WHEN** the user pans and zooms a board, reloads, and opens the same board
- **THEN** the diagram presents the pan position and zoom last stored for that board

#### Scenario: Keep a separate position per board
- **WHEN** the user pans and zooms one board, switches to another board, pans and zooms there, and returns to the first
- **THEN** each board presents its own stored pan position and zoom

#### Scenario: Re-frame after a stage is added or removed
- **WHEN** the board's workflow changes so that a stage is added or removed
- **THEN** the diagram re-frames every stage
- **AND** that framing becomes the stored position for that board

#### Scenario: Keep the stored position after moving a stage
- **WHEN** the board's workflow changes only the authored position or size of a stage
- **THEN** the diagram keeps the stored position for that board
- **AND** the moved stage is presented where it was authored

#### Scenario: Keep the stored position out of shared data
- **WHEN** the user navigates the diagram of a published board
- **THEN** the pan position and zoom are not included in the board's workflow, the published document, or any team update

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

### Requirement: Task creation in the initial stage

The diagram SHALL present a task creation action in the header of the stage that is the workflow's configured initial stage, and SHALL NOT present that action in any other stage. The action SHALL carry an accessible name naming task creation and a tooltip naming the same action, so a sighted and an assisted reading agree, and SHALL be an icon control that does not disturb the arrangement of its stage's title and card count.

Activating the action SHALL open the board's New task experience defined by `kanban-board` Top-level task creation, presenting that experience exactly as the column board does and creating the task in the configured initial stage. The action SHALL NOT be a layout edit: activating it SHALL NOT start a stage move, a stage resize, or an arrow adjustment, and SHALL NOT store a workflow change or add a placement-history entry, whether it is activated by pointer or by keyboard.

The action SHALL remain available while the layout is locked and while card selection is active, because it creates a task rather than editing the diagram. The action SHALL be unavailable when the active Hub has no registered project, because none could own the task; a published placeholder, which owns no directory, is not a registered project. The action SHALL stay available whenever a registered project exists, even when this board's project scope allows none, because the creation experience is what explains that the board accepts no task. The action SHALL remain present when the board's search or project filter hides every card of that stage.

The action SHALL be focusable and SHALL activate from the keyboard as readily as from the pointer. Activation by any means opens the board's shared creation experience, which takes focus while it is open and returns focus to the action that opened it when it is dismissed without creating; the diagram itself keeps its layout and viewport, and the task drawer stays closed.

#### Scenario: Present the action only on the initial stage

- **WHEN** the diagram presents a workflow whose initial stage is one of three stages
- **THEN** the initial stage's header presents the task creation action
- **AND** neither of the other two stage headers presents it

#### Scenario: Create a task from the diagram

- **WHEN** the user activates the task creation action in the initial stage's header and saves the New task experience
- **THEN** the task is created in the configured initial stage
- **AND** the diagram presents the new card in that stage region

#### Scenario: Activate the action without moving the stage

- **WHEN** the user presses the task creation action in the initial stage's header
- **THEN** the New task experience opens
- **AND** the stage does not move, resize, or enter a gesture
- **AND** no workflow change is stored and no placement-history entry is added

#### Scenario: Keep the action available while the layout is locked

- **WHEN** the layout is locked and the user activates the task creation action
- **THEN** the New task experience opens
- **AND** the locked diagram still refuses stage moves, resizes, and arrow adjustments

#### Scenario: Keep the action available during selection mode

- **WHEN** card selection is active and the user activates the task creation action
- **THEN** the New task experience opens
- **AND** no card selection is changed

#### Scenario: Disable the action without a registered project

- **WHEN** the active Hub has no project at all, or only published placeholders that own no directory
- **THEN** the task creation action in the initial stage's header is unavailable
- **AND** activating it opens nothing
- **AND** the column board's action of the same board is unavailable in the same way

#### Scenario: Keep the action available when only the board refuses

- **WHEN** the active Hub has a registered project and the board's project scope allows none of them
- **THEN** the task creation action in the initial stage's header is available
- **AND** activating it opens the creation experience that says the board accepts no new task and withholds saving

#### Scenario: Keep the action while a filter hides every card

- **WHEN** the board's search or project filter hides every card of the initial stage
- **THEN** the initial stage's header still presents the task creation action
- **AND** the stage region presents its empty state

#### Scenario: Activate the action from the keyboard

- **WHEN** the user reaches the task creation action by tabbing through the diagram and activates it
- **THEN** the New task experience opens with focus inside it
- **AND** the stage has not moved and the task drawer has not opened
- **AND** dismissing that experience returns focus to the task creation action

#### Scenario: Press the action while layout editing is unlocked

- **WHEN** layout editing is unlocked and the user presses the task creation action and drags away from it
- **THEN** the stage has not moved from where it stood
- **AND** no workflow change is stored
- **AND** activating the same control by keyboard opens the New task experience

### Requirement: Stage edit action in the diagram stage header

While layout editing is unlocked, the diagram's stage header SHALL present the stage edit action defined by `stage-editing` alongside the stage title, the card count, and, on the initial stage, the task creation action. The action SHALL sit at the header's top right after the card count and SHALL live in the same group of stage actions, so presenting it never moves the stage title.

The action SHALL NOT be a layout edit, but SHALL be absent while the layout lock is on and SHALL appear when the layout is unlocked. It SHALL stay available while card selection is active and while the search or project filter hides every card of the stage; activating it SHALL NOT start a stage move, a stage resize, or a connection adjustment, SHALL NOT add a placement-history entry, and SHALL NOT store a workflow change by itself. The header is the stage's drag handle, so pressing the action SHALL NOT pick the stage up.

#### Scenario: Present the action in the diagram

- **WHEN** the unlocked diagram presents a board whose workflow has four stages
- **THEN** each stage header presents the stage edit action after its card count

#### Scenario: Pressing the action does not start a move

- **WHEN** the user presses the stage edit action in a stage header
- **THEN** the stage editor opens
- **AND** the stage does not enter a drag or resize gesture
- **AND** no placement-history entry is added

#### Scenario: Hide the action while the layout is locked

- **WHEN** the layout is locked
- **THEN** the stage edit action is absent and not keyboard focusable
- **AND** stage moves, resizes, and arrow adjustments remain refused

#### Scenario: Show the action after unlocking

- **WHEN** the user unlocks layout editing
- **THEN** each stage edit action appears
- **AND** locking the layout again hides it

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

### Requirement: Condition mark on a connection without a condition

Every connection the workflow authors as a transition and that authors no condition SHALL present a mark on its path distinguishing it from a connection that authors a condition. The mark SHALL be absent from a connection that authors a condition, from the dashed connection a stage that authors no transitions receives, and from a connection whose source stage is deterministic, because that connection's routing is authored by the stage's named exits rather than by a condition; the diagram already distinguishes the latter two as paths it never invites the user to condition. The mark SHALL be presented only while the layout lock is off, because authoring the condition it stands for is a structural edit. The mark SHALL be removed when a condition is stored for that connection. The mark SHALL keep a readable size while the diagram zooms and SHALL follow its connection while a stage is moved or resized. The mark SHALL NOT be a control, SHALL NOT enter the diagram's keyboard order, and SHALL NOT change board data when pressed.

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

#### Scenario: Do not mark a deterministic connection

- **WHEN** a deterministic stage maps an exit to another stage
- **THEN** the connection drawn to that destination presents no mark
- **AND** the stage editor presents that exit and the destination it resolves to

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

### Requirement: Editing the routing of a deterministic connection

A connection whose source stage is deterministic SHALL NOT open the condition editor, because the routing that connection stands for is authored by that stage's named exits and no condition applies to it. Double-clicking that connection SHALL open the deterministic stage's editor while the layout lock is off, and SHALL open nothing while the layout lock is on. The stage editor SHALL remain the surface that presents and edits every named exit and the destination it resolves to, including when several exits resolve to one destination.

#### Scenario: Open a deterministic stage's editor from its connection

- **WHEN** the layout lock is off and the user double-clicks a connection whose source stage is deterministic
- **THEN** the stage editor opens for that stage
- **AND** no condition editor is presented

#### Scenario: Open nothing while the layout is locked

- **WHEN** the layout lock is on and the user double-clicks a connection whose source stage is deterministic
- **THEN** no editor opens
- **AND** no change is stored

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
