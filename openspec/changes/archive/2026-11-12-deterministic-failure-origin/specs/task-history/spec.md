# Spec Delta

## MODIFIED Requirements

### Requirement: Only settled facts are recorded

The record SHALL NOT include state that is still in progress or that an existing surface already presents as current state. A phase of an operation that has not settled, a transition awaiting delivery, and the current stage itself SHALL NOT produce an entry. Attaching or closing a conversation, delivering a stage instruction, saving or deleting a note, and editing the task's title or description SHALL NOT produce an entry. Clearing a next-stage intent SHALL NOT produce an entry.

An active deterministic program, a sleeping loop, individual external checks, recovery process attempts, repeated attempts of one host call, pending trust, and a saved result still awaiting delivery SHALL NOT generate progress or per-poll rows. Its terminal execution outcome and the eventual logical handoff settlement SHALL follow Flow facts recorded. A settled failed execution SHALL carry, bounded, the attempts the host made inside it, so the retries are auditable on that one entry instead of adding rows. A parameter admission refusal SHALL NOT produce an entry, because it is a configuration refusal rather than an execution attempt. Editing an entry's parameter values SHALL NOT produce an entry; the next settled execution records the values it used. A raw stage-instruction delivery SHALL still add no row merely because its context contains a handoff, and no script history SHALL be inferred from console output. Intermediate state SHALL remain on the current execution surfaces instead.

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

#### Scenario: Attempts ride the settled row

- **WHEN** the host repeats one guarded Bash call and the execution then settles as a failure
- **THEN** the record gains one failed execution entry for that execution
- **AND** that entry carries the bounded attempt facts of the repeated call

#### Scenario: A parameter refusal and a repair add nothing

- **WHEN** an admission is refused for a missing parameter and the user later edits that value
- **THEN** neither the refusal nor the edit adds a task-history entry
- **AND** the next settled execution records the values it used

### Requirement: History table in the task drawer

The History section SHALL present the record as a table with the columns **When**, **Event**, **Detail**, and **In stage**. The When column SHALL present the moment in the reader's local date and time and SHALL expose the same moment as a machine-readable timestamp. The Event column SHALL name the kind of fact. The Detail column SHALL carry the fact's own detail: the origin and destination for a stage entry, the recorded destination for an intention, the checkout path and branch for a worktree outcome, and the reason for a pause. Rows SHALL be ordered newest first and SHALL present the whole record without a cap, scrolling within the section when it exceeds the available height.

A deterministic execution row SHALL identify the settled outcome as script execution rather than an assistant turn or Auto mode change. Its Detail SHALL include the named output and redacted message, or the relevant cancellation or execution diagnostic, and SHALL distinguish completion of the program from acceptance or failure of its result handoff. A failed execution row SHALL additionally name the failure origin, the root-cause code, and the number of attempts the host made, and SHALL present the bounded facts that explain a guard or runtime failure so the failure can be diagnosed without reproducing it. A handoff row SHALL identify its source and destination and SHALL NOT claim a move when no stage change occurred. Execution and handoff rows SHALL remain non-stage rows and SHALL show a placeholder in In stage. The record SHALL NOT expose configured secret values, trust data, program snapshots, or full diagnostic streams.

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

#### Scenario: Read a guard failure from the row

- **WHEN** an execution failed inside the isolated Bash guard
- **THEN** its row names the failure origin, the root-cause code and the attempt count
- **AND** it presents the bounded guard facts, redacted, without a full diagnostic stream
