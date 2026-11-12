# deterministic-steps Specification

## Purpose
Lets a workflow stage wait for external conditions using repeatable Bash or TypeScript code without a model turn, recover its execution after a host restart, and deliver a named outcome and message to the next stage.

## Requirements

### Requirement: Deterministic stage definition
A workflow SHALL support a deterministic stage configured with a language of Bash or TypeScript, exactly one nonempty inline script or external file path, a working-directory choice of task or base project, a mapping of named exits to existing stages, an optional list of authorized environment-variable names, and an optional ordered list of declared parameters. A declared parameter SHALL have a unique safe name and an optional nonempty description, and SHALL NOT carry a value. The default directory SHALL be the task's effective project directory, inside its worktree when one is bound and otherwise the base-project directory. A deterministic stage SHALL NOT also configure a nonempty agent entry instruction or a second allowed-transition list. Its exit mapping SHALL be the authoritative set of configured destinations; distinct exits MAY name the same destination, but an exit SHALL NOT target the source stage. A deterministic stage that declares parameters SHALL be accepted as the workflow's initial stage and as an exit or transition destination. Reexecution in the current stage SHALL use Play rather than a self-transition. Existing workflows without deterministic configuration SHALL retain their behavior. Saving invalid configuration SHALL fail without changing the stored workflow.

#### Scenario: Configure either supported language and source form

- **WHEN** a user saves a deterministic stage with Bash or TypeScript and exactly one inline script or external file path
- **THEN** the workflow stores that configuration and its named exit routes
- **AND** neither saving the configuration nor opening the editor executes the script

#### Scenario: Reject conflicting execution and routing definitions

- **WHEN** a deterministic stage also supplies an agent entry instruction, an allowed-transition list, both script source forms, or a self-targeting exit
- **THEN** saving fails with a diagnostic identifying the conflicting field
- **AND** the previous workflow remains unchanged

#### Scenario: Validate exit destinations

- **WHEN** an exit points to a stage that does not exist
- **THEN** the workflow is rejected before it can be activated

#### Scenario: Select the base project explicitly

- **WHEN** a task has a worktree but its stage selects the base-project directory
- **THEN** script execution and relative external-script paths use the base-project directory
- **AND** the input context still identifies the task's worktree separately

#### Scenario: Accept a parameterized stage as initial stage or destination

- **WHEN** a workflow marks a stage that declares parameters as its initial stage, or an exit or transition targets that stage
- **THEN** saving succeeds and the workflow keeps that composition
- **AND** no entry is started merely because the composition is stored
### Requirement: Repeatable program execution without a model
A deterministic stage SHALL execute code outside the plugin's main process without creating a conversation, selecting a model, or starting a model turn for that execution. Bash and TypeScript scripts SHALL own their polling loops, sleep intervals, and business deadlines. The host SHALL NOT replace those loops with per-poll scheduling or impose the chat runtime's short-call deadline on the entire wait. The host SHALL supervise cancellation and bounded diagnostic/resource handling separately from the script's business deadline. TypeScript SHALL expose only bash from the DSH tool surface, callable as tools.bash, and SHALL support asynchronous function-body evaluation with top-level await and return. External TypeScript files SHALL use the same program format as inline TypeScript. Other DSH/MCP tools and model invocations SHALL NOT be injected. The documented contract SHALL require scripts to perform repeatable checks; the product SHALL NOT claim that arbitrary Bash or TypeScript is provably read-only.

#### Scenario: Wait inside the script
- **WHEN** a script checks an external condition, sleeps, and checks again before returning
- **THEN** the same supervised execution remains active through that loop
- **AND** the host does not create a new run, model turn, or scheduled prompt for each check

#### Scenario: Call Bash from TypeScript
- **WHEN** a TypeScript script awaits tools.bash
- **THEN** the command executes within that run's authorized directory, environment scope, and native execution policy
- **AND** its result is returned to the script without a model call or promotion to a detached chat job

