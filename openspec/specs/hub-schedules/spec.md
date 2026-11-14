# hub-schedules Specification

## Purpose

Lets a Hub run recurring native sessions on a cron schedule, with a prompt, a model, and a
project workspace configured once and executed unattended by the host.

## Requirements

### Requirement: Hub-scoped schedule definition

A schedule SHALL belong to exactly one Hub. A schedule SHALL consist of a nonempty title, a
nonempty prompt, a five-field cron expression, an IANA time zone, and a target project registered
in that same Hub. A schedule SHALL also carry an optional model selection, a new-conversation
option defaulting to enabled, an archive-when-idle option defaulting to enabled, and an enabled
option defaulting to enabled. A schedule SHALL NOT reference a project from another Hub, a task,
or a worktree. Saving a schedule SHALL validate its fields before durably recording it, and a
failed validation SHALL leave the stored collection unchanged and report the failure.

#### Scenario: Save a valid schedule
- **WHEN** the user saves a schedule with a title, a prompt, a valid cron expression and time zone, and a project in the selected Hub
- **THEN** the schedule is stored for that Hub and listed in its Schedules section
- **AND** no native session, task, or run is created by the save itself

#### Scenario: Reject a schedule without a prompt
- **WHEN** the user saves a schedule whose prompt is empty or only whitespace
- **THEN** the save is rejected with a message identifying the prompt
- **AND** the stored schedule collection is unchanged

#### Scenario: Reject a project from another Hub
- **WHEN** the user saves a schedule whose target project does not belong to the schedule's Hub
- **THEN** the save is rejected and no schedule is stored

#### Scenario: Keep schedules after a restart
- **WHEN** the host restarts with a stored enabled schedule
- **THEN** the schedule is listed with the same identity, fields, and enabled state

### Requirement: Schedules configuration surface

The Kanban configuration SHALL offer a Schedules section whenever a Hub is selected. That section
SHALL list the selected Hub's schedules, showing for each one its title, its cron description, its
next occurrence, its target project, its model or the host default, whether it is enabled, and its
last run summary. The section SHALL provide a creation action and, for each schedule, edit, enable or
pause, delete, and run-now actions. Create and edit SHALL use one overlay editor that exposes every
schedule field and shows validation failures inline.

The editor SHALL present the schedule's model as an explicit choice between the host default and a
specific model. A specific model SHALL be chosen with the host's native model selector, the same
selector DSH composes for a conversation's input, and SHALL offer the reasoning efforts that selector
reports. Choosing the host default SHALL store no model for the schedule. When the running host does
not compose the native model selector, the editor SHALL present the schedule's stored model read-only
together with a statement that the selector is unavailable, and SHALL NOT remove or rewrite it. When
the host catalog cannot be read, the selector SHALL report the failure and offer a retry, and the
stored model SHALL remain presented. A specific choice with no model selected SHALL prevent saving
and SHALL explain what is missing.

Deleting a schedule SHALL require explicit confirmation. The Schedules section SHALL state when no Hub
is selected, and the editor SHALL prevent saving while a required field is invalid. A new schedule
SHALL start enabled, with a new conversation per run and archiving enabled, using the browser's time
zone.

#### Scenario: Open the Schedules section

- **WHEN** the user opens Kanban configuration with a Hub selected
- **THEN** the Schedules section is available and lists that Hub's schedules only

#### Scenario: Choose a model with the native selector

- **WHEN** the user chooses a specific model in the schedule editor
- **THEN** the host's native model selector presents the catalog routes and their reasoning efforts
- **AND** the chosen route is saved with the schedule

#### Scenario: Keep the host default model

- **WHEN** the user chooses the host default in the schedule editor and saves
- **THEN** the schedule stores no model of its own
- **AND** its occurrences use the deployment default

#### Scenario: Present the stored model when the selector is unavailable

- **WHEN** the running host does not compose the native model selector for a schedule that stores a model
- **THEN** the editor presents the stored model read-only with a statement that the selector is unavailable
- **AND** the stored model is not removed or rewritten

#### Scenario: Validate the model against the catalog

- **WHEN** the catalog is available and the editor selects a model that is not in it
- **THEN** saving is refused with a message asking for a catalog model or the host default

#### Scenario: Require a model for a specific choice

- **WHEN** the user chooses a specific model without selecting a route
- **THEN** saving is unavailable and the editor explains what is missing

#### Scenario: Create a schedule in the overlay

- **WHEN** the user submits a valid schedule from the creation overlay
- **THEN** the schedule appears in the list and the overlay closes

#### Scenario: Start a new schedule from defaults

- **WHEN** the user opens the creation overlay
- **THEN** the schedule starts enabled, with a new conversation per run and archiving enabled
- **AND** the time zone defaults to the browser's time zone

#### Scenario: Show validation inline

