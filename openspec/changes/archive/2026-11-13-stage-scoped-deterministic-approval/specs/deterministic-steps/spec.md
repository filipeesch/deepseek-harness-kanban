# Spec Delta

## MODIFIED Requirements

### Requirement: Immutable execution capture

The host SHALL distinguish an executable version from an execution capture. The executable version SHALL be identified by the exact primary program bytes, the language and program format, the source form and authored source reference, the directory choice, the named routes together with their stable destination identities, the authorized variable names, and the declared parameter names. The executable version SHALL NOT include the resolved execution directory, parameter values, or any entry-local data. Before an executable run is admitted, the host SHALL resolve the selected directory, read and validate the primary external script when applicable, and durably capture the exact executable version together with the resolved execution directory and incoming handoff. The capture SHALL NOT include parameter values: a value belongs to the entry, and the reviewed authority is the declaration, not what one entry supplies. Configuration edits, declaration edits, and changes to the primary file SHALL NOT modify an active or recovering run. Explicit Play SHALL capture the latest configuration and file contents for a new execution in the same stage. The host SHALL distinguish the selected file path from the bytes it actually approved and captured, and SHALL NOT substitute changed bytes during recovery. Every execution SHALL still be admitted only in the directory recorded by its own capture, even when its version was approved through another execution. The product SHALL disclose that imported modules, called executables, and external services are not frozen transitively.

#### Scenario: Edit an active stage

- **WHEN** the user saves corrected script text or routes while a run remains active
- **THEN** the saved workflow changes but that run continues with its captured version
- **AND** the interface indicates that Play is required to apply the new version

#### Scenario: Recover after the file changed

- **WHEN** the host restarts an active run whose original external file was subsequently modified
- **THEN** it executes the captured primary script bytes and routes, not the changed file

#### Scenario: Missing capture cannot be reconstructed safely

- **WHEN** a recovering run's captured program is missing or corrupt
- **THEN** recovery stops with a diagnostic rather than reading a newer primary script and executing it under the old approval

#### Scenario: A declaration edit does not alter an active run

- **WHEN** the saved stage gains or removes a declared parameter name while a run remains active
- **THEN** that run keeps its captured declaration and values
- **AND** the saved edit applies to the next captured version

#### Scenario: Reuse one approved version across task directories

- **WHEN** two entries of the same board and stage resolve the same program bytes and reviewed capabilities from different task directories
- **THEN** both executions use the same executable version
- **AND** each execution is admitted only in the directory recorded by its own capture

#### Scenario: A directory change alone does not create a version

- **WHEN** a task's execution directory changes without any change to the program or reviewed capabilities
- **THEN** the executable version identifier is unchanged
- **AND** an execution whose recorded directory no longer matches the task is rejected instead of running in the new directory

### Requirement: Local executable trust

An executable version SHALL require explicit local approval after review of the exact primary program, language and program format, source form and authored source reference, directory choice, named routes and their destinations, declared parameter names, and authorized variable names. Parameter values, the resolved execution directory, and entry-local data SHALL NOT be part of the approved version. Approval SHALL be recorded for the board and the stable stage identity, independent of project: one approval SHALL authorize every project the board allows and every future card of that stage whose execution resolves to the same executable version. A change to any reviewed input, including the bytes read from an external primary file, SHALL create a new executable version and require exactly one new approval. Editing an entry's parameter values or changing the directory in which a task runs SHALL NOT invalidate an approval. Approval SHALL be local to the installation and SHALL NOT be granted by saving, publishing, accepting a shared workflow, or by tool-originated writing. Repeated entries, repeated executions, and restart recovery of an approved executable version SHALL NOT request approval again. Withholding approval SHALL leave the task in its current stage without executing code. Trust SHALL NOT bypass native filesystem or execution policy and SHALL NOT claim to freeze dependencies outside the captured program. An installation holding approvals recorded before the stage-scoped model SHALL NOT reuse them: after the upgrade each stage SHALL request one approval, and obsolete approval records MAY be discarded.

#### Scenario: Receive executable YAML from the team

- **WHEN** a shared update introduces or changes a deterministic script
- **THEN** accepting the update does not authorize it locally
- **AND** the next requested execution waits for approval of the captured executable version

#### Scenario: Recover an approved execution

- **WHEN** the host restarts a run with the same executable version and a valid local approval
- **THEN** it does not ask for the same approval again

#### Scenario: Change a primary file between review and launch

- **WHEN** the source file changes after the user reviews its captured contents
- **THEN** the launch uses the reviewed captured bytes or requires another approval
- **AND** it never launches changed bytes under the earlier approval

#### Scenario: Change a declared parameter name requires a new approval

