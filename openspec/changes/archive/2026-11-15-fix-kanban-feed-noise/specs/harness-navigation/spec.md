# Spec Delta

## ADDED Requirements

### Requirement: Board update status reports the live board feed

The plugin SHALL present one board-update status on the Kanban page. That status SHALL report the availability of the live board feed and its recovery action. A failure the plugin reports to the caller that requested it — a rejected board command, an explicit board read, or a background refresh — SHALL NOT replace the board-update status. A reported failure SHALL keep the last received board state available rather than presenting an empty board, and the status's retry action SHALL restart the board feed.

#### Scenario: A rejected command does not replace the status

- **WHEN** a board command is rejected and its failure is presented where the action was started
- **THEN** the board-update status still reports the board feed as available
- **AND** no board-feed retry action is presented for that rejection

#### Scenario: A read a surface requested does not replace the status

- **WHEN** an explicit board read or a background refresh fails
- **THEN** the board-update status reports only the live board feed's availability
- **AND** the board keeps presenting the last state it received

#### Scenario: Recover a failed board feed

- **WHEN** the live board feed fails
- **THEN** the Kanban page presents the board-update status with the failure and its retry action
- **AND** the last received board state remains available
- **AND** the retry action restarts the feed, and the status clears once a frame is accepted

### Requirement: Board update failures stay out of native conversations

The board-update status, its message, and its retry action SHALL be presented only on the Kanban page. A native conversation SHALL NOT present them, in an ordinary DSH chat without a task card or in a conversation hosted inside the task drawer. A native conversation SHALL remain fully usable, including ordinary replies and the plugin's question surfaces, while the board feed is unavailable.

#### Scenario: An ordinary chat after a refused branch claim shows no failure

- **WHEN** a navigation to an ordinary DSH chat is not a branch of the open task's conversation, the host refuses the claim while the Kanban panel was active, and the host's native navigation applies
- **THEN** the ordinary chat presents no board-update failure and no retry action

#### Scenario: An ordinary chat while the board feed is unavailable

- **WHEN** the live board feed is unavailable and the user works in an ordinary DSH chat
- **THEN** the conversation accepts ordinary replies as it does with the feed available
- **AND** the board-update status is presented only when the Kanban page is shown
