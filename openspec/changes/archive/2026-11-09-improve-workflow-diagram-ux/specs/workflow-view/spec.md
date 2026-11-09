# Spec Delta

## MODIFIED Requirements

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

The diagram SHALL derive a stage's outgoing connections from its configured transitions only. Each configured transition target SHALL be drawn as a solid connection from the source stage to that target. A stage that does not configure transitions SHALL have exactly one dashed connection to the next stage in workflow order, presenting the default path while any other stage remains allowed. A stage whose configured transitions are empty SHALL have no outgoing connection. When a stage has more than one outgoing connection, each connection SHALL leave from a distinct point of the stage boundary so the separate paths are visible. A configured target equal to the stage itself SHALL NOT be drawn as a connection. A connection whose target precedes its source in workflow order SHALL be routed outside the stage column so that it does not cross the stage regions.

A connection SHALL be drawn as an orthogonal path with rounded corners. A forward connection SHALL leave its source's right edge horizontally, turn at right angles, and enter its target's left edge horizontally. A returning connection SHALL leave the source's bottom edge and enter the target's bottom edge while running below every stage region. An arrowhead SHALL mark the connection's direction at the target. Each connection SHALL mark its contact with the stage boundary with a small circle at both ends; the circles SHALL be present only while the connection is pointed at, and SHALL NOT be presented otherwise. The circles are decorative: they add no focus target and no accessible name to the connection. The drawn path, its fan-out points, its clearance, and its contact circles SHALL follow a stage's position and size while that stage is moved or resized, without waiting for the change to be stored.

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
- **THEN** the diagram draws the connection routed below the stage column, entering the target's bottom edge
- **AND** the connection does not cross a stage region

#### Scenario: Draw an orthogonal path

- **WHEN** the diagram draws a forward connection between two stages
- **THEN** the path leaves the source's right edge horizontally, turns at right angles, and enters the target's left edge horizontally
- **AND** the corners of the path are rounded

#### Scenario: Reveal the contact points on hover

- **WHEN** the user points at a connection
- **THEN** a circle marks the connection's contact with each end of the stage boundary
- **AND** the circles are absent while the connection is not pointed at
- **AND** the circles add no focus target to the connection

#### Scenario: Follow a moved stage

- **WHEN** the user drags a stage that has connections
- **THEN** every connection attached to that stage follows its position while the drag is in progress
- **AND** the connections settle at the stored position when the drag ends

#### Scenario: Follow a resized stage

- **WHEN** the user resizes a stage that has connections
- **THEN** the connection endpoints follow the stage's new edges

### Requirement: Accessible diagram surface

The diagram SHALL expose each stage region as a labelled region and each card as an activatable control reachable by keyboard. The pan and zoom state SHALL NOT hide a card from assistive technology, and the diagram SHALL NOT trap keyboard focus: focus SHALL be able to leave the diagram through its normal tab order. The control stack SHALL expose an accessible name and a tooltip for every control, and each control's unavailable state SHALL be exposed as disabled rather than hidden. The minimap SHALL expose an accessible name, SHALL be operable by pointer, and SHALL NOT insert itself into the diagram's card tab order.

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

## ADDED Requirements

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

The diagram SHALL provide a layout lock that is on by default every time the diagram is presented. While the lock is on, stage move, stage resize, Organize, Undo, and Redo SHALL NOT be available and SHALL NOT change the workflow. While the lock is off, those actions SHALL be available subject to their own availability rules. The lock SHALL NOT gate card activation, card drag, selection, the run action, the advance action, pan, zoom, or the shared search and project filter. Unlocking and locking SHALL NOT change board data, and the lock SHALL NOT persist across a reload.

#### Scenario: Start locked

- **WHEN** the user opens the workflow diagram
- **THEN** the layout lock is on
- **AND** the layout actions are unavailable

#### Scenario: Block layout editing while locked

- **WHEN** the layout is locked and the user drags a stage header, a stage resize handle, or activates Organize, Undo, or Redo
- **THEN** no stage moves, resizes, or is reorganized
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

## REMOVED Requirements

### Requirement: Diagram navigation

**Reason**: The wheel gesture inverted its meaning — the wheel now zooms without a modifier and panning is a background drag — and the zoom and fit controls moved into the diagram's control stack. The replacement requirement is Diagram zoom and pan.

**Migration**: Users pan by dragging the empty background, zoom with the wheel or a pinch, and reach zoom in, zoom out, and fit-to-view from the bottom-left control stack.