#### Scenario: Required runtime capability is unavailable
- **WHEN** the host cannot provide the required language format, long-lived cancellable execution, confinement, or child-process cleanup
- **THEN** execution does not silently fall back to an in-process evaluator, an agent turn, or broader permissions
- **AND** the user receives an actionable capability diagnostic
### Requirement: Immutable execution capture
Before an executable run is admitted, the host SHALL resolve the selected directory, read and validate the primary external script when applicable, and durably capture the exact primary script bytes, language, directory choice and resolved directory, named routes, authorized variable names, declared parameter names, and incoming handoff. The capture SHALL NOT include parameter values: a value belongs to the entry, and the reviewed authority is the declaration, not what one entry supplies. Configuration edits, declaration edits, and changes to the primary file SHALL NOT modify an active or recovering run. Explicit Play SHALL capture the latest configuration and file contents for a new execution in the same stage. The host SHALL distinguish the selected file path from the bytes it actually approved and captured, and SHALL NOT substitute changed bytes during recovery. The product SHALL disclose that imported modules, called executables, and external services are not frozen transitively.

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
### Requirement: Entry activation independent of auto mode
A newly persisted entry into a deterministic stage SHALL request its execution even when task auto mode is disabled, subject to local trust, native execution policy, and valid task/project context. The activation request and entry identity SHALL be persisted atomically with the task creation or actual stage placement, before asynchronous capture, file reads, trust review, or program launch. Startup SHALL resume a pending activation without inventing one for historical occupied stages. Initial task creation in a deterministic initial stage SHALL count as a new entry. Starting a script-only entry SHALL NOT require conversation or model preparation, create a worktree implicitly, or use the prompt-stage five-second countdown. An entry whose stage declares parameters SHALL request its execution even when no value has been supplied, and the supervisor SHALL settle that attempt as a parameter failure without launching the program. Reordering a card in its current stage, loading an existing card, or changing a stage's configuration SHALL NOT synthesize a new entry or reactivate a stopped or failed run. A task whose worktree is preparing or in error SHALL not execute from that unresolved binding.

#### Scenario: Enter without auto mode or a conversation

- **WHEN** a task with auto mode disabled and no conversation enters an approved deterministic stage with a valid execution context
- **THEN** the script starts without a model-selection dialog or prompt countdown
- **AND** no conversation is created merely to run the script

#### Scenario: Create in a deterministic initial stage

- **WHEN** a task is created in a deterministic initial stage
- **THEN** that new entry requests execution using the same trust and admission rules as a later entry

#### Scenario: Do not start historical entries retroactively

- **WHEN** deterministic configuration is added to a stage that already contains cards
- **THEN** those existing cards do not execute solely because configuration changed or the host restarted
- **AND** Play can explicitly start the current stage for a selected card

#### Scenario: Recover a new entry before capture begins

- **WHEN** the host crashes after creating or moving a task into a deterministic entry but before its primary script has been captured
- **THEN** startup recovers the persisted activation request and requested authored definition
- **AND** it captures and authorizes the primary program before execution rather than losing the entry or implicitly executing historical cards

#### Scenario: Enter a parameterized stage without values

- **WHEN** a new entry is persisted in a stage that declares parameters and the entry holds no value for a declared name
- **THEN** the activation is recorded and the supervisor reports the missing parameters
- **AND** the program is not launched
### Requirement: Stop and Play on the current stage
The card and drawer SHALL provide Stop for an active deterministic execution and Play for a stopped, failed, or not-yet-started deterministic entry whose latest saved configuration is still deterministic. The durable entry and its captured control state, not the latest saved execution mode, SHALL determine whether an existing run is deterministic. Saving an agent or manual mode SHALL NOT hide Stop, arm an agent instruction, or let a completed conversation turn bypass that run. If the latest saved mode is no longer deterministic, Play SHALL not silently execute the old code or start an agent; the interface SHALL explain that valid deterministic configuration or a genuine stage change is required. Play SHALL revalidate the entry's values against the declaration captured for that new execution and SHALL fail in the stage when a declared name has no value, leaving the entry available for editing. Stop SHALL durably revoke the active run before requesting cancellation of its TypeScript/Bash program and owned Bash children, SHALL leave the task in its current stage, and SHALL neither follow an exit nor generate an error-route handoff. A successful Stop SHALL remain effective after restart. Play SHALL create a new execution identity and start time in the same stage, capture the latest configuration, and perform any required trust review. Play SHALL NOT move the task merely to begin execution, but a subsequent completed result SHALL follow its configured route normally. There SHALL be no dry-run behavior implied by Play. A new run SHALL NOT overlap an owned predecessor whose termination has not been confirmed.

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
### Requirement: Durable recovery from host loss
The host SHALL persist an execution intent before launching code. If the host exits or crashes while that intent remains active and no terminal result has been saved, startup SHALL recover the same execution by running its captured program from the beginning. Its execution identity, original start time, entry identity, incoming handoff, and entry-bound parameter values SHALL remain unchanged; its process-attempt identity and restart count SHALL distinguish the replacement process. Recovery SHALL NOT re-read parameter values from the saved workflow or from a changed declaration. Recovery SHALL NOT restore variables, instruction position, timers, or process memory, and SHALL NOT replay every polling check missed while the host was unavailable. Stopped, failed, superseded, and completed executions SHALL NOT be rerun automatically. A saved terminal result awaiting transition or handoff SHALL resume interrupted delivery instead of rerunning the script, reusing its identity and reconciling any existing native admission. A delivery explicitly recorded as failed SHALL remain failed after restart and require explicit retry; it SHALL NOT be retried merely because the host restarted. The host SHALL prevent concurrent owners or surviving predecessor processes from acting on the same active execution.

