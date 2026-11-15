# Spec Delta

## ADDED Requirements

### Requirement: Configuration sections and navigation

The Kanban configuration dialog SHALL present exactly these top-level sections, in this order: General, Hub, Boards, Projects, Schedules, and Team Settings. The General section SHALL be the section presented first and opened by default. The dialog SHALL NOT present a top-level section dedicated to the active board, and board configuration SHALL be opened from the Boards section. Selecting a section SHALL present that section's content without closing the dialog and SHALL NOT abandon a command already in flight. The dialog SHALL keep its unsaved-work guards: leaving a section that holds an unsaved draft SHALL ask before discarding that draft, keeping the draft when the user declines, and closing the dialog while any section holds an unsaved draft SHALL ask before discarding it. Editing a board's configuration SHALL be reachable from the Boards section only, so that no board is editable from two different places in the configuration.

#### Scenario: Present the top-level sections

- **WHEN** the user opens the Kanban configuration dialog
- **THEN** it presents General, Hub, Boards, Projects, Schedules, and Team Settings as top-level sections in that order
- **AND** it presents no top-level section for a board
- **AND** the General section is the one opened by default

#### Scenario: Reach board configuration from Boards

- **WHEN** the user chooses the Edit action of a board row in the Boards section
- **THEN** that board's configuration opens while the dialog keeps presenting the Boards section
- **AND** no top-level board section appears in the section row

#### Scenario: Ask before discarding a section draft

- **WHEN** a section holds an unsaved draft and the user selects another section
- **THEN** the dialog asks before discarding the draft
- **AND** the draft is kept when the user declines
- **AND** the other section opens when the user confirms

### Requirement: Boards section with stacked board configuration

The Boards section SHALL list every board of the active Hub, and each row SHALL present the board's name together with an Edit action and a Delete action. The section SHALL present a New board action that creates a board through the same creation surface the board header offers, requiring a name and initializing the default workflow. Renaming a board SHALL be available in that board's own configuration and SHALL NOT be offered from the row. The row SHALL NOT present an action that makes the board the active board.

Choosing Edit SHALL open that board's configuration as an overlay stacked above the Boards section, carrying the board sub-sections General, Projects, Defaults, Workflow, and Danger zone, and editing the board it was opened for — including a board that is not the active board. While the overlay is open, the Boards section SHALL remain presented beneath it and SHALL NOT accept input. Closing the overlay SHALL return to the Boards section with the list reflecting every change the overlay made. Deleting a board from the overlay's Danger zone SHALL close the overlay and return to the Boards section. Board deletion SHALL keep its existing rules: only a board with no tasks is deletable, and the removal of a published board SHALL ask whether it applies only to this installation or to the team.

#### Scenario: List the boards of the active Hub

- **WHEN** the user opens the Boards section for a Hub with more than one board
- **THEN** every board of that Hub is listed with its name, an Edit action, and a Delete action
- **AND** no board from another Hub is listed

#### Scenario: Edit a board that is not active

- **WHEN** the user chooses Edit on a board that is not the active board
- **THEN** that board's configuration opens over the list
- **AND** the changes apply to that board and to no other
- **AND** the active board of the Kanban page is unchanged

#### Scenario: Close the overlay back to the list

- **WHEN** the user closes the board configuration overlay
- **THEN** the Boards section is presented with the list reflecting the changes the overlay made
- **AND** the configuration dialog stays open

#### Scenario: Delete a board from the overlay

- **WHEN** the user deletes the board the overlay was opened for, from its Danger zone
- **THEN** the overlay closes
- **AND** the Boards section is presented without that board

#### Scenario: Create a board from the section

- **WHEN** the user chooses New board and submits a valid name
- **THEN** the board is created with the default workflow through the same creation surface the board header offers
- **AND** it appears in the Boards section

### Requirement: Stable configuration overlay size

Every configuration overlay SHALL keep the same size while the user switches between its sections or sub-sections. The overlay SHALL present a height fixed from the viewport together with an internal scroll region for its content, so that a section with little content and a section with much content present the same overlay height, and a change of section SHALL NOT move the overlay's edges. The top-level configuration dialog SHALL present the same width for every one of its sections. The board configuration overlay SHALL present one width for all of its sub-sections, wider than the top-level dialog because it carries the workflow editor, and that width SHALL NOT change as the user moves between its sub-sections. A viewport too narrow for the chosen width SHALL reduce the overlay to the available width while preserving the fixed height, and content that exceeds the scroll region SHALL scroll inside the overlay instead of growing it.

#### Scenario: Keep the same height across sections

- **WHEN** the user moves between two configuration sections whose content differs in length
- **THEN** the overlay presents the same height in both
- **AND** the longer content scrolls inside the overlay

#### Scenario: Keep the same width across sections

- **WHEN** the user moves between two sections of the top-level configuration dialog
- **THEN** the dialog presents the same width in both

#### Scenario: Keep the board overlay width across sub-sections

- **WHEN** the user moves between the board configuration sub-sections
- **THEN** the board overlay presents the same width for every sub-section
- **AND** that width is not reduced when the user leaves the Workflow sub-section

#### Scenario: Scroll instead of growing

- **WHEN** a section's content is taller than the overlay's fixed height
- **THEN** the content scrolls inside the overlay
- **AND** the overlay's height does not change

## MODIFIED Requirements

### Requirement: Board default model configuration

