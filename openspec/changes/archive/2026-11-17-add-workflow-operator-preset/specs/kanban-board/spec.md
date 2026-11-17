## MODIFIED Requirements

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including optional root workflow and stage descriptions, the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, each stage's stored size, the board's default presentation, and an optional stable stage identity for each stage. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. For manual moves, the product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping.

A stage's stable identity SHALL be a value distinct from the stage identifier, SHALL be unique within the board, SHALL be preserved when the identifier or any other stage field is edited, and SHALL be preserved by every edit that does not present it. A workflow whose stages carry no stable identity SHALL be accepted: the configuration is valid without one, and an identity SHALL be assigned before the stage is published to a team. An authored field the editor does not present SHALL survive an edit unchanged.

This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

A stage SHALL additionally support the scripted configuration defined by `scripted-steps`. A scripted stage SHALL NOT author a nonempty entry instruction or an allowed transitions list. Its named exit mappings SHALL be its configured destinations for workflow access and graph presentation; several exits MAY resolve to the same destination, which SHALL be presented as one connection to that destination. The exit names SHALL NOT be presented on the diagram's connections; each exit name and the destination it resolves to SHALL remain presented and editable in the stage editor. A scripted stage SHALL NOT obtain a default route from the first exit or from workflow order. Exit names SHALL NOT be executable interpretations of a legacy transition condition, and legacy conditions SHALL retain their documentary meaning. A script SHALL NOT supply or override a destination stage identifier.

Optional root and stage descriptions SHALL retain authored content in YAML and the normalized workflow; a missing or blank description SHALL be represented as absent without inventing text. No 150-character schema limit SHALL be imposed on other authors. Unrelated edits SHALL preserve authored descriptions and exact YAML text. Legacy workflows, including those whose stored normalized state omitted an authored stage description, SHALL be read using a versioned migration or equivalent compatibility projection before strict consistency checks without rewriting YAML or hashes. Description changes SHALL participate in semantic comparisons, revision and diff, creation and incremental events, replay, restore, and merge/conflict detection. Team publication and synchronization SHALL preserve them, and incompatible peers SHALL report incompatibility rather than silently discard them.

#### Scenario: Render a configured column group

- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition

- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation

- **WHEN** a user requests a move that the active board's workflow does not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

#### Scenario: Read a stage's stored size

- **WHEN** the active board's workflow stores a size for a stage
- **THEN** the board presents that stage at that size, bounded by the minimum size

#### Scenario: Reject an invalid stage size

- **WHEN** a workflow configuration stores a stage size that is not a finite number, is below the minimum, or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Do not enforce a WIP capacity

- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow

- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

#### Scenario: Reject an unsupported default presentation

- **WHEN** a workflow configuration sets a default presentation other than the column board or the workflow diagram
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Accept a bare transition identifier

- **WHEN** a stage configures a transition as a bare target identifier
- **THEN** the workflow is accepted and the transition is drawn and followed as before

#### Scenario: Accept a transition with a condition

- **WHEN** a stage configures a transition as a mapping with a target identifier and a condition
- **THEN** the workflow is accepted and the condition is kept with that transition

#### Scenario: Accept a mixed transition list

- **WHEN** one stage mixes bare target identifiers and conditioned transitions in the same list
- **THEN** the workflow is accepted and every entry describes one transition

#### Scenario: Reject a transition to an unknown stage

- **WHEN** a stage configures a transition whose target stage does not exist
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Keep the permitted set unchanged by a condition

- **WHEN** a stage configures the same targets with and without conditions
- **THEN** the same requests are permitted and the same requests require confirmation

#### Scenario: Keep a stage identity across an identifier rename

- **WHEN** a workflow configuration carries a stable identity for a stage and that stage's identifier is edited
- **THEN** the stage keeps its stable identity
- **AND** the resulting workflow is accepted

#### Scenario: Accept a workflow without stage identities

- **WHEN** a board whose stages carry no stable identity is opened
- **THEN** the configuration is accepted and the board renders normally
- **AND** no identity is fabricated while the board stays unpublished

#### Scenario: Preserve an authored identity the editor does not present

- **WHEN** the user edits one stage of a workflow whose stages carry stable identities
- **THEN** every stage keeps its authored identity
- **AND** no identity is moved to another stage

#### Scenario: Accept a scripted stage without changing legacy conditions

- **WHEN** a workflow configures a scripted stage with named exits and another stage with documentary transition conditions
- **THEN** the scripted configuration is validated by the same workflow semantics as the host
- **AND** its exits determine its configured destinations without selecting a default exit
- **AND** the other stage retains its conditions and permitted targets unchanged

