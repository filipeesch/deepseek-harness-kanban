# Spec Delta

## ADDED Requirements

### Requirement: Deletion admitted by an agent is the same operation as deletion from the interface

A task deletion admitted by an agent through the product tool SHALL be the same durable operation the interface admits: it SHALL be recorded through the same confirmed deletion command, SHALL be ordered by the same host queue with one lane per repository, SHALL run the same authoritative preflight, SHALL archive the task conversations while retaining their histories, SHALL remove the card and its shared notes, SHALL keep the Git branch, and SHALL resume after a restart from the same journal. The agent path SHALL NOT introduce a second deletion implementation, a second confirmation surface, or a stronger cleanup.

The agent path SHALL keep every existing refusal: a task whose recorded context operation holds it, a confirmed target that no longer matches the recorded binding, a checkout shared with another task, and local changes that require a separate discard consent. The agent SHALL NOT be able to satisfy the discard consent, and SHALL NOT be able to force a shared checkout removal, through the product tool surface.

Because the tool returns without waiting for the cleanup, and the queued work may start before the result reaches the caller, the outcome SHALL be published exactly as the interface publishes it: success removes the card when the queued work finishes, and a failure is presented on the card status, the board destructive-operation notice, and the drawer operation status with the existing recovery actions. The tool result SHALL NOT be the record of success or failure.

#### Scenario: Admit an agent deletion and finish in the background

- **WHEN** an agent admits a deletion whose card is idle and whose checkout is removable
- **THEN** the operation is recorded and queued, and the tool returns without waiting for the cleanup
- **AND** the card, its shared notes, and its incident relations are removed once the background work finishes
- **AND** its conversations are archived with their histories retained and its Git branch is kept

#### Scenario: Wait for a running conversation instead of stopping it

- **WHEN** an agent admits a deletion whose card has a running conversation
- **THEN** the queued operation is recorded as waiting and no cleanup starts
- **AND** the deletion resumes after the conversations settle, without stopping them

#### Scenario: Report a queued preflight failure on the card

- **WHEN** the queued preflight of an agent-admitted deletion finds local changes, a shared checkout, or a changed target
- **THEN** the operation is recorded as failed with its failing phase and problem
- **AND** the card, the board notice, and the drawer present the failure with its recovery actions
- **AND** the tool result does not report the deletion as failed or as complete

#### Scenario: Refuse an admission that the interface would refuse

- **WHEN** an agent admits a deletion for a task that another context operation holds, or names a target that no longer matches the recorded worktree binding
- **THEN** the command is refused before an operation is recorded
- **AND** the applicable existing error and recovery surface are presented

#### Scenario: Resume an agent-admitted deletion after a restart

- **WHEN** the plugin starts and a task has a queued or in-progress deletion admitted by an agent
- **THEN** the host resumes that deletion in its repository lane exactly as it resumes an interface deletion
- **AND** no additional confirmation is requested

#### Scenario: Reach no stronger cleanup than the interface

- **WHEN** the agent-admitted deletion path is compared with the interface path for the same card
- **THEN** the same checkouts are removable, the same discard consent is required, and the same shared-checkout refusal applies
- **AND** the agent path removes nothing the interface path would keep