#### Scenario: Recover an active loop

- **WHEN** the host restarts after losing a script that had not returned a terminal result
- **THEN** it restarts the captured script from the beginning with the same execution identity and original start time
- **AND** the script can calculate its total business deadline from that preserved start time

#### Scenario: Resume a saved result

- **WHEN** the host crashes after persisting a terminal result but before its transition or handoff completes
- **THEN** startup resumes the saved result's delivery with the same delivery identity
- **AND** does not execute the source script again

#### Scenario: Refuse uncertain duplicate ownership

- **WHEN** recovery cannot establish that an older owned process has stopped or cannot acquire exclusive ownership
- **THEN** it reports a recoverable diagnostic rather than starting a concurrent duplicate execution

#### Scenario: Recover a parameterized execution

- **WHEN** the host restarts an active execution whose entry holds parameter values
- **THEN** the replacement attempt receives those same values
- **AND** a saved edit to the declaration does not change them during recovery
### Requirement: Entry and run identity protect against stale results
Each actual stage entry and each explicit execution SHALL have distinct durable identities. Moving a card away from an active deterministic stage SHALL revoke that run and cancel its owned processes without waiting for its external condition to complete. A result SHALL be accepted only for the current entry, current run, and current process attempt, before a Stop or movement has revoked it. Returning to the same stage SHALL create a new entry rather than accepting a result from an earlier visit. Turn-end events from conversations SHALL NOT route a task past an active, stopped, untrusted, or failed deterministic entry.

#### Scenario: Move away and return to the same stage
- **WHEN** a card leaves a deterministic stage, later returns, and the original process produces a delayed result
- **THEN** the original result is ignored even though the stage identifier matches again
- **AND** only the new entry's execution can select its output route

#### Scenario: Reorder within the current stage
- **WHEN** a card is reordered without changing stages
- **THEN** its current execution identity and state remain unchanged

#### Scenario: A conversation finishes while the script is active
- **WHEN** an owned conversation completes a turn while the task's current entry is deterministic
- **THEN** that turn does not bypass or complete the deterministic stage
### Requirement: Structured completion and exact named routing
A successfully completed script SHALL return an object containing a nonempty exit name and a nonempty message. TypeScript SHALL return that object as its completion value. A standalone Bash script SHALL exit successfully and emit exactly one JSON completion object on stdout; diagnostic output SHALL use stderr. The host SHALL reject missing, malformed, truncated, oversized, or nonconforming completion values and SHALL NOT infer an exit from log text. A valid mapped exit SHALL select exactly its captured destination, not the first configured transition or the next stage in display order. Distinct exit names MAY select the same stage. Before admitting the move, the host SHALL confirm that the task still owns that run, the same captured destination stage still exists by stable identity, and applicable task-context and pending-user-work guards permit delivery. The trusted captured mapping SHALL remain the authority for that run even when the saved workflow changes its exits; the host SHALL NOT substitute the new mapping or reject an otherwise valid captured route solely because it is absent from the latest saved exit list. A result held by those guards SHALL remain durable without polling the external system again. A script result SHALL NOT authorize an otherwise required manual transition override.

#### Scenario: Route a rejected review to correction
- **WHEN** a script returns exit rejected with a message and that exit maps to the correction stage
- **THEN** the host moves to exactly that stage and carries the returned message
- **AND** does not choose another exit based on ordering or documentary condition text

#### Scenario: Hold delivery while user work is pending
- **WHEN** a mapped terminal result is saved while the task still owes pending user work
- **THEN** no move or downstream execution is admitted until that guard clears
- **AND** the saved result remains available without rerunning the script

#### Scenario: A destination disappeared after capture
- **WHEN** a saved exit's captured destination no longer exists when routing is admitted
- **THEN** the task remains in its current stage with a routing diagnostic
- **AND** the host does not substitute a newer route or another stage