#### Scenario: Draw one connection for several exits without naming it on the path

- **WHEN** a scripted stage maps two exit names to the same other stage
- **THEN** the diagram draws one connection to that destination
- **AND** that connection presents no exit name
- **AND** the stage editor presents both exit names and the destination they share

#### Scenario: Accept and preserve optional descriptions

- **WHEN** a workflow authors root and stage descriptions and an unrelated field is edited
- **THEN** both descriptions and their authored text remain unchanged
- **AND** missing or blank descriptions are treated as absent without generating text
- **AND** a description longer than 150 characters is not rejected for its length alone

#### Scenario: Read a legacy omitted stage description

- **WHEN** a legacy workflow's YAML contains a stage description omitted from its stored normalized state
- **THEN** the board loads the description through a compatible projection before consistency validation
- **AND** neither the authored YAML nor its digest is rewritten merely by loading

#### Scenario: Preserve descriptions across history and sharing

- **WHEN** a description is changed, published, synchronized, replayed, or restored
- **THEN** the changed description participates in semantic history and conflict detection
- **AND** a peer unable to preserve it reports incompatibility rather than silently discarding it

### Requirement: Automatic advance after a completed turn
When a conversation of a task whose auto mode is enabled or whose ordinary reason-carrying recorded transition resolves, or whose eligible exceptional recorded transition belongs to that conversation and turn, ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, and the task does not carry the pause requested by the agent, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. An ordinary blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them. The host SHALL NOT admit an advance while the task carries the agent-requested pause defined by Agent-requested task pause; that pause SHALL NOT be recorded again or cleared by the evaluation, and a later completed turn SHALL re-evaluate it without advancing.

For an exceptional recording, the host SHALL consume it only on the observed `completed` end of its exact originating open turn in its calling session and task entry. The host SHALL revalidate that identity, the recorded value, source entry, destination, and all admission guards in the serialized admission transaction. Invalidation or cleanup SHALL compare the exception identity with the current recorded declaration and SHALL NOT clear or alter a newer replacement recorded concurrently. If that turn fails, aborts, is interrupted, cannot be verified, or cannot be admitted because the task is held, paused, busy, or otherwise fails a guard, the unadmitted exception SHALL be discarded or invalidated and SHALL NOT be retried by a later turn or resurrected as an auto-mode destination. An already admitted advance SHALL remain durable under existing dispatch and recovery rules. Independently enabled auto mode SHALL continue its normal behavior after the exception is gone.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

This trigger SHALL NOT advance a task out of an entry owned by durable scripted activation or control state, including an entry waiting for trust, running, stopped, failed, or awaiting result delivery. That ownership SHALL NOT be recomputed from a later saved YAML mode: switching the saved stage to agent or manual mode SHALL NOT enable a conversation turn to bypass the captured run or its stopped state. A completed turn from one of its conversations SHALL NOT replace the named result of that entry or restart its program. The no-catch-up rule above SHALL remain a rule about unobserved conversation turns; automatic recovery of a previously active scripted run SHALL follow `scripted-steps` without replaying a conversation turn.

#### Scenario: Advance after a completed turn
- **WHEN** the only open conversation of an armed task ends a completed turn and the task has no pending user work
- **THEN** one automatic advance is admitted

#### Scenario: Do not advance after a non-completed turn
- **WHEN** a turn ends as `error`, `blocked`, `aborted`, or `max-tokens`
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** a pause reason naming the ending is recorded

#### Scenario: Wait for every conversation to become idle
- **WHEN** a completed turn ends while another open conversation of the same task is running a turn or awaiting a reply
- **THEN** no advance is admitted at that moment
- **AND** the next completed turn re-evaluates the task

#### Scenario: Wait while an unanswered question round exists
- **WHEN** a completed turn ends while any conversation of the task has an unanswered structured question round
- **THEN** no advance is admitted
- **AND** no pause reason is recorded
- **AND** the auto-mode control presents the held state

#### Scenario: Wait while a user message is queued
- **WHEN** a completed turn ends while any conversation of the task has a user message queued for the next turn
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a pending approval exists
- **WHEN** a completed turn ends while any conversation of the task has an approval or native question awaiting the user
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a closed conversation has pending user work
- **WHEN** a completed turn ends while a closed conversation of the task has pending user work
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Advance after the pending work is consumed
- **WHEN** pending user work is consumed and a later turn ends as `completed` with no pending user work in the task
- **THEN** one automatic advance is admitted

#### Scenario: Consuming pending work does not advance by itself
- **WHEN** the task's last pending user work is consumed without a completed turn ending
- **THEN** no advance is admitted
- **AND** the task remains in its current stage