- **WHEN** the saved declaration adds or removes a parameter name after the executable version was approved
- **THEN** the next execution requires a new local review
- **AND** changing only a value for an approved version does not

#### Scenario: Approve once for every project of the board

- **WHEN** the same approved executable version is executed by cards in two projects the board allows
- **THEN** neither project requests approval again
- **AND** each project still resolves its own local variable values

#### Scenario: A different worktree does not request approval again

- **WHEN** a second card enters the same stage with a different execution directory and the same executable version
- **THEN** the card starts without a new approval request

#### Scenario: An approved version is requested only once per change

- **WHEN** the saved program changes while several cards wait in the stage
- **THEN** the stage is unapproved once
- **AND** one approval satisfies every card whose execution resolves to that changed version

#### Scenario: An upgrade does not reuse a project-scoped approval

- **WHEN** the installation holds an approval recorded before the stage-scoped model
- **THEN** the stage requests one approval
- **AND** the old record neither authorizes nor blocks execution

### Requirement: Local variables isolated by project and stage

Explicit execution variables SHALL be configured independently for each local project-and-stage pair using the host credential mechanism. Stable stage identity SHALL keep that scope intact across a stage identifier rename; another project or stage SHALL NOT inherit its variables. A deterministic definition SHALL list only the variable names that run is authorized to access, not their values. TypeScript and Bash execution SHALL enforce the same authorized set without implicitly exposing other installation credentials. Resolved values SHALL remain outside shared YAML, task input metadata, run snapshots, and ordinary client projections. Configured and missing state SHALL be presented on a dedicated local-variables surface for the selected project and stable stage, separate from the executable-version review; the review SHALL NOT present project variable values or their configured or missing state. Configuration UI SHALL show configured/missing status without reading stored values back to the browser. An unavailable native credential provider or missing explicitly required variable SHALL report an actionable diagnostic rather than silently widening access or substituting an unrelated credential. A recovering process SHALL resolve authorized values again rather than persisting secret values for replay.

#### Scenario: Separate two projects using the same stage
- **WHEN** the same workflow stage runs for tasks in two projects with different local values
- **THEN** each run receives only its own project-and-stage values for the authorized names

#### Scenario: Separate two stages in one project
- **WHEN** one stage has a configured token but another stage has no value for that name
- **THEN** the second stage does not inherit the first stage's token

#### Scenario: Restart after credential rotation
- **WHEN** an active run is recovered after an authorized variable's local value has changed
- **THEN** the replacement process resolves the current value for the same authorized name
- **AND** the old secret was not recovered from a run snapshot

#### Scenario: Configure values away from the review
- **WHEN** a user needs to supply multiple values for the project and stage
- **THEN** the local-variables surface stores them without opening or repeating the executable-version review
- **AND** the review neither displays nor edits those values

#### Scenario: Review a version of a project with missing values
- **WHEN** a project the board allows lacks a required local variable
- **THEN** the executable-version review still presents only the executable version
- **AND** the missing variable is reported on that project's local-variables surface and on the task that fails because of it

### Requirement: Stop and Play on the current stage

The card and drawer SHALL provide Stop for an active deterministic execution and Play for a stopped, failed, or not-yet-started deterministic entry whose latest saved configuration is still deterministic. The durable entry and its captured control state, not the latest saved execution mode, SHALL determine whether an existing run is deterministic. An entry awaiting approval SHALL NOT present Stop or Play: it SHALL present the approval action defined for that executable version, and moving the card away SHALL revoke the waiting entry without executing code. Saving an agent or manual mode SHALL NOT hide Stop, arm an agent instruction, or let a completed conversation turn bypass that run. If the latest saved mode is no longer deterministic, Play SHALL not silently execute the old code or start an agent; the interface SHALL explain that valid deterministic configuration or a genuine stage change is required. Play SHALL revalidate the entry's values against the declaration captured for that new execution and SHALL fail in the stage when a declared name has no value, leaving the entry available for editing. Stop SHALL durably revoke the active run before requesting cancellation of its TypeScript/Bash program and owned Bash children, SHALL leave the task in its current stage, and SHALL neither follow an exit nor generate an error-route handoff. A successful Stop SHALL remain effective after restart. Play SHALL create a new execution identity and start time in the same stage, capture the latest configuration, and perform any required approval. Approving a waiting entry SHALL resume that same captured execution instead of creating a new one. Play SHALL NOT move the task merely to begin execution, but a subsequent completed result SHALL follow its configured route normally. There SHALL be no dry-run behavior implied by Play. A new run SHALL NOT overlap an owned predecessor whose termination has not been confirmed.

#### Scenario: Stop during sleep or an external command

- **WHEN** Stop is admitted while the script is sleeping or awaiting Bash
- **THEN** the run is recorded as stopped and its owned processes are cancelled
- **AND** a late completion cannot move the card or produce a handoff