- **WHEN** the user submits an invalid cron expression
- **THEN** the overlay reports the invalid expression and stays open without saving

#### Scenario: Confirm deletion

- **WHEN** the user requests deletion of a schedule
- **THEN** a confirmation naming the schedule is shown before anything is removed
- **AND** cancelling the confirmation leaves the schedule unchanged

#### Scenario: Keep a paused schedule paused when edited

- **WHEN** the user edits a paused schedule and saves
- **THEN** the saved schedule remains paused

### Requirement: Cron expression contract

A schedule SHALL use a five-field cron expression ordered as minute, hour, day of month, month,
and day of week, evaluated in the schedule's explicit UTC or IANA Area/Location time zone; numeric
offset identifiers SHALL be rejected. The expression SHALL accept wildcards, single values, lists,
inclusive ranges, step values, three-letter month and weekday names, and the symbolic expressions
`@hourly`, `@daily`, `@midnight`, and `@weekly`. When both the day-of-month and the day-of-week
fields are restricted, including an explicit full range such as `1-31`, an occurrence SHALL match
either field rather than both. The editor SHALL show a
plain-language description of the expression and a preview of the next three occurrences. The
editor SHALL offer hourly, daily, weekly, and manual quick choices; the first three fill the
expression and the manual choice leaves the expression editable. An
expression that is malformed, has an unsupported field count, or has a value outside its field
range SHALL be rejected with an actionable message. An occurrence whose local time does not exist
because of a daylight-saving transition SHALL be skipped for that date, and an occurrence whose
local time exists twice SHALL be consumed once at the earlier instant.

#### Scenario: Describe a manual expression
- **WHEN** the user types the expression `*/3 * * * *`
- **THEN** the editor describes it as running every three minutes
- **AND** the preview shows the next three occurrences in the schedule's time zone

#### Scenario: Fill the expression from a preset
- **WHEN** the user chooses the daily quick choice
- **THEN** the editor fills a daily cron expression and shows its description
- **AND** the user can still edit the expression manually

#### Scenario: Reject an out-of-range field
- **WHEN** the user types an expression whose minute field is `61`
- **THEN** the editor reports the invalid field and the schedule is not saved

#### Scenario: Match either restricted day field
- **WHEN** a schedule uses `0 0 1-31 * MON`
- **THEN** it fires on every day, because the full-range day-of-month still matches

#### Scenario: Reject a numeric offset time zone
- **WHEN** the user enters `+01:00` as the time zone
- **THEN** the editor reports that an explicit UTC or Area/Location zone is required

#### Scenario: Skip a non-existent local time
- **WHEN** a daily occurrence falls in the daylight-saving gap of its time zone
- **THEN** that date produces no occurrence and the following date follows the expression

#### Scenario: Consume the earlier repeated local time
- **WHEN** a daily occurrence falls in a repeated daylight-saving hour of its time zone
- **THEN** the occurrence runs once at the earlier instant and does not run again at the later one

### Requirement: Occurrence setup

When a due occurrence is admitted, the host SHALL resolve the schedule's project, use that
project's native workspace, and create a native conversation in it unless the schedule uses a
continuous conversation. For a new conversation the host SHALL create one session for that
occurrence. For a continuous schedule it SHALL reuse the session already bound to the schedule only
while that binding names the same project and the session's recorded directory still passes native
directory admission; otherwise it SHALL create and bind a fresh conversation. Immediately before
sending, the host SHALL reject a project relocation and recheck the project identity and the
conversation directory. The host SHALL apply the schedule's model selection to that session
before sending the prompt, SHALL attempt to set a conversation title derived from the schedule
title and the occurrence time, SHALL continue with the host-provided title when no title service
is available, and SHALL then send the prompt once. An occurrence SHALL NOT create, move, edit,
or archive a task, board, workflow, note, or worktree. While it runs, the conversation SHALL be
present in the project's native workspace. If the stored model is unavailable, the occurrence
SHALL fail before sending any prompt, record the failure, and archive the session it created for
that occurrence.

#### Scenario: Create the conversation for one occurrence
- **WHEN** a due occurrence of a schedule using a new conversation per run is admitted
- **THEN** one session is created in the target project's native workspace
- **AND** exactly one prompt carrying the schedule prompt is sent to it
- **AND** no task or worktree is created or changed

#### Scenario: Reuse the continuous conversation
- **WHEN** a due occurrence of a schedule with a continuous conversation is admitted twice and the project and directory are unchanged
- **THEN** both prompts are sent to the same session
- **AND** only the first admitted occurrence creates that session

#### Scenario: Rebind a continuous conversation after the target changed
- **WHEN** a continuous schedule is repointed to another project or its recorded conversation directory no longer passes admission
- **THEN** the occurrence creates and binds a fresh conversation in the project's directory
- **AND** the previous conversation is left untouched

