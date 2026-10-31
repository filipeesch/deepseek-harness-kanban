# Spec Delta

## MODIFIED Requirements

### Requirement: Board selection and persistence
The Kanban page SHALL present the boards of the active Hub as tabs below the Hub tabs. The active board SHALL be retained per Hub across reloads in browser local storage. When the remembered board no longer exists, the plugin SHALL select the first available board. Switching boards SHALL reset board-scoped search, project filter, selection mode, and the open task drawer. Switching boards SHALL NOT stop, move, or otherwise affect task execution or a pending timed stage instruction armed for a task on either board.

#### Scenario: Restore the active board after reload
- **WHEN** the user reloads the page after selecting a board
- **THEN** the same board is active if it still exists in the same Hub

#### Scenario: Fall back from a deleted board
- **WHEN** the remembered board no longer exists in the active Hub
- **THEN** the first available board becomes active
- **AND** the page does not render an empty or stale board tab

#### Scenario: Reset board-scoped UI on switch
- **WHEN** the user switches from one board to another
- **THEN** the new board starts without the previous board's search, project filter, selection, or open task drawer
- **AND** running tasks continue unaffected

#### Scenario: Keep a pending timed instruction on switch
- **WHEN** the user switches to another board or Hub while a timed stage instruction countdown is active
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled
- **AND** the switch does not send, cancel, or duplicate the instruction

### Requirement: Timed stage instruction after a move
When a permitted move changes a task's stage to a stage with an entry instruction, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops and drawer stage changes. It SHALL NOT be armed for a same-stage reorder, for a task created directly in an instructed initial stage, or for a move into a stage without an entry instruction. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL send only that stage's entry instruction to the target. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed send SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

#### Scenario: Arm on a board drop
- **WHEN** the user drops a card on a permitted stage with an entry instruction
- **THEN** the card exposes a countdown for that entry
- **AND** no instruction is sent while the countdown is active

#### Scenario: Arm on a drawer stage change
- **WHEN** the user selects a permitted instructed destination from the drawer's stage control
- **THEN** the drawer presents the countdown notice for that entry
- **AND** the card exposes the countdown control for the same entry

#### Scenario: Send only the instruction on expiry
- **WHEN** the five-second countdown ends without cancellation
- **THEN** only the stage's entry instruction is sent to the task's first open conversation
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** only the stage's entry instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Cancel from the card
- **WHEN** the user activates the card's countdown control before it ends
- **THEN** no instruction is sent
- **AND** the task remains in the destination stage at the same position
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Cancel from the drawer
- **WHEN** the user activates the cancel action in the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the countdown disappears on the card and in the drawer
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Manual prompt cancels the countdown
- **WHEN** a successful user prompt resolves the entry before the countdown ends
- **THEN** the countdown stops without sending the instruction
- **AND** no second instruction is sent

#### Scenario: New instructed entry replaces the countdown
- **WHEN** the task moves again into another instructed stage before the countdown ends
- **THEN** the previous countdown no longer sends
- **AND** a new countdown for the new entry is armed

#### Scenario: No countdown on a same-stage reorder
- **WHEN** the user reorders the card within its current stage
- **THEN** no new countdown is armed
- **AND** an active countdown for the current entry keeps running

#### Scenario: No countdown for task creation
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** no countdown is armed
- **AND** the card exposes the run action for the new entry

#### Scenario: Continue when the card is not visible
- **WHEN** the card is hidden by search, a project filter, selection mode, or another panel before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled

#### Scenario: Continue across board and Hub switches
- **WHEN** the user switches to another board or Hub before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled
- **AND** the unresolved entry is resolved for the task on its own board

#### Scenario: Send while the Kanban panel is hidden
- **WHEN** the countdown ends while the Kanban panel is not visible and its board is not mounted
- **THEN** only the stage's entry instruction is sent to the resolved target
- **AND** the unresolved entry is resolved without requiring the board to be reopened

#### Scenario: Unsent draft does not block the send
- **WHEN** the target conversation has unsent composer text or attachments when the countdown ends
- **THEN** the stage instruction is sent anyway
- **AND** the unsent text and attachments remain unchanged

#### Scenario: Failed timed send restores the run action
- **WHEN** the timed instruction cannot be admitted or sent
- **THEN** the countdown stops
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no automatic retry occurs

#### Scenario: Changed instruction fails visibly
- **WHEN** the stage's entry instruction changes before the countdown ends
- **THEN** the timed send is rejected
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no replacement instruction is sent automatically

#### Scenario: Already resolved at admission ends silently
- **WHEN** admission reports that the entry was resolved before the timed send
- **THEN** the countdown stops without an error notice
- **AND** no instruction is sent

#### Scenario: Reload does not send
- **WHEN** the board reloads or the plugin restarts while a countdown is active
- **THEN** no instruction is sent automatically
- **AND** the entry remains unresolved
- **AND** the card exposes the run action after reload
