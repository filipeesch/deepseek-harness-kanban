# stage-editing Specification

## Purpose

Lets a user edit one stage of a board's workflow from the stage header itself, without opening the workflow YAML, while keeping every authored detail of the workflow document that the edit does not touch.

## Requirements

### Requirement: Stage edit action in a stage header

Every stage of the active board SHALL present a stage edit action in its header in the column board and in the workflow diagram while layout editing is unlocked. The action SHALL be an icon control placed at the header's top right, after the stage's card count, inside the same group of stage actions so that presenting it never moves the stage title. It SHALL carry an accessible name naming the stage it edits and a tooltip naming the same action, so a sighted and an assisted reading agree.

The action SHALL be available while card selection is active and while a search or project filter hides every card of that stage. It SHALL be absent from the workflow diagram while the layout lock is on and SHALL appear when the layout is unlocked. Activating it SHALL NOT be a layout edit and SHALL NOT start a stage move, a stage resize, or a connection adjustment, whether it is activated by pointer or by keyboard, and it SHALL NOT store a workflow change by itself.

The action SHALL be focusable and SHALL activate from the keyboard as readily as from the pointer. Activating it opens the stage editor for that stage, which takes focus while it is open and returns focus to the action that opened it when it is dismissed without saving.

#### Scenario: Refuse the action while the diagram is locked

- **WHEN** the workflow diagram is locked and the user presents a stage header
- **THEN** the stage edit action is not presented or keyboard focusable
- **AND** the stage editor cannot be opened through it

#### Scenario: Present the action on every stage

- **WHEN** the column board or the unlocked diagram presents a workflow with four stages
- **THEN** each of the four stage headers presents the stage edit action

#### Scenario: Present the action after the card count

- **WHEN** a stage header presents a task creation action, its card count, and the stage edit action
- **THEN** the stage edit action appears after the card count at the header's top right
- **AND** the stage title stays where it was

#### Scenario: Activate the action without moving the stage

- **WHEN** the user presses the stage edit action in a stage header of the diagram
- **THEN** the stage editor opens for that stage
- **AND** the stage does not move, resize, or enter a gesture
- **AND** no workflow change is stored

#### Scenario: Reveal and hide the action with the lock

- **WHEN** the user unlocks layout editing
- **THEN** each diagram stage presents its edit action
- **AND** locking layout editing again hides the actions

#### Scenario: Open the editor from the keyboard

- **WHEN** the stage edit action has focus and the user activates it from the keyboard
- **THEN** the stage editor opens for that stage
- **AND** focus moves inside the editor

#### Scenario: Restore focus on dismiss

- **WHEN** the user dismisses the stage editor without saving
- **THEN** focus returns to the stage edit action that opened it

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

### Requirement: Stage display name editing

The editor SHALL edit the stage's display name. The name SHALL be required, SHALL be trimmed of surrounding whitespace, and SHALL be rejected with an inline problem when it is empty. When another stage of the same board already uses the edited name, the editor SHALL present a non-blocking warning and SHALL still allow the save, because the workflow format does not require unique names. Changing the display name SHALL NOT change the stage identifier or any task.

#### Scenario: Reject an empty name

- **WHEN** the user clears the stage name and activates save
- **THEN** the editor presents an inline problem naming the missing name
- **AND** no command is sent

#### Scenario: Warn about a duplicate name

- **WHEN** the user sets the stage name to the name of another stage of the same board
- **THEN** the editor presents a warning naming the other stage
- **AND** the save action remains available

#### Scenario: Keep the identifier

- **WHEN** the user changes only the stage name and saves
- **THEN** every task in that stage keeps its stage assignment

### Requirement: Stage entry instruction editing

The editor SHALL edit the stage's entry instruction as multiline text. An instruction with content SHALL be stored for that stage; an instruction the user clears or reduces to whitespace SHALL remove the stage's entry instruction, so no instruction is delivered when a task enters that stage. Changing the instruction SHALL NOT change the instruction already delivered to a task that entered the stage earlier.

