# Spec Delta

## MODIFIED Requirements

### Requirement: Flow facts recorded

The record SHALL include, as separate entries: the task's creation together with the stage it was created in; every stage entry, naming the origin stage and the destination stage; every next-stage intent recorded on the task; every auto mode change, naming whether auto mode was enabled, disabled, paused with its reason, paused by the agent, or resumed; and the settled outcome of every worktree creation, attachment, and removal, and of every failed context operation, naming the path and branch the operation acted on and the failure reason when it failed.

The record SHALL additionally include the settled outcome of each deterministic execution, distinguishing a completed named result, an executor failure, and an explicit or superseding cancellation. The outcome SHALL identify its execution and source stage and SHALL carry the named exit and redacted message or diagnostic when one exists. A settled execution SHALL additionally carry, bounded, the parameter names and values that execution used, so two executions of the same entry can be compared; it SHALL NOT carry a value the execution did not receive. A completed script outcome SHALL NOT claim that its destination was entered before that transition settles. A logical deterministic handoff acceptance or failure SHALL be recorded when that fact settles, with its delivery identity and destination reference, rather than by copying raw transcript events. Replaying the same execution outcome or handoff receipt after restart SHALL NOT create another occurrence; a later explicit Play creates a different execution whose settled outcome SHALL be recorded even when its text repeats a previous outcome. These entries SHALL contain no resolved variable values, trust grants, captured code, or polling log stream and SHALL remain installation-local. Parameter values are task data, not credentials, and SHALL be recorded only on the execution that received them.

#### Scenario: Record the creation of a task

- **WHEN** a task is created in the board's initial stage
- **THEN** the record starts with an entry naming the creation and that stage

#### Scenario: Record a stage entry

- **WHEN** a task moves from one stage to another
- **THEN** the record gains an entry naming the origin stage and the destination stage

#### Scenario: Record a next-stage intent

- **WHEN** a next-stage destination is recorded on the task
- **THEN** the record gains an entry naming the origin stage and the recorded destination
- **AND** that entry presents the recording as an intention rather than a move
- **AND** the task's stage is unchanged

#### Scenario: Record replacing a next-stage intent

- **WHEN** a task with a recorded destination records a different one
- **THEN** the record gains one entry for that recording
- **AND** the earlier entry is unchanged

#### Scenario: Record an auto mode change

- **WHEN** auto mode is enabled, disabled, paused by the host with a reason, paused by the agent with its reason, or resumed
- **THEN** the record gains one entry naming that change
- **AND** a pause entry carries the reason that paused it

#### Scenario: Record a resume caused by a placement

- **WHEN** a placement clears a paused auto mode or an agent pause
- **THEN** the record gains one entry naming the resume
- **AND** a placement that keeps an admitted agent pause adds none

#### Scenario: Record a worktree outcome

- **WHEN** a worktree creation, attachment, or removal settles
- **THEN** the record gains one entry naming the outcome and the checkout path
- **AND** a created worktree entry names its branch

#### Scenario: Record a failed operation

- **WHEN** a worktree or context operation fails
- **THEN** the record gains one entry naming the checkout it acted on
- **AND** that entry carries the failure that ended the operation

#### Scenario: A return to the base project records nothing

- **WHEN** a task returns to its base project directory
- **THEN** the record gains no entry
- **AND** a task deletion records nothing, because the record is removed with the task

#### Scenario: Record a deterministic result before claiming its move

- **WHEN** a deterministic execution saves a terminal named output while its result delivery is still held
- **THEN** history records the settled execution outcome with its source stage, output, and redacted message
- **AND** that outcome is not presented as a completed stage change or handoff acceptance

#### Scenario: Record a settled deterministic handoff once

- **WHEN** a deterministic handoff is accepted by its destination entry
- **THEN** history records its logical acceptance and delivery identity
- **AND** restarting or retrying the same delivery adds no duplicate acceptance fact

#### Scenario: Keep distinct manual reexecutions in history

- **WHEN** two different executions started by Play later settle with the same named output and message
- **THEN** history retains a settled outcome for each execution
- **AND** the equal text does not collapse those different occurrences

#### Scenario: Record the parameter values an execution used

- **WHEN** a parameterized execution settles after running with a pipeline and an app value
- **THEN** its settled outcome carries those names and values
- **AND** a later execution of the same entry that runs with a different value records its own values

### Requirement: Only settled facts are recorded

The record SHALL NOT include state that is still in progress or that an existing surface already presents as current state. A phase of an operation that has not settled, a transition awaiting delivery, and the current stage itself SHALL NOT produce an entry. Attaching or closing a conversation, delivering a stage instruction, saving or deleting a note, and editing the task's title or description SHALL NOT produce an entry. Clearing a next-stage intent SHALL NOT produce an entry.

An active deterministic program, a sleeping loop, individual external checks, recovery process attempts, pending trust, and a saved result still awaiting delivery SHALL NOT generate progress or per-poll rows. Its terminal execution outcome and the eventual logical handoff settlement SHALL follow Flow facts recorded. A parameter admission refusal SHALL NOT produce an entry, because it is a configuration refusal rather than an execution attempt. Editing an entry's parameter values SHALL NOT produce an entry; the next settled execution records the values it used. A raw stage-instruction delivery SHALL still add no row merely because its context contains a handoff, and no script history SHALL be inferred from console output. Intermediate state SHALL remain on the current execution surfaces instead.

#### Scenario: An operation in progress adds nothing

- **WHEN** a worktree operation passes through its intermediate phases
- **THEN** the record gains no entry until the operation settles

#### Scenario: A transition awaiting delivery adds nothing

- **WHEN** a confirmed transition is waiting to be dispatched
- **THEN** the record gains no entry for that waiting state

#### Scenario: Clearing an intent adds nothing

- **WHEN** a recorded next-stage destination is cleared
- **THEN** the record gains no entry for the clearing
- **AND** the entry recorded when that destination was recorded remains

#### Scenario: A repeated agent pause adds nothing

- **WHEN** an agent requests the pause the task already holds with the same reason
- **THEN** the task is reported unchanged
- **AND** the record gains no entry for that request

#### Scenario: Conversation and note activity adds nothing

- **WHEN** a conversation is attached or closed, a stage instruction is delivered, a note is saved or deleted, or the task's title or description is edited
- **THEN** the record gains no entry

#### Scenario: Do not turn a script loop or recovery into history rows

- **WHEN** a deterministic script performs repeated checks and sleeps, or an active run is restarted after host loss
- **THEN** those progress events add no task-history row
- **AND** only distinct settled execution and logical handoff facts are appended

#### Scenario: A parameter refusal and a repair add nothing

- **WHEN** an admission is refused for a missing parameter and the user later edits that value
- **THEN** neither the refusal nor the edit adds a task-history entry
- **AND** the next settled execution records the values it used
