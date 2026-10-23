# Spec Delta

## ADDED Requirements

### Requirement: Rich workflow YAML editing
The Workflow configuration SHALL present YAML in a code-editor surface rather than a plain textarea. The surface SHALL provide YAML syntax highlighting, line numbers, folding, search, and a vertically resizable editing area, and it SHALL preserve the text and comments entered by the user without reformatting.

#### Scenario: Edit workflow YAML with code-editor assistance
- **WHEN** the user opens Configuration → Workflow
- **THEN** the YAML is shown with syntax highlighting and line numbers in a resizable editor
- **AND** the user can fold sections and search within the document

#### Scenario: Preserve authored text
- **WHEN** the user saves a workflow whose text was not changed
- **THEN** the stored YAML matches the editor text without normalization or reformatting

### Requirement: Expanded workflow editing area
The Workflow section SHALL use a larger Configuration surface than the other sections, and the editor SHALL support vertical resizing and a maximize action that expands the editing area without closing Configuration.

#### Scenario: Maximize the workflow editor
- **WHEN** the user activates the editor's maximize action
- **THEN** the editor expands within the Configuration dialog
- **AND** the Save and Reload actions remain available

#### Scenario: Resize the workflow editor
- **WHEN** the user drags the editor's vertical resize handle
- **THEN** the editing area grows or shrinks without changing the YAML or closing the dialog

### Requirement: Live workflow diagnostics and guarded save
The Workflow section SHALL validate the YAML locally while the user edits, using the same accepted workflow semantics as the host save path. Syntax problems SHALL be shown at their document positions, schema problems SHALL be shown inline or in an issue summary, and Save SHALL remain disabled while the current text is invalid or validation is pending.

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
- **AND** the last valid workflow is not replaced

### Requirement: Workflow draft preservation
The Workflow draft SHALL survive switching between Configuration tabs. Closing Configuration with unsaved changes, or replacing the draft with Reload, SHALL require explicit confirmation; canceling SHALL keep the draft and the dialog open.

#### Scenario: Switch tabs without losing the draft
- **WHEN** the user edits the workflow, switches to another Configuration tab, and returns to Workflow
- **THEN** the edited YAML is still present

#### Scenario: Confirm before closing
- **WHEN** the user attempts to close Configuration while the workflow draft differs from the saved workflow
- **THEN** a discard confirmation is shown
- **AND** canceling keeps the dialog open with the draft intact

#### Scenario: Confirm before reload
- **WHEN** the user activates Reload saved workflow while the draft is dirty
- **THEN** the user is asked to confirm replacing the draft

### Requirement: Content-height workflow columns
Each workflow column SHALL size itself to its own cards and controls. A column in a grouped workflow SHALL grow to fit its cards instead of receiving an equal share of a fixed group height. When the columns exceed the viewport, the board page SHALL scroll vertically; cards SHALL NOT be clipped or overflow their column background.

#### Scenario: Grow a grouped column with many cards
- **WHEN** a column inside a multi-column group contains more cards than fit in its previous equal-height share
- **THEN** the column grows so every card is inside the column surface
- **AND** the board page scrolls vertically when needed

#### Scenario: Short column stays content-sized
- **WHEN** another column in the same group has fewer cards
- **THEN** that column ends at its own content instead of stretching to match the taller peer

### Requirement: Animated task drawer transitions
Opening a task drawer from a card SHALL use a short slide-and-fade transition. Closing the drawer from the header action, Escape, or a board-background click SHALL use a symmetric exit transition before the drawer is removed. The entrance SHALL replay only when opening from a closed drawer, not when switching cards while the drawer is open. Reopening during the exit SHALL cancel the exit, and reduced-motion preferences SHALL disable these animations.

#### Scenario: Animate opening from a card
- **WHEN** the user opens a task drawer from a closed state
- **THEN** the drawer enters with the configured slide-and-fade transition
- **AND** focus moves into the drawer

#### Scenario: Do not replay when switching cards
- **WHEN** the user selects another card while the drawer is already open
- **THEN** the drawer content changes without replaying the entrance transition

#### Scenario: Animate closing
- **WHEN** the user closes the drawer with the header action, Escape, or a board-background click
- **THEN** the drawer plays the exit transition before it is removed
- **AND** its controls do not accept interaction during the exit

#### Scenario: Reopen during exit
- **WHEN** the user selects a card while the drawer is exiting
- **THEN** the exit is canceled and the drawer remains available

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the drawer opens and closes without the entrance or exit transition
