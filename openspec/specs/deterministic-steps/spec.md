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

A successfully completed script SHALL return an object containing a nonempty exit name and a nonempty message, and MAY additionally contain a bounded params object that supplies parameter values to its captured destination. TypeScript SHALL return that object as its completion value. A standalone Bash script SHALL exit successfully and emit exactly one JSON completion object on stdout; diagnostic output SHALL use stderr. The params object SHALL contain only nonempty string values under safe parameter names, within the accepted parameter count, name length, per-value length, and total-size bounds, and the whole completion document SHALL remain within the accepted 32 KiB completion size bound. The host SHALL reject a completion whose params object is not a mapping of safe parameter names to nonempty string values within those bounds, and SHALL reject a partial map instead of accepting the values it can read. The host SHALL reject missing, malformed, truncated, oversized, or nonconforming completion values and SHALL NOT infer an exit from log text. A valid mapped exit SHALL select exactly its captured destination, not the first configured transition or the next stage in display order. Distinct exit names MAY select the same stage. The host SHALL preserve the accepted parameter values with the saved result, redacted for known secret values, so a delivery retry or restart recovery reuses exactly those values without executing the program again. Before admitting the move, the host SHALL confirm that the task still owns that run, the same captured destination stage still exists by stable identity, and applicable task-context and pending-user-work guards permit delivery. The trusted captured mapping SHALL remain the authority for that run even when the saved workflow changes its exits; the host SHALL NOT substitute the new mapping or reject an otherwise valid captured route solely because it is absent from the latest saved exit list. A result held by those guards SHALL remain durable without polling the external system again. Whenever delivery of the current result is refused by a task-context, pending-work, or conversation guard, the host SHALL persist on the entry that owns the result a bounded hold record naming a stable reason code, the bounded facts that produced the refusal, and when it was observed. A request that no longer matches the entry, execution, attempt, or result it was admitted for, or that was cancelled while its checks awaited, SHALL be retried on the next event and SHALL NOT persist a hold against another entry. The hold record SHALL be replaced when the reason changes and cleared once delivery is admitted or settled. When an event reports that the blocking condition changed, the host SHALL attempt delivery of the saved result again with its existing execution and delivery identities, and SHALL NOT require a new Play for that retry. A conversation read that cannot produce a verdict SHALL be recorded as its own reason rather than as an unqualified refusal. A script result SHALL NOT authorize an otherwise required manual transition override.

#### Scenario: Route a rejected review to correction

- **WHEN** a script returns exit rejected with a message and that exit maps to the correction stage
- **THEN** the host moves to exactly that stage and carries the returned message
- **AND** does not choose another exit based on ordering or documentary condition text

#### Scenario: Hold delivery while user work is pending

- **WHEN** a mapped terminal result is saved while the task still owes pending user work
- **THEN** no move or downstream execution is admitted until that guard clears
- **AND** the saved result remains available without rerunning the script
- **AND** the entry records a hold naming the pending work
- **AND** answering that work makes the host attempt delivery of the same saved result without a new Play

#### Scenario: Hold delivery while the conversation still works

- **WHEN** a mapped terminal result is saved while one of the task's conversations still owns a running turn, a background job, a schedule, or a subagent
- **THEN** the task does not move and the saved result keeps its execution and delivery identities
- **AND** the entry records a hold naming the activity that refused delivery
- **AND** settling or cancelling that activity makes the host attempt delivery of the same saved result without a new Play

#### Scenario: A conversation read cannot decide

- **WHEN** the host cannot read a conversation's activity well enough to admit or refuse delivery
- **THEN** the task does not move and the entry records a hold naming that condition
- **AND** a later event that reports conversation activity makes the host attempt delivery again

#### Scenario: A destination disappeared after capture

- **WHEN** a saved exit's captured destination no longer exists when routing is admitted
- **THEN** the task remains in its current stage with a routing diagnostic
- **AND** the host does not substitute a newer route or another stage

#### Scenario: Edit a route while its captured execution remains active