This instruction field SHALL apply to the non-deterministic execution mode. Editing or clearing an agent instruction SHALL NOT implicitly create or run deterministic configuration. Switching to deterministic execution SHALL require a valid mutually exclusive deterministic draft; saving either mode SHALL NOT alter a script version already captured by another task execution.

#### Scenario: Store an entry instruction

- **WHEN** the user writes an instruction and saves
- **THEN** the stage stores that instruction
- **AND** a task entering the stage afterwards is delivered that instruction

#### Scenario: Clear an entry instruction

- **WHEN** the stage has an entry instruction and the user clears the field and saves
- **THEN** the stage has no entry instruction
- **AND** a task entering the stage afterwards is delivered no instruction

#### Scenario: Keep a delivered instruction

- **WHEN** a task entered the stage before the instruction changed
- **THEN** the instruction already delivered to that task stays as delivered

#### Scenario: Keep instruction editing separate from a captured script

- **WHEN** the user changes the saved stage execution mode while a task still owns a captured deterministic run
- **THEN** the saved draft follows mutual-exclusion validation
- **AND** the existing execution is not replaced or activated by that save

### Requirement: Allowed transitions editing

For a stage without deterministic configuration, the editor SHALL edit the stage's allowed transition targets in one of three modes: unrestricted, meaning any other stage may be a destination; restricted to a chosen set of the board's other stages; or no destinations, meaning the stage is terminal and permits no other stage. Unrestricted SHALL be the mode of a stage that authors no allowed transitions, and choosing it SHALL remove the stage's allowed transitions. The no-destinations mode SHALL be the mode of a stage that authors an empty allowed transitions list, and choosing it SHALL store an empty list. A stage that authors an empty list SHALL be presented in the no-destinations mode. In restricted mode the editor SHALL present the board's other stages as a checklist, so a destination can only be chosen from the stages that exist, and SHALL keep the stage itself out of the list.

Each chosen target SHALL carry an optional free-text condition describing when that transition applies. A condition field SHALL present that condition as editable multiline text whose field the user can enlarge, and SHALL NOT open a second editor for it; the text SHALL be stored with the transition it belongs to when the stage is saved. An empty or whitespace-only condition SHALL be stored as no condition.

The editor SHALL reject a restricted draft that chooses no destination, and SHALL present that problem as a direction to the no-destinations mode, so a stage that permits no destination is reached only through that mode. The editor SHALL reject a target that names the edited stage, a stage that no longer exists, and the same destination chosen twice.

A deterministic stage SHALL use its named exit mapping instead of authoring this allowed-transition list. Its editor SHALL choose each exit's destination from other existing stages, SHALL reject a self-target or an unknown target, and SHALL allow distinct exit names to select the same stage. The configured destination set SHALL be derived from those mappings without choosing a first-exit default. Legacy free-text conditions SHALL NOT become output selectors or executable predicates, and editing one execution mode SHALL NOT create a second routing source.

#### Scenario: Present the other stages as choices

- **WHEN** the user opens the allowed transitions section for a board with four stages
- **THEN** the editor offers the three other stages as choices
- **AND** the edited stage is not offered

#### Scenario: Choose targets with conditions

- **WHEN** the user chooses two targets and writes a condition for one of them and saves
- **THEN** the stage allows exactly those two destinations
- **AND** the condition is stored with the target it belongs to

#### Scenario: Expand a condition

- **WHEN** the user enlarges a condition field to read or edit a long condition
- **THEN** the field grows and shows the whole text
- **AND** no second editor is opened for it
- **AND** nothing is stored until the stage is saved

#### Scenario: Allow any stage

- **WHEN** the user chooses the unrestricted mode and saves
- **THEN** the stage authors no allowed transitions
- **AND** any other stage may be a destination

#### Scenario: Choose no destinations

- **WHEN** the user chooses the no-destinations mode and saves
- **THEN** the stage authors an empty allowed transitions list
- **AND** no other stage is a destination

#### Scenario: Present a stage that authors no destination