#### Scenario: Refuse a relocated project before sending
- **WHEN** the schedule's project is relocating or its path changed before the prompt was sent
- **THEN** the occurrence fails before sending and records the failure

#### Scenario: Fail on an unavailable model
- **WHEN** the schedule's stored model is no longer available in the host catalog
- **THEN** the occurrence fails without sending a prompt
- **AND** the failure is recorded for that schedule

### Requirement: Session-only model selection

Selecting a model for a schedule SHALL apply it only to the conversation the occurrence created or
reused. It SHALL NOT change the installation's default model for new conversations, and the host
SHALL NOT write to that default on the schedule's behalf. When the host exposes no surface that
selects a model for one conversation without persisting the default, the occurrence SHALL fail
before sending any prompt and record the failure; the host SHALL NOT fall back to an entry point
that persists the default. A model absent from the current catalog SHALL fail the same way. The
editor SHALL validate the stored selection against the catalog when the catalog is available, and
SHALL preserve the selected reasoning effort through an edit.

#### Scenario: Apply only to the conversation
- **WHEN** a schedule with a model runs while the installation default is another model
- **THEN** the conversation uses the schedule's model
- **AND** the installation default is unchanged

#### Scenario: Fail closed without session-scoped selection
- **WHEN** the host cannot select a model for one conversation without changing the installation default
- **THEN** the occurrence fails before sending and records the failure
- **AND** the installation default is unchanged

#### Scenario: Preserve reasoning effort through an edit
- **WHEN** the user edits an unrelated schedule field and saves
- **THEN** the stored model keeps its provider, model, and reasoning effort

### Requirement: Execution admission

The host SHALL run an occurrence only while the host process is running and only for an enabled
schedule. An occurrence due while the host was not running SHALL NOT be replayed; the schedule
SHALL continue from its next future occurrence. An occurrence due while the previous run of the
same schedule is still being dispatched SHALL be skipped and SHALL NOT be queued; a dispatch is
active from admission until its prompt is admitted, and an already-admitted model turn MAY still
be running when a later occurrence is admitted. Admission SHALL reserve the schedule and persist a
running marker before any native side effect, and SHALL refuse a duplicate admission. The next
occurrence shown for a schedule SHALL always be in the future relative to the moment it is
computed. Different schedules MAY run concurrently. A run-now request SHALL use the same execution path as a
scheduled occurrence, SHALL be rejected while that schedule is already running, and SHALL NOT
change the schedule's next scheduled occurrence.

#### Scenario: Skip an occurrence missed while the host was closed
- **WHEN** the host starts after several occurrences of a schedule have passed
- **THEN** no missed occurrence is executed
- **AND** the schedule waits for its next future occurrence

#### Scenario: Skip an overlapping dispatch
- **WHEN** a second occurrence becomes due before the previous dispatch of the same schedule finishes
- **THEN** the second occurrence is skipped and nothing is queued for it

#### Scenario: Admit the next occurrence after the previous prompt was admitted
- **WHEN** the previous occurrence's prompt was admitted and its model turn is still running
- **THEN** the next occurrence is admitted when due

#### Scenario: Do not create a session before the running marker is durable
- **WHEN** the host fails to persist the running marker
- **THEN** no session is created and no prompt is sent
- **AND** the admission slot is released

#### Scenario: Run now on a saved schedule
- **WHEN** the user requests run-now for an enabled schedule that is not running
- **THEN** the run executes through the normal occurrence path
- **AND** the schedule's next scheduled occurrence is unchanged

#### Scenario: Refuse a second run-now
- **WHEN** the user requests run-now while that schedule is already running
- **THEN** the request is rejected and the running occurrence is unaffected

### Requirement: Session archiving after a run

A schedule SHALL support archiving the conversation it created once that conversation is idle. The
option SHALL default to enabled and SHALL apply only to sessions created for a single occurrence.
The host SHALL archive such a session only when it has no running turn, no pending question or
approval (including a plugin structured question), no queued prompt, and no background job or
subagent activity. An observation that arrives while an evaluation is in progress SHALL cause a
coalesced reevaluation rather than being dropped. A session with pending interaction SHALL remain
visible and SHALL be archived later, when it becomes idle after a subsequent settled turn. A
conversation of a continuous schedule SHALL never be archived by the schedule. A conversation
created for a failed occurrence SHALL be archived when it satisfies the same idle conditions. A
failed archive SHALL be recorded on the run it belongs to, SHALL NOT overwrite a newer last run,
and SHALL NOT fail the run. An archived conversation SHALL be reopenable from the schedule's last
run, including a failed run.

#### Scenario: Archive an idle conversation
- **WHEN** an occurrence's turn ends with no pending interaction and no background activity
- **THEN** the conversation is archived after the turn settles

