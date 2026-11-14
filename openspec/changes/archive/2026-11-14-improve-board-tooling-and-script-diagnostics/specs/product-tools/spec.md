# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information, including reading several tasks in one call through `get_cards`; creating tasks; editing task titles and descriptions; reading a task's recorded relations and writing or removing them through `create_relation` and `delete_relation`; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board's exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, writing one stage's deterministic configuration through `set_stage_script`, reviewing a supplied document without saving it through `validate_workflow`, running one stage's authored program in an isolated test execution through `test_script`, reading one task's scripted execution state and the reason a saved result is held through `get_script_execution`, comparing a board's local document with the version this installation last applied from the team through `diff_published_board`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and reading a board's revision history through `list_board_revisions`, `diff_board_revisions`, and `revert_board`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition, pausing a task, nor writing a relation SHALL move a task, change its stage or position, send a message, or start an execution during the call; a declared transition SHALL be followed by the task's next completed turn.

The document, stage, authoring, measurement, revision, scripted-execution, validation, and comparison tools SHALL be declared only for an agent whose preset is the workflow architect preset. For every other calling agent they SHALL be absent from the declared tool set and SHALL NOT be dispatchable, and the plugin SHALL NOT merely refuse them at call time while still declaring them.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, reading several tasks in one call, card relation reading and writing, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and declaration, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, team file search, reading, creation, editing, and deletion, and cross-card message sending are available operations
- **AND** board movement, task deletion, note deletion, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Inspect the task pause tool names

- **WHEN** an agent receives the plugin's task control tools
- **THEN** the surface contains `pause_task` and `resume_task`
- **AND** no tool turns a task's auto mode on or off

#### Scenario: Inspect the relation tool names

- **WHEN** an agent receives the plugin's card tools
- **THEN** the surface contains `create_relation` and `delete_relation`
- **AND** no tool moves a task by writing a relation

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position while the call runs
- **AND** the declared transition decides the destination of the advance the next completed turn performs

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Do not change a card by writing a relation

- **WHEN** an agent creates or removes a relation
- **THEN** both tasks remain in their stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin's product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub's team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed

#### Scenario: Expose the cross-card message tool

- **WHEN** an agent receives the plugin's product tools inside a task conversation
- **THEN** `send_task_message` is available as an operation
- **AND** the tool surface still exposes no moving or deleting of tasks and no Hub administration

#### Scenario: Expose the workflow design tools to the workflow architect

