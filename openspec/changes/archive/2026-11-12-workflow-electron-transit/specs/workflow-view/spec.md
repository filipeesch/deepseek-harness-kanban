# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