#### Scenario: Re-validate pending user work at admission
- **WHEN** pending user work appears after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged
- **AND** the next completed turn re-evaluates the task

#### Scenario: Do not advance a busy task
- **WHEN** a completed turn ends while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage
- **THEN** no advance is admitted
- **AND** no pause reason is recorded for that condition

#### Scenario: Do not advance a task paused by the agent
- **WHEN** a completed turn ends while the task carries the pause requested by the agent
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** the recorded pause and its reason are unchanged

#### Scenario: Re-evaluate the agent pause at admission
- **WHEN** the pause requested by the agent is recorded after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

#### Scenario: Advance with the board closed
- **WHEN** a completed turn ends while the Kanban board is not displayed and the task has no pending user work
- **THEN** the advance is admitted and dispatched
- **AND** the card shows its result when the board is displayed again

#### Scenario: Keep an admitted advance across a reload
- **WHEN** the user reloads the interface while an admitted advance has not been dispatched
- **THEN** the advance is still dispatched
- **AND** it is not duplicated

#### Scenario: No catch-up after a restart
- **WHEN** the host starts and a task's last turn ended while the host was not observing it
- **THEN** no advance is admitted for that turn
- **AND** the task remains in its stage until its next completed turn

#### Scenario: Ignore incidental turns in a scripted entry

- **WHEN** a task occupies a scripted entry and one of its conversations completes a turn with Auto mode enabled
- **THEN** that turn admits no advance out of the scripted entry
- **AND** its run, stopped state, captured configuration, and pending handoff are not changed

#### Scenario: Admit only the exceptional originating turn
- **WHEN** an eligible exceptional recording is made in a task conversation and that same observed turn ends as `completed` with every admission guard satisfied
- **THEN** exactly one advance to the exceptional destination is admitted regardless of auto mode
- **AND** the admitted advance remains durable across reload and restart

#### Scenario: Another conversation or turn cannot consume an exception
- **WHEN** a different conversation or a later turn completes while an exceptional recording is unadmitted
- **THEN** that completion cannot consume the exception
- **AND** the exception cannot be reused as an auto-mode destination

#### Scenario: Fail closed on a held or busy exceptional advance
- **WHEN** the originating turn completes but pending user work, a pause, another running turn, an unresolved operation, or another admission guard prevents admission
- **THEN** no exceptional advance is admitted and the exception is invalidated
- **AND** clearing the hold or a later completed turn cannot revive it

#### Scenario: Fail closed on an unverified exceptional turn
- **WHEN** the originating turn fails, aborts, is interrupted, is not verifiably observed, or the host restarts before admission and loses its identity
- **THEN** the unadmitted exception is invalidated and is not replayed
- **AND** any later ordinary auto-mode advance follows normal rules without using it

### Requirement: Automatic advance destination and dispatch

A completed turn SHALL advance the task when its auto mode is enabled or when a reason-carrying recorded transition for its current stage resolves, subject to the originating-turn restrictions and fail-closed admission of an exceptional recording. A recording stored without a reason arms nothing, as the recording requirement states. The advance SHALL NOT be admitted while the task owes the user anything as defined by Pending user work, while a context operation is pending, or while a confirmed transition is already recorded.

The destination SHALL be the stage of the task's ordinary recorded transition for its current stage while that transition resolves, or the eligible exceptional destination only for its matching originating completed turn. Otherwise, and only for a task whose auto mode is enabled, it SHALL be the first entry of the current stage's configured transitions, or the stage that follows the current stage in workflow order when the stage does not configure transitions. There SHALL be no default destination when the configured list is empty or the resolved stage is the current stage.

When the destination is the recorded transition, the advance SHALL move the task exactly to that stage and SHALL NOT continue resolution beyond it. While the default destination has neither an entry instruction nor scripted configuration, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction or scripted configuration, or at the last reachable stage when no reachable stage has either. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

An ordinary recorded transition that no longer resolves SHALL NOT be replaced by the default destination. In that case the host SHALL NOT advance the task. When the task's auto mode is enabled, the host SHALL pause auto mode with the `transition-stale` reason defined by Auto mode on a task card; a task whose auto mode is disabled SHALL stay in its stage without recording a pause. An ineligible or invalidated exceptional recording SHALL NOT become a default destination, and normal auto-mode behavior remains independent after it is gone.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be delivered to the task's first open conversation as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the reason the recorded transition carried and then by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies; when no conversation is open, a new conversation SHALL be created and used as the target. The delivered context message SHALL contain the stage instruction, the declared reason when one applies, and, when it applies, the briefing. An advance that consumed no recorded reason SHALL deliver no reason block. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt or a stage instruction is delivered.

