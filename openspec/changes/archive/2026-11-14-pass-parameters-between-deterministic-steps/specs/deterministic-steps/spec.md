# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
