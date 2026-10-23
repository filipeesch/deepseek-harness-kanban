## MODIFIED Requirements

### Requirement: Run a stage instruction from a card
When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. When visible, the action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order; when no conversation is open, it SHALL create a new conversation and use that conversation as the target. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Show the action after a transition
- **WHEN** a card enters a stage with an entry instruction and no prompt has been sent since that entry
- **THEN** the card exposes the run action
- **AND** the task's stage and position are that of the transition

#### Scenario: Hide the action after any prompt
- **WHEN** a successful user prompt is sent in any open conversation of the task while the card remains in the instructed stage
- **THEN** the run action is no longer shown
- **AND** the task's stage and position are unchanged

#### Scenario: Report an admission failure
- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the failure is reported on the board
- **AND** the task's stage and position are unchanged
- **AND** the failed request does not implicitly start another run
- **AND** the run action remains available for the same entry

#### Scenario: Do not reset on same-stage reorder
- **WHEN** the card is reordered within the instructed stage
- **THEN** the entry marker is unchanged
- **AND** the action remains hidden if a prompt was already sent for that entry

#### Scenario: Reset on leaving and re-entering
- **WHEN** the card leaves the instructed stage and later enters it again
- **THEN** a new unresolved entry is created
- **AND** the action is shown again until a prompt is sent for that entry

#### Scenario: New task in an instructed initial stage
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** the card exposes the run action until a prompt is sent
- **AND** the task is not moved by the action

#### Scenario: Existing task without an entry marker
- **WHEN** a task is already in an instructed stage without an entry marker
- **THEN** the card does not expose the run action
- **AND** the action becomes available only after its next entry

#### Scenario: Run an instruction from a card
- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is sent to that first open conversation
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Run the instruction again
- **WHEN** a stage instruction has already been admitted and the card later re-enters that instructed stage
- **THEN** a new unresolved entry is created
- **AND** the action is available and sends the current stage instruction again to the resolved target

#### Scenario: Run when every conversation is closed
- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a changed instruction
- **WHEN** the stage's entry instruction changes after the card action was displayed and the user activates the action
- **THEN** the run is rejected
- **AND** the task, its stage, and its conversations are unchanged
- **AND** the user can review and run the current instruction

#### Scenario: Action unavailable while the task is busy
- **WHEN** the task has an unresolved context operation, a confirmed transition, or selection mode is active
- **THEN** the run action is unavailable
- **AND** no instruction is sent

#### Scenario: No action without an entry instruction
- **WHEN** a card's current stage has no entry instruction
- **THEN** the card does not expose the run action

## ADDED Requirements

### Requirement: Narrower board columns
The board SHALL render workflow columns with a 240px default width, 20% narrower than the previous 300px default, and a 208px minimum. Content-driven column heights and horizontal board scrolling SHALL remain available.

#### Scenario: Render the narrower default columns
- **WHEN** the board renders a workflow column slot at its default width
- **THEN** the slot is 240px wide
- **AND** the column keeps its content-driven height and the board scrolls horizontally when needed