The Defaults sub-section of the board configuration SHALL present the model the board's new
conversations start on. The control SHALL present both modes as a segmented control, visible at the same time —
the deployment default and a specific model — with exactly one of them selected.
The host's native model selector SHALL be rendered beneath the mode control in either mode
and SHALL be disabled while the deployment default is selected, so that changing the mode
never changes the sub-section's layout. Choosing the deployment default SHALL remove the root model mapping from the
board's authored workflow YAML and SHALL leave the board with no model of its own. Choosing a
specific model SHALL use that selector, the same selector DSH composes for a
conversation's input, and SHALL offer the reasoning efforts that selector reports for the chosen
route. A specific choice with no model selected SHALL prevent saving and SHALL explain what is
missing.

The Defaults sub-section SHALL save the model choice together with the board's default agent preset
in one guarded workflow write, using the revision the form was opened with. A document that is
invalid at save time SHALL NOT replace the stored workflow, and the problem SHALL stay visible.
Saving SHALL preserve the text and comments outside the rewritten root fields, and SHALL NOT clear a
stored field the person did not edit.

When the running host does not compose the native model selector, the sub-section SHALL present the
board's stored route read-only together with a statement that the selector is unavailable, and SHALL
NOT remove or rewrite that route. When the host catalog cannot be read, the selector SHALL report the
failure and offer a retry, and the stored route SHALL remain visible. When the board's stored model is
not among the models the host reports as available, the sub-section SHALL present the stored provider
and model and state that they are unavailable, and SHALL NOT remove them or alter the board on its
own. While the Workflow sub-section holds unsaved edits, the Defaults controls SHALL remain available
for editing, saving SHALL be unavailable with an explanation and a way to open the Workflow
sub-section, and nothing SHALL be written.

#### Scenario: Choose a model for the board

- **WHEN** the user chooses a specific model and a reasoning effort in the Defaults sub-section and saves
- **THEN** the board's authored workflow YAML carries that model mapping at the document root
- **AND** the text and comments outside that mapping are unchanged

#### Scenario: Offer the reasoning effort of the chosen model

- **WHEN** the user chooses a model that reports reasoning efforts
- **THEN** the native selector offers those efforts and an option that keeps the model's own default

#### Scenario: Keep the deployment default

- **WHEN** the user chooses the deployment default and saves
- **THEN** the board's authored workflow YAML no longer carries a model mapping
- **AND** the board's new conversations start on the deployment default

#### Scenario: Save the model and the preset together

- **WHEN** the user changes both the model and the agent preset and saves
- **THEN** one guarded workflow write carries both root fields
- **AND** the write uses the revision the form was opened with

#### Scenario: Require a model for a specific choice

- **WHEN** the user chooses a specific model without selecting a route
- **THEN** saving is unavailable and the sub-section explains what is missing

#### Scenario: Present the stored route when the selector is unavailable

- **WHEN** the running host does not compose the native model selector
- **THEN** the sub-section presents the board's stored route read-only with a statement that the selector is unavailable
- **AND** the stored route is not removed or rewritten

#### Scenario: Report an unreadable catalog with retry

- **WHEN** the host model catalog cannot be read
- **THEN** the selector reports the failure and offers a retry action
- **AND** the stored route remains visible

#### Scenario: Present a stored model that the host no longer offers

- **WHEN** the board's stored model is absent from the models the host reports as available
- **THEN** the sub-section presents the stored provider and model and states that they are unavailable
- **AND** the stored model is neither removed nor rewritten

#### Scenario: Keep the defaults controls while the workflow is dirty

- **WHEN** the Workflow sub-section holds unsaved edits and the user opens Defaults
- **THEN** the model and preset controls remain editable
- **AND** saving is unavailable with an explanation and a way to open the Workflow sub-section
- **AND** no write is sent and the workflow draft is untouched

#### Scenario: Reject an invalid document

- **WHEN** the board's workflow document is invalid at save time
- **THEN** the save is refused and the stored workflow is unchanged
- **AND** the problem stays visible in the configuration

#### Scenario: Keep the layout while the mode changes

- **WHEN** the user switches between the deployment default and a specific model
- **THEN** both modes stay presented in the same place with exactly one selected
- **AND** the native model selector stays in the sub-section, disabled while the deployment default is selected and enabled otherwise
- **AND** the sub-section's height does not change

### Requirement: Workflow draft preservation

A board's Workflow draft SHALL survive switching between that board configuration's own sub-sections, so
returning to Workflow in the same board configuration shows the edited YAML for that board. Closing the
board configuration with unsaved workflow changes, or replacing the draft with Reload, SHALL require
explicit confirmation; canceling SHALL keep the draft and the configuration open. A closed board
configuration SHALL NOT carry its draft: reopening the same board starts from the saved workflow.

#### Scenario: Switch tabs without losing the draft

- **WHEN** the user edits the workflow, switches to another board sub-section, and returns to Workflow
- **THEN** the edited YAML is still present for the same board

#### Scenario: Confirm before closing

- **WHEN** the user attempts to close the board configuration while the workflow draft differs from the saved workflow
- **THEN** a discard confirmation is shown
- **AND** canceling keeps the configuration open with the draft intact

#### Scenario: Confirm before reload

- **WHEN** the user activates Reload saved workflow while the draft is dirty
- **THEN** the user is asked to confirm replacing the draft

#### Scenario: Start from the saved workflow after reopening

- **WHEN** the user closes a board configuration, discarding its workflow draft, and opens that board again
- **THEN** the Workflow editor shows the saved workflow