- **WHEN** the user opens the editor for a stage that authors an empty allowed transitions list
- **THEN** the editor presents the no-destinations mode as the chosen mode
- **AND** it presents no destination as chosen

#### Scenario: Restore a stage that allows any other stage

- **WHEN** the user changes a stage that authors no destination to the unrestricted mode and saves
- **THEN** the stage authors no allowed transitions
- **AND** any other stage may be a destination

#### Scenario: Reject an empty restricted set

- **WHEN** the user chooses the restricted mode, chooses no destination, and activates save
- **THEN** the editor presents an inline problem that names the no-destinations mode
- **AND** no command is sent

#### Scenario: Edit a condition as multiline text

- **WHEN** the user enters several lines in a condition field and saves
- **THEN** the whole text is stored with that destination

#### Scenario: Accept an empty condition

- **WHEN** the user clears a condition and saves
- **THEN** the transition stores no condition

#### Scenario: Reject the stage as its own destination

- **WHEN** a stored or chosen destination names the edited stage
- **THEN** the editor presents an inline problem
- **AND** no command is sent

#### Scenario: Choose several named exits for the same destination

- **WHEN** the deterministic editor maps two different exit names to the same other stage
- **THEN** both exit names and mappings are retained
- **AND** the destination is not rejected as a duplicate legacy checklist entry
- **AND** no separate allowed-transition list or default first exit is authored

### Requirement: Initial stage action

The editor SHALL present an action that makes the edited stage the workflow's initial stage. That action SHALL be presented only while the edited stage is not the initial stage. Activating it and saving SHALL make the edited stage the initial stage, and the board's task creation action SHALL move to that stage, with exactly one initial stage remaining at all times.

#### Scenario: Present the action on a non-initial stage

- **WHEN** the user opens the editor for a stage that is not the board's initial stage
- **THEN** the editor presents the action that makes it the initial stage

#### Scenario: Omit the action on the initial stage

- **WHEN** the user opens the editor for the board's initial stage
- **THEN** the editor does not present the action that makes it the initial stage

#### Scenario: Move the initial stage

- **WHEN** the user activates the action on a stage that is not initial and saves
- **THEN** that stage becomes the workflow's initial stage
- **AND** the board presents its task creation action in that stage
- **AND** the previous initial stage no longer presents it

### Requirement: Stage identifier editing

The editor SHALL present the stage identifier as read-only until the board reports no in-flight work, and SHALL present, when it is unavailable, why the identifier cannot be edited. The board SHALL count as having in-flight work when any task of the board has a running conversation, a pending transition, an armed automatic advance, an unresolved stage instruction, an operation in progress, or a worktree that is being prepared or is in error, or an active, stopping, recovering, or result-awaiting-delivery deterministic execution. The identifier field SHALL otherwise be editable, SHALL be validated as a safe identifier, and SHALL be rejected with an inline problem when it is empty or when another stage of the board already uses it.

Changing the identifier SHALL keep the board valid and SHALL keep every stage reference pointing at the same stage: the initial stage, group membership, other stages' allowed transition targets, deterministic exit destinations, and connection layouts SHALL be rewritten to the new identifier. Tasks that are idle in the edited stage SHALL be migrated to the new identifier by the same save, so no task is left in a stage the workflow does not define. The save SHALL be all-or-nothing: when any reference or task cannot be migrated, nothing SHALL be stored. Changing the identifier SHALL NOT change the stage's stable identity: the stage SHALL remain the same stage to everything that addresses it by identity, and the authored identity SHALL be preserved exactly as it was.

The identifier edit SHALL NOT require a confirmation step. On a board that is published to a team, the identifier SHALL remain editable, and the rename SHALL reach other members as a change to that stage's identifier rather than as a removal and a creation, so that each member migrates its own tasks in the same save that stores the resulting workflow. The rename SHALL NOT require a team review and SHALL NOT be blocked by another member's tasks.

