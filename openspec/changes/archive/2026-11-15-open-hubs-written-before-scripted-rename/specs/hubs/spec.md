# Spec Delta

## ADDED Requirements

### Requirement: Stored Hub record compatibility across releases

The plugin SHALL open a Hub record written by an earlier build whose persisted execution field names a later release replaced. On open, the plugin SHALL read the previous names for a stage's execution definition, a task's execution control and handoff, and the execution and handoff task-history kinds, and SHALL convert them to the current names before the record is validated as an opened Hub. The conversion SHALL preserve the Hub identifier, name, revision, boards, tasks, notes, schedules, and every field it did not rename, and SHALL NOT change the authored workflow YAML.

A stored record that already uses the current names SHALL be opened as the same value, so opening an upgraded installation rewrites nothing; the next ordinary save persists the current names. An opened Hub aggregate SHALL reject the previous names rather than accept them, so a record that mixes both spellings converges to the current name instead of being written back unchanged.

#### Scenario: Open a record written before the scripted rename

- **WHEN** an installation opens a Hub record whose stage definition, task control, task handoff, or task history uses the previous deterministic names
- **THEN** the Hub opens with its boards, tasks, notes, schedules, and history intact
- **AND** the stage definition, task control, handoff, execution results, and history kinds read as their scripted equivalents

#### Scenario: Keep the authored workflow text

- **WHEN** the opened record's workflow YAML still uses the previous execution spelling
- **THEN** the authored YAML is unchanged
- **AND** it parses to the workflow the record now stores

#### Scenario: Do not rewrite a converted record

- **WHEN** the opened record already uses the current names
- **THEN** the plugin opens it without a storage write

#### Scenario: Reject the previous names in an opened Hub

- **WHEN** an opened Hub aggregate carries a previous execution field name
- **THEN** the aggregate is invalid state and is rejected instead of being persisted