- **WHEN** an active approved run captured exit passed to stage B and the saved workflow later maps passed to stage C
- **THEN** that run still routes passed to B if B is the same existing stable stage and current task safety guards pass
- **AND** only an explicit new execution or a genuine new entry captures C as its route

#### Scenario: Preserve the target through an identifier rename

- **WHEN** the target of a captured route is renamed while retaining its stable stage identity
- **THEN** the result resolves to that same stage under its current identifier
- **AND** another stage reusing the old identifier cannot receive the result

#### Scenario: Return values for the next script

- **WHEN** the program returns a completion whose params object contains a value for a name its captured destination declares
- **THEN** the host saves the completion with that value and keeps it for delivery and delivery retries
- **AND** the value is data, never part of the executable source

#### Scenario: Reject a malformed parameter map

- **WHEN** the params object is not a mapping of safe names to nonempty strings within the accepted bounds, or the whole completion exceeds its 32 KiB size bound
- **THEN** the execution settles as a contract failure
- **AND** no partial value is bound to a destination entry

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

The host SHALL preserve the completed exit name, message, sent parameter values, source stage, source execution identity, and delivery identity as a handoff bound to the exact destination entry. An agent destination SHALL receive the message and the bounded sent parameter values as identified native context accompanying its own stage instruction. A deterministic destination SHALL receive the handoff in its input without creating a conversation, and SHALL receive only the sent values whose names it declares through its parameter input; the raw sent map SHALL NOT be exposed on its handoff input. A manual destination SHALL retain the handoff and its sent values for its next execution and expose them in the task's history. A destination that declares a name the sent map does not carry SHALL still accept the handoff; its entry SHALL be created and its own admission SHALL report the missing parameter for repair, rather than the delivery failing or following a failure route. Routing SHALL stop at the mapped destination even if that destination has no agent instruction. Delivery retries and restart recovery SHALL reuse the same sent values and SHALL NOT duplicate the handoff. After any awaited destination preparation or durable-log read, final native admission SHALL still require the exact destination entry identity and delivery identity; matching a stage identifier alone SHALL NOT authorize a handoff after the task moved away and returned. The host SHALL serialize the final check and native admission against an intervening placement for that task or provide an equivalent entry-bound admission guarantee. A future visit to the same stage SHALL NOT inherit an unrelated older entry's handoff.

#### Scenario: Chain two deterministic stages

- **WHEN** a deterministic stage exits to another deterministic stage
- **THEN** the second script receives the first stage's named exit and message as its incoming handoff
- **AND** it receives the sent values whose names it declares as its parameter input
- **AND** neither script requires a conversation or model turn

#### Scenario: Render sent values as conversation context

- **WHEN** an exit maps to an agent destination or a manual destination
- **THEN** the handoff context presents the bounded sent parameter values beside the message
- **AND** no parameter entry is created merely because values were sent

#### Scenario: Do not expose an undeclared sent value to a program

- **WHEN** the sent map carries a name the deterministic destination does not declare
- **THEN** the destination program receives only its declared names
- **AND** the extra value is not exposed on its handoff input

#### Scenario: Keep a missing declared value repairable

- **WHEN** the sent map lacks a name the destination declares
- **THEN** the handoff is accepted and the destination entry is created
- **AND** the destination admission reports the missing name for repair
- **AND** the delivery does not fail the route or follow a failure exit

#### Scenario: Reuse sent values on a delivery retry

- **WHEN** a handoff delivery is retried or recovered after host loss
- **THEN** it reuses the same sent values and delivery identity
- **AND** it does not execute the source program again

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

The script SHALL receive structured input containing task identity, title and description; Hub, board and stage identity; project identity and directory; effective directory and any recorded worktree/branch; entry and execution identities and timestamps; process-attempt/restart information; the entry's parameter values for exactly the declared names; and the incoming handoff when present. The incoming handoff in the script input SHALL NOT carry the raw sent parameter map; the program SHALL receive values only through the declared parameter input. The context SHALL NOT automatically include the entire conversation history or secret values, and SHALL NOT include an undeclared parameter name. TypeScript SHALL receive the context without source-code interpolation of task text or parameter values. Standalone Bash SHALL receive JSON input through stdin rather than interpolating task fields or parameter values into shell code. Recorded branch metadata SHALL NOT be presented as proof of the live Git HEAD.

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