A scripted destination SHALL admit its own authorized execution rather than create a conversation or consume an agent instruction marker. A named scripted result SHALL resolve exactly through the captured exit mapping of its execution, SHALL NOT select the first exit as a default, and SHALL NOT cross an intermediate manual or scripted destination to reach a later instructed stage. Protected destinations SHALL remain protected: the script SHALL NOT supply a destination or use a human-only override, and a missing or invalid authorized destination SHALL produce a visible failure instead of a fallback. A valid destination agent instruction SHALL additionally carry the scripted handoff defined by `task-conversations`, without mislabeling it as a recorded agent reason. For a scripted result, route authority SHALL come from the approved mapping captured by that execution, not a later authored allowed-target set. Editing an active exit from one destination to another SHALL not change or invalidate the approved captured destination merely because the latest configuration differs. Routing SHALL resolve the captured destination to the same stable stage after an identifier rename and SHALL reject identifier reuse by a different stage. It SHALL still validate the current entry and run, destination existence and stable identity, task context, and pending user work; it SHALL not use a generic human transition override to bypass those checks.

#### Scenario: Use the recorded transition

- **WHEN** the current stage configures multiple permitted transitions, the task recorded one of them, and a completed turn advances the task
- **THEN** the task moves to the stage of the recorded transition

#### Scenario: Advance on a declared transition without auto mode

- **WHEN** a task whose auto mode is disabled has a reason-carrying recorded transition for its current stage and its turn completes
- **THEN** the task moves to the stage of the recorded transition
- **AND** auto mode remains disabled

#### Scenario: Do not advance without auto mode or a recording

- **WHEN** a task whose auto mode is disabled has no reason-carrying recorded transition and its turn completes
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

#### Scenario: Hold the advance while the task owes the user

- **WHEN** a completed turn ends for a task whose auto mode is disabled and whose ordinary reason-carrying recorded transition resolves, and the task has pending user work
- **THEN** no advance is admitted
- **AND** the recorded transition is preserved

#### Scenario: Deliver the declared reason with the instruction

- **WHEN** an advance follows a recorded transition and the destination has an entry instruction
- **THEN** the delivered context message is the entry instruction, then the recorded reason, then the briefing when it applies

#### Scenario: Stop at the recorded destination

- **WHEN** the recorded transition names a stage without an entry instruction and a later reachable stage has one
- **THEN** the task moves exactly to the recorded stage
- **AND** no later stage is crossed and no instruction is sent

#### Scenario: Pause on a recorded transition that no longer resolves

- **WHEN** a completed turn would advance a task whose auto mode is enabled and whose recorded transition is no longer a configured target of its current stage
- **THEN** no advance is admitted
- **AND** auto mode is paused with the `transition-stale` reason
- **AND** the task remains in its current stage

#### Scenario: Do not pause a stale recording without auto mode

- **WHEN** a completed turn would advance a task whose auto mode is disabled and whose recorded transition no longer resolves
- **THEN** no advance is admitted
- **AND** no pause is recorded
- **AND** the task remains in its current stage

#### Scenario: Use the first configured transition

- **WHEN** the current stage configures multiple permitted transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order

- **WHEN** the current stage does not configure transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction

- **WHEN** the next stage has neither an entry instruction nor scripted configuration and a later reachable stage has an entry instruction
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is delivered

#### Scenario: Stop at the last reachable stage

- **WHEN** no reachable stage ahead has an entry instruction or scripted configuration
- **THEN** the task moves to the last reachable stage
- **AND** no instruction is sent

#### Scenario: Place at the top of the destination

- **WHEN** an advance is dispatched to a destination stage that already contains tasks
- **THEN** the task is placed before every existing card of that stage
- **AND** the existing cards retain their relative order

#### Scenario: Never revisit a stage

- **WHEN** the resolution would return to a stage it already visited
- **THEN** resolution stops before the repeat
- **AND** no advance loops

#### Scenario: Capture the instruction at admission

- **WHEN** the destination instruction changes after an advance is admitted
- **THEN** the admitted advance sends the captured instruction
- **AND** the task moves to the captured destination

#### Scenario: Target the first open conversation

- **WHEN** an advance with an instructed destination is dispatched and the task has open conversations
- **THEN** the first open conversation receives the instruction
- **AND** no conversation picker is presented

#### Scenario: Create the target conversation

- **WHEN** an advance with an instructed destination is dispatched and the task has no open conversation
- **THEN** one new conversation is created and receives the instruction
- **AND** no additional conversation is created

#### Scenario: Keep a failed destination entry unresolved

- **WHEN** the instruction cannot be delivered after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

