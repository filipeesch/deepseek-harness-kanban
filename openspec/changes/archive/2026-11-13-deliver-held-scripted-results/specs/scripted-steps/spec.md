# Spec Delta

## MODIFIED Requirements

### Requirement: Structured completion and exact named routing

A successfully completed script SHALL return an object containing a nonempty exit name and a nonempty message. TypeScript SHALL return that object as its completion value. A standalone Bash script SHALL exit successfully and emit exactly one JSON completion object on stdout; diagnostic output SHALL use stderr. The host SHALL reject missing, malformed, truncated, oversized, or nonconforming completion values and SHALL NOT infer an exit from log text. A valid mapped exit SHALL select exactly its captured destination, not the first configured transition or the next stage in display order. Distinct exit names MAY select the same stage. Before admitting the move, the host SHALL confirm that the task still owns that run, the same captured destination stage still exists by stable identity, and applicable task-context and pending-user-work guards permit delivery. The trusted captured mapping SHALL remain the authority for that run even when the saved workflow changes its exits; the host SHALL NOT substitute the new mapping or reject an otherwise valid captured route solely because it is absent from the latest saved exit list. A result held by those guards SHALL remain durable without polling the external system again. Whenever delivery of the current result is refused by a task-context, pending-work, or conversation guard, the host SHALL persist on the entry that owns the result a bounded hold record naming a stable reason code, the bounded facts that produced the refusal, and when it was observed. A request that no longer matches the entry, execution, attempt, or result it was admitted for, or that was cancelled while its checks awaited, SHALL be retried on the next event and SHALL NOT persist a hold against another entry. The hold record SHALL be replaced when the reason changes and cleared once delivery is admitted or settled. When an event reports that the blocking condition changed, the host SHALL attempt delivery of the saved result again with its existing execution and delivery identities, and SHALL NOT require a new Play for that retry. A conversation read that cannot produce a verdict SHALL be recorded as its own reason rather than as an unqualified refusal. A script result SHALL NOT authorize an otherwise required manual transition override.

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

## ADDED Requirements

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