#### Scenario: Do not read the raw sent map

- **WHEN** a deterministic destination receives a handoff whose source result carried parameter values
- **THEN** its parameter input contains exactly the declared names and their values
- **AND** its handoff input does not expose the raw sent map
- **AND** the host does not reject the execution merely because extra values were sent

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

Parameter values SHALL be supplied through the transition declaration of the stage that precedes the deterministic entry, through the completion of a preceding deterministic result whose captured exit targets that entry, or through the local repair command for that entry, and SHALL be bound to that entry. A value sent by a deterministic result SHALL bind to a declared parameter only when the names are exactly equal; the host SHALL NOT rename, infer, or match a sent value by position. A sent name the destination does not declare SHALL NOT create an entry value, and a declared name the result did not send SHALL remain absent so that admission reports it. A result-supplied value SHALL be bounded and redacted like any other entry value. They SHALL remain unchanged for every attempt and every Play of that entry, and a later entry SHALL NOT inherit them. Values SHALL be nonempty strings within the accepted per-value and total size limits, and SHALL be limited to the names the destination declares. A program SHALL receive exactly the declared names as structured input and SHALL NOT receive an undeclared name even when the entry holds one. The host SHALL NOT interpolate a value into TypeScript or Bash source. A stage that declares no parameters SHALL give its program an empty parameter object. The declaration is authored configuration; a value is entry-local task data and SHALL NOT be written into workflow text, the shared log, or another entry.

#### Scenario: Pass the declared values to the program

- **WHEN** an entry's stage declares pipeline and app and the entry holds a value for both
- **THEN** the program reads both values from its structured parameter input
- **AND** it reads no other parameter name

#### Scenario: Bind values sent by the previous script

- **WHEN** a preceding deterministic result supplies a value for every declared name of its destination entry
- **THEN** the entry is created with those values
- **AND** the program reads exactly those declared names

#### Scenario: Ignore an extra sent value

- **WHEN** a deterministic result sends a name its destination does not declare
- **THEN** the entry does not hold that name
- **AND** the execution is not rejected merely because the value was sent

#### Scenario: Match by name, not by position

- **WHEN** a deterministic result sends the right values under names the destination does not declare
- **THEN** none bind to the entry
- **AND** the destination admission reports the missing declared names

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

An entry whose stage declares parameters SHALL NOT start its program while any declared name lacks a nonempty value. A value supplied by a completed deterministic result SHALL satisfy a declared name exactly as a transition-supplied or repaired value does, and a missing declared name SHALL be reported even when the result supplied other names. The host SHALL settle that attempt as a failed execution with a diagnostic naming every missing name. That failure SHALL NOT follow the error exit, SHALL NOT move the task, SHALL NOT replace the entry, and SHALL NOT append a history entry, because it is a configuration refusal rather than an execution attempt. The entry SHALL remain in its stage with Play and parameter editing available. Every stage entry SHALL be admissible regardless of how it was created, including an agent declaration, a manual move, task creation, an automatic advance, and a script exit; a stage that declares parameters SHALL be a valid initial stage and a valid exit or transition destination.

#### Scenario: Enter by a manual move without values

- **WHEN** a task is moved by hand into a stage that declares parameters and an error exit
- **THEN** the task stays in that stage with a diagnostic naming the missing parameters
- **AND** the error exit is not followed and the entry is preserved

#### Scenario: Enter by an agent declaration with every value

- **WHEN** an agent declares a transition to a parameterized stage and supplies every declared name
- **THEN** the entry is created with those values and the program starts under the normal rules

#### Scenario: Route a script result into a parameterized stage

- **WHEN** a deterministic result maps to a stage that declares parameters
- **THEN** the entry is created with the values whose names the result supplied
- **AND** a declared name that the result did not supply is reported in place for repair
- **AND** the error exit is not followed and the entry is preserved

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

