# Task History Delta

## MODIFIED Requirements

### Requirement: Flow facts recorded

The record SHALL include, as separate entries: the task's creation together with the stage it was created in; every stage entry, naming the origin stage and the destination stage; every next-stage intent recorded on the task; every auto mode change, naming whether auto mode was enabled, disabled, paused with its reason, paused by the agent, or resumed; and the settled outcome of every worktree creation, attachment, and removal, and of every failed context operation, naming the path and branch the operation acted on and the failure reason when it failed.

The record SHALL additionally include the settled outcome of each deterministic execution, distinguishing a completed named result, an executor failure, and an explicit or superseding cancellation. The outcome SHALL identify its execution and source stage and SHALL carry the named exit and redacted message or diagnostic when one exists. A completed script outcome SHALL NOT claim that its destination was entered before that transition settles. A logical deterministic handoff acceptance or failure SHALL be recorded when that fact settles, with its delivery identity and destination reference, rather than by copying raw transcript events. Replaying the same execution outcome or handoff receipt after restart SHALL NOT create another occurrence; a later explicit Play creates a different execution whose settled outcome SHALL be recorded even when its text repeats a previous outcome. These entries SHALL contain no variable values, trust grants, captured code, or polling log stream and SHALL remain installation-local.

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

### Requirement: Only settled facts are recorded

The record SHALL NOT include state that is still in progress or that an existing surface already presents as current state. A phase of an operation that has not settled, a transition awaiting delivery, and the current stage itself SHALL NOT produce an entry. Attaching or closing a conversation, delivering a stage instruction, saving or deleting a note, and editing the task's title or description SHALL NOT produce an entry. Clearing a next-stage intent SHALL NOT produce an entry.

An active deterministic program, a sleeping loop, individual external checks, recovery process attempts, pending trust, and a saved result still awaiting delivery SHALL NOT generate progress or per-poll rows. Its terminal execution outcome and the eventual logical handoff settlement SHALL follow Flow facts recorded. A raw stage-instruction delivery SHALL still add no row merely because its context contains a handoff, and no script history SHALL be inferred from console output. Intermediate state SHALL remain on the current execution surfaces instead.

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

### Requirement: A stage entry requires a stage change

An entry for a stage change SHALL be appended only when the task's stage actually changes. A placement within the current stage, a move that is refused or canceled, an automatic advance that fails without moving the task, and renaming a stage SHALL NOT produce a stage entry.

Stop, Play, correction of saved script configuration, and restart recovery within the same stage SHALL NOT produce a stage-entry fact or restart the time spent in that stage. A deterministic result SHALL produce a stage-entry fact only when its admitted transition actually changes the task's stage, independently of its execution-outcome or handoff facts.

#### Scenario: Reorder within the current stage

- **WHEN** a task is placed at a new position inside its current stage
- **THEN** the record gains no entry

#### Scenario: A refused or canceled move

- **WHEN** a requested stage change is refused by the workflow or canceled by the user
- **THEN** the record gains no entry

#### Scenario: A failed automatic advance

- **WHEN** an admitted automatic advance fails before the task moves
- **THEN** the record gains no stage entry

#### Scenario: Renaming a stage

- **WHEN** a stage's identifier is renamed
- **THEN** the record gains no entry
- **AND** the existing entries keep naming the renamed stage correctly

#### Scenario: Reexecute without recording a stage change

- **WHEN** a deterministic execution is stopped, its script is corrected, and Play starts a new run in the same stage
- **THEN** history gains no stage-change entry for Stop, the edit, or Play
- **AND** the current stage duration continues from the actual stage entry

### Requirement: History table in the task drawer

The History section SHALL present the record as a table with the columns **When**, **Event**, **Detail**, and **In stage**. The When column SHALL present the moment in the reader's local date and time and SHALL expose the same moment as a machine-readable timestamp. The Event column SHALL name the kind of fact. The Detail column SHALL carry the fact's own detail: the origin and destination for a stage entry, the recorded destination for an intention, the checkout path and branch for a worktree outcome, and the reason for a pause. Rows SHALL be ordered newest first and SHALL present the whole record without a cap, scrolling within the section when it exceeds the available height.

A deterministic execution row SHALL identify the settled outcome as script execution rather than an assistant turn or Auto mode change. Its Detail SHALL include the named output and redacted message, or the relevant cancellation or execution diagnostic, and SHALL distinguish completion of the program from acceptance or failure of its result handoff. A handoff row SHALL identify its source and destination and SHALL NOT claim a move when no stage change occurred. Execution and handoff rows SHALL remain non-stage rows and SHALL show a placeholder in In stage. The record SHALL NOT expose configured secret values, trust data, program snapshots, or full diagnostic streams.

#### Scenario: Read the recorded flow

- **WHEN** the user opens the History section of a task that has recorded entries
- **THEN** the section presents a table with When, Event, Detail, and In stage columns
- **AND** each row names one fact with its moment

#### Scenario: Newest fact first

- **WHEN** the record holds more than one entry
- **THEN** the most recent entry is presented first
- **AND** the oldest entry is presented last

#### Scenario: The whole record is reachable

- **WHEN** the record holds more entries than the section can show at once
- **THEN** every entry is reachable by scrolling the section
- **AND** no entry is withheld behind a load-more control or a page size

#### Scenario: A stage entry names both stages

- **WHEN** a table row presents a stage entry
- **THEN** its Detail names the origin stage and the destination stage

#### Scenario: An intention reads as an intention

- **WHEN** a table row presents a recorded next-stage destination
- **THEN** the row presents it as an intention, distinct from a stage change

#### Scenario: Read a deterministic outcome without confusing it with a move

- **WHEN** the History section presents a deterministic execution result and a later handoff acceptance
- **THEN** the rows identify those as distinct settled facts with their own moments
- **AND** the result message is visible in Detail after known-secret redaction
- **AND** only an actual stage-entry row carries the stage-duration value