- **WHEN** an agent whose preset is the workflow architect preset receives the plugin's tools
- **THEN** `get_board_yaml`, `get_stage`, `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, `remove_stage`, `set_stage_script`, `validate_workflow`, `test_script`, `get_script_execution`, `diff_published_board`, `get_route_stats`, `render_workflow_diagram`, `layout_metrics`, `list_board_revisions`, `diff_board_revisions`, and `revert_board` are declared operations
- **AND** the board administration and task tools remain declared as before

#### Scenario: Withhold the workflow design tools from every other agent

- **WHEN** an agent whose preset is not the workflow architect preset, including a task conversation, receives the plugin's tool declarations
- **THEN** none of the document, stage, authoring, measurement, revision, scripted-execution, validation, or comparison tools is declared
- **AND** a request naming one of them is not dispatched
- **AND** the board administration and task tools remain declared as before

#### Scenario: Offer no script retry or execution control to an agent

- **WHEN** an agent receives the plugin's tools for a board that holds a scripted stage
- **THEN** the surface exposes reading that stage's execution state and running an isolated test execution
- **AND** it exposes no operation that retries the delivery of a saved result, starts a real execution, stops a real execution, approves an executable version, or edits an entry's parameter values

### Requirement: Partial board workflow edits

`edit_board_yaml` SHALL accept one or more literal old/new text pairs. Each edit MAY also name the stage it targets and the authored field of that stage the match must fall inside, so an edit is unambiguous between stages that carry the same text. Each old value SHALL match the stored workflow YAML exactly once at the moment the edit is applied, within the scope the edit names when it names one. Zero matches, multiple matches, and an empty edit collection SHALL be rejected without changing the board. A rejection SHALL name the zero-based index of the edit that failed; for a missing match it SHALL name the closest authored line and its line number; for a repeated match it SHALL name the line number of every occurrence and, when the occurrences fall in different stages, the stage of each.

The plugin SHALL apply the pairs in order to an in-memory copy, validate the complete result with the same workflow semantics as the board UI, and persist the result all or nothing. Text and comments outside the replaced spans SHALL remain unchanged. A call that names a stage the workflow does not define, or a field the named stage does not author, SHALL be rejected without changing the board.

#### Scenario: Set a stage entry prompt

- **WHEN** an agent calls `edit_board_yaml` with an old value that occurs once in the current YAML and a new value that adds `on_enter_prompt` to that stage
- **THEN** the stage's entry prompt is stored
- **AND** the other stages and every comment outside the replaced span are unchanged

#### Scenario: Apply several edits in one call

- **WHEN** an agent calls `edit_board_yaml` with several old/new pairs and every old value occurs once at its turn
- **THEN** every pair is applied in order
- **AND** the board is persisted once with the complete result

#### Scenario: Scope an edit to one stage

- **WHEN** the same text exists in two stages and an edit names one of them
- **THEN** only that stage's occurrence is replaced
- **AND** the other stage's identical text is unchanged

#### Scenario: Scope an edit to one stage field

- **WHEN** an edit names a stage and the stage's entry instruction field
- **THEN** the old text is matched only inside that field
- **AND** the same text in that stage's script or transition list is not matched

#### Scenario: Reject an edit whose old text is absent

- **WHEN** an old value does not occur in the current workflow YAML
- **THEN** the tool reports that the text was not found, the index of the failed edit, and the closest authored line with its line number
- **AND** the board is unchanged, including the other pairs of the same call

#### Scenario: Reject an edit whose old text is ambiguous

- **WHEN** an old value occurs more than once in the current workflow YAML
- **THEN** the tool reports how many occurrences were found, their line numbers, and the stage of each
- **AND** the board is unchanged

#### Scenario: Reject an edit collection that produces an invalid workflow

- **WHEN** the applied result is rejected by the workflow parser or would orphan a task stage
- **THEN** the tool reports the validation problem
- **AND** the board's stored workflow is unchanged

#### Scenario: Preserve comments and formatting

- **WHEN** an agent edits one stage's allowed transitions and the YAML contains comments elsewhere
- **THEN** every comment and every untouched line remain exactly as authored
- **AND** only the replaced span differs

### Requirement: Board write concurrency

`update_board`, `edit_board_yaml`, and `delete_board` SHALL accept an optional Hub revision. The Hub revision is shared by every board of the Hub and advances on any Hub change, including a task move, a conversation change, and a note edit on another board, so it SHALL NOT be treated as the identity of the target board's document.

A tool that composes its document from the stored one SHALL, when the supplied revision no longer matches the current Hub revision, re-read the board and apply its composition to the current document. It SHALL proceed and save the composed result when the composition still succeeds and every anchor the call names still matches what it names. When the composition no longer succeeds, the tool SHALL reject the request without changing the board and SHALL report the current Hub revision together with the stale revision the caller supplied. When the installation still retains the document the most recent accepted write replaced, the report SHALL also name the stages and fields that changed on the target board. A tool that replaces the whole document SHALL reject a stale revision without changing the board, because a replacement cannot be rebased. When the revision is omitted, the tool SHALL apply the change to the current stored state. The board workflow read payload SHALL include the current Hub revision.

#### Scenario: Apply a write with the current revision

- **WHEN** an agent supplies the Hub revision returned by the read and the Hub has not changed since
- **THEN** the requested board change is applied

#### Scenario: Rebase a composed write after an unrelated Hub change

- **WHEN** the Hub revision moved because another board's task moved, and every anchor of the composed write still matches the target board
- **THEN** the composition is reapplied to the board's current document
- **AND** the write succeeds and reports the revision it saved

#### Scenario: Reject a write whose anchors no longer match

- **WHEN** the Hub revision moved and an anchor of the composed write no longer matches the target board
- **THEN** the write is refused and the board is unchanged
- **AND** the refusal reports the current Hub revision and the stale revision the caller supplied
- **AND** it names the stages and fields that changed when the installation still retains the replaced document

#### Scenario: Reject a write with a stale revision

- **WHEN** an agent supplies a Hub revision that no longer matches the current Hub revision and the write cannot be reapplied to the current document
- **THEN** the tool reports the revision conflict
- **AND** the board is unchanged

#### Scenario: Reject a whole-document write with a stale revision

- **WHEN** an agent supplies a Hub revision that no longer matches the current Hub revision and replaces the whole document
- **THEN** the tool reports the revision conflict
- **AND** the board is unchanged

#### Scenario: Apply a write without a revision

- **WHEN** an agent omits the Hub revision
- **THEN** the requested board change is applied to the current stored board

### Requirement: Board administration publishing

A board administration tool SHALL NOT publish. After a successful board creation, rename, workflow replacement, workflow edit, project scope change, or board removal, the tool SHALL change this installation's local state only and SHALL leave a team-bound board presented as the draft the publishing capability describes. Publishing SHALL remain a manual operator action in the interface and SHALL NOT be triggered by any product tool.

The tool result SHALL report the local change together with a publishing outcome that states that no publishing was attempted, and it SHALL NOT report a published state, a publishing blocker, or a publishing failure, because no publishing is attempted. A team-scoped board removal SHALL remove the board locally and SHALL leave the team's published board untouched until the operator publishes.

#### Scenario: Keep a tool write local on a bound Hub

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a team storage
- **THEN** the local change is saved
- **AND** nothing is published
- **AND** the board is presented as a draft
- **AND** the result states that no publishing was attempted

#### Scenario: Keep a tool workflow edit local

- **WHEN** an agent replaces or edits a board workflow while the board is published to a team
- **THEN** the local workflow is saved
- **AND** the board's log gains the revision the write records
- **AND** the team's published board still carries the previous document until the operator publishes

#### Scenario: Keep a tool removal local

- **WHEN** an agent removes a team-bound board with either scope
- **THEN** the board disappears locally
- **AND** the team's published layout is unchanged
- **AND** no publishing is attempted for that removal

#### Scenario: Keep an unbound Hub local

- **WHEN** an agent changes a board and the Hub is not bound to a storage
- **THEN** the change is saved locally
- **AND** the result reports that no publishing was attempted

#### Scenario: Publish a tool change on an explicit binding

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that requires explicit publishing
- **THEN** the local change is saved
- **AND** nothing is published by the tool
- **AND** the result states that the change is local and the board is a draft until the operator publishes it

#### Scenario: Let continuous storage synchronize a tool change

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that synchronizes continuously
- **THEN** the local change is saved
- **AND** the result does not report the change as left to automatic synchronization
- **AND** the board remains a draft until the operator publishes it

#### Scenario: Keep the local change when publishing is blocked

- **WHEN** the board carries a publishing blocker and an agent changes it
- **THEN** the local change is saved
- **AND** the result reports that no publishing was attempted
- **AND** the blocker is not reported as a publishing failure of the tool

#### Scenario: Do not publish a local-only removal

- **WHEN** an agent deletes a team-bound board with the local scope
- **THEN** the board disappears locally
- **AND** no publishing is attempted for that removal

#### Scenario: Keep a Hub awaiting review local

- **WHEN** an agent changes a board and the Hub is awaiting connection review
- **THEN** the change is saved locally
- **AND** the result reports that no publishing was attempted

#### Scenario: Keep a tool removal local

- **WHEN** an agent attempts to remove a board that is part of the team's shared configuration
- **THEN** the tool refuses and explains that the operator removes it in the interface
- **AND** the board and the team's document are unchanged
- **AND** no publishing is attempted

#### Scenario: Do not publish a local-only removal

- **WHEN** an agent removes a board that is not shared with the team
- **THEN** the board disappears locally
- **AND** the result states that no publishing was attempted

#### Scenario: Report no publishing outcome that cannot happen

- **WHEN** an agent writes a board through any board administration tool
- **THEN** the result never reports a publishing blocker or a publishing failure
- **AND** the result never reports that the change is left to automatic synchronization

### Requirement: Board deletion

`delete_board` SHALL require an explicit confirmation and SHALL refuse a board that contains tasks. The tool SHALL NOT delete the board's projects, project directories, worktrees, branches, native conversations, or native workspaces. A board that is part of the team's shared configuration SHALL be refused with an actionable problem: removing it is a publishing decision, so the operator removes it in the interface, where the local or team removal scope selects what is published. A board that is not shared SHALL be removed locally, and the result SHALL state that no publishing was attempted. Deleting the last board SHALL leave the Hub with no boards.

#### Scenario: Delete an empty board

- **WHEN** an agent calls `delete_board` with a board identifier, confirmation, and a board that contains no tasks
- **THEN** the board is removed from its Hub

#### Scenario: Refuse a board that contains tasks

- **WHEN** an agent calls `delete_board` for a board that still contains tasks
- **THEN** the tool reports that the board is in use
- **AND** the board and its tasks are unchanged

#### Scenario: Require a removal scope for a bound board

- **WHEN** an agent calls `delete_board` for a board that is part of the team's shared configuration
- **THEN** the tool refuses and explains that the operator removes it in the interface, where the removal scope is chosen
- **AND** the board is unchanged

#### Scenario: Remove a bound board only from this installation

- **WHEN** the operator removes a shared board with the local scope in the interface
- **THEN** the board disappears locally
- **AND** no publishing or synchronization is started for that removal

#### Scenario: Remove a bound board for the team

- **WHEN** the operator removes a shared board with the team scope in the interface
- **THEN** the board disappears locally
- **AND** the removal is included in the team's document through the Hub's publishing behavior

#### Scenario: Delete the last board

- **WHEN** an agent deletes the only board of a Hub that has no tasks
- **THEN** the Hub remains with no boards

## ADDED Requirements

### Requirement: Workflow write controls

Every tool that writes a board's workflow document SHALL accept three optional controls beside the document or the edits: a digest expectation, a dry review, and a response mode.

A supplied digest expectation SHALL be compared with the digest of the exact document the write would store, after composition and validation and before any persistence. A mismatch SHALL refuse the write, persist nothing, and report both digests. A matching expectation SHALL change nothing about the write.

A dry review SHALL compose and validate the document exactly as a real write does, return the same report, and persist nothing: no board document, no revision, no publishing, and no change to any task.

A response mode SHALL select the report shape: a summary, which is the default, and a full report. The summary SHALL carry the digest of the composed document, the stages whose content changed with the name of each changed field but not its text, the validation problems, the grouped warnings, the authorization impact, the affected cards, and the instruction and source sizes. The full report SHALL carry the per-field before and after values the report already defines. The digest SHALL be reported in both modes.

Every accepted write SHALL report the digest of the exact document it stored, so a caller can verify what was saved without reading the document back.

#### Scenario: Refuse a write whose document does not match the expected digest

- **WHEN** a caller supplies a digest expectation that differs from the composed document
- **THEN** nothing is persisted and no revision is recorded
- **AND** the result reports the expected and the composed digests

#### Scenario: Accept a write whose document matches the expected digest

- **WHEN** a caller supplies the digest of the document the write composes
- **THEN** the document is stored and its digest is reported

#### Scenario: Review a write without saving it

- **WHEN** a caller writes with the dry review control
- **THEN** the same report a real write would produce is returned
- **AND** the board, its revisions, its tasks, and the team document are unchanged

#### Scenario: Report a summary by default

- **WHEN** a caller writes without naming a response mode
- **THEN** the result names the stages that changed and the fields that changed in each
- **AND** it does not carry the before and after text of those fields
- **AND** it carries the digest of the stored document

#### Scenario: Report the full difference on request

- **WHEN** a caller writes with the full response mode
- **THEN** the result carries the per-field before and after values the report defines
- **AND** it carries the digest of the stored document
