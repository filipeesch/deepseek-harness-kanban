# Spec Delta

## ADDED Requirements

### Requirement: Decision changes in revision comparison

`diff_board_revisions` SHALL report a decision configuration added, changed, or removed between two retained revisions, naming the changed fields among the question, the context, and the options, and naming an option identifier that was added, changed, or removed. Its summary form SHALL name the changed fields without carrying the authored question, context, or option text. `list_board_revisions` SHALL describe a revision that changed only a decision configuration as a workflow change that names the affected stage and the changed field. `revert_board` SHALL restore or clear a decision configuration through the same validated write path as any other stage field, and SHALL refuse a restored document that would leave a stage with a partial decision configuration.

#### Scenario: Compare a revision that changed a gate

- **WHEN** an agent compares two retained revisions whose decision stage question and one option changed
- **THEN** the result names that stage and the changed question and options
- **AND** it names the option identifier that changed

#### Scenario: Summarize without the authored text

- **WHEN** an agent lists revisions and one revision changed only a decision configuration
- **THEN** the summary names the affected stage and the changed field
- **AND** it carries no authored question, context, or option text

#### Scenario: Revert a decision change

- **WHEN** an agent reverts a board to a retained revision whose decision configuration differs
- **THEN** the board's stored document restores that configuration through the validated write path
- **AND** the restored revision remains listed