#### Scenario: Stop default resolution at a scripted stage

- **WHEN** a default turn-driven advance reaches a scripted stage before a later instructed stage
- **THEN** the task stops in the scripted stage and admits that entry subject to local authorization
- **AND** no later stage is crossed or agent conversation created for the script

#### Scenario: Stop a named output at its exact destination

- **WHEN** a scripted result maps to a manual stage with a later instructed stage reachable beyond it
- **THEN** the task moves only to the mapped manual stage
- **AND** its output message is preserved as handoff without starting a later agent stage

#### Scenario: Keep the approved destination after an active mapping edit

- **WHEN** an active execution captured an approved exit to stage B and the saved workflow later maps that exit to stage C
- **THEN** its completed result still selects stage B if the same stable destination exists and current run, entry, context, and pending-user-work guards permit admission
- **AND** it neither follows C nor requests a generic human override merely because the latest mapping differs

#### Scenario: Follow a renamed target without accepting identifier reuse

- **WHEN** a captured destination has been renamed while retaining its stable identity
- **THEN** routing resolves the same destination under its new identifier
- **AND** a replacement stage that merely reuses the old identifier is not accepted as that destination

#### Scenario: Stop at an exceptional destination

- **WHEN** a matching completed turn admits an exceptional recorded route to an existing stage without an entry instruction
- **THEN** the task moves exactly to that stage and does not cross it
- **AND** any scripted destination remains subject to its own authorization and entry rules

#### Scenario: Resume ordinary auto mode after invalidation

- **WHEN** an unadmitted exception is invalidated and auto mode is independently enabled
- **THEN** a subsequent completed turn evaluates the normal configured or default route
- **AND** it does not use the invalidated exceptional destination

### Requirement: Recorded transition for the next advance

A task SHALL be able to record at most one transition for its current stage. An ordinary recorded transition SHALL name an existing stage that the current stage's configured transitions list and SHALL carry a reason written by the agent. An ordinary recording SHALL be rejected when the current stage does not configure transitions, when the named stage is the task's current stage, when the named stage is not one of the configured targets, or when it names no reason. The reason SHALL be nonempty after trimming; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. Clearing a recording SHALL require no reason. Recording, replacing, or clearing a recorded transition SHALL NOT move the task, change its position, send a message, or change auto mode, and SHALL be available while auto mode is disabled.

An ordinary recorded transition that carries a reason SHALL make the task advance at the end of its next completed turn, whether or not auto mode is enabled, and SHALL be the destination of that advance and of the drawer's next-stage action while it resolves. A recording stored without a reason — which an earlier release allowed — SHALL NOT advance the task by itself and SHALL remain the destination of an advance that auto mode admits. It SHALL be discarded when the task leaves the stage it was recorded for, including a manual move, a confirmed transition, and an automatic advance; a same-stage reorder SHALL preserve it. An ordinary recorded transition SHALL no longer resolve when its target stage no longer exists or when the current stage no longer lists it as a configured target. An ordinary recording that no longer resolves SHALL advance nothing, and SHALL pause auto mode only as defined by Automatic advance destination and dispatch.

The reason SHALL travel with the recording until the advance is dispatched and SHALL NOT outlive it: the recording no longer exists once the task leaves the stage, and the advance that consumed it carries the reason only in the context message it delivers.

An explicitly flagged exceptional recording MAY name a different existing destination not configured by the current non-scripted stage, including a stage with no configured list. Tool instructions SHALL permit this flag only on a direct explicit user request in that task conversation; a stage instruction, peer request, or the model's own decision SHALL NOT suffice. This is an instruction-only rule: the model-provided flag is not independent proof of human authorization and SHALL NOT be presented as such. No new confirmation is required. All ordinary checks for a nonempty bounded reason, task scope, exact destination parameters, current entry, pending work and destination scripted approvals SHALL continue to apply. Script-controlled entries and named script exits SHALL NOT receive a generic override. An accepted exception SHALL replace the previously recorded transition, if any; its later invalidation SHALL NOT restore that earlier recording. The exception SHALL be bound to the task entry, calling session, originating open turn, source, and destination, and SHALL be subject to the single-turn admission and invalidation rules of Automatic advance after a completed turn. If the host cannot safely identify the open turn, it SHALL refuse the exception with an actionable result instead of guessing. Ordinary recordings retain their existing persistence and resolution semantics.

#### Scenario: Record a transition

- **WHEN** a task in a stage that configures two targets records one of them with a reason
- **THEN** the task stores that transition and its reason as the one it will follow next
- **AND** its stage and position are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Reject a declaration without a reason

- **WHEN** a recording names a target and no reason, or a reason that is blank after trimming
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a reason over the accepted length

