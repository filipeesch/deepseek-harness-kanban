# Spec Delta

## ADDED Requirements

### Requirement: Hub section of configuration

The Hub section of the Kanban configuration dialog SHALL present only the identity of the active Hub and the deletion of that Hub. The identity SHALL present the Hub's name with a rename action, keeping the naming rules defined by Hub creation and naming. The deletion control SHALL be presented in a danger zone visually separated from the identity, and SHALL keep the eligibility, the confirmation content, and the consequences defined by Hub deletion. The Hub section SHALL NOT list the Hub's boards, SHALL NOT create, rename, or delete a board, and SHALL NOT present a board's task count; managing the Hub's boards SHALL be presented by the Boards section defined by `kanban-board`.

#### Scenario: Rename the Hub from its section

- **WHEN** the user saves a valid new name in the Hub section
- **THEN** the Hub tabs show the new name
- **AND** the Hub's boards, projects, tasks, conversations, and worktrees are unchanged

#### Scenario: Keep board management out of the Hub section

- **WHEN** the user opens the Hub section of a Hub that has boards
- **THEN** the section presents no board list, no board creation form, and no board task count
- **AND** the Hub's identity and its deletion are the only content of the section

#### Scenario: Delete the Hub from the separated danger zone

- **WHEN** the user opens the Hub section of an eligible Hub
- **THEN** the deletion control is presented in a danger zone separated from the Hub's identity
- **AND** it keeps the eligibility rules and the confirmation defined by Hub deletion