### Requirement: Whole-tree cleanup proof per platform

The host and the program-lifetime guard SHALL prove that no process started by an
execution still runs before the execution reports a result, releases its ownership
record, or hands a result to a destination. The proof SHALL use the strongest ownership
primitive the platform offers without elevation: the kernel's per-process environment on
Linux; on macOS a marker sweep executed by the host process outside the execution's
confinement, at the guard's authenticated request, because a confined program cannot read
another process's environment; and, on a platform with no supported ownership primitive, a
refusal before any code is launched. The proof SHALL NOT require executing a setuid
program, a program the confinement denies, or any capability the execution is meant to be
restricted from. A process group SHALL be considered empty only after a signal to its
group id fails because the group no longer exists, and a member SHALL be signalled only
after its ownership was confirmed. An execution whose cleanup cannot be proven SHALL NOT
report its captured result and SHALL NOT release its ownership record as settled; it SHALL
settle as an infrastructure failure that carries the guard's own reason, bounded and
redacted, so the failure is diagnosable without reproducing it.

#### Scenario: A confined execution on macOS returns its result
- **WHEN** a deterministic stage runs a `tools.bash` call under a confined file policy on macOS and the command succeeds
- **THEN** the call returns its captured output and the execution completes normally
- **AND** no process carrying the run's ownership token remains

#### Scenario: The confined guard does not read the process table itself
- **WHEN** the guard must locate a process that left its process group
- **THEN** it obtains the marker sweep from the host over the authenticated lifetime channel
- **AND** it does not execute a setuid program or a program the confinement denies

#### Scenario: Linux proves ownership from the kernel
- **WHEN** a Linux execution sweeps its owned set
- **THEN** it reads each candidate's environment from the kernel's process filesystem
- **AND** no external process-listing program is required

#### Scenario: A descendant that left the group is still terminated
- **WHEN** a descendant detaches into another session or process group and still carries the run's ownership token
- **THEN** it is signalled as an owned process
- **AND** a process whose ownership cannot be confirmed is never signalled or frozen

#### Scenario: Unproven cleanup fails closed and names its reason
- **WHEN** the strongest available sweep cannot run, or cannot confirm an empty owned set
- **THEN** the execution reports no captured result and settles as an infrastructure failure
- **AND** its diagnostic names the guard's own reason, bounded and redacted

#### Scenario: A platform without an ownership primitive fails closed in every mode
- **WHEN** a platform has no supported ownership primitive
- **THEN** both the Bash and the TypeScript execution modes refuse to start
- **AND** no mode reports a clean process tree that it did not verify
- **AND** the refusal is an actionable configuration diagnostic

#### Scenario: A confined platform with no fully enforcing backend is refused before code
- **WHEN** the platform's file-policy backend reports partial enforcement
- **THEN** the stage is refused before the program starts
- **AND** the diagnostic names the missing enforcement instead of a generic policy failure

#### Scenario: Host loss keeps the same proof
- **WHEN** the host dies while an execution is active
- **THEN** the next startup proves the predecessor's cleanup with the same platform primitive before any replacement code runs
- **AND** an unproven predecessor blocks a concurrent duplicate instead of being assumed gone

### Requirement: Run secrets stay out of the native process command line

The authenticated lifetime authorization and the ownership marker SHALL NOT be exposed on a
native process command line or in a world-readable file. The guard SHALL read its
configuration from a private file readable only by the executing user. The reviewed Bash
program SHALL reach the guard and the executing shell through a private file rather than as
a command-line argument, so the program text cannot be read from a process listing. Those
private files SHALL be removed when the execution settles, or at the next startup if the
host did not finish. A TypeScript provider that transports its own program is outside this
guarantee.

#### Scenario: No authorization on the command line
- **WHEN** the host launches the guard for an execution
- **THEN** the command line carries only the guard program and a private path
- **AND** a process of another user cannot read the configuration, where a command line would have been world-readable

#### Scenario: The reviewed Bash program is not on the command line
- **WHEN** a standalone Bash execution or a guarded `tools.bash` call starts
- **THEN** the command line carries the program's private path and not its text
- **AND** a process listing of the guard, its leader, and the executing shell exposes no program text

