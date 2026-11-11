# Spec Delta

## MODIFIED Requirements

### Requirement: Stage identifier editing

The editor SHALL present the stage identifier as read-only until the board reports no in-flight work, and SHALL present, when it is unavailable, why the identifier cannot be edited. The board SHALL count as having in-flight work when any task of the board has a running conversation, a pending transition, an armed automatic advance, an unresolved stage instruction, an operation in progress, or a worktree that is being prepared or is in error. The identifier field SHALL otherwise be editable, SHALL be validated as a safe identifier, and SHALL be rejected with an inline problem when it is empty or when another stage of the board already uses it.

Changing the identifier SHALL keep the board valid and SHALL keep every stage reference pointing at the same stage: the initial stage, group membership, other stages' allowed transition targets, and connection layouts SHALL be rewritten to the new identifier. Tasks that are idle in the edited stage SHALL be migrated to the new identifier by the same save, so no task is left in a stage the workflow does not define. The save SHALL be all-or-nothing: when any reference or task cannot be migrated, nothing SHALL be stored. Changing the identifier SHALL NOT change the stage's stable identity: the stage SHALL remain the same stage to everything that addresses it by identity, and the authored identity SHALL be preserved exactly as it was.

The identifier edit SHALL NOT require a confirmation step. On a board that is published to a team, the identifier SHALL remain editable, and the rename SHALL reach other members as a change to that stage's identifier rather than as a removal and a creation, so that each member migrates its own tasks in the same save that stores the resulting workflow. The rename SHALL NOT require a team review and SHALL NOT be blocked by another member's tasks.

#### Scenario: Keep the identifier read-only during in-flight work

- **WHEN** the board has a task with a pending transition and the user opens the stage editor
- **THEN** the stage identifier is read-only
- **AND** the editor explains why it cannot be edited

#### Scenario: Rename the identifier

- **WHEN** the board has no in-flight work, two idle tasks are in the edited stage, and the user changes the identifier and saves
- **THEN** both tasks are assigned to the new identifier
- **AND** every transition and group that named the old identifier names the new one
- **AND** the stage keeps its name, instruction, targets, size, and position

#### Scenario: Keep the stage identity across a rename

- **WHEN** the user changes a stage identifier and saves
- **THEN** the stage keeps its stable identity
- **AND** the authored identity is unchanged
- **AND** every reference the editor does not present is preserved

#### Scenario: Reject a duplicate identifier

- **WHEN** the user sets the identifier to one that another stage of the board uses
- **THEN** the editor presents an inline problem
- **AND** no command is sent

#### Scenario: Store nothing when the rename cannot complete

- **WHEN** a rename would leave a reference or a task unresolved
- **THEN** nothing is stored
- **AND** the editor stays open with the draft intact

#### Scenario: Rename on a published board

- **WHEN** the board is published to a team and the board has no in-flight work
- **THEN** the identifier remains editable
- **AND** the change is stored and published like any other workflow change
- **AND** other members apply it as a change to that stage's identifier, so their own tasks in that stage move with it
- **AND** no team review is required for the rename