#### Scenario: Edit a route while its captured execution remains active
- **WHEN** an active approved run captured exit passed to stage B and the saved workflow later maps passed to stage C
- **THEN** that run still routes passed to B if B is the same existing stable stage and current task safety guards pass
- **AND** only explicit Play or a genuine new entry captures C as its route

#### Scenario: Preserve the target through an identifier rename
- **WHEN** the target of a captured route is renamed while retaining its stable stage identity
- **THEN** the result resolves to that same stage under its current identifier
- **AND** another stage reusing the old identifier cannot receive the result
### Requirement: Executor failure routing and repair
A script exception, a program exit that its captured mapping does not name, an invalid completion, or an execution failure SHALL produce a structured diagnostic carrying its origin, and a synthetic result that follows the captured destination for that origin. When a captured destination for that origin still exists and remains admissible, the synthetic result SHALL follow it through the normal durable routing path. A missing or undeclared parameter value SHALL be a configuration refusal rather than an executor failure: it SHALL NOT follow any route, SHALL leave the task in its current stage with its entry preserved, and SHALL offer Play and parameter editing. A failure whose origin is configuration SHALL likewise remain in its current stage and SHALL NOT follow a route. Trust not yet granted, explicit cancellation, and a source entry that is no longer current SHALL NOT be treated as script error outcomes. An unmapped script exit SHALL become a diagnostic rather than falling back to an unrelated route. Failure to deliver a saved result SHALL be handled as transition/handoff recovery, not as a reason to execute the script again or recursively follow error routes. When the run confirmed exclusive native ownership cannot be re-established after a failure, the execution SHALL remain failed in its stage without following a route, and the original diagnostic SHALL be preserved beside the ownership diagnostic.

#### Scenario: Follow a configured error exit

- **WHEN** an executor fails before returning a valid completion, the failure origin is `script` or `contract`, and the run captured a valid error destination
- **THEN** the host saves an error result with a diagnostic message and follows that route once

#### Scenario: Repair without an error route

- **WHEN** an executor fails and there is no error route
- **THEN** the card remains in the current stage with its failure and Play action
- **AND** correcting configuration does not start code until Play is explicitly requested

#### Scenario: Repair without a destination for that origin

- **WHEN** an executor fails and the captured mapping has no destination for that failure origin
- **THEN** the card remains in the current stage with its failure, its origin, and Play

#### Scenario: Missing local trust is not a failure transition

- **WHEN** a stage has not been authorized locally
- **THEN** it waits for trust review without running code or following any route

#### Scenario: A missing parameter does not follow the error route

- **WHEN** an entry is admitted without a value for a declared parameter and the stage configures an error destination
- **THEN** the failure stays in the stage with a parameter diagnostic
- **AND** no route is followed and the entry is not replaced

#### Scenario: A configuration failure does not reach a correction stage

- **WHEN** an admitted run fails because its execution context changed or an authorized variable is unavailable
- **THEN** the task stays in its stage with the configuration diagnostic and Play
- **AND** the captured error and infrastructure destinations are not followed

#### Scenario: Uncertain cleanup keeps the cause

- **WHEN** native cleanup cannot confirm quiescence after a failed execution
- **THEN** the task stays failed in its stage without following a route
- **AND** the original failure diagnostic remains readable beside the ownership diagnostic
### Requirement: Handoff to any destination type
The host SHALL preserve the completed exit name, message, source stage, source execution identity, and delivery identity as a handoff bound to the exact destination entry. An agent destination SHALL receive the message as identified native context accompanying its own stage instruction. A deterministic destination SHALL receive the handoff in its input without creating a conversation. A manual destination SHALL retain it for its next execution and expose it in the task's history. Routing SHALL stop at the mapped destination even if that destination has no agent instruction. Delivery retries and restart recovery SHALL reuse the same identity and SHALL NOT duplicate the handoff. After any awaited destination preparation or durable-log read, final native admission SHALL still require the exact destination entry identity and delivery identity; matching a stage identifier alone SHALL NOT authorize a handoff after the task moved away and returned. The host SHALL serialize the final check and native admission against an intervening placement for that task or provide an equivalent entry-bound admission guarantee. A future visit to the same stage SHALL NOT inherit an unrelated older entry's handoff.

#### Scenario: Chain two deterministic stages
- **WHEN** a deterministic stage exits to another deterministic stage
- **THEN** the second script receives the first stage's named exit and message as its incoming handoff
- **AND** neither script requires a conversation or model turn

#### Scenario: Stop at a manual destination
- **WHEN** an exit maps to a manual stage without a prompt or script
- **THEN** the task stops there with its handoff retained
- **AND** the host does not skip ahead to a later instructed stage