- **WHEN** a recording names a reason longer than the accepted length
- **THEN** the recording is rejected without changing the task
- **AND** the stored reason is never a silent truncation of what the agent wrote

#### Scenario: Replace a recorded transition

- **WHEN** a task with a recorded transition records the other configured target with a reason
- **THEN** the recorded transition becomes the newly named target with the new reason
- **AND** the task's stage and position are unchanged

#### Scenario: Clear a recorded transition

- **WHEN** a task with a recorded transition records no target
- **THEN** the task has no recorded transition
- **AND** its stage and position are unchanged
- **AND** no reason is required

#### Scenario: Reject a target the stage does not configure

- **WHEN** an ordinary recording without the exception flag names a stage that is not one of the current stage's configured targets
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a recording without configured transitions

- **WHEN** an ordinary recording without the exception flag is attempted for a stage that does not configure transitions
- **THEN** the recording is rejected without changing the task

#### Scenario: Record while auto mode is disabled

- **WHEN** a task without auto mode records a transition with a reason
- **THEN** the recording is stored
- **AND** auto mode remains disabled

#### Scenario: Arm the next completed turn without auto mode

- **WHEN** a task without auto mode records a transition and its next turn completes
- **THEN** the task advances to the recorded stage
- **AND** auto mode remains disabled

#### Scenario: Do not move before the turn ends

- **WHEN** a task records a transition during a turn
- **THEN** its stage and position are unchanged for the rest of that turn
- **AND** the advance happens at the end of the completed turn, or not at all when the turn ends otherwise

#### Scenario: Disarm the advance by clearing the recording

- **WHEN** a task without auto mode clears its recorded transition and its next turn completes
- **THEN** the task does not advance

#### Scenario: Keep a recording without a reason inert

- **WHEN** a task carries a transition recorded without a reason and its auto mode is disabled
- **THEN** its next completed turn advances nothing
- **AND** auto mode, when the user enables it, still uses that recording as its destination

#### Scenario: Discard the recording on leaving the stage

- **WHEN** a task with a recorded transition moves to another stage
- **THEN** the task no longer has a recorded transition
- **AND** its reason is discarded with it

#### Scenario: Preserve the recording across a same-stage reorder

- **WHEN** a task with an ordinary recorded transition is reordered inside its stage
- **THEN** the recorded transition and its reason are preserved

#### Scenario: Declare a directly requested exceptional route

- **WHEN** the user directly and explicitly asks the agent in the task conversation to move to a different existing unconfigured stage and the agent records it with the exception flag, a valid reason, and any required parameters
- **THEN** the route is bound to that task entry, session, and originating open turn
- **AND** recording alone neither moves the task nor changes auto mode

#### Scenario: Exception replaces the prior declaration

- **WHEN** an accepted exceptional declaration replaces an ordinary recorded transition and its originating turn later fails or cannot be admitted
- **THEN** the exception is invalidated
- **AND** the earlier ordinary declaration is not restored

#### Scenario: Exception cleanup preserves a newer declaration

- **WHEN** a newer declaration replaces an exception before the old exception is invalidated or admitted
- **THEN** identity-checked cleanup of the old exception does not clear or alter the newer declaration
- **AND** the old exception cannot be consumed

#### Scenario: Do not infer exceptional user intent

- **WHEN** a stage instruction, a peer, or the agent itself proposes an unconfigured route without a direct explicit user request
- **THEN** the tool instructions prohibit declaring it with the exception flag
- **AND** the flag itself is not independent evidence of authorization

#### Scenario: Refuse an unsafe or invalid exception

- **WHEN** an exceptional declaration names the current stage or an unknown stage, lacks a valid reason or required parameters, targets a script-controlled source, or its originating open turn cannot be safely identified
- **THEN** it is rejected without changing the task or replacing the prior recording
- **AND** inability to identify the turn is reported with an actionable result

#### Scenario: Retain manual restricted move confirmation

- **WHEN** a user manually requests a restricted move rather than an exceptional recorded route
- **THEN** the existing explicit confirmation and scripted authorization requirements remain in force

### Requirement: Transition briefing for an instructed stage

When a stage configures two or more transition targets and the host delivers that stage's entry instruction, the delivery SHALL include a host-generated briefing after the instruction and, when the delivery carries a declared transition's reason, after that reason. The briefing SHALL list every configured target with its stage name and its authored condition when the stage authored one, SHALL name the recorded transition when the task already recorded one for that stage, SHALL name the target that applies when nothing is recorded, and SHALL name the tool that records the choice together with its required reason. The briefing SHALL describe conditionally that an eligible declared transition is followed at the end of the completed turn. It SHALL NOT direct the agent to record a transition solely because the stage has multiple targets; an authored instruction or direct user request MAY direct a declaration. The briefing SHALL be derived from the active workflow at the moment of delivery and SHALL appear on every delivery path: the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, and the first execution of a task created by an agent. A stage that configures fewer than two targets SHALL produce no briefing, and its context message SHALL contain the entry instruction and, when one applies, the declared transition's reason.