#### Scenario: Correct and reexecute without changing stages

- **WHEN** the user stops or encounters a failed execution, edits the stage, and presses Play
- **THEN** a new execution starts in the same stage with the corrected captured version and a new start time
- **AND** a completed result can then follow its named route

#### Scenario: Preserve stopped state across restart

- **WHEN** the host restarts with a stopped run
- **THEN** the task remains stopped until explicit Play or another new stage entry

#### Scenario: Do not undo an already admitted transition

- **WHEN** a stale Stop request arrives after the source run's result has already admitted its transition
- **THEN** it is rejected as stale rather than undoing the move or stopping a different run

#### Scenario: Change the saved mode while a script still owns the entry

- **WHEN** the user saves an agent or manual mode while the current entry owns a deterministic run
- **THEN** its captured run remains supervised and Stop remains available until that run is stopped or settled
- **AND** the new saved mode does not start an agent or enable incidental turn-driven movement
- **AND** after Stop, Play cannot start a different execution kind implicitly

#### Scenario: Play revalidates a changed declaration

- **WHEN** the saved declaration gained a parameter name after the entry was created and the entry has no value for it
- **THEN** Play does not start the program and the card names the missing name
- **AND** filling the value before Play admits the new execution

#### Scenario: Awaiting approval offers neither Stop nor Play

- **WHEN** an entry is waiting for approval of its executable version
- **THEN** its card and drawer present the approval action instead of Stop or Play
- **AND** no program is launched

#### Scenario: Approval resumes the waiting execution

- **WHEN** the user approves the executable version of a waiting entry
- **THEN** that same captured execution starts without a new execution identity or start time

### Requirement: Truthful execution controls and diagnostics

Cards and drawers SHALL distinguish awaiting approval, active, stopping, stopped, failed, result-awaiting-delivery, and a parameter refusal without reporting a running agent when no conversation is running. The interface SHALL display the executable version and whether a saved edit requires Play, the relevant failure, and the applicable control with accessible names and action-local progress. An entry awaiting approval SHALL present its approval state, the executable version, and the action that opens the review, and SHALL NOT present Stop or Play for that entry. The executable-version review SHALL present the exact primary program with syntax highlighting for its language and every reviewed capability. The review SHALL NOT present project variable values or their configured or missing state. A failed execution SHALL present its failure origin, its root-cause code, and the number of attempts it made, in the card's script panel and in the task's history detail. The persisted and displayed diagnostic SHALL carry, bounded and redacted, the facts the host observed: the guard's exit status and terminating signal, the received output sizes and bounded beginning, the bounded end of its diagnostic stream, and whether the command was admitted. An infrastructure or configuration diagnostic SHALL NOT present a stack trace or a local filesystem path in the message delivered to a destination stage; the detailed facts SHALL remain available through the task's history. For an entry whose stage declares parameters, the card and drawer SHALL show the entry's parameter values read-only and SHALL offer parameter editing whenever the entry exists and its execution is not active or stopping. It SHALL present a parameter refusal as a recoverable configuration problem that offers both Play and editing, distinct from an executor failure. Available diagnostics SHALL be bounded and SHALL not add one task-history row per polling iteration or per retried call. The host SHALL avoid logging resolved variable values and redact known secret values from persisted/displayed diagnostics, their detailed facts, and handoff messages; documentation SHALL explain that arbitrary user code can transform or disclose secrets and that redaction is not a complete data-loss-prevention boundary. Parameter values SHALL be presented as task data and SHALL NOT be treated as secrets. Secret values SHALL NOT appear in ordinary snapshots or verification evidence. Switching panels or closing the browser SHALL not stop a host-owned active script.

#### Scenario: Observe a sleeping script without an agent

- **WHEN** a deterministic script is active while no conversation is running
- **THEN** the card identifies script execution and offers Stop without falsely claiming an agent turn is active

#### Scenario: Inspect an executor failure

- **WHEN** an execution fails
- **THEN** the card and drawer expose the failure origin, the root-cause code, the attempt count, and the appropriate recovery action without a global board-saving indicator

#### Scenario: Inspect why the guard failed without reproducing it

- **WHEN** a guarded Bash call fails and the user opens the script panel or the task history
- **THEN** the recorded facts identify whether the command was admitted, the guard's exit status or signal, and the bounded end of its diagnostic stream
- **AND** those facts are redacted before they are persisted or displayed

#### Scenario: Keep infrastructure noise out of the next stage

- **WHEN** an infrastructure failure is delivered to a destination stage
- **THEN** the delivered message states the origin, the attempt count and where the detail lives
- **AND** it contains no stack trace and no local filesystem path