#### Scenario: Retry a handoff after host loss
- **WHEN** the destination already accepted a handoff but the source receipt was not yet observed before restart
- **THEN** delivery recovery recognizes the existing identity instead of adding the same context twice

#### Scenario: Reject a stale handoff after awaited preparation
- **WHEN** handoff delivery awaits destination preparation and the task moves away and returns to the same stage before native admission
- **THEN** the old delivery does not inject context or trigger an obsolete instruction in the new entry
- **AND** sharing the same stage identifier does not satisfy the entry-bound authorization

#### Scenario: Keep an explicitly failed handoff failed after restart
- **WHEN** a deterministic result delivery was durably recorded as failed before host shutdown
- **THEN** recovery retains its failure and explicit retry action without rerunning the script or automatically resending the handoff
### Requirement: Minimal input context
The script SHALL receive structured input containing task identity, title and description; Hub, board and stage identity; project identity and directory; effective directory and any recorded worktree/branch; entry and execution identities and timestamps; process-attempt/restart information; the entry's parameter values for exactly the declared names; and the incoming handoff when present. The context SHALL NOT automatically include the entire conversation history or secret values, and SHALL NOT include an undeclared parameter name. TypeScript SHALL receive the context without source-code interpolation of task text or parameter values. Standalone Bash SHALL receive JSON input through stdin rather than interpolating task fields or parameter values into shell code. Recorded branch metadata SHALL NOT be presented as proof of the live Git HEAD.

#### Scenario: Pass untrusted task text as data

- **WHEN** a task title or description contains shell syntax or TypeScript delimiters
- **THEN** the script sees that text only as structured input
- **AND** the host does not execute it as part of constructing the script

#### Scenario: Recover without changing the business deadline

- **WHEN** a script receives context after automatic recovery
- **THEN** its execution start remains the original value and its process-attempt/restart information identifies the recovery

#### Scenario: Read a parameter as data

- **WHEN** a declared parameter value contains shell syntax or a TypeScript delimiter
- **THEN** both supported languages receive it as structured data
- **AND** the host does not interpolate it into the program source
### Requirement: Local executable trust
The first execution of an executable version SHALL require explicit local approval after review of the exact captured primary code, language, source location, working-directory scope, routes, declared parameter names, and authorized variable names. Parameter values SHALL NOT be part of the reviewed version. Changes to that reviewed executable configuration, including external primary file contents, a change to a declared parameter name, or an expansion of variable access, SHALL invalidate the previous approval. Editing an entry's parameter values SHALL NOT invalidate an approval. Approval SHALL be local to the project/stage scope and SHALL NOT be granted by saving, publishing, or accepting a shared workflow. Repeated use and restart recovery of the same approved version SHALL not request trust again. Rejecting or withholding approval SHALL leave the task in its current stage without executing code. Trust SHALL NOT bypass native filesystem/execution policy or claim to freeze dependencies outside the captured program.

#### Scenario: Receive executable YAML from the team

- **WHEN** a shared update introduces or changes a deterministic script
- **THEN** accepting the update does not authorize it locally
- **AND** the next requested execution waits for approval of the actual captured version

#### Scenario: Recover an approved execution

- **WHEN** the host restarts a run with the same captured version and valid local approval
- **THEN** it does not ask for the same approval again

#### Scenario: Change a primary file between review and launch

- **WHEN** the source file changes after the user reviews its captured contents
- **THEN** the launch uses the reviewed captured bytes or requires another approval
- **AND** it never launches changed bytes under the earlier approval

#### Scenario: Change a declared parameter name requires a new approval

