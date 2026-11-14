# Spec Delta

## MODIFIED Requirements

### Requirement: Schedules configuration surface

The Kanban configuration SHALL offer a Schedules section whenever a Hub is selected. That section
SHALL list the selected Hub's schedules, showing for each one its title, its cron description, its
next occurrence, its target project, its model or the host default, whether it is enabled, and its
last run summary. The section SHALL provide a creation action and, for each schedule, edit, enable or
pause, delete, and run-now actions. Create and edit SHALL use one overlay editor that exposes every
schedule field and shows validation failures inline.

The editor SHALL present the schedule's model as an explicit choice between the host default and a
specific model. A specific model SHALL be chosen with the host's native model selector, the same
selector DSH composes for a conversation's input, and SHALL offer the reasoning efforts that selector
reports. Choosing the host default SHALL store no model for the schedule. When the running host does
not compose the native model selector, the editor SHALL present the schedule's stored model read-only
together with a statement that the selector is unavailable, and SHALL NOT remove or rewrite it. When
the host catalog cannot be read, the selector SHALL report the failure and offer a retry, and the
stored model SHALL remain presented. A specific choice with no model selected SHALL prevent saving
and SHALL explain what is missing.

Deleting a schedule SHALL require explicit confirmation. The Schedules section SHALL state when no Hub
is selected, and the editor SHALL prevent saving while a required field is invalid. A new schedule
SHALL start enabled, with a new conversation per run and archiving enabled, using the browser's time
zone.

#### Scenario: Open the Schedules section

- **WHEN** the user opens Kanban configuration with a Hub selected
- **THEN** the Schedules section is available and lists that Hub's schedules only

#### Scenario: Choose a model with the native selector

- **WHEN** the user chooses a specific model in the schedule editor
- **THEN** the host's native model selector presents the catalog routes and their reasoning efforts
- **AND** the chosen route is saved with the schedule

#### Scenario: Keep the host default model

- **WHEN** the user chooses the host default in the schedule editor and saves
- **THEN** the schedule stores no model of its own
- **AND** its occurrences use the deployment default

#### Scenario: Present the stored model when the selector is unavailable

- **WHEN** the running host does not compose the native model selector for a schedule that stores a model
- **THEN** the editor presents the stored model read-only with a statement that the selector is unavailable
- **AND** the stored model is not removed or rewritten

#### Scenario: Validate the model against the catalog

- **WHEN** the catalog is available and the editor selects a model that is not in it
- **THEN** saving is refused with a message asking for a catalog model or the host default

#### Scenario: Require a model for a specific choice

- **WHEN** the user chooses a specific model without selecting a route
- **THEN** saving is unavailable and the editor explains what is missing

#### Scenario: Create a schedule in the overlay

- **WHEN** the user submits a valid schedule from the creation overlay
- **THEN** the schedule appears in the list and the overlay closes

#### Scenario: Start a new schedule from defaults

- **WHEN** the user opens the creation overlay
- **THEN** the schedule starts enabled, with a new conversation per run and archiving enabled
- **AND** the time zone defaults to the browser's time zone

#### Scenario: Show validation inline

- **WHEN** the user submits an invalid cron expression
- **THEN** the overlay reports the invalid expression and stays open without saving

#### Scenario: Confirm deletion

- **WHEN** the user requests deletion of a schedule
- **THEN** a confirmation naming the schedule is shown before anything is removed
- **AND** cancelling the confirmation leaves the schedule unchanged

#### Scenario: Keep a paused schedule paused when edited

- **WHEN** the user edits a paused schedule and saves
- **THEN** the saved schedule remains paused
