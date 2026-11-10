# Spec Delta

## ADDED Requirements

### Requirement: Card attention surface

The board SHALL present a task's dominant attention state as a tint of the card surface. The dominant state SHALL be selected from the task's attention facts by a fixed priority: a failure, then an awaiting reply, then agent execution, then unread messages. The tint SHALL be the state's attention color mixed into the host surface at a low share, so that the card stays legible as text while its surface reads as area. The tint SHALL NOT be the only presentation of the state: the attention marks defined by Coexisting attention indicators across task conversations SHALL remain presented, including for every state that does not win the surface. The surface SHALL present no tint when none of those states applies. The tint SHALL NOT change the card's height, SHALL NOT add, remove, or reorder a region of the card, and SHALL NOT affect the task's workflow stage, its position, or its drag behavior. Task-level context-operation, confirmed-transition, and automatic-advance state SHALL NOT tint the card; those remain in the status region as defined by Task card status strip.

#### Scenario: Paint the dominant state

- **WHEN** a task has a failure and also has unread messages
- **THEN** the card surface is tinted with the failure color
- **AND** the unread mark is still presented in the context region

#### Scenario: Keep the card text legible

- **WHEN** a card presents a tint in either the host's light or dark appearance
- **THEN** the title, the project name, and the status-region text keep at least 4.5:1 contrast against the painted surface

#### Scenario: Present no tint without attention

- **WHEN** a task has no failure, no awaiting reply, no running agent, and no unread messages
- **THEN** the card surface presents no tint

#### Scenario: Keep the card height stable

- **WHEN** a card gains or loses a tint
- **THEN** its height and the positions of its regions do not change

#### Scenario: Keep status state out of the surface

- **WHEN** a task has a failed context operation and no failure, awaiting reply, running agent, or unread message
- **THEN** the card surface presents no tint
- **AND** the status region reports the failed operation

#### Scenario: Keep the tint in selection mode

- **WHEN** the board is in card-selection mode and a card has an attention state
- **THEN** the card still presents its tint
- **AND** the selection control and the selection accent remain presented

### Requirement: Attention marks keep a readable size in the diagram

The board SHALL present each attention mark at a readable on-screen size in the column board and in the workflow diagram. A mark's on-screen size SHALL remain constant while the diagram's zoom is between 0.29 and 1, SHALL follow the diagram's zoom above 1, and SHALL NOT exceed 3.5 times its authored size at any zoom, including the diagram's minimum zoom. Marks SHALL remain circles distinguished by their attention color and their fixed order of unread, awaiting reply, and failure. The card SHALL NOT present a mark for agent execution. Each mark SHALL keep the accessible name for its state at every zoom.

#### Scenario: Keep a constant size above the bound

- **WHEN** the workflow diagram presents a workflow at zoom 1 or at zoom 0.5
- **THEN** each attention mark renders at its authored on-screen size

#### Scenario: Bound the size at the minimum zoom

- **WHEN** the workflow diagram presents a workflow at its minimum zoom of 0.2
- **THEN** each attention mark renders at no more than 3.5 times its authored size
- **AND** it remains visible

#### Scenario: Present the authored size in the column board

- **WHEN** the board presents its columns instead of the diagram
- **THEN** each attention mark renders at its authored on-screen size

#### Scenario: Keep the marks named

- **WHEN** assistive technology reads a card that presents attention marks at any zoom
- **THEN** each mark exposes the name of its state

### Requirement: Board-wide mark all as read

The active board's header SHALL present a mark-all-read action. The action SHALL be presented whenever the board is not in card-selection mode, and SHALL be unavailable while the active board has no unread and no failed settled turn. Activating it SHALL acknowledge the last settled turn of every conversation belonging to every task on the active board, SHALL clear those tasks' unread and failure indicators, and SHALL persist the acknowledgment across reloads and plugin restarts. It SHALL NOT clear an awaiting-reply state, which is live rather than recorded. It SHALL NOT acknowledge a conversation of a task on another board or in another Hub. It SHALL NOT require a confirmation step, and it SHALL expose a short accessible name that states its effect.

#### Scenario: Clear a whole board

- **WHEN** the user activates the mark-all-read action on a board whose tasks have unread and failed settled turns
- **THEN** every card on that board stops presenting its unread and failure indicators
- **AND** a reload does not restore them

#### Scenario: Be unavailable when nothing is pending

- **WHEN** the active board has no unread and no failed settled turn
- **THEN** the mark-all-read action is unavailable

#### Scenario: Keep the other boards unread

- **WHEN** the user activates the mark-all-read action on one board
- **THEN** the tasks on every other board keep their indicators

#### Scenario: Keep an awaiting reply

- **WHEN** a task on the active board is awaiting a reply
- **THEN** activating the mark-all-read action does not clear that state

#### Scenario: Stay out of selection mode

- **WHEN** the board is in card-selection mode
- **THEN** the mark-all-read action is not presented

#### Scenario: Act without confirmation

- **WHEN** the user activates the mark-all-read action
- **THEN** no confirmation dialog is presented
- **AND** the action takes effect immediately

## MODIFIED Requirements

### Requirement: Execution accent on task cards

A task card SHALL present agent execution through one visible execution accent carried by two surfaces: a bar at the trailing edge of the card and the card's border. Both surfaces SHALL use the host theme's accent color and SHALL pulse while agent execution is running, remaining legible in the host's light and dark appearances. The accent SHALL NOT be presented as an attention mark: a card whose task is running SHALL NOT add a mark to the context region for that state. The card SHALL NOT present a working text label. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping both accent surfaces visible without animation. The execution accent SHALL NOT replace or hide the attention indicators, and it SHALL be presented whether or not the card also presents the run or advance actions. The card SHALL NOT present a background activity indicator; background activity SHALL remain available through the task drawer's Conversations section entry as defined by Coexisting attention indicators across task conversations.

#### Scenario: Card shows a running turn

- **WHEN** a task is running an assistant turn
- **THEN** its card presents the trailing accent bar and the accent-colored border
- **AND** the working state is announced once to assistive technology
- **AND** the card presents no working text label

#### Scenario: Card shows working while a subagent runs

- **WHEN** a task's assistant turn has ended and an owned subagent descendant is still running
- **THEN** its card still presents both accent surfaces
- **AND** the running subagent is not presented as background activity

#### Scenario: Running carries no attention mark

- **WHEN** a card presents the execution accent
- **THEN** the context region presents no mark for agent execution
- **AND** the marks for unread messages, an awaiting reply, and a failure remain presented when they apply

#### Scenario: Distinguish running from unread without motion

- **WHEN** the host prefers reduced motion and one card is running while another card is unread
- **THEN** both cards present the same blue surface
- **AND** only the running card presents the accent-colored border

#### Scenario: Background work does not use the accent

- **WHEN** a task has no owned agent running and still owns unsettled jobs or schedules
- **THEN** its card presents no execution accent
- **AND** its card presents no background activity indicator

#### Scenario: Activity is separate from identity

- **WHEN** a card presents an execution accent
- **THEN** the project name and the attention marks remain presented in the context region
- **AND** the accent does not replace an attention mark

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** both accent surfaces remain visible without animation

#### Scenario: Theme appearance

- **WHEN** the host application uses its light or dark appearance
- **THEN** both accent surfaces remain legible and use host theme colors