- **WHEN** the saved declaration adds or removes a parameter name after the executable version was approved
- **THEN** the next execution requires a new local review
- **AND** changing only a value for an approved version does not
### Requirement: Local variables isolated by project and stage
Explicit execution variables SHALL be configured independently for each local project-and-stage pair using the host credential mechanism. Stable stage identity SHALL keep that scope intact across a stage identifier rename; another project or stage SHALL NOT inherit its variables. A deterministic definition SHALL list only the variable names that run is authorized to access, not their values. TypeScript and Bash execution SHALL enforce the same authorized set without implicitly exposing other installation credentials. Resolved values SHALL remain outside shared YAML, task input metadata, run snapshots, and ordinary client projections. Configuration UI SHALL show configured/missing status without reading stored values back to the browser. An unavailable native credential provider or missing explicitly required variable SHALL report an actionable diagnostic rather than silently widening access or substituting an unrelated credential. A recovering process SHALL resolve authorized values again rather than persisting secret values for replay.

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
### Requirement: Truthful execution controls and diagnostics
Cards and drawers SHALL distinguish awaiting trust, active, stopping, stopped, failed, result-awaiting-delivery, and a parameter refusal without reporting a running agent when no conversation is running. The interface SHALL display the captured version and whether a saved edit requires Play, the relevant failure, and Stop/Play controls with accessible names and action-local progress. A failed execution SHALL present its failure origin, its root-cause code, and the number of attempts it made, in the card's script panel and in the task's history detail. The persisted and displayed diagnostic SHALL carry, bounded and redacted, the facts the host observed: the guard's exit status and terminating signal, the received output sizes and bounded beginning, the bounded end of its diagnostic stream, and whether the command was admitted. An infrastructure or configuration diagnostic SHALL NOT present a stack trace or a local filesystem path in the message delivered to a destination stage; the detailed facts SHALL remain available through the task's history. For an entry whose stage declares parameters, the card and drawer SHALL show the entry's parameter values read-only and SHALL offer parameter editing whenever the entry exists and its execution is not active or stopping. It SHALL present a parameter refusal as a recoverable configuration problem that offers both Play and editing, distinct from an executor failure. Available diagnostics SHALL be bounded and SHALL not add one task-history row per polling iteration or per retried call. The host SHALL avoid logging resolved variable values and redact known secret values from persisted/displayed diagnostics, their detailed facts, and handoff messages; documentation SHALL explain that arbitrary user code can transform or disclose secrets and that redaction is not a complete data-loss-prevention boundary. Parameter values SHALL be presented as task data and SHALL NOT be treated as secrets. Secret values SHALL NOT appear in ordinary snapshots or verification evidence. Switching panels or closing the browser SHALL not stop a host-owned active script.

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

- **WHEN** captured output contains an exact resolved secret value known to the host
- **THEN** that value is redacted before diagnostic or handoff persistence and display
- **AND** tests and screenshots contain no real credentials

#### Scenario: Repair values from a failed entry

- **WHEN** an entry failed for a missing parameter and the user opens the script panel
- **THEN** the panel presents the failure, Play, and the parameter editing action
- **AND** it presents the entry's current values read-only until the user edits them
### Requirement: Declared stage parameters
A deterministic stage definition SHALL declare required parameters as an ordered list of entries, each with a name that is unique within the declaration and matches a safe identifier, and an optional nonempty description no longer than the accepted length. The declaration SHALL be authored workflow configuration, SHALL be published with the stage, and SHALL NOT carry values, defaults, or optionality markers. A declaration SHALL hold no more than the accepted number of parameters. The declared names SHALL be part of the executable authority reviewed for local trust, and SHALL NOT be resolved through the credential mechanism: parameters are data, not secrets. A deterministic stage SHALL remain the only stage type that declares parameters.

#### Scenario: Declare two required parameters

- **WHEN** a user saves a deterministic stage whose definition lists `pipeline` and `app` with a description for each
- **THEN** the workflow stores both names and descriptions as part of that stage's deterministic configuration
- **AND** no value is stored by the declaration

#### Scenario: Reject an invalid or duplicate parameter name

- **WHEN** a declaration repeats a name, uses an unsafe identifier, or carries an empty description
- **THEN** saving fails with a diagnostic naming the offending entry
- **AND** the previous workflow remains unchanged

#### Scenario: Reject a declaration beyond the accepted size

- **WHEN** a declaration holds more parameters than the accepted number
- **THEN** saving fails with a diagnostic naming the limit
- **AND** no partial declaration is stored
### Requirement: Parameter values bound to a stage entry
Parameter values SHALL be supplied through the transition declaration of the stage that precedes the deterministic entry, or through the local repair command for that entry, and SHALL be bound to that entry. They SHALL remain unchanged for every attempt and every Play of that entry, and a later entry SHALL NOT inherit them. Values SHALL be nonempty strings within the accepted per-value and total size limits, and SHALL be limited to the names the destination declares. A program SHALL receive exactly the declared names as structured input and SHALL NOT receive an undeclared name even when the entry holds one. The host SHALL NOT interpolate a value into TypeScript or Bash source. A stage that declares no parameters SHALL give its program an empty parameter object. The declaration is authored configuration; a value is entry-local task data and SHALL NOT be written into workflow text, the shared log, or another entry.

#### Scenario: Pass the declared values to the program

- **WHEN** an entry's stage declares `pipeline` and `app` and the entry holds a value for both
- **THEN** the program reads both values from its structured parameter input
- **AND** it reads no other parameter name

