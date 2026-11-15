# Spec Delta

## MODIFIED Requirements

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`.

`list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, the currently recorded transition together with the reason it carries, and, for every target stage that declares parameters, that target's declared parameter names with their optional descriptions.

`set_next_transition` SHALL act only on the task that owns the calling conversation: it SHALL offer no task identifier, and a call made outside a task conversation SHALL be rejected. It SHALL accept an optional target stage, an optional reason, and an optional parameter value set. A provided target SHALL be one of the current stage's configured targets and SHALL require a nonempty reason; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. An omitted target SHALL clear the recording and SHALL NOT require a reason.

A parameter value set SHALL be accepted only for a target that declares parameters. For that target the call SHALL supply exactly the declared names, each with a nonempty string value within the accepted per-value and total size limits; an unknown name, a missing declared name, an empty value, or an oversized value SHALL be rejected with an actionable error that names the accepted parameter names, so the agent can correct the declaration in the same turn. A parameter value set supplied for a target that declares no parameters SHALL be rejected. A parameter value set SHALL NOT be accepted together with a cleared or omitted target.

Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call, including the recorded parameter values when the recorded target declares parameters. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task during the call, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. A recorded transition SHALL arm the advance the task performs at the end of its next completed turn, whether or not auto mode is enabled. A rejected target, a rejected reason, a rejected parameter value set, or a missing required reason SHALL leave the task, its recorded transition, and its recorded parameters unchanged. The host SHALL revalidate the recorded parameter names against the destination's current declaration before the task enters it, and SHALL fail that transition with an actionable error rather than creating an entry whose declaration no longer matches.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition and the reason it carries

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures and a nonempty reason
- **THEN** the task records that transition together with that reason
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a declaration without a reason

- **WHEN** an agent calls `set_next_transition` with a target and no reason, or with a reason that is blank after trimming
- **THEN** the tool reports the rejection with an actionable error
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a reason over the accepted length

- **WHEN** an agent calls `set_next_transition` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the recorded reason is never a silent truncation of what the agent wrote

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared without requiring a reason
- **AND** the result reports that no transition is recorded

#### Scenario: Reject a target the stage does not configure

- **WHEN** an agent calls `set_next_transition` with a target that is not one of the current stage's configured targets
- **THEN** the tool reports the rejection
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a recording without configured transitions

- **WHEN** an agent calls `set_next_transition` for a task whose stage does not configure transitions
- **THEN** the tool reports that the stage has no configurable transitions
- **AND** the task is unchanged

#### Scenario: Recording does not move the task

- **WHEN** an agent declares or clears a transition
- **THEN** the task's stage and position are unchanged while the call runs
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Arm the advance with auto mode disabled

- **WHEN** an agent declares a transition for a task whose auto mode is disabled
- **THEN** the recording is stored and auto mode remains disabled
- **AND** the task's next completed turn advances to the declared stage

#### Scenario: Disarm the advance by clearing with auto mode disabled

- **WHEN** an agent clears the recorded transition of a task whose auto mode is disabled
- **THEN** the task does not advance at the end of its next completed turn

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls `set_next_transition` inside a task conversation
- **THEN** the recording applies to the task that owns that conversation
- **AND** the tool offers no way to name another task

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls `set_next_transition` in an ordinary DSH chat
- **THEN** the tool rejects the request with an actionable error
- **AND** no task records a transition

#### Scenario: Read another task from an ordinary chat

- **WHEN** an agent calls `list_allowed_transitions` with an explicit task identifier
- **THEN** the result describes that task's stage and targets
- **AND** no task state changes

#### Scenario: Report a target's declared parameters

- **WHEN** a configured target's stage declares a pipeline and an app parameter with descriptions
- **THEN** `list_allowed_transitions` reports both names and descriptions for that target
- **AND** it reports no parameters for a target whose stage declares none

#### Scenario: Record a transition with every declared parameter

- **WHEN** an agent calls `set_next_transition` with a target that declares two parameters and supplies both values and a reason
- **THEN** the task records the transition together with those values
- **AND** the result reports the recorded values
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a missing or unknown parameter

- **WHEN** an agent supplies a value set that omits a declared name, adds an unknown name, or carries an empty or oversized value
- **THEN** the tool reports the rejection and names the accepted parameter names
- **AND** the task, its recorded transition, and its recorded parameters are unchanged

#### Scenario: Reject parameters for a target that declares none

- **WHEN** an agent supplies a parameter value set for a target whose stage declares no parameters
- **THEN** the tool reports the rejection
- **AND** the task records no transition

#### Scenario: Fail a placement whose declaration changed

- **WHEN** a recorded target's declaration changes between the recording and the placement so the recorded values no longer match
- **THEN** the transition fails with an actionable error instead of creating an entry
- **AND** the task remains in its current stage
