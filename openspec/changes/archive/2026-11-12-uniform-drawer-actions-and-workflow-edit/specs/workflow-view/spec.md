## MODIFIED Requirements

### Requirement: Stage edit action in the diagram stage header

While layout editing is unlocked, the diagram's stage header SHALL present the stage edit action defined by `stage-editing` alongside the stage title, the card count, and, on the initial stage, the task creation action. The action SHALL sit at the header's top right after the card count and SHALL live in the same group of stage actions, so presenting it never moves the stage title.

The action SHALL NOT be a layout edit, but SHALL be absent while the layout lock is on and SHALL appear when the layout is unlocked. It SHALL stay available while card selection is active and while the search or project filter hides every card of the stage; activating it SHALL NOT start a stage move, a stage resize, or a connection adjustment, SHALL NOT add a placement-history entry, and SHALL NOT store a workflow change by itself. The header is the stage's drag handle, so pressing the action SHALL NOT pick the stage up.

#### Scenario: Present the action in the diagram

- **WHEN** the unlocked diagram presents a board whose workflow has four stages
- **THEN** each stage header presents the stage edit action after its card count

#### Scenario: Pressing the action does not start a move

- **WHEN** the user presses the stage edit action in a stage header
- **THEN** the stage editor opens
- **AND** the stage does not enter a drag or resize gesture
- **AND** no placement-history entry is added

#### Scenario: Keep the action available while the layout is locked

- **WHEN** the layout is locked
- **THEN** the stage edit action is absent and not keyboard focusable
- **AND** stage moves, resizes, and arrow adjustments remain refused

#### Scenario: Show the action after unlocking

- **WHEN** the user unlocks layout editing
- **THEN** each stage edit action appears
- **AND** locking the layout again hides it
