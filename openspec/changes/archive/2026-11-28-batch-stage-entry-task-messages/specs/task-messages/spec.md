## MODIFIED Requirements

### Requirement: Deferred delivery into a target stage

A message to the sending task that names a destination stage SHALL be held instead of delivered. The held message SHALL carry a delivery identity derived from the sending conversation and the tool call, the sender, the target agent or the main conversation, the destination stage, the body, and the time, and SHALL be stored on the task as local state that is never published or shared. Writing it SHALL be idempotent per delivery identity, and a call that names a stage the task's workflow does not define SHALL be rejected without storing anything.

The host SHALL release a held message when the task first enters its destination stage. When an entry instruction and held messages resolve to the same conversation, the first model step that executes the instruction SHALL include all eligible held messages immediately after the instruction, in hold-queue order. Each SHALL remain a separate plugin-sourced native context message with its own delivery identity. Those messages SHALL NOT reach an unrelated step or start a separate step or turn for their delivery. The same rule SHALL apply to manual, timed, automatic, confirmed, and scripted entry instruction delivery. When a held message resolves to a different conversation, it SHALL be delivered separately after the instruction is admitted. When the destination authors no instruction, the message SHALL be delivered immediately after the placement. A same-stage reorder SHALL NOT release anything, because it is not an entry.

A same-conversation message SHALL NOT be marked released unless the native conversation durably records its acceptance into the step. An aborted or rejected step that never records the message SHALL leave it held for an eligible retry. An instruction from a superseded stage entry SHALL NOT release held messages. A released message SHALL be removed from the hold queue together with a durable record of its released identity, so a replayed tool call with the same identity neither queues nor delivers it again, and a release interrupted before that record leaves the message held for the next delivery attempt of that entry. The message SHALL NOT be delivered while the task remains in an earlier stage, SHALL NOT count as pending user work, and SHALL NOT itself arm or prevent an automatic advance; the turn it may start is an ordinary turn.

The host SHALL discard a held message that can no longer be delivered — because the workflow no longer defines its destination stage, or because the task reached a stage no route of any kind leaves without entering the destination — and SHALL record that discard in the task's history naming the agent or main conversation it was for and the stage it waited for. A decision gate and a scripted stage are terminal only when they configure no exit at all. The discard SHALL be recorded with the removal, before the workflow save that stranded it reports success. Deleting the task SHALL remove its held messages. A message that names no destination stage SHALL keep the immediate delivery defined by Message delivery as conversation context.

#### Scenario: Hold a message for a later stage

- **WHEN** an agent sends a message to its own task naming a stage and an agent or the main conversation
- **THEN** no message is delivered at that moment
- **AND** the message is held on the task for that stage

#### Scenario: Release with the destination instruction

- **WHEN** the task enters the destination stage with one or more held messages addressed to the instruction's resolved conversation
- **THEN** the first model step that executes the instruction receives those messages immediately after it in queue order
- **AND** each keeps its own delivery identity and is released once without creating a second step or turn for delivery

#### Scenario: Keep held messages out of unrelated work

- **WHEN** the resolved conversation processes an unrelated model step before it executes the destination instruction
- **THEN** that unrelated step does not receive any held message for the instruction

#### Scenario: Recover an interrupted same-conversation release

- **WHEN** a step is rejected or canceled before the conversation records a held message
- **THEN** the unrecorded message remains held for an eligible retry
- **AND** if native history already records another held message whose release marker was not saved, recovery marks it released without delivering it again

#### Scenario: Ignore a superseded instruction

- **WHEN** an instruction queued for a prior entry reaches a conversation after that entry was replaced, including on a later visit to the same stage
- **THEN** that instruction does not release any held messages for the current entry

#### Scenario: Release as its own message

- **WHEN** the task enters the destination stage and that stage's instruction targets another conversation, or the stage has no instruction
- **THEN** the held message is delivered to its own conversation after placement and after instruction admission if there is an instruction
- **AND** no instruction is fabricated for it

#### Scenario: Keep a message held before its stage

- **WHEN** the task has not yet entered the destination stage
- **THEN** the message is not delivered
- **AND** it does not count as pending user work and does not affect an automatic advance

#### Scenario: Discard a message whose stage disappeared

- **WHEN** the workflow stops defining the destination stage before the task enters it
- **THEN** the message is discarded and never delivered
- **AND** the task history records the discard and the stage it waited for

#### Scenario: Discard a message the flow never reaches

- **WHEN** the task reaches a terminal stage without entering the destination stage
- **THEN** the message is discarded and never delivered
- **AND** the task history records the discard

#### Scenario: Keep an undeliverable stage out of the queue

- **WHEN** an agent names a stage the workflow does not define as the destination
- **THEN** the call is rejected with an actionable error
- **AND** nothing is held
