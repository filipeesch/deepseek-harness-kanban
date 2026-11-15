# Spec Delta

## MODIFIED Requirements

### Requirement: Stage editor form

The stage edit action SHALL open one modal editor for a single stage. The editor SHALL present its content as five tabs — Stage, Execution, Routing, Inputs, and Approval — and SHALL present its save action and its cancel action in a footer that remains visible while the active tab's content scrolls. A stage that authors no program SHALL present the Stage, Execution, and Routing tabs only, and a stage that authors a program SHALL present all five. The editor SHALL hold one width and one height across every tab, so selecting another tab never resizes the overlay, and only the active tab's panel SHALL scroll.

The Stage tab SHALL present the stage's display name, identifier, execution mode, and whether it is the board's initial stage, together with the action that makes it initial. The Execution tab SHALL present the entry instruction of a stage that authors no program, and the program of a stage that authors one. The Routing tab SHALL present the allowed transitions of a stage that authors no program, and the named exits of a stage that authors one. The Inputs tab SHALL present the declared parameters and the authorized local variable names. The Approval tab SHALL present the stored executable version and its approval state.

The editor SHALL edit a draft: changing a field SHALL NOT store anything until the save action is activated, and the cancel action, the Escape key, and the close action SHALL dismiss the editor without storing anything and without changing the stage. Selecting another tab SHALL NOT store, discard, or validate anything, and SHALL keep the draft and its caret and undo history for every field it holds.

The save action SHALL be unavailable while the draft holds no change and while a save is in flight. The editor SHALL validate its draft before sending it and SHALL present every validation problem inside the editor next to the field it concerns, on the tab that holds that field. When a save is rejected, the editor SHALL remain open with the draft intact and SHALL present the problem inline rather than as a board-level notice.

After a successful save the editor SHALL close and the board SHALL present the stored stage, except when the saved stage's executable version still requires approval as `scripted-steps` defines it: the editor SHALL then present the stored version's approval state and the approval action for that stored version instead of the draft form, and SHALL offer no further edit of the closed draft.

The program form SHALL edit Bash or TypeScript, exactly one inline code or external file source, the task-or-base-project directory choice, named output routes, authorized local variable names as defined by `scripted-steps`, and the declared parameters, each with a required name and an optional description. The parameter declaration SHALL be edited independently of any entry's values: the form SHALL NOT present, accept, or store an entry's parameter values. The inline program SHALL be editable as multiline code that the user can enlarge. The form SHALL make an agent instruction and a program mutually exclusive and SHALL reject a conflicting configuration rather than silently running both. It SHALL distinguish the saved authored configuration from the captured version of any existing execution: saving SHALL NOT start code, replace an active snapshot, or restart a task. Local variable values SHALL be managed for the selected project and stable stage through the native credential mechanism, not serialized into shared workflow text; their dedicated surface SHALL report configured or missing state without returning stored values to the browser, and the editor SHALL NOT present stored values.

#### Scenario: Open the editor with the stored stage

- **WHEN** the user activates the stage edit action for a stage that has a name, an entry instruction, and two allowed targets
- **THEN** the editor presents the Stage tab with that name
- **AND** its Execution tab presents that instruction
- **AND** its Routing tab presents those two targets
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

- **WHEN** the user opens a stage that authors a program, edits its inline code or routes, and saves
- **THEN** the editor validates and stores that stage's program fields using the same semantics as YAML editing
- **AND** it does not execute the script
- **AND** an existing run keeps its captured version until explicit Play

#### Scenario: Close after an author save of an inline program

- **WHEN** the user saves an inline program from the editor
- **THEN** the save authorizes the stored executable version as `scripted-steps` defines it
- **AND** the editor closes and the board presents the stored stage

#### Scenario: Keep the editor open after saving an unapproved version

- **WHEN** the user saves a stage whose executable version still requires approval, which an external file source always does
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

### Requirement: Stage script approval

The editor's Approval tab SHALL present the approval state of the stored executable version of the stage it edits, and SHALL present the approval action when that version is not approved. The approval action SHALL open the executable-version review defined by `scripted-steps` for the stored version. Activating it SHALL NOT save the draft, replace the stored workflow, execute code, start a card, create a conversation or worktree, or move a task. Approving SHALL resume every waiting entry of that board, stage, and executable version whose captured execution context remains valid. The editor SHALL reject an approval whose version changed after the review and SHALL ask for a new review.