#### Scenario: Ignore an undeclared value

- **WHEN** an entry holds a value for a name its stage no longer declares
- **THEN** the program does not receive that name
- **AND** the execution is not rejected merely because the entry holds it

#### Scenario: A later entry does not inherit values

- **WHEN** a task leaves a parameterized stage and later returns to the same stage through a declaration that supplies no values
- **THEN** the new entry starts without the earlier entry's values

#### Scenario: Recover with the entry's own values

- **WHEN** the host restarts an active execution
- **THEN** the replacement attempt receives the same values bound to that entry
- **AND** it does not read values from the saved workflow
### Requirement: Parameterized entry admission failure
An entry whose stage declares parameters SHALL NOT start its program while any declared name lacks a nonempty value. The host SHALL settle that attempt as a failed execution with a diagnostic naming every missing name. That failure SHALL NOT follow the error exit, SHALL NOT move the task, SHALL NOT replace the entry, and SHALL NOT append a history entry, because it is a configuration refusal rather than an execution attempt. The entry SHALL remain in its stage with Play and parameter editing available. Every stage entry SHALL be admissible regardless of how it was created, including an agent declaration, a manual move, task creation, an automatic advance, and a script exit; a stage that declares parameters SHALL be a valid initial stage and a valid exit or transition destination.

#### Scenario: Enter by a manual move without values

- **WHEN** a task is moved by hand into a stage that declares parameters and an error exit
- **THEN** the task stays in that stage with a diagnostic naming the missing parameters
- **AND** the error exit is not followed and the entry is preserved

#### Scenario: Enter by an agent declaration with every value

- **WHEN** an agent declares a transition to a parameterized stage and supplies every declared name
- **THEN** the entry is created with those values and the program starts under the normal rules

#### Scenario: Route a script result into a parameterized stage

- **WHEN** a deterministic result maps to a stage that declares parameters
- **THEN** the task enters that stage with no values
- **AND** the attempt fails in place with the parameter diagnostic instead of running

#### Scenario: Create a task in a parameterized initial stage

- **WHEN** a task is created in a stage that declares parameters
- **THEN** the task remains in that stage and the attempt reports the missing parameters
- **AND** no conversation or agent execution is created merely to satisfy them
### Requirement: Repairing entry parameters without trust review
The host SHALL let the user replace the parameter values of the current entry while its execution is not active or stopping, through an explicit command that names the entry identity and the complete value set. The command SHALL reject a stale entry, an incomplete or malformed value set, a value beyond the accepted limits, and an entry whose saved stage no longer declares parameters. Saving values SHALL NOT grant executable trust, SHALL NOT change the authored declaration, SHALL NOT start a program, and SHALL NOT append a history entry. A subsequent Play SHALL admit a new execution of the same entry with the saved values, and a parameter refusal caused by a new declaration name SHALL remain recoverable by editing that name before Play.

#### Scenario: Repair values and start again

- **WHEN** an entry failed for a missing parameter, the user supplies it, and then presses Play
- **THEN** a new execution of the same entry starts with the saved values
- **AND** no new trust approval is requested for the value change

#### Scenario: Reject a stale or active entry

- **WHEN** the user submits values for an entry that was replaced or whose execution is active
- **THEN** the command is rejected with an actionable error
- **AND** no value is stored

#### Scenario: Repair a name added by a saved edit

- **WHEN** the saved declaration gains a parameter name while an entry exists, and the user fills that name before Play
- **THEN** Play admits a new execution with the completed value set
- **AND** Play without that value fails in the card instead of starting
### Requirement: Bounded retry of an unadmitted Bash call
The host SHALL repeat a guarded Bash call only when the guard provably did not start the command: it produced no output on either stream, exited with status 125, was not terminated by a signal, and was neither timed out nor aborted by the caller. A guard failure with any evidence — command output, a terminating signal, a guard diagnostic line, another exit status, or a timeout — SHALL NOT be repeated, because the host cannot prove that the command produced no effect. The host SHALL make at most three attempts within one call, with a short growing delay before each repetition, and SHALL abandon the wait when the execution is stopped. A repeated call SHALL remain one logical call to the program, which observes only the final result or failure. The host SHALL NOT restart the whole program because of an infrastructure failure; automatic whole-program restart remains reserved for loss of the host.

#### Scenario: Repeat a guard that never admitted the command

- **WHEN** a guarded Bash call returns no output on either stream, status 125 and no terminating signal
- **THEN** the host repeats the same command, at most three attempts in total, without exposing the attempts to the program
- **AND** a program that then receives a result continues in the same execution

