# Spec Delta

## MODIFIED Requirements

### Requirement: Stage editor form

The stage edit action SHALL open one modal editor for a single stage. The editor SHALL present its content as a tab set — Stage, Execution, Routing, Inputs, Approval, and Decision — and SHALL present its save action and its cancel action in a footer that remains visible while the active tab's content scrolls. A stage that authors neither a program nor a decision configuration SHALL present the Stage, Execution, and Routing tabs only; a stage that authors a program SHALL present the Stage, Execution, Routing, Inputs, and Approval tabs; and a stage that authors a decision configuration SHALL present the Stage and Decision tabs only. The editor SHALL hold one width and one height across every tab, so selecting another tab never resizes the overlay, and only the active tab's panel SHALL scroll.

The Stage tab SHALL present the stage's display name, its optional description, its identifier, its execution mode (agent instruction or manual, scripted step, or decision step), and whether it is the board's initial stage, together with the action that makes it initial. The Execution tab SHALL present the entry instruction of a stage that authors no program, and the program of a stage that authors one. The Routing tab SHALL present the allowed transitions of a stage that authors neither a program nor a decision configuration, and the named exits of a stage that authors a program; a stage that authors a decision configuration SHALL present no routing fields on that tab, because its options are its destinations. The Inputs tab SHALL present the declared parameters and the authorized local variable names. The Approval tab SHALL present the stored executable version and its approval state. The Decision tab SHALL present the question, the optional Markdown context, and the ordered options, each with its identifier, title, optional description, and destination chosen from the board's other existing stages, together with the actions that add, reorder, and remove an option.

The editor SHALL edit a draft: changing a field SHALL NOT store anything until the save action is activated, and the cancel action, the Escape key, and the close action SHALL dismiss the editor without storing anything and without changing the stage. Selecting another tab SHALL NOT store, discard, or validate anything, and SHALL keep the draft and its caret and undo history for every field it holds.

The save action SHALL be unavailable while the draft holds no change and while a save is in flight. The editor SHALL validate its draft before sending it and SHALL present every validation problem inside the editor next to the field it concerns, on the tab that holds that field. When a save is rejected, the editor SHALL remain open with the draft intact and SHALL present the problem inline rather than as a board-level notice.

After a successful save the editor SHALL close and the board SHALL present the stored stage, except when the saved stage's executable version still requires approval as `scripted-steps` defines it: the editor SHALL then present the stored version's approval state and the approval action for that stored version instead of the draft form, and SHALL offer no further edit of the closed draft.

The program form SHALL edit Bash or TypeScript, exactly one inline code or external file source, the task-or-base-project directory choice, named output routes, authorized local variable names as defined by `scripted-steps`, and the declared parameters, each with a required name and an optional description. The parameter declaration SHALL be edited independently of any entry's values: the form SHALL NOT present, accept, or store an entry's parameter values. The inline program SHALL be editable as multiline code that the user can enlarge. The form SHALL make an agent instruction, a program, and a decision configuration mutually exclusive and SHALL reject a conflicting configuration rather than silently storing both. It SHALL distinguish the saved authored configuration from the captured version of any existing execution: saving SHALL NOT start code, replace an active snapshot, or restart a task. Local variable values SHALL be managed for the selected project and stable stage through the native credential mechanism, not serialized into shared workflow text; their dedicated surface SHALL report configured or missing state without returning stored values to the browser, and the editor SHALL NOT present stored values.

#### Scenario: Open the editor with the stored stage

- **WHEN** the user activates the stage edit action for a stage that has a name, an entry instruction, and two allowed targets
- **THEN** the editor presents the Stage tab with that name
- **AND** its Execution tab presents that instruction
- **AND** its Routing tab presents those two targets
- **AND** no change is stored

#### Scenario: Open the editor for a decision stage

- **WHEN** the user opens the editor for a stage that authors a decision configuration
- **THEN** the editor presents the Stage and Decision tabs
- **AND** the Decision tab presents the stored question, context, and options
- **AND** the editor presents no Execution, Routing, Inputs, or Approval tab

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

- **WHEN** the user opens a stage that authors a program, edits its inline code or routes, and saves
- **THEN** the editor validates and stores that stage's program fields using the same semantics as YAML editing
- **AND** it does not execute the script
- **AND** an existing run keeps its captured version until explicit Play

#### Scenario: Close after an author save of an inline program

- **WHEN** the user saves an inline program from the editor
- **THEN** the save authorizes the stored executable version as `scripted-steps` defines it
- **AND** the editor closes and the board presents the stored stage

#### Scenario: Keep the editor open after saving an unapproved version

- **WHEN** the user saves a program whose stored version still requires approval, which an external file source always does
- **THEN** the editor stays open with the stored version
- **AND** it presents the approval action for that stored version
- **AND** no code runs and no card starts

#### Scenario: Reject mixed prompt and script execution

- **WHEN** a draft supplies a program together with a nonempty agent instruction or a separate allowed-transition list
- **THEN** save is rejected with an inline field diagnostic
- **AND** no conflicting execution definition is stored

#### Scenario: Declare a parameter in the deterministic form

- **WHEN** the user adds a parameter name with a description to a scripted draft and saves
- **THEN** that name and description are stored in the stage's program definition
- **AND** no parameter value is stored by the editor
- **AND** an existing run keeps its captured declaration until explicit Play

#### Scenario: Reject an invalid parameter declaration

- **WHEN** a draft repeats a parameter name, uses an unsafe name, or exceeds the accepted bounds
- **THEN** the editor presents the problem inline next to the parameter field on the tab that holds it
- **AND** save does not store a partial or conflicting declaration

#### Scenario: Distinguish the stored version from the draft

- **WHEN** the editor holds an unsaved program draft while the stored version is approved
- **THEN** the Approval tab presents the stored version as approved
- **AND** it does not claim that the draft is approved

## ADDED Requirements

### Requirement: Decision editing in the stage editor

The editor SHALL make the decision step a third execution mode beside the agent instruction or manual mode and the scripted step. Choosing the decision mode SHALL present the Decision tab and SHALL hide the fields that belong to the other two modes. Saving a decision draft SHALL require a nonempty question and at least one option, with a unique identifier, a nonempty title, and a destination that is another existing stage; an invalid option SHALL be presented inline on the Decision tab and the save SHALL store nothing. Saving a decision draft SHALL remove the stage's entry instruction, allowed-transition list, and scripted configuration in the same write, and choosing either of the other modes SHALL remove the stage's decision configuration in that write, so a stage never authors two modes. The stage description SHALL remain a Stage-tab field in every mode and SHALL NOT be edited through the question field. Editing a decision draft SHALL NOT move a card, answer a gate, or change a recorded choice.

#### Scenario: Save a decision draft

- **WHEN** the user chooses the decision mode, writes a question, adds two valid options, and saves
- **THEN** the stage authors the decision configuration
- **AND** the editor closes and the board presents the stored stage
- **AND** no card moves and no gate is answered

#### Scenario: Reject an incomplete decision draft

- **WHEN** the user saves a decision draft with no question or an option without a title or destination
- **THEN** the editor presents the problem inline on the Decision tab
- **AND** nothing is stored

#### Scenario: Replace the stage mode

- **WHEN** the user changes a stage that authors a program or an instruction into the decision mode and saves
- **THEN** the stage authors only the decision configuration
- **AND** the previous mode's authored fields are removed in the same write

#### Scenario: Keep the description in every mode

- **WHEN** the stage has a description and the user saves a decision draft
- **THEN** the description remains authored as before
- **AND** it is not replaced by the decision question
