# Spec Delta

## MODIFIED Requirements

### Requirement: Stage editor form

The stage edit action SHALL open one modal editor for a single stage. The editor SHALL present the stage's display name, execution mode, identifier, and whether it is the board's initial stage, and SHALL present a save action and a cancel action. For a legacy instruction or manual stage it SHALL present the entry instruction and allowed transitions. For a deterministic stage it SHALL present the deterministic configuration instead of a second instruction or allowed-transition definition. The editor SHALL edit a draft: changing a field SHALL NOT store anything until the save action is activated, and the cancel action, the Escape key, and the close action SHALL dismiss the editor without storing anything and without changing the stage.

The save action SHALL be unavailable while the draft holds no change and while a save is in flight. The editor SHALL validate its draft before sending it and SHALL present every validation problem inside the editor next to the field it concerns. When a save is rejected, the editor SHALL remain open with the draft intact and SHALL present the problem inline rather than as a board-level notice. After a successful save the editor SHALL close and the board SHALL present the stored stage, except when the saved deterministic stage's executable version is not approved: the editor SHALL remain open, keep the stored stage, and present the approval action for that stored version. Saving SHALL NOT approve an executable version. The editor SHALL present the stored executable version's approval state for the board and stage, and SHALL distinguish that state from the draft: a draft that differs from the stored stage SHALL NOT be presented as approved.

The deterministic form SHALL edit Bash or TypeScript, exactly one inline code or external file source, the task-or-base-project directory choice, named output routes, authorized local variable names as defined by `deterministic-steps`, and the declared parameters, each with a required name and an optional description. The parameter declaration SHALL be edited independently of any entry's values: the form SHALL NOT present, accept, or store an entry's parameter values. The inline program SHALL be editable as multiline code. The form SHALL make instruction and deterministic execution mutually exclusive and SHALL reject a conflicting configuration rather than silently running both. It SHALL distinguish the saved authored configuration from the captured version of any existing execution: saving SHALL NOT grant approval, start code, replace an active snapshot, or restart a task. Local variable values SHALL be managed for the selected project and stable stage through the native credential mechanism, not serialized into shared workflow text; their dedicated surface SHALL report configured or missing state without returning stored values to the browser, and the editor SHALL NOT present stored values.

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
- **AND** it does not execute the script or approve its version
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

#### Scenario: Keep the editor open after saving an unapproved version

- **WHEN** the user saves a deterministic stage whose stored executable version is not approved
- **THEN** the editor stays open with the stored stage
- **AND** it presents the approval action for that stored version
- **AND** no code runs and no card starts

#### Scenario: Distinguish the stored version from the draft

- **WHEN** the editor holds an unsaved deterministic draft while the stored version is approved
- **THEN** the editor presents the stored version as approved
- **AND** it does not claim that the draft is approved

## ADDED Requirements

### Requirement: Stage script approval

The stage editor SHALL present an approval action for the stored executable version of the edited deterministic stage when that version is not approved, and SHALL present the approved state when it is. The approval action SHALL open the executable-version review defined by `deterministic-steps` for the stored version. Activating it SHALL NOT save the draft, replace the stored workflow, execute code, start a card, create a conversation or worktree, or move a task. Approving SHALL resume every waiting entry of that board, stage, and executable version whose captured execution context remains valid. The editor SHALL reject an approval whose version changed after the review and SHALL ask for a new review. When the primary source is an external file resolved relative to a task or project directory and different directories produce different primary bytes, the editor SHALL NOT present the stage as approved by a single action: it SHALL state that each resolved version needs its own approval and SHALL approve only the version it can resolve from the authored configuration.

#### Scenario: Approve the stored version from the editor

- **WHEN** the user opens a deterministic stage whose stored version is not approved and approves it from the editor
- **THEN** the stored version becomes approved for the board and stage
- **AND** the stored workflow is unchanged
- **AND** no card, conversation, worktree, or execution is created by the approval

#### Scenario: Approve before any card enters

- **WHEN** a stage has no card and its stored version is approved from the editor
- **THEN** the next card to enter that stage starts without an approval request

#### Scenario: Refuse a replaced version

- **WHEN** the stored executable version changes while the editor's review is open and the user approves
- **THEN** the approval is rejected
- **AND** the editor asks for a review of the current version
- **AND** no code runs under the discarded review

#### Scenario: Report a directory-dependent source

- **WHEN** the stage's primary source is an external file whose bytes depend on the execution directory
- **THEN** the editor does not present one action as approving every resolved version
- **AND** it explains that each resolved version needs its own approval