#### Scenario: The private files do not outlive the execution
- **WHEN** the execution settles, or the next startup finds a configuration or a program left by a host that did not finish
- **THEN** those private files are removed

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

### Requirement: Explicit Play delivers a saved result

While the current entry owns a saved result whose delivery is pending or failed, the Play action SHALL deliver that saved result with its existing delivery identity and SHALL NOT capture, authorize, or execute the program again. A refused delivery SHALL leave the entry and the saved result in place, update the hold record, and return an actionable diagnostic instead of starting a program. Starting a new execution for the same entry SHALL require a separate explicit action, which SHALL capture the latest configuration and primary source, SHALL remain subject to parameter completeness and local trust, and SHALL NOT reuse the earlier result or its identity. The card and drawer SHALL label the two actions distinctly and SHALL NOT offer the new-execution action while an execution owns the entry.

#### Scenario: Deliver instead of rerunning

- **WHEN** a saved result awaits delivery and the user presses Play
- **THEN** the host attempts delivery of that saved result
- **AND** it does not capture the saved configuration, request trust, or execute the program again
- **AND** the execution identity and the delivery identity do not change

#### Scenario: A failed delivery is retried by Play

- **WHEN** a saved result delivery was recorded as failed and the user presses Play
- **THEN** the host retries that delivery instead of running the program
- **AND** the saved result and its identities are preserved

#### Scenario: Start again only through the explicit action

- **WHEN** a saved result exists and the user starts a new execution through the explicit action
- **THEN** the host captures the latest configuration and file contents for a new execution of the same entry
- **AND** the earlier saved result is no longer offered for delivery

#### Scenario: No new execution while the entry is owned

- **WHEN** an execution is active or stopping for the entry
- **THEN** the new-execution action is not offered
- **AND** the interface offers only the applicable control for that execution

### Requirement: Held saved result is explained in the drawer

The card and drawer SHALL identify a saved result whose delivery is held, and the drawer SHALL present, above the section content, a highlighted notice that states the reason in plain language together with the bounded facts that produced it. The facts SHALL name the blocking background job or schedule by its bounded label, the pending user work by kind, or the structural condition that refused delivery. The notice SHALL also state what the user can do about that reason. It SHALL be derived from durable state, so it survives closing and reopening the drawer and a host restart, and it SHALL disappear once the hold record is cleared. The host SHALL record at most one bounded diagnostic per hold-reason change and SHALL NOT append a task-history row per delivery attempt, retry, or polling iteration. A failed delivery SHALL remain presented as its own state with its own recovery, not as a silent hold.

#### Scenario: Name the job that blocks delivery

- **WHEN** a saved result is held because a background job still runs for the task's conversation
- **THEN** the drawer notice names that job by its bounded label
- **AND** it states that delivery resumes when the job settles or is cancelled

#### Scenario: Name pending user work

- **WHEN** a saved result is held by a pending question, approval, or queued prompt
- **THEN** the drawer notice names the kind of work that is pending
- **AND** the card keeps a short held label

#### Scenario: The notice survives a restart

- **WHEN** the host restarts while a saved result is held
- **THEN** reopening the card's drawer presents the same hold reason without a new delivery attempt being required
- **AND** no task-history row was added for the refusal

#### Scenario: The notice clears with the reason

- **WHEN** the blocking condition clears and delivery is admitted
- **THEN** the notice disappears
- **AND** the card presents the destination entry instead of the held state

### Requirement: Cancel the background job that blocks a saved result

For a hold whose facts name a running background job, the drawer SHALL offer an action that cancels that job. The host SHALL accept the cancellation only for a job owned by one of the task's conversations, SHALL treat an already settled job as a completed request, SHALL cancel the job through the native job registry with a reason that names the saved-result recovery, and SHALL then attempt delivery of the saved result again without requiring a new Play. The action SHALL NOT be offered for a schedule, a subagent, pending user work, or any structural condition, and the host SHALL refuse a cancellation request that the current hold does not name.

