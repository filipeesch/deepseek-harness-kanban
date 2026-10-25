# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list every workflow stage in workflow order, including the current stage. Stages that the workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement. An instructed destination SHALL follow the Drawer stage change prefills the stage instruction requirement.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project, and its execution status
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the complete workflow stage control in workflow order

#### Scenario: List the complete workflow
- **WHEN** the user opens the drawer for a task
- **THEN** the stage control lists every workflow stage in workflow order
- **AND** the current stage is included

#### Scenario: Present restricted stages with lower emphasis
- **WHEN** the workflow does not permit a transition from the current stage to another listed stage
- **THEN** that stage is presented with lower visual emphasis than permitted stages
- **AND** it remains selectable
- **AND** its restriction is available to assistive technology without adding visible explanatory text

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately
- **AND** a permitted instructed destination inserts the stage instruction into the active conversation composer without an additional confirmation

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value

#### Scenario: Execution status stays visible across sections
- **WHEN** a task is running an assistant turn and the user switches between the drawer's sections
- **THEN** the drawer header still presents the task's execution status on every section

#### Scenario: Execution status clears when the turn ends
- **WHEN** the task's assistant turn ends while the drawer is open
- **THEN** the drawer header stops presenting the turn execution status without a reload

### Requirement: Drawer stage change prefills the stage instruction
The drawer's stage control SHALL apply the same transition rules as a board drop: a permitted stage SHALL move the task immediately, and a restricted stage SHALL require explicit confirmation before the move. After the move, when the destination stage has an entry instruction, the drawer SHALL switch to the Conversations section and insert only that instruction into the composer of the active conversation; the instruction SHALL NOT be submitted and no agent execution SHALL start. If no conversation tab is active, the first open conversation SHALL be used. If the task has no open conversation, the drawer SHALL report that no conversation is available and SHALL NOT insert an instruction. Existing composer text and attachments SHALL be preserved; the drawer SHALL offer an explicit Replace action that clears both and inserts the instruction. The composer SHALL be focused after a successful insertion. A destination without an entry instruction SHALL only move the task.

#### Scenario: Change to an instructed stage from Conversations
- **WHEN** the user selects a permitted instructed destination while the Conversations section is active
- **THEN** the task moves immediately
- **AND** only the destination instruction is inserted into the active conversation's composer
- **AND** the instruction is not submitted and no agent starts
- **AND** the composer is focused

#### Scenario: Change to an instructed stage from another drawer section
- **WHEN** the user selects a permitted instructed destination while Info, Git, or Notes is active
- **THEN** the task moves immediately
- **AND** the drawer switches to Conversations
- **AND** only the instruction is inserted into the active conversation's composer

#### Scenario: Change to a restricted instructed stage
- **WHEN** the user selects a restricted instructed destination and confirms the override
- **THEN** the task moves to that stage
- **AND** the drawer switches to Conversations
- **AND** only the destination instruction is inserted into the active conversation's composer
- **AND** the instruction is not submitted and no agent starts

#### Scenario: Cancel a restricted destination
- **WHEN** the user cancels the restricted-stage confirmation
- **THEN** the task does not move
- **AND** no composer draft is created or replaced
- **AND** no agent execution starts

#### Scenario: Preserve an existing draft
- **WHEN** the target composer already has text or attachments
- **THEN** the drawer does not overwrite them
- **AND** it offers an explicit Replace action
- **AND** declining leaves the existing draft unchanged

#### Scenario: Replace an existing draft
- **WHEN** the user chooses Replace for a composer with text or attachments
- **THEN** the existing text and attachments are cleared
- **AND** only the stage instruction is inserted
- **AND** the instruction is not submitted

#### Scenario: No open conversation
- **WHEN** the user selects an instructed destination and every conversation tab is closed
- **THEN** the task moves after any required confirmation
- **AND** the drawer reports that no conversation is available for the instruction
- **AND** no instruction is submitted

#### Scenario: Change to an uninstructed stage
- **WHEN** the user selects a destination without an entry instruction
- **THEN** the task moves after any required confirmation
- **AND** no composer draft or agent execution is created by the change
