# Spec Delta

## ADDED Requirements

### Requirement: Board default agent preset

Each board's workflow SHALL accept an optional root `agent_preset` scalar that names the agent
preset the board's new conversations start on. The value SHALL be nonempty text. A workflow without
the field SHALL keep the current behavior and start those conversations on the host default preset.
The field SHALL be validated with the same accepted workflow semantics as the rest of the workflow:
an empty value, or a document that carries a field the workflow does not define, SHALL be rejected
as invalid and SHALL NOT replace the last valid workflow. The board's stored parsed workflow and its
authored YAML SHALL agree on the field, in the same way they agree on every other workflow field.
The board's default agent preset SHALL be part of the workflow's meaning and SHALL NOT be part of its
layout. It SHALL be stored in the board's workflow and SHALL NOT be stored in a board setting outside
it. A stored preset that the running host no longer offers SHALL remain stored and SHALL NOT be
removed or rewritten on its own.

#### Scenario: Accept a board default agent preset

- **WHEN** a workflow configures a root `agent_preset` with a preset identity
- **THEN** the configuration is accepted and the board keeps that preset as its default
- **AND** the stored parsed workflow and the authored YAML agree

#### Scenario: Keep the host default when the field is absent

- **WHEN** a workflow configures no root `agent_preset`
- **THEN** the configuration is accepted
- **AND** the board names no default agent preset of its own

#### Scenario: Reject an empty preset

- **WHEN** a workflow configures a root `agent_preset` that is empty or blank
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count a preset change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in its `agent_preset`
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

#### Scenario: Preserve a stored preset the host no longer offers

- **WHEN** a board stores an `agent_preset` that is absent from the running host's roster
- **THEN** the stored value remains in the workflow
- **AND** the board configuration does not remove or rewrite it

### Requirement: Board default agent preset configuration

The Defaults sub-section of the board configuration SHALL present the agent preset the board's new
conversations start on, as a list of the presets the host reports as available, each with its name
and description, together with an explicit option that keeps the host default preset. Choosing the
host default preset SHALL remove the root `agent_preset` from the board's authored workflow YAML.
Choosing an available preset SHALL store that preset identity as the root `agent_preset`. The
choice SHALL be saved together with the board's default model in the single guarded write defined by
Board default model configuration, preserving the text and comments outside the rewritten root
fields. A stored preset that the host does not report SHALL be presented as unavailable and SHALL be
kept as the current choice. When the roster cannot be read, the sub-section SHALL report the failure
with a retry action, SHALL keep presenting the stored preset, and SHALL NOT remove or rewrite it.

#### Scenario: Choose an available preset

- **WHEN** the user chooses an available preset in the Defaults sub-section and saves
- **THEN** the board's authored workflow YAML carries that identity as the root `agent_preset`
- **AND** the text and comments outside that field are unchanged

#### Scenario: Keep the host default preset

- **WHEN** the user chooses the option that keeps the host default preset and saves
- **THEN** the board's authored workflow YAML no longer carries a root `agent_preset`
- **AND** the board's new conversations start on the host default preset

#### Scenario: Present a stored preset the host no longer offers

- **WHEN** the board's stored preset is absent from the presets the host reports
- **THEN** the Defaults sub-section presents the stored identity and states that it is unavailable
- **AND** the stored preset is neither removed nor rewritten

#### Scenario: Report a roster failure with retry

- **WHEN** the host's agent-preset roster cannot be read
- **THEN** the Defaults sub-section reports the failure and offers a retry action
- **AND** the stored preset remains presented and unchanged

## MODIFIED Requirements

### Requirement: Rich workflow YAML editing

The Workflow sub-section of the board configuration SHALL present the active board's workflow YAML in
a code-editor surface rather than a plain textarea. The surface SHALL provide YAML syntax
highlighting, line numbers, folding, search, and a vertically resizable editing area, and it SHALL
preserve the text and comments entered by the user without reformatting.

#### Scenario: Edit workflow YAML with code-editor assistance

- **WHEN** the user opens Configuration → Board → Workflow
- **THEN** the active board's YAML is shown with syntax highlighting and line numbers in a resizable editor
- **AND** the user can fold sections and search within the document

#### Scenario: Preserve authored text

- **WHEN** the user saves a workflow whose text was not changed
- **THEN** the stored YAML matches the editor text without normalization or reformatting

### Requirement: Expanded workflow editing area

The Workflow sub-section SHALL use the widest configuration surface, and the editor SHALL support
vertical resizing and a maximize action that expands the editing area without closing Configuration.

#### Scenario: Maximize the workflow editor

- **WHEN** the user activates the editor's maximize action
- **THEN** the editor expands within the Configuration dialog
- **AND** the Save and Reload actions remain available

#### Scenario: Resize the workflow editor