When instruction delivery carries a scripted handoff, the handoff SHALL be a separate identified block after any declared agent reason and before this briefing. It SHALL NOT change the briefing's documentary conditions, configured destinations, or end-of-turn declaration guidance. A stage with fewer than two targets SHALL still receive its pending handoff even though it produces no briefing. The handoff SHALL NOT be presented as a reason the agent declared.

#### Scenario: Include the briefing with two or more targets

- **WHEN** the host delivers the entry instruction of a stage that configures two or more targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing

#### Scenario: Place the briefing after the declared reason

- **WHEN** the delivery carries both a declared transition's reason and a briefing
- **THEN** the message orders the instruction, then the reason, then the briefing

#### Scenario: Omit the briefing with one target

- **WHEN** the host delivers the entry instruction of a stage that configures exactly one target
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: Omit the briefing without configured transitions

- **WHEN** the host delivers the entry instruction of a stage that does not configure transitions
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: State the required reason and the end-of-turn timing

- **WHEN** the briefing names the tool that records the choice
- **THEN** it states that recording a destination requires a reason
- **AND** it states conditionally that an eligible declared transition is followed at the end of the completed turn

#### Scenario: List each target with its condition

- **WHEN** the briefing is generated for a stage whose targets carry authored conditions
- **THEN** every target is listed with its stage name and its condition
- **AND** a target without a condition is listed without one

#### Scenario: Name the target that applies without a recording

- **WHEN** the briefing is generated and the task has no recorded transition for that stage
- **THEN** the briefing names the target the host uses when nothing is recorded

#### Scenario: Name the recorded transition

- **WHEN** the briefing is generated and the task already recorded a transition for that stage
- **THEN** the briefing names the recorded transition

#### Scenario: Derive the briefing at send time

- **WHEN** the workflow changes between the admission of an instruction and its delivery
- **THEN** the briefing reflects the targets the stage configures at the moment of delivery

#### Scenario: Include the briefing on every send path

- **WHEN** a stage instruction is delivered by the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent
- **THEN** the delivered context message includes the briefing whenever the stage configures two or more targets

#### Scenario: Keep scripted handoff when no briefing applies

- **WHEN** an instructed destination receives a scripted handoff and configures fewer than two transition targets
- **THEN** its context message includes the instruction and the separate scripted handoff block
- **AND** no transition briefing is generated
- **AND** no agent-declared reason is fabricated

#### Scenario: Describe choices without commanding a route

- **WHEN** the host sends a briefing for a stage with multiple targets and neither the authored instruction nor the user requests a transition
- **THEN** the briefing describes the targets and declaration mechanism without directing the agent to declare one
- **AND** automatic mode remains a separate control

### Requirement: Board default agent preset

Each board's workflow SHALL accept an optional root `agent_preset` scalar naming the preset its new conversations start on. It SHALL be nonempty text, validated with the workflow, part of workflow meaning rather than layout, and consistent between parsed workflow and authored YAML. Invalid workflow fields or an empty preset SHALL NOT replace the last valid workflow. An authored preset SHALL take precedence over board-default metadata. A stored preset unavailable on the host SHALL remain stored and SHALL be reported as unavailable; host-default fallback SHALL remain available.

For a newly created board without an authored preset or explicit user choice, the product SHALL record a versioned implicit workflow-operator selection in board-owned shareable metadata separate from authored YAML. A user-selected host default SHALL be persisted as an explicit distinct choice; legacy absence on an existing board SHALL continue to mean host default. Imported or received already-authored boards SHALL NOT be reclassified as newly created. The effective choice and its origin SHALL be visible in board settings. These selections SHALL be preserved in schema validation, revisions, publication, synchronization, replay, conflict handling, and recovery; incompatible peers SHALL fail explicitly rather than discard them. No existing conversation or other board SHALL be changed by editing the choice.

#### Scenario: Accept a board default agent preset

- **WHEN** a workflow configures a root `agent_preset` with a preset identity
- **THEN** the configuration is accepted and the board keeps that preset as its default
- **AND** the stored parsed workflow and the authored YAML agree

#### Scenario: Keep the host default when the field is absent

