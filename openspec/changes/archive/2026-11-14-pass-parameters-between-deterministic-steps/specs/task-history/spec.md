# Spec Delta

## ADDED Requirements

### Requirement: Handoff parameter values are recorded and presented

The flow record SHALL include, on the logical deterministic handoff entry for that delivery, the bounded and redacted parameter values the source script sent with its result. The values SHALL be recorded when the handoff's acceptance or failure settles, SHALL NOT be rewritten by a later delivery retry that reuses the same delivery identity, and SHALL NOT be attributed to the destination's execution. The destination's own execution entry SHALL continue to record only the parameter values that execution received and used. The History section SHALL present those sent values on the handoff row's Detail, identified as values sent by the source, without presenting them as values the destination executed with and without claiming a stage change that did not happen. A handoff row recorded before this capability SHALL remain present and SHALL read without sent values rather than being backfilled. The row SHALL remain a non-stage row and SHALL NOT expose configured secret values.

#### Scenario: Record the values a handoff carried

- **WHEN** a script result carrying parameter values is accepted by its destination entry
- **THEN** its handoff entry stores those values bounded and redacted
- **AND** the destination execution entry records only the values that execution actually received

#### Scenario: Record a failed handoff without a destination execution

- **WHEN** a script result carrying parameter values is recorded as failed delivery
- **THEN** the handoff entry retains the sent values and the failure diagnostic
- **AND** no destination execution entry is invented

#### Scenario: Read the values a handoff carried

- **WHEN** the user opens the History section of a task whose handoff carried parameter values
- **THEN** that handoff row's Detail names the sent values with their names
- **AND** the row does not present them as the destination's execution values

#### Scenario: Omit sent values when none were sent

- **WHEN** a handoff carried no parameter values
- **THEN** the row presents only its existing message and routing detail