- **WHEN** the user drags the editor's vertical resize handle
- **THEN** the editing area grows or shrinks without changing the YAML or closing the dialog

### Requirement: Live workflow diagnostics and guarded save

The Workflow sub-section SHALL validate the active board's YAML locally while the user edits, using
the same accepted workflow semantics as the host save path. Syntax problems SHALL be shown at their
document positions, schema problems SHALL be shown inline or in an issue summary, and Save SHALL
remain disabled while the current text is invalid or validation is pending.

#### Scenario: Syntax error blocks saving

- **WHEN** the editor contains invalid YAML syntax
- **THEN** the problem is shown in the editor and the Save action is disabled
- **AND** no save request is sent

#### Scenario: Correcting the YAML enables saving

- **WHEN** the user fixes the invalid YAML and the document becomes valid
- **THEN** the diagnostics clear and the Save action becomes available

#### Scenario: Host-only rejection remains visible

- **WHEN** a locally valid workflow is rejected by the host for an orphaned column or revision conflict
- **THEN** the host error remains visible after the save attempt
- **AND** the active board's last valid workflow is not replaced

### Requirement: Workflow draft preservation

The active board's Workflow draft SHALL survive switching between configuration sections and between
the board's sub-sections. Closing Configuration with unsaved workflow changes, or replacing the draft
with Reload, SHALL require explicit confirmation; canceling SHALL keep the draft and the dialog open.

#### Scenario: Switch tabs without losing the draft

- **WHEN** the user edits the workflow, switches to another Configuration section or board sub-section, and returns to Workflow
- **THEN** the edited YAML is still present for the same board

#### Scenario: Confirm before closing

- **WHEN** the user attempts to close Configuration while the workflow draft differs from the saved workflow
- **THEN** a discard confirmation is shown
- **AND** canceling keeps the dialog open with the draft intact

#### Scenario: Confirm before reload

- **WHEN** the user activates Reload saved workflow while the draft is dirty
- **THEN** the user is asked to confirm replacing the draft

### Requirement: Board project scope configuration

A board SHALL carry its own project scope that states which projects may create tasks on it. The scope
SHALL be stored on the board and SHALL NOT be stored in the board's workflow YAML. The scope SHALL
have two states: unrestricted, meaning every project of the Hub may create tasks, and restricted to
an explicit set of project keys. A board with no recorded scope SHALL be unrestricted, and a
restriction SHALL be recorded as an explicit set that SHALL be able to be empty. A board restricted to
an empty set SHALL accept no new task and SHALL be presented as closed for creation. The board
configuration's Projects sub-section SHALL present both states with the projects of the active Hub so
a user can choose between them and change the selected set. Removing a project from the scope SHALL
NOT change the tasks already on the board, SHALL NOT move them, and SHALL NOT remove them. Saving the
scope SHALL be a board write that carries the Hub revision as its precondition and SHALL follow the
same publishing behavior as the other board writes. The scope SHALL be local to the Hub that owns the
board and SHALL be published only as described by the hub-sharing specification.

#### Scenario: Restrict a board to selected projects

- **WHEN** the user selects specific projects for a board and saves the board configuration
- **THEN** the board allows those projects and refuses every other project of the Hub
- **AND** the New task input offers the selected projects only

#### Scenario: Allow every project on a board

- **WHEN** the user chooses to allow every project for a board that was restricted
- **THEN** the board records no restriction
- **AND** every project of the Hub may create tasks on that board again

#### Scenario: Close a board to new tasks

- **WHEN** the user selects specific projects and leaves none selected
- **THEN** the board accepts no new task
- **AND** New task explains that the board is closed for creation instead of offering an empty project input

#### Scenario: Keep existing cards when a project leaves the scope

- **WHEN** the user removes from the board's scope a project that has cards on that board
- **THEN** the scope no longer allows that project
- **AND** the existing cards stay in their stages with their conversations and worktrees unchanged

#### Scenario: Present the scope beside the rest of the board configuration

- **WHEN** the user opens the board configuration's Projects sub-section
- **THEN** the project scope is presented with the board's other configuration
- **AND** it presents the board's current state and the projects of the active Hub

#### Scenario: Do not store the scope in the workflow

- **WHEN** the user saves a board project scope
- **THEN** the board's workflow YAML is unchanged
- **AND** the scope does not appear in the workflow editor

### Requirement: Board default model configuration

The Defaults sub-section of the board configuration SHALL present the model the board's new
conversations start on. The control SHALL offer an explicit choice between the deployment default and
a specific model. Choosing the deployment default SHALL remove the root model mapping from the
board's authored workflow YAML and SHALL leave the board with no model of its own. Choosing a
specific model SHALL use the host's native model selector, the same selector DSH composes for a
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