- **WHEN** an existing legacy board has no root `agent_preset` and no board-default selection metadata
- **THEN** the configuration is accepted
- **AND** the board names no default agent preset of its own and new conversations use the host default

#### Scenario: Reject an empty preset

- **WHEN** a workflow configures a root `agent_preset` that is empty or blank
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count a preset change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in its `agent_preset`
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

#### Scenario: Preserve a stored preset the host no longer offers

- **WHEN** a board stores an `agent_preset` that is absent from the running host's roster
- **THEN** the stored value remains in the workflow
- **AND** the board configuration does not remove or rewrite it

#### Scenario: Default a new board without rewriting custom YAML

- **WHEN** a new board is created with custom YAML without an authored preset or other explicit selection
- **THEN** versioned shareable board metadata selects the workflow operator implicitly
- **AND** the supplied YAML bytes remain exact and an `expect_sha256` check and dry run use that exact document

#### Scenario: Honor an explicit authored or host-default choice

- **WHEN** a board is created with an authored preset or the user explicitly selects the host default
- **THEN** that explicit selection takes precedence over the implicit operator default
- **AND** explicit host default remains distinguishable from legacy absence

#### Scenario: Preserve shared and imported defaults

- **WHEN** a new board with operator-default metadata is published, synchronized, or restored
- **THEN** its selection and origin are preserved without rewriting authored YAML
- **AND** an imported existing board with no selection remains on the host default
- **AND** an incompatible peer reports incompatibility rather than losing the selection

### Requirement: Board default agent preset configuration

The Defaults sub-section of the board configuration SHALL present the agent preset the board's new
conversations start on, as a list of the presets the host reports as available, each with its name
and description, together with an explicit option that keeps the host default preset. Choosing the
host default preset SHALL remove the root `agent_preset` from the board's authored workflow YAML and persist an explicit host-default choice in board metadata.
Choosing an available preset SHALL store that preset identity as the root `agent_preset`, replacing any existing authored value. Choosing host default SHALL remove any existing authored preset. The explicit choice and corresponding metadata SHALL be updated atomically with the board's default model in the single guarded, reviewed write defined by Board default model configuration, preserving the text and comments outside the rewritten root fields. No conflicting implicit metadata SHALL override the explicit choice. This settings edit SHALL NOT be confused with new-board creation: creation with supplied custom YAML preserves that document's exact bytes and digest. A stored preset that the host does not report SHALL be presented as unavailable and SHALL be
kept as the current choice. When the roster cannot be read, the sub-section SHALL report the failure
with a retry action, SHALL keep presenting the stored preset, and SHALL NOT remove or rewrite it.

#### Scenario: Choose an available preset

- **WHEN** the user chooses an available preset in the Defaults sub-section and saves
- **THEN** the board's authored workflow YAML carries that identity as the root `agent_preset`
- **AND** the text and comments outside that field are unchanged

#### Scenario: Keep the host default preset

- **WHEN** the user chooses the option that keeps the host default preset and saves
- **THEN** the board's authored workflow YAML no longer carries a root `agent_preset`
- **AND** the explicit host-default choice is stored in board metadata
- **AND** the board's new conversations start on the host default preset

#### Scenario: Present a stored preset the host no longer offers

- **WHEN** the board's stored preset is absent from the presets the host reports
- **THEN** the Defaults sub-section presents the stored identity and states that it is unavailable
- **AND** the stored preset is neither removed nor rewritten

#### Scenario: Report a roster failure with retry

- **WHEN** the host's agent-preset roster cannot be read
- **THEN** the Defaults sub-section reports the failure and offers a retry action
- **AND** the stored preset remains presented and unchanged

#### Scenario: Replace an authored preset in settings

- **WHEN** a board already has an authored root `agent_preset` and the user selects another available preset in settings
- **THEN** one guarded reviewed write replaces the authored value and atomically updates the corresponding metadata
- **AND** the selected preset is effective without changing other YAML text or comments

#### Scenario: Explicitly select host default over an authored preset

- **WHEN** a board already has an authored root `agent_preset` and the user selects host default in settings
- **THEN** one guarded reviewed write removes that field and atomically records the explicit host-default metadata
- **AND** new conversations use the host default rather than the removed preset or implicit operator

#### Scenario: Show the effective default and origin

- **WHEN** the Defaults sub-section opens for an implicit operator default, explicit choice, or legacy absence
- **THEN** it shows the effective selection and its origin
- **AND** a missing operator preset is reported as unavailable without rewriting the selection

#### Scenario: Keep existing sessions and other boards unchanged

- **WHEN** the user changes this board's preset choice
- **THEN** other boards and existing conversations retain their choices
- **AND** only future conversations use the new effective default