The rename SHALL preserve the stable local stage association used by executable trust and project-and-stage variable scopes; it SHALL NOT transfer those values or grants to another stage, expose secret values, or merge scopes from different projects. A change to executable authority SHALL still follow the normal trust-review rules. Renaming SHALL migrate applicable local task and handoff stage references while retaining execution and entry identities and previously captured program bytes. An unpublished stage SHALL NOT require fabrication of a published workflow identity merely to preserve its local association.

#### Scenario: Keep the identifier read-only during in-flight work

- **WHEN** the board has a task with a pending transition and the user opens the stage editor
- **THEN** the stage identifier is read-only
- **AND** the editor explains why it cannot be edited

#### Scenario: Rename the identifier

- **WHEN** the board has no in-flight work, two idle tasks are in the edited stage, and the user changes the identifier and saves
- **THEN** both tasks are assigned to the new identifier
- **AND** every transition and group that named the old identifier names the new one
- **AND** the stage keeps its name, instruction, targets, size, and position

#### Scenario: Keep the stage identity across a rename

- **WHEN** the user changes a stage identifier and saves
- **THEN** the stage keeps its stable identity
- **AND** the authored identity is unchanged
- **AND** every reference the editor does not present is preserved

#### Scenario: Reject a duplicate identifier

- **WHEN** the user sets the identifier to one that another stage of the board uses
- **THEN** the editor presents an inline problem
- **AND** no command is sent

#### Scenario: Store nothing when the rename cannot complete

- **WHEN** a rename would leave a reference or a task unresolved
- **THEN** nothing is stored
- **AND** the editor stays open with the draft intact

#### Scenario: Rename on a published board

- **WHEN** the board is published to a team and the board has no in-flight work
- **THEN** the identifier remains editable
- **AND** the change is stored and published like any other workflow change
- **AND** other members apply it as a change to that stage's identifier, so their own tasks in that stage move with it
- **AND** no team review is required for the rename

#### Scenario: Withhold identifier edits during deterministic work

- **WHEN** a board has an active or result-awaiting-delivery deterministic execution
- **THEN** the identifier field is read-only with an explanation
- **AND** the ordinary script and route fields remain editable under their own validation and capture rules

#### Scenario: Rename a stage without crossing local variable scopes

- **WHEN** an idle deterministic stage identifier is renamed and other stages map exits to it
- **THEN** those authored exit destinations follow the same stage in the same save
- **AND** its local project-and-stage variable associations remain distinct for every project
- **AND** no secret value or trust grant is published by the rename

### Requirement: Authored workflow text preservation

A stage edit SHALL change only the fields the editor edits. Every other character of the authored workflow SHALL stay as its author wrote it: comments, key order, quoting style, blank lines, connection layouts, stage position and size, and any authored key the editor does not present. Other stages SHALL NOT change, and the workflow document the edit produces SHALL be validated before it is stored.

Deterministic configuration SHALL obey the same preservation rule. Editing one script, source path, directory choice, exit route, or authorized variable-name list SHALL NOT rewrite unrelated stages or discard comments, scalar text, or layout. An edit that does not present deterministic fields SHALL preserve them. Local credentials, trust grants, captured execution state, and secret values SHALL NOT be inserted into the workflow document.

#### Scenario: Preserve authored comments and order

- **WHEN** the authored workflow carries comments and a custom key order and the user edits one stage name and saves
- **THEN** every comment, key order, and untouched value remains
- **AND** only that stage's name changed

#### Scenario: Leave other stages alone

- **WHEN** the user edits one stage and saves
- **THEN** no other stage's name, instruction, targets, position, or size changes

#### Scenario: Refuse an invalid result

- **WHEN** the edited stage's fields would make the workflow invalid
- **THEN** nothing is stored
- **AND** the editor presents the validation problem inline

#### Scenario: Preserve a script while editing unrelated stage fields

- **WHEN** the user changes only a deterministic stage's display name in a workflow with authored code and comments
- **THEN** its script bytes and untouched configuration remain as authored
- **AND** no other stage or layout is rewritten
- **AND** no local variable value, trust, or execution snapshot is serialized into YAML
