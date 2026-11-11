# Spec Delta

## Purpose

Record what happened to a task over its life, as settled facts with the moment each one happened, and present that record in the task drawer so the task's flow is readable without reading conversations.

## ADDED Requirements

### Requirement: Durable task flow record

Every task SHALL carry an ordered record of the flow facts that happened to it. Each entry SHALL name the kind of fact, the moment it happened, and the references that kind needs. Entries SHALL be appended only as facts settle, and SHALL NOT be rewritten afterwards, except to follow a renamed stage identifier. The record SHALL be removed together with the task, and SHALL NOT be included in anything the plugin publishes to team storage.

#### Scenario: An appended entry keeps its moment

- **WHEN** a flow fact settles for a task
- **THEN** the record gains one entry carrying the moment that fact happened
- **AND** that moment is unchanged by any later fact

#### Scenario: The record ends with the task

- **WHEN** a task is deleted
- **THEN** its flow record is removed with it
- **AND** no other task's record gains an entry

#### Scenario: The record never reaches team storage

- **WHEN** the board a task belongs to is published to a team storage
- **THEN** the published content contains no task flow record

### Requirement: Flow facts recorded

The record SHALL include, as separate entries: the task's creation together with the stage it was created in; every stage entry, naming the origin stage and the destination stage; every next-stage intent recorded on the task; every auto mode change, naming whether auto mode was enabled, disabled, paused with its reason, paused by the agent, or resumed; and the settled outcome of every worktree creation, attachment, and removal, and of every failed context operation, naming the path and branch the operation acted on and the failure reason when it failed.

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

### Requirement: Only settled facts are recorded

The record SHALL NOT include state that is still in progress or that an existing surface already presents as current state. A phase of an operation that has not settled, a transition awaiting delivery, and the current stage itself SHALL NOT produce an entry. Attaching or closing a conversation, delivering a stage instruction, saving or deleting a note, and editing the task's title or description SHALL NOT produce an entry. Clearing a next-stage intent SHALL NOT produce an entry.

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

### Requirement: Every occurrence is recorded

A settled fact SHALL append an entry every time it happens, including when it repeats the previous entry's content. The record SHALL NOT collapse consecutive duplicate facts.

#### Scenario: A repeated pause is recorded again

- **WHEN** a task is paused by the host for the same reason twice, without any other auto mode change between them
- **THEN** the record gains one entry for each pause

#### Scenario: A repeated stage entry is recorded again

- **WHEN** a task leaves a stage and later enters that same stage again
- **THEN** the record gains an entry for each entry into that stage

### Requirement: A stage entry requires a stage change

An entry for a stage change SHALL be appended only when the task's stage actually changes. A placement within the current stage, a move that is refused or canceled, an automatic advance that fails without moving the task, and renaming a stage SHALL NOT produce a stage entry.

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

### Requirement: The record follows a renamed stage

The record SHALL reference stages by their identifier and resolve their names from the board's current workflow. Renaming a stage identifier SHALL carry that identifier into every entry that references it, preserving each entry's moment, order, and kind. An entry that references a stage the workflow no longer defines SHALL remain present and identifiable.

#### Scenario: A renamed stage reads correctly

- **WHEN** a stage is renamed after a task recorded entries for it
- **THEN** every entry that references that stage presents the new name
- **AND** the entries keep their order and moments

#### Scenario: A reused identifier stays readable

- **WHEN** a stage is renamed to an identifier a removed stage used, so a recorded move names that identifier on both sides
- **THEN** the entry remains in the record with its kind and moment
- **AND** the stored record stays valid

#### Scenario: A removed stage stays identifiable

- **WHEN** an entry references a stage the board's workflow no longer defines
- **THEN** the entry remains in the record and is identifiable as that stage

### Requirement: No history before the feature

A task that has no recorded entry SHALL present an empty record. The plugin SHALL NOT infer, backfill, or invent entries for time before the record existed.

#### Scenario: A task stored before the record existed

- **WHEN** a task with no recorded entry is opened
- **THEN** its record is empty
- **AND** its next settled fact becomes the first entry

### Requirement: History table in the task drawer

The History section SHALL present the record as a table with the columns **When**, **Event**, **Detail**, and **In stage**. The When column SHALL present the moment in the reader's local date and time and SHALL expose the same moment as a machine-readable timestamp. The Event column SHALL name the kind of fact. The Detail column SHALL carry the fact's own detail: the origin and destination for a stage entry, the recorded destination for an intention, the checkout path and branch for a worktree outcome, and the reason for a pause. Rows SHALL be ordered newest first and SHALL present the whole record without a cap, scrolling within the section when it exceeds the available height.

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

### Requirement: Time spent in a stage

The In stage column SHALL present the time between a stage entry and the next later stage entry, and for the most recent stage entry the time since it happened. The value SHALL be refreshed while the section is open. Rows that are not stage entries SHALL present a placeholder instead of a duration.

#### Scenario: Measure a completed stage

- **WHEN** a stage entry is followed by a later stage entry
- **THEN** its In stage value is the time between the two
- **AND** it does not change afterwards

#### Scenario: Measure the current stage

- **WHEN** the most recent stage entry is the task's current stage
- **THEN** its In stage value grows with the time since that entry while the section is open

#### Scenario: A non-stage row shows no duration

- **WHEN** a row presents an auto mode change or a worktree outcome
- **THEN** its In stage cell presents a placeholder rather than a duration

### Requirement: Empty history

A task with no recorded entry SHALL present the History section with a statement that nothing has been recorded yet, and SHALL NOT present an empty table.

#### Scenario: Open a task with no recorded flow

- **WHEN** the user opens the History section of a task with no entries
- **THEN** the section states that nothing has been recorded yet
- **AND** no empty table is presented

### Requirement: History stays out of task tool payloads

Tool payloads that read or list tasks SHALL omit the flow record, so browsing tasks never carries a task's whole history into a model's context.

#### Scenario: List tasks

- **WHEN** a task list is requested through a tool
- **THEN** each returned task omits its flow record

#### Scenario: Read one task

- **WHEN** a single task is requested through a tool
- **THEN** the returned task omits its flow record