#### Scenario: Keep a conversation awaiting an answer
- **WHEN** an occurrence's turn ends while a question or approval is pending
- **THEN** the conversation stays visible
- **AND** it is archived after the later turn that clears the pending interaction settles

#### Scenario: Record a failed archive without failing the run
- **WHEN** archiving an idle conversation is refused after a sent occurrence
- **THEN** the last run keeps its sent outcome and records the archive failure
- **AND** a later success clears that recorded failure

#### Scenario: Reevaluate after an observation during evaluation
- **WHEN** an idle observation arrives while the watcher is still awaiting an earlier facts read
- **THEN** the watcher reevaluates and archives the idle conversation

#### Scenario: Never archive a continuous conversation
- **WHEN** a continuous schedule finishes a turn with archiving enabled in its stored options
- **THEN** the conversation remains visible

#### Scenario: Reopen the last run
- **WHEN** the user opens the last run of a schedule whose conversation is archived
- **THEN** the conversation is unarchived and opened when the host exposes session navigation

### Requirement: Run results and visibility

The host SHALL record, for each schedule, the most recent run's completion time, outcome
(sent or failed), failure reason, and conversation identity. The Schedules section SHALL show that
last run and SHALL show a running indicator while an occurrence or run-now of that schedule is in
progress. A failed occurrence SHALL NOT pause, disable, or delete the schedule. A configuration
that cannot run, such as a missing project directory or an unavailable model, SHALL be recorded as
that run's failure. The last run SHALL survive a host restart.

#### Scenario: Record a delivered prompt
- **WHEN** an occurrence sends its prompt successfully
- **THEN** the schedule's last run records the completion time, the sent outcome, and the conversation identity
- **AND** the running indicator clears

#### Scenario: Keep a failing schedule enabled
- **WHEN** an occurrence fails because its project directory is unavailable
- **THEN** the failure is recorded with its reason
- **AND** the schedule remains enabled and keeps its next occurrence

#### Scenario: Show the running indicator
- **WHEN** an occurrence of a schedule is in progress
- **THEN** the schedule's row shows that it is running

#### Scenario: Keep the last run after a restart
- **WHEN** the host restarts after a failed run
- **THEN** the schedule still reports that failure as its last run

### Requirement: Local persistence and lifecycle

Schedules and their run results SHALL be local to the installation. They SHALL NOT be included in
the Hub's published team document, and publishing or receiving a team configuration SHALL NOT
create, modify, or remove a schedule. Recording a completed run SHALL NOT change the Hub's
durable revision, so an open configuration editor is not invalidated by a run that finishes in the
background. Deleting a schedule SHALL cancel its future occurrences, SHALL remove its
configuration and run results, and SHALL keep the native conversations it already created; deleting
the last schedule SHALL remove the optional schedule collection from the Hub so an older strict
schema can parse it again. A late write from an in-flight occurrence SHALL NOT resurrect a deleted
schedule's runtime, and startup SHALL prune runtime whose schedule or Hub no longer exists. A
project that a schedule targets SHALL NOT be deletable until that schedule is deleted or repointed.
Disabling the plugin SHALL stop admitting occurrences and SHALL NOT create or send another
occurrence after disposal.
Deleting a Hub SHALL remove its schedules and cancel their occurrences while keeping their native
conversations. A stored Hub created before this capability SHALL load unchanged with no schedules.

#### Scenario: Never publish schedules
- **WHEN** a Hub with schedules is published to team storage
- **THEN** the published document contains no schedule data

#### Scenario: A finished run does not conflict with an open editor
- **WHEN** a run finishes while a user has a configuration editor open
- **THEN** the editor can still save without a revision conflict caused by the run

#### Scenario: Block deleting a schedule's project
- **WHEN** the user requests deleting a project that a schedule in the same Hub targets
- **THEN** the deletion is rejected and the plugin asks to delete or repoint the schedule first

#### Scenario: Delete a schedule
- **WHEN** the user confirms deleting a schedule
- **THEN** no further occurrence runs for it
- **AND** the native conversations it already created remain available
- **AND** a late write from an in-flight occurrence does not restore its runtime record

#### Scenario: Delete the last schedule restores the older shape
- **WHEN** the user deletes the last schedule of a Hub
- **THEN** the Hub no longer stores a schedule collection

#### Scenario: Stop after disposal
- **WHEN** the plugin is disabled while an occurrence is preparing its conversation
- **THEN** no further session is created and no further prompt is sent
- **AND** the admitted execution is drained before run storage closes

#### Scenario: Delete a Hub with schedules
- **WHEN** the user deletes a Hub that owns schedules
- **THEN** the schedules are removed and their pending occurrences are cancelled
- **AND** their native conversations remain available

#### Scenario: Load a Hub stored before schedules existed
- **WHEN** a Hub persisted without a schedule collection is loaded
- **THEN** it loads unchanged with no schedules and behaves as before
