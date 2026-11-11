# Spec Delta

## MODIFIED Requirements

### Requirement: Allowed transitions editing

The editor SHALL edit the stage's allowed transition targets in one of three modes: unrestricted, meaning any other stage may be a destination; restricted to a chosen set of the board's other stages; or no destinations, meaning the stage is terminal and permits no other stage. Unrestricted SHALL be the mode of a stage that authors no allowed transitions, and choosing it SHALL remove the stage's allowed transitions. The no-destinations mode SHALL be the mode of a stage that authors an empty allowed transitions list, and choosing it SHALL store an empty list. A stage that authors an empty list SHALL be presented in the no-destinations mode. In restricted mode the editor SHALL present the board's other stages as a checklist, so a destination can only be chosen from the stages that exist, and SHALL keep the stage itself out of the list.

Each chosen target SHALL carry an optional free-text condition describing when that transition applies. A condition field SHALL present that condition as editable multiline text whose field the user can enlarge, and SHALL NOT open a second editor for it; the text SHALL be stored with the transition it belongs to when the stage is saved. An empty or whitespace-only condition SHALL be stored as no condition.

The editor SHALL reject a restricted draft that chooses no destination, and SHALL present that problem as a direction to the no-destinations mode, so a stage that permits no destination is reached only through that mode. The editor SHALL reject a target that names the edited stage, a stage that no longer exists, and the same destination chosen twice.

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
