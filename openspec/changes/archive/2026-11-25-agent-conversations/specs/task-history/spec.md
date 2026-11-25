# Spec Delta

## ADDED Requirements

### Requirement: Held message facts

The task's flow record SHALL include the discard of a message that was held for a stage the flow never reached, and SHALL keep the released identity of each message already delivered so a replay cannot requeue it. The entry SHALL name the stage the message waited for, the agent conversation it was for when it was not the main one, and why it could never be delivered, distinguishing a stage the workflow stopped defining from a task that reached a terminal stage without entering it. A discard SHALL be recorded once per message; a repeated reconciliation of the same task SHALL NOT add another entry. A message that is released and delivered SHALL produce no discard entry.

#### Scenario: Record a discarded message

- **WHEN** a message held for a stage is discarded because the workflow no longer defines that stage
- **THEN** the record gains one entry naming the stage, the conversation it was for, and that reason

#### Scenario: Record a terminal discard

- **WHEN** a task reaches a terminal stage without entering the stage a held message waited for
- **THEN** the record gains one entry naming that stage and the terminal reason

#### Scenario: Do not repeat a discard

- **WHEN** the held messages of a task are reconciled twice
- **THEN** the record carries one entry for each discarded message, not one per reconciliation

#### Scenario: Deliver instead of recording

- **WHEN** a held message reaches the stage it waited for
- **THEN** no discard entry is recorded for it