#### Scenario: Cancel the blocking job and deliver

- **WHEN** the drawer cancel action is used for the job named by the current hold
- **THEN** the host cancels that job and records the cancellation reason
- **AND** it attempts delivery of the saved result again
- **AND** the program is not executed again

#### Scenario: Refuse a job the task does not own

- **WHEN** a cancellation request names a job owned by another conversation
- **THEN** the host refuses the request with an actionable diagnostic
- **AND** the job keeps running and the saved result stays held

#### Scenario: An already settled job is not an error

- **WHEN** the named job settles before the cancellation request is processed
- **THEN** the request completes without an error
- **AND** delivery is still attempted again

#### Scenario: No cancel action for a non-job blocker

- **WHEN** the hold names pending user work, a schedule, a subagent, or a structural condition
- **THEN** the drawer does not offer a cancel action for it
- **AND** the notice states the action that does apply

### Requirement: Parameter editing surface

An entry's parameter editing surface SHALL be presented above the board and workflow-diagram content and SHALL NOT be clipped or overlapped by a stage, a column, a card, or the diagram canvas. It SHALL present every declared name with its optional description and an editable value field, SHALL allow the value list to scroll when the declaration exceeds the available height, and SHALL keep its save, cancel, and close actions reachable while it scrolls. Opening it SHALL NOT change the entry, the workflow, or the execution, and closing it without saving SHALL discard the draft. The surface SHALL return focus to the control that opened it when dismissed without saving.

#### Scenario: Edit parameters from the workflow diagram

- **WHEN** the user opens the parameter editor from a card inside a stage of the workflow diagram
- **THEN** the editor is presented above the stage and the diagram canvas
- **AND** no stage or connection overlays it
- **AND** its fields and actions remain reachable

#### Scenario: Edit a declaration that exceeds the available height

- **WHEN** a declaration holds more values than fit in the editor
- **THEN** the value area scrolls
- **AND** the save and cancel actions remain reachable

#### Scenario: Dismiss without saving

- **WHEN** the user closes the parameter editor without saving
- **THEN** the entry keeps its current values
- **AND** no command is sent and the workflow is unchanged

### Requirement: Scripted execution state read

The plugin SHALL expose `get_script_execution`, a read-only read of one task's scripted-step state. It SHALL accept one task identifier and SHALL report: the current stage entry and whether the execution still owns it; the execution phase; whether a saved result exists and its delivery status; the saved result's chosen exit, message, and destination stage; the hold record that currently withholds delivery, including its code, the observation moment, the pending user-work kinds, and the bounded background facts; the entry-bound parameter values together with the declared names, and which declared names hold no value; the captured executable version identifier and the captured source form; the attempt and restart counts; and a bounded list of the task's most recent execution and handoff records with their outcome and moment.

It SHALL NOT start, stop, retry, or deliver an execution; SHALL NOT approve an executable version; SHALL NOT append a history row or a diagnostic record; SHALL NOT route or move a task; and SHALL NOT change the board. It SHALL NOT carry a stored variable value, a secret, or captured program source. When the calling host cannot run scripted stages, it SHALL report the stage and that execution is unavailable instead of reporting a failed execution.

#### Scenario: Explain why a saved result is not delivered

- **WHEN** an agent reads the execution state of a task whose saved result is held
- **THEN** the result names the hold code and the bounded facts behind it
- **AND** it names the saved result's exit and destination
- **AND** it reports the recent execution records

#### Scenario: Read an execution that has no saved result yet

- **WHEN** an agent reads the execution state of a task whose program is still running
- **THEN** the result reports the phase and the attempt count
- **AND** it reports that no saved result exists

#### Scenario: Read a task with no scripted execution

- **WHEN** an agent reads the execution state of a task whose stage authors no program
- **THEN** the result reports that the task holds no scripted execution
- **AND** no execution is started

#### Scenario: Read without changing anything

- **WHEN** an agent reads the execution state
- **THEN** no history row, diagnostic, revision, or board change is recorded
- **AND** no delivery is attempted

#### Scenario: Report a host without scripted execution capability

