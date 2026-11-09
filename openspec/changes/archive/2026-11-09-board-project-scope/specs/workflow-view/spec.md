# Spec Delta

## MODIFIED Requirements

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