#### Scenario: Keep secrets out of diagnostics

- **WHEN** captured output contains an exact resolved secret value known by the host
- **THEN** that value is redacted before diagnostic or handoff persistence and display
- **AND** tests and screenshots contain no real credentials

#### Scenario: Repair values from a failed entry

- **WHEN** an entry failed for a missing parameter and the user opens the script panel
- **THEN** the panel presents the failure, Play, and the parameter editing action
- **AND** it presents the entry's current values read-only until the user edits them

#### Scenario: Present awaiting approval without an execution control

- **WHEN** an entry is waiting for approval
- **THEN** the card and drawer present the approval state and the review action
- **AND** neither presents Stop or Play for that entry
- **AND** no agent turn is reported

#### Scenario: Highlight the reviewed program

- **WHEN** the review presents the exact primary program
- **THEN** the program is presented with syntax highlighting for its language
- **AND** the highlighted text is the captured program rather than a live read of the source file

## ADDED Requirements

### Requirement: Stage-scoped approval request

A pending executable-version approval SHALL be a board-and-stage fact shared by every entry of that stage that resolves to the same executable version. The host SHALL present one pending approval for that board, stage, and executable version rather than one request per card. The pending approval SHALL be presented on the waiting card, in a board queue, and in the stage editor. Approving SHALL resume every waiting entry of that board, stage, and executable version whose captured execution context is still valid, and SHALL leave the others waiting with their own state. An approval SHALL be rejected with an actionable diagnostic when the stage's executable version changed after the review; the user SHALL review the current version. Saving a workflow, accepting a shared update, publishing a board, or writing through a tool SHALL NOT approve an executable version. The host SHALL NOT approve an executable version automatically after a timeout or a restart. The product SHALL NOT present a separate revocation action: changing a reviewed input is what requests a new approval.

#### Scenario: Share one approval with waiting cards

- **WHEN** several cards of the same board and stage wait for the same executable version
- **THEN** the board presents one pending approval for that version
- **AND** approving it resumes every waiting entry whose execution context remains valid

#### Scenario: Approve from a waiting card

- **WHEN** the user activates the approval action on a waiting card and approves the current version
- **THEN** that card's execution starts
- **AND** every other card waiting for the same version also starts

#### Scenario: Approve from the board queue

- **WHEN** the user approves a queued stage version
- **THEN** the queue removes that item once no card remains waiting for it
- **AND** the approval applies to every project the board allows

#### Scenario: Approve before the first card enters

- **WHEN** the stage editor approves the stored executable version before any card enters the stage
- **THEN** the next entry of that stage starts without an approval request
- **AND** no card, conversation, worktree, or execution is created by the approval

#### Scenario: Reject an approval for a replaced version

- **WHEN** the executable version changes while the review is open and the user submits the approval
- **THEN** the approval is rejected
- **AND** the interface asks the user to review the current version
- **AND** no code runs under the earlier review

#### Scenario: Saving or publishing does not approve

- **WHEN** the user saves the stage, accepts a shared update, publishes the board, or writes the stage through a tool
- **THEN** the executable version is not approved
- **AND** the next execution still waits for approval

#### Scenario: A relative source that resolves different bytes per directory

- **WHEN** the primary source is an external file resolved relative to a task or project directory and two directories produce different primary bytes
- **THEN** each resolved result is its own executable version and needs its own approval
- **AND** the stage editor approves only the version it can resolve from the authored configuration and reports the remaining versions as needing approval when they are captured

### Requirement: Executable version review

The executable-version review SHALL present the exact primary program, the language and program format, the source form and authored source reference, the directory choice, the named routes and their destinations, the declared parameter names, the authorized variable names, and the executable version identifier. When the review is bound to a captured execution it SHALL also present that execution's resolved directory as an execution fact, not as part of the approved version. The review SHALL NOT present project variable values or their configured or missing state. Requesting a review SHALL NOT store anything, execute code, create a conversation or worktree, or change the workflow. A review of a version resolved from the authored configuration SHALL be identified as not yet captured and SHALL NOT authorize any other captured version.

#### Scenario: Review a captured execution from a card

- **WHEN** a waiting card opens the review
- **THEN** it presents the exact captured program and reviewed capabilities
- **AND** it presents the captured execution's resolved directory as context
- **AND** it presents no project variable values

#### Scenario: Review the authored version without a capture

- **WHEN** the stage editor opens the review before any entry exists
- **THEN** it presents the version resolved from the authored configuration
- **AND** it identifies the version as not yet captured
- **AND** approving it does not execute code or create an entry

#### Scenario: Review reveals no stored secrets

- **WHEN** the reviewed version authorizes local variable names
- **THEN** the review presents only those names
- **AND** it never returns a stored value to the browser
