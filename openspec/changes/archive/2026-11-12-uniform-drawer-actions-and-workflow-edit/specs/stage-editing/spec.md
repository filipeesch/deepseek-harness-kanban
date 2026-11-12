## MODIFIED Requirements

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

#### Scenario: Keep the action available while the layout is locked

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