#### Scenario: Do not repeat a command that may have run

- **WHEN** the guard reports an unproven process tree, is terminated by a signal, prints a guard diagnostic, or exits with another status
- **THEN** the host does not repeat the command
- **AND** the execution settles as one failure

#### Scenario: Do not extend a stop

- **WHEN** Stop is requested while the host waits between attempts
- **THEN** no further attempt starts
- **AND** the execution settles as stopped without a handoff

#### Scenario: Do not restart the program

- **WHEN** every attempt of the call fails
- **THEN** the execution settles as one failure
- **AND** the captured program is not restarted automatically
### Requirement: Failure origin classification
Every failed deterministic execution SHALL be classified by origin before it is reported or routed: `script` when the captured program threw or returned an exit that its captured mapping does not name; `contract` when the program's completion value violates the required completion shape or its size bound; `infrastructure` when the guard, its transport, the execution runtime, or the host failed while the program was running; and `configuration` when the execution could not be attempted as configured, including an entry context that changed, a missing or out-of-scope variable, an unrecoverable capture, a missing host capability, or a file policy the host cannot establish. The origin SHALL be persisted with the diagnostic as part of the execution record and SHALL remain readable after the process that produced it ends. An infrastructure failure SHALL keep the root-cause code of the failure that produced it, and a program exception that carried that cause SHALL be recorded as a nested cause rather than replace it. When several host failures occur in one execution, the first one SHALL be the reported cause.

#### Scenario: A host failure inside a program keeps its cause

- **WHEN** a program does not handle a guarded Bash failure and the execution ends with a program exception
- **THEN** the diagnostic names the guard's root-cause code, the origin is `infrastructure`, and the program exception is recorded as the nested cause

#### Scenario: A program defect is a script failure

- **WHEN** the captured program throws, or returns an exit that its captured mapping does not name
- **THEN** the origin is `script`

#### Scenario: A malformed completion is a contract failure

- **WHEN** the program returns a value that is not exactly a nonempty exit name and a nonempty message within the completion size bound
- **THEN** the origin is `contract`

#### Scenario: A changed context is a configuration failure

- **WHEN** the captured execution directory is unavailable or the admitted execution context no longer matches the capture
- **THEN** the origin is `configuration`
- **AND** the task does not move and Play remains available

#### Scenario: A missing host capability or policy is a configuration failure

- **WHEN** the host lacks the required Bash or TypeScript capability, or cannot establish the selected file policy
- **THEN** the origin is `configuration`
- **AND** the diagnostic names what must be mounted or changed
### Requirement: Reserved infrastructure destination
A deterministic stage SHALL accept the reserved exit name `infrastructure` in its exit mapping on the same terms as the reserved name `error`. The host SHALL choose the synthetic destination for a settled failure in this order: the reserved `infrastructure` destination when the failure origin is `infrastructure` and the captured mapping names it; otherwise the reserved `error` destination when the captured mapping names it; otherwise no destination, leaving the task failed in its stage. A failure whose origin is `configuration` SHALL NOT follow `infrastructure`, `error`, or any other route. The reserved name SHALL be part of the captured exit mapping and the approved fingerprint, and SHALL NOT be allowed to target the source stage. A program MAY return the name itself, in which case the host SHALL treat it as an ordinary mapped exit. The synthetic result SHALL carry the reserved name as its exit when the infrastructure destination is used.

#### Scenario: Route an infrastructure failure to escalation

- **WHEN** a captured mapping names `infrastructure` and the execution settles with an infrastructure failure
- **THEN** the task moves once to that captured destination
- **AND** the saved result carries the reserved exit name

#### Scenario: Fall back to the error destination

- **WHEN** the captured mapping does not name `infrastructure` but names `error`, and the execution settles with an infrastructure failure
- **THEN** the task follows the captured `error` destination
- **AND** the delivered message states the failure origin

#### Scenario: Stay in the stage without either destination

- **WHEN** the captured mapping names neither reserved destination and an infrastructure failure settles
- **THEN** the task remains failed in its stage with Play
- **AND** no other exit is substituted

#### Scenario: Configuration never escalates

- **WHEN** the failure origin is `configuration` and the stage maps `infrastructure` and `error`
- **THEN** no destination is chosen and the task stays in its stage
- **AND** Play and the configuration action remain available

#### Scenario: Do not target the source stage

- **WHEN** an exit named `infrastructure` targets its own stage
- **THEN** saving the workflow fails and the previous workflow remains unchanged