- **WHEN** an agent reads the execution state on a host that cannot run scripted stages
- **THEN** the result reports that execution is unavailable on that host
- **AND** it does not report the execution as failed

### Requirement: Isolated script test execution

The plugin SHALL expose `test_script`, which runs one stage's authored program against a caller-supplied input and a simulated shell, so a program can be debugged without changing a card, a workflow, an entry, or a team document. It SHALL accept one board identifier, one stage identifier, the parameter values for that stage's declaration, a list of simulated shell responses, and an optional default response, and it MAY accept one project of the board whose directory the program sees.

Each simulated response SHALL associate a match with a shell result: the exit code, the standard output text, and the standard error text. A `tools.bash` call SHALL be resolved against the declared responses in order and SHALL use the first match; a call that matches none SHALL use the declared default when one was supplied. The result SHALL report every shell call the program made, in order, with the command it requested, the response that resolved it, and the output the program received.

The result SHALL report the program's chosen exit, its message, the destination stage that exit names in the stage's current authored configuration, the program's own output, and the failure classification when the program failed to produce a completion. Parameter values SHALL be validated against the stage's declaration before anything runs, and a missing or undeclared value SHALL fail the call with an actionable problem. Both the parameter values and the simulated shell results SHALL be bounded, and every reported text SHALL be bounded.

The test execution SHALL verify, before running anything, that the provider holds the same isolated program-runtime contract a real execution requires, and SHALL refuse a provider that retains state, evaluates in process, or uses any format other than a fresh isolated function-body program. It SHALL run the authored program in that contract, with no filesystem, network, or process binding other than the simulated shell. The result SHALL report the shell calls the program made, bounded, and SHALL count any it leaves out. It SHALL NOT capture or store an executable version, request or grant an executable-version approval, create or take a stage entry, create a conversation or worktree, deliver a handoff, route a task, append a history row, record a revision, or change a workflow. It SHALL NOT resolve the shell from the host's native execution capability, and a program that requires a real shell SHALL fail with the simulated result instead of reaching the host. A Bash primary program SHALL be refused with an actionable problem, because a Bash program is the shell script itself and no simulated shell can stand in for it.

#### Scenario: Debug a program that reads a command output

- **WHEN** an agent tests a stage's program with parameter values and a simulated response for a command it expects
- **THEN** the program receives the simulated output
- **AND** the result reports that command, the response that resolved it, the chosen exit, the message, and the destination that exit names

#### Scenario: Fall back to the default response

- **WHEN** the program runs a command that matches no declared response and a default response was supplied
- **THEN** the call receives the default response
- **AND** the result names the response that resolved it

#### Scenario: Report a command no response covers

- **WHEN** the program runs a command that matches no declared response and no default was supplied
- **THEN** the call does not reach the host shell
- **AND** the result reports the command that was not covered and the failure the program saw

#### Scenario: Reject values that do not match the declaration

- **WHEN** a caller supplies a missing or undeclared parameter value
- **THEN** nothing runs and the problem names the accepted names

#### Scenario: Test without touching a card

- **WHEN** an agent tests a stage's program
- **THEN** no task, stage entry, execution, handoff, history row, revision, or workflow changes
- **AND** no executable version is captured or approved
- **AND** no approval is requested

#### Scenario: Refuse a provider that is not isolated

- **WHEN** the host's TypeScript provider retains state, evaluates in process, or is not a function-body program
- **THEN** the test is refused with the executable-format problem
- **AND** the program body is not evaluated

#### Scenario: Bound a long run of shell calls

- **WHEN** a tested program runs more shell commands than one result lists
- **THEN** the result lists the bounded set
- **AND** it states how many calls it left out

#### Scenario: Refuse to test a Bash program

- **WHEN** a caller tests a stage whose program is Bash
- **THEN** nothing runs and the problem says a Bash program is the shell script itself
- **AND** no shell command is executed

#### Scenario: Testing never reaches the real shell

- **WHEN** a tested program runs any command
- **THEN** the command resolves against the simulated responses
- **AND** the host's native shell capability is not used
