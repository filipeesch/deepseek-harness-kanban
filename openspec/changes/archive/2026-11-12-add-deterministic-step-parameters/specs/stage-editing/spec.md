# Spec Delta

## MODIFIED Requirements

### Requirement: Stage editor form

The stage edit action SHALL open one modal editor for a single stage. The editor SHALL present the stage's display name, execution mode, identifier, and whether it is the board's initial stage, and SHALL present a save action and a cancel action. For a legacy instruction or manual stage it SHALL present the entry instruction and allowed transitions. For a deterministic stage it SHALL present the deterministic configuration instead of a second instruction or allowed-transition definition. The editor SHALL edit a draft: changing a field SHALL NOT store anything until the save action is activated, and the cancel action, the Escape key, and the close action SHALL dismiss the editor without storing anything and without changing the stage.

The save action SHALL be unavailable while the draft holds no change and while a save is in flight. The editor SHALL validate its draft before sending it and SHALL present every validation problem inside the editor next to the field it concerns. When a save is rejected, the editor SHALL remain open with the draft intact and SHALL present the problem inline rather than as a board-level notice. After a successful save the editor SHALL close and the board SHALL present the stored stage.

The deterministic form SHALL edit Bash or TypeScript, exactly one inline code or external file source, the task-or-base-project directory choice, named output routes, authorized local variable names as defined by `deterministic-steps`, and the declared parameters, each with a required name and an optional description. The parameter declaration SHALL be edited independently of any entry's values: the form SHALL NOT present, accept, or store an entry's parameter values. The inline program SHALL be editable as multiline code. The form SHALL make instruction and deterministic execution mutually exclusive and SHALL reject a conflicting configuration rather than silently running both. It SHALL distinguish the saved authored configuration from the captured version of any existing execution: saving SHALL NOT grant trust, start code, replace an active snapshot, or restart a task. Local variable values SHALL be managed for the selected project and stable stage through the native credential mechanism, not serialized into shared workflow text; a read surface SHALL report configured or missing state without returning stored values to the browser.

#### Scenario: Open the editor with the stored stage

- **WHEN** the user activates the stage edit action for a stage that has a name, an entry instruction, and two allowed targets
- **THEN** the editor presents that name, that instruction, and those two targets
- **AND** no change is stored

#### Scenario: Discard a draft

- **WHEN** the user changes the stage name and activates cancel
- **THEN** the editor closes
- **AND** the board still presents the stored stage name
- **AND** no command is sent

#### Scenario: Save a draft

- **WHEN** the user changes the stage name and activates save
- **THEN** the change is stored
- **AND** the editor closes
- **AND** the board presents the stored name

#### Scenario: Keep the draft on a rejected save

- **WHEN** a save is rejected because the workflow changed since the editor opened
- **THEN** the editor stays open with the draft intact
- **AND** the editor presents the conflict inline
- **AND** the board presents no board-level notice for the rejection

#### Scenario: Edit a deterministic stage without activating it

- **WHEN** the user opens a deterministic stage, edits its inline script or routes, and saves
- **THEN** the editor validates and stores that stage's deterministic fields using the same semantics as YAML editing
- **AND** it does not execute the script or grant trust
- **AND** an existing run keeps its captured version until explicit Play

#### Scenario: Reject mixed prompt and script execution

- **WHEN** a draft supplies deterministic execution together with a nonempty agent instruction or a separate allowed-transition list
- **THEN** save is rejected with an inline field diagnostic
- **AND** no conflicting execution definition is stored

#### Scenario: Declare a parameter in the deterministic form

- **WHEN** the user adds a parameter name with a description to a deterministic draft and saves
- **THEN** that name and description are stored in the stage's deterministic configuration
- **AND** no parameter value is stored by the editor
- **AND** an existing run keeps its captured declaration until explicit Play

#### Scenario: Reject an invalid parameter declaration

- **WHEN** a draft repeats a parameter name, uses an unsafe name, or supplies an empty description
- **THEN** the editor presents the problem inline next to the parameter field
- **AND** save does not store a partial or conflicting declaration