The Approval tab SHALL present where the stored version's approval came from, as recorded by `scripted-steps`: the author's own save in this editor, or an explicit review. A version the author saved as an inline program SHALL be presented as approved without offering a second approval action for the same bytes.

When the primary source is an external file resolved relative to a task or project directory and different directories produce different primary bytes, the editor SHALL NOT present the stage as approved by a single action: it SHALL state that each resolved version needs its own approval and SHALL approve only the version it can resolve from the authored configuration.

#### Scenario: Present an approval recorded by the author's save

- **WHEN** the user saves an inline program and reopens the stage editor
- **THEN** the Approval tab presents the stored version as approved
- **AND** it presents the approval as recorded by the author's save
- **AND** it offers no second approval action for that version

#### Scenario: Approve the stored version from the editor

- **WHEN** the user opens a stage whose stored version requires approval, such as one authored with an external file source, and approves it from the Approval tab
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

## ADDED Requirements

### Requirement: Stage editor tab navigation

The stage editor SHALL present a tab row whose labels are Stage, Execution, Routing, Inputs, and Approval, in that order. The tab row SHALL present only the tabs the edited stage has content for: a stage that authors no program SHALL present Stage, Execution, and Routing, and a stage that authors a program SHALL present all five. A tab label SHALL name the concern it holds and SHALL be reachable and activatable from the keyboard. The tab row SHALL expose one tab stop, with arrow keys and the Home and End keys moving between tabs, and it SHALL report the selected tab and the panel it controls to assistive technology.

Opening the editor SHALL select the Stage tab, except when the surface that opened it names another tab: the workflow diagram SHALL open the Routing tab for a stage connection and a card's script panel SHALL open the Execution tab. Selecting a tab SHALL NOT store, discard, or validate the draft, and SHALL NOT change the overlay's size.

#### Scenario: Present the tabs a stage has content for

- **WHEN** the user opens the editor for a stage that authors no program
- **THEN** the tab row presents Stage, Execution, and Routing
- **AND** it presents no Inputs or Approval tab

#### Scenario: Present every tab for a scripted stage

- **WHEN** the user opens the editor for a stage that authors a program
- **THEN** the tab row presents Stage, Execution, Routing, Inputs, and Approval in that order

#### Scenario: Open on the Stage tab

- **WHEN** the user activates the stage edit action in a stage header
- **THEN** the editor opens with the Stage tab selected

#### Scenario: Open on the tab a surface names

- **WHEN** the user opens the editor from a card's script panel
- **THEN** the Execution tab is selected
- **AND** when the user opens it from a connection of the workflow diagram, the Routing tab is selected

#### Scenario: Keep the draft across tabs

- **WHEN** the user edits a name on the Stage tab, selects the Execution tab, and returns to the Stage tab
- **THEN** the edit is still present
- **AND** nothing was stored
- **AND** no validation problem was raised by the tab change

#### Scenario: Keep the overlay size across tabs

- **WHEN** the user switches between the tab with the least content and the tab with the most content
- **THEN** the overlay keeps the same width and height
- **AND** only the active panel scrolls

#### Scenario: Navigate between tabs from the keyboard

- **WHEN** the tab row holds focus and the user presses an arrow key, Home, or End
- **THEN** the next, first, or last tab is selected
- **AND** focus stays on the tab row
- **AND** the content panel for the selected tab is presented

### Requirement: Stage editor problem navigation

The editor SHALL mark every tab that holds a validation problem and SHALL announce that state in the tab's accessible name. When a save is refused for a problem outside the selected tab, the editor SHALL select the first tab, in tab order, that holds a problem, so a refusal never leaves the author on a tab that presents no problem. The problem SHALL remain presented inline next to the field it concerns, and the mark SHALL clear once no field on that tab holds a problem.

#### Scenario: Mark a tab that holds a problem

- **WHEN** the user clears the stage name and activates save
- **THEN** the editor presents the inline problem beside the name field
- **AND** the Stage tab announces that it holds a problem

#### Scenario: Reach a problem that is not on the selected tab

- **WHEN** the user is on the Routing tab and activates save while a field on the Inputs tab holds a problem
- **THEN** the editor selects the Inputs tab
- **AND** it presents the problem beside the field that caused it
- **AND** no command is sent

#### Scenario: Clear the mark after a fix

- **WHEN** the user corrects the only problem on a marked tab
- **THEN** that tab no longer announces a problem
- **AND** the stored stage is unchanged until the user saves