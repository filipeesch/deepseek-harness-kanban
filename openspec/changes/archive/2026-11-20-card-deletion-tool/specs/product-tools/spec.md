# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information, including reading several tasks in one call through `get_cards`; creating tasks; editing task titles and descriptions; deleting a task through `delete_card`; reading a task recorded relations and writing or removing them through `create_relation` and `delete_relation`; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with the concise `get_workflow_summary`; searching, reading, creating, editing, and deleting the Hub team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, writing one stage scripted configuration through `set_stage_script`, reviewing a supplied document without saving it through `validate_workflow`, running one stage authored program in an isolated test execution through `test_script`, reading one task scripted execution state and the reason a saved result is held through `get_script_execution`, comparing a board local document with the version this installation last applied from the team through `diff_published_board`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and readin... (line truncated to 2000 chars)

The document, stage, authoring, measurement, revision, scripted-execution, validation, and comparison tools SHALL be declared only for an agent whose preset is the workflow architect preset. For every other calling agent they SHALL be absent from the declared tool set and SHALL NOT be dispatchable, and the plugin SHALL NOT merely refuse them at call time while still declaring them.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, reading several tasks in one call, card relation reading and writing, task creation, task text editing, task deletion, shared note creation, listing, and tag-aware updating, transition discovery and declaration, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, team file search, reading, creation, editing, and deletion, and cross-card message sending are available operations
- **AND** board movement, note deletion, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Inspect the task pause tool names

- **WHEN** an agent receives the plugin task control tools
- **THEN** the surface contains `pause_task` and `resume_task`
- **AND** no tool turns a task auto mode on or off

#### Scenario: Inspect the relation tool names

- **WHEN** an agent receives the plugin card tools
- **THEN** the surface contains `create_relation` and `delete_relation`
- **AND** no tool moves a task by writing a relation

#### Scenario: Inspect the card deletion tool name

- **WHEN** an agent receives the plugin card tools
- **THEN** the surface contains `delete_card`
- **AND** it contains no tool that deletes several tasks in one call, and no tool that removes a task worktree alone

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position while the call runs
- **AND** an ordinary declaration decides the destination of the advance the next completed turn performs, while an exceptional declaration is subject to its originating-turn identity and admission guards

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Do not change a card by writing a relation

- **WHEN** an agent creates or removes a relation
- **THEN** both tasks remain in their stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed

#### Scenario: Expose the cross-card message tool

- **WHEN** an agent receives the plugin product tools inside a task conversation
- **THEN** `send_task_message` is available as an operation
- **AND** the tool surface still exposes no moving of tasks and no Hub administration

#### Scenario: Expose the workflow design tools to the workflow architect

- **WHEN** an agent whose preset is the workflow architect preset receives the plugin tools
- **THEN** `get_board_yaml`, `get_stage`, `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, `remove_stage`, `set_stage_script`, `validate_workflow`, `test_script`, `get_script_execution`, `diff_published_board`, `get_route_stats`, `render_workflow_diagram`, `layout_metrics`, `list_board_revisions`, `diff_board_revisions`, and `revert_board` are declared operations
- **AND** the board administration and task tools remain declared subject to the existing role policy

#### Scenario: Withhold the workflow design tools from every other agent

- **WHEN** an agent whose preset is not the workflow architect preset, including a task conversation, receives the plugin tool declarations
- **THEN** none of the document, stage, authoring, measurement, revision, scripted-execution, validation, or comparison tools is declared
- **AND** a request naming one of them is not dispatched
- **AND** other board administration and task tools are declared only when the calling preset allows them

#### Scenario: Offer no script retry or execution control to an agent

- **WHEN** a workflow architect receives the plugin tools for a board that holds a scripted stage
- **THEN** the surface exposes reading that stage execution state and running an isolated test execution
- **AND** it exposes no operation that retries the delivery of a saved result, starts a real execution, stops a real execution, approves an executable version, or edits an entry parameter values

### Requirement: Explicit user intent without a second product confirmation

Creating, editing, or deleting a task, creating, renaming, editing, or deleting a board, and creating, editing, or deleting a Hub's team file SHALL require an explicit user request for that change. Sending a cross-card message, declaring a transition, and creating or removing a card relation SHALL require the user's explicit request in that conversation, an explicit direction in the stage instruction delivered to it, or an explicit request in a cross-card message from another task. The plugin SHALL NOT add another product-specific approval dialog for a write that the user, that stage instruction, or that peer request explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior, and a cross-card message received from another task SHALL NOT satisfy it for any change other than declaring a transition and writing the relation it asks for.

Deleting a task through `delete_card` SHALL require the user's explicit request in the calling conversation and nothing weaker: neither a stage instruction delivered to that conversation, nor a cross-card message from another task, nor the agent's own judgement SHALL authorize it. The tool's `confirmed` parameter SHALL carry the agent's assertion of that request, and a call without it SHALL be refused before any operation is recorded.

#### Scenario: Create a task at the user's request

- **WHEN** the user explicitly asks an agent to create a task and the agent invokes the corresponding board operation
- **THEN** the requested task can be created without an additional product-specific confirmation dialog

#### Scenario: Edit a task at the user's request

- **WHEN** the user explicitly asks an agent to change a task's title or description and the agent invokes the corresponding board operation
- **THEN** the requested text change can be applied without an additional product-specific confirmation dialog

#### Scenario: Delete a task at the user request

- **WHEN** the user explicitly asks an agent in that conversation to delete a card and the agent invokes `delete_card` with confirmation
- **THEN** the deletion is admitted without a second product-specific confirmation dialog
- **AND** the tool reports the card, the admitted operation phase, and the consequences it read before admission

#### Scenario: Refuse a deletion the stage instruction only implies

- **WHEN** a stage instruction delivered to the calling conversation tells the agent to keep the board clean, or a cross-card message asks it to remove a card, and no user in that conversation asked for that deletion
- **THEN** the tool does not authorize the deletion
- **AND** the agent reports that the user must request it

#### Scenario: Refuse a deletion without the confirmation assertion

- **WHEN** an agent invokes `delete_card` without `confirmed: true`
- **THEN** the call is refused with the same confirmation requirement the interface command uses
- **AND** no operation is recorded and the card is unchanged

#### Scenario: Create a board at the user's request

- **WHEN** the user explicitly asks an agent to create a board in a Hub and the agent invokes `create_board`
- **THEN** the requested board can be created without an additional product-specific confirmation dialog

#### Scenario: Delete a board at the user's request

- **WHEN** the user explicitly asks an agent to delete an empty board and the agent invokes `delete_board` with confirmation
- **THEN** the requested board can be deleted without an additional product-specific confirmation dialog

#### Scenario: Do not use cards for unsolicited agent tracking

- **WHEN** an agent has no explicit user request to create, edit, or delete a board task or a board
- **THEN** the plugin's board tools do not authorize that change merely to track the agent's own work

#### Scenario: Edit a team file at the user's request

- **WHEN** the user explicitly asks an agent to change a document in the Hub's team files and the agent invokes the corresponding team file tool
- **THEN** the requested change can be applied without an additional product-specific confirmation dialog

#### Scenario: Do not use team files for unsolicited agent bookkeeping

- **WHEN** an agent has no explicit user request to create, edit, or delete a team file
- **THEN** the plugin's team file tools do not authorize that change merely to record the agent's own progress

#### Scenario: Send a cross-card message at the user's request

- **WHEN** the user explicitly asks an agent to send a message to another task and the agent invokes `send_task_message`
- **THEN** the requested message can be delivered without an additional product-specific confirmation dialog

#### Scenario: Send a cross-card message directed by the stage instruction

- **WHEN** the stage instruction delivered to the calling conversation explicitly directs a message to another task and the agent invokes `send_task_message`
- **THEN** the message can be delivered without an additional product-specific confirmation dialog
- **AND** the user is not asked to authorize it separately

#### Scenario: Do not message another card unsolicited

- **WHEN** an agent has neither an explicit user request nor a stage-instruction direction to message another task
- **THEN** the plugin's cross-card message tool does not authorize that message merely to record the agent's own progress

#### Scenario: Write a relation directed by the stage instruction

- **WHEN** the stage instruction delivered to the calling conversation explicitly directs the agent to relate its task to another task and the agent invokes `create_relation`
- **THEN** the relations are stored without an additional product-specific confirmation dialog
- **AND** the user is not asked to authorize them separately

#### Scenario: Do not write relations unsolicited

- **WHEN** an agent has no explicit user request, stage-instruction direction, or peer request to relate tasks
- **THEN** the plugin's relation tools do not authorize the write merely to record the agent's own progress

#### Scenario: Do not write on a peer message

- **WHEN** a cross-card message asks the receiving agent to create, edit, or delete a task, board, note, or team file
- **THEN** the plugin's tools still require the receiving conversation's user to request that change
- **AND** the message alone authorizes no such write

#### Scenario: Do not delete on a peer message

- **WHEN** a cross-card message asks the receiving agent to delete the card it works on or any other card
- **THEN** `delete_card` still requires the user in the receiving conversation to request that deletion
- **AND** the message alone authorizes no deletion

### Requirement: Availability outside task-bound chats

Board and task read tools SHALL be available in task conversations and ordinary DSH chats. Creating or editing a task SHALL NOT require the calling chat to be associated with a task card. Deleting a task through `delete_card` SHALL be available in both, and SHALL resolve its Hub scope from the task in a task conversation and from an explicit Hub identifier otherwise. Board administration writes SHALL be available only in an ordinary DSH chat that is not owned by a task; a session owned by a task, including a subagent descendant of a task conversation, SHALL be rejected without changing board state. Board-scoped tools SHALL require an explicitly discovered board identifier in an ordinary DSH chat and SHALL resolve it from the task in a task conversation. Team file tools SHALL be available in task conversations and ordinary DSH chats alike, SHALL resolve the Hub from the task in a task conversation, and SHALL NOT require a board identifier or a task identifier. `send_task_message` SHALL be available only inside a conversation associated with a task. An ordinary DSH chat, a session that no task owns, and a subagent descendant of a task conversation SHALL be rejected with an actionable error without delivering anything.

#### Scenario: Use board tools from an ordinary DSH chat

- **WHEN** a user asks for a supported board operation in an ordinary DSH chat
- **THEN** the agent can discover a Hub and board with the approved tools
- **AND** it can perform the operation with the discovered board identifier without first opening or creating a task-bound conversation

#### Scenario: Delete a card from an ordinary DSH chat

- **WHEN** the user asks an agent in an ordinary DSH chat to delete a card and names the card
- **THEN** the agent can invoke `delete_card` with that task identifier
- **AND** the deletion is refused when the card belongs to a Hub other than the one named for the call

#### Scenario: Delete a card from a task conversation

- **WHEN** the user asks an agent in a task conversation to delete a card of that task Hub
- **THEN** the tool resolves the Hub from the task and needs no Hub identifier
- **AND** the deletion is refused when the named card belongs to another Hub

#### Scenario: Use board tools from a task conversation

- **WHEN** a user asks for a supported board read operation within a task conversation
- **THEN** the same approved read operation set is available there
- **AND** the board identifier can be inferred from the task

#### Scenario: Reject board administration from a task conversation

- **WHEN** an agent invokes `create_board`, `update_board`, `edit_board_yaml`, or `delete_board` from a task conversation or from a subagent descendant of one
- **THEN** the tool rejects the request with an actionable error
- **AND** no board is created, changed, or deleted

#### Scenario: Do not require a board for Hub discovery

- **WHEN** an agent calls `list_hubs`
- **THEN** the tool returns the Hubs available to the installation
- **AND** it does not require a board or a native workspace

#### Scenario: Use team file tools from either conversation kind

- **WHEN** a user asks an agent to read or change a Hub's team file from a task conversation or from an ordinary DSH chat
- **THEN** the tool resolves the Hub for that conversation and reports the storage's team file support
- **AND** no board identifier or task identifier is required

#### Scenario: Reject a cross-card message outside a task conversation

- **WHEN** an agent invokes `send_task_message` from an ordinary DSH chat or from a session that no task owns
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject a cross-card message from a subagent descendant

- **WHEN** an agent invokes `send_task_message` from a subagent descendant of a task conversation
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered


### Requirement: Product tools are declared per role

The plugin SHALL declare a product tool for an agent only when that agent's preset allows it. A preset that names a role allowlist SHALL receive exactly the product tools in that allowlist: a product tool outside it SHALL be absent from the declared tool set and SHALL NOT be dispatchable, rather than declared and refused at call time. An agent whose preset is not a project role, including an agent on the host default preset and the workflow architect, SHALL keep its existing product tool surface apart from the replacement of `get_board_summary` by `get_workflow_summary`, and the workflow-architect-only declaration stated in the product tool surface requirement SHALL remain unchanged. The allowlist SHALL be read from the preset's own composition, so two boards that select different role presets get different surfaces without a board setting. This restriction SHALL NOT bypass native DSH permission behavior or any authorization the tool already enforces, and it SHALL NOT change what a product tool does when it is declared. The card deletion tool SHALL belong to the planner allowlist and SHALL be absent from the manager allowlist.

#### Scenario: Select the planner's surface

- **WHEN** an agent runs on a preset that allows board reading, card creation, editing, and deletion, relations, notes, messages, transitions, pause and resume, team files, and the structured-question tool
- **THEN** those product tools are declared for it
- **AND** the workflow-authoring and board-administration tools are not

#### Scenario: Select the manager's surface

- **WHEN** an agent runs on a preset that allows board reading, notes, messages, transitions, pause and resume, and the structured-question tool
- **THEN** exactly those product tools are declared for it
- **AND** no card creation, card editing, or card deletion tool is declared

#### Scenario: The manager cannot delete a card

- **WHEN** the manager's allowlist is read
- **THEN** it does not contain the card deletion tool name
- **AND** a manager conversation that needs a card removed asks the person or the planner instead

#### Scenario: The planner can delete a card

- **WHEN** the planner's allowlist is read
- **THEN** it contains the card creation, card editing, and card deletion tool names
- **AND** it still contains no board administration or workflow authoring tool

#### Scenario: Absence rather than refusal

- **WHEN** an agent on a role preset is asked about a product tool outside its allowlist
- **THEN** the tool does not appear in its declared tool set
- **AND** a call to it is reported as an unknown tool rather than as a permission refusal

#### Scenario: Leave other presets alone

- **WHEN** an agent runs on the host default preset or on the workflow architect preset
- **THEN** it keeps its existing product tool surface except for the replacement of `get_board_summary` by `get_workflow_summary`
- **AND** the workflow-architect-only declaration is unchanged
- **AND** the card deletion tool is declared for it the same way card creation is

## ADDED Requirements

### Requirement: Card deletion tool

The plugin SHALL expose `delete_card` as a product tool that permanently deletes one card. The tool SHALL accept an optional task identifier, a confirmation flag, and an optional Hub identifier, and SHALL NOT accept a worktree path, a discard flag, or a force flag.

The tool SHALL resolve its target from the task identifier when one is given and otherwise from the task that owns the calling conversation, and it SHALL reject a call that names neither. A blank task identifier SHALL be rejected instead of being read as an omission, because reading it as one would redirect the deletion to the caller's own card. Inside a task conversation the Hub of that conversation SHALL be the boundary: a card of another Hub SHALL be rejected, whether or not the call also names that Hub. Outside a task conversation the Hub identifier SHALL be required, so a card is never deleted by a globally resolved identifier alone. A task identifier that resolves to a task of another Hub SHALL be rejected with an actionable problem that names the scope mismatch, and SHALL NOT be reported as a missing task.

The tool SHALL report the consequences it reads immediately before admission: the conversation count including how many are closed, the number of shared notes, the number of relations that join the card to another, the checkout path and branch, whether that checkout is a Git managed worktree created by Kanban or attached externally, whether the associated project is a plain folder so the checkout will remain on disk, whether unclaimed checkouts remain, and whether the checkout currently holds local changes that require a separate discard confirmation. A consequence the host cannot determine SHALL be reported as unavailable rather than guessed, and SHALL NOT prevent admission.

The tool SHALL admit the deletion through the same confirmed deletion command the interface uses, passing the worktree binding it just read as the expected target, and SHALL return without waiting for the background cleanup, which the queue may already have started. The result SHALL identify the card and its Hub, report the recorded operation phase, and carry the consequence summary. The tool SHALL NOT wait for the cleanup, SHALL NOT report the card as deleted, and SHALL NOT offer to retry, force, or discard.

The tool SHALL honor cancellation of its own call until the deletion journal is handed to storage, and SHALL NOT honor it afterwards: a storage write that has begun cannot be called back, so that handoff is the point of no return. The check SHALL run before the command side effects, and again inside the transaction that writes the journal, which is the first moment after the repository write queue; a call cancelled while either queue is busy SHALL be refused with nothing recorded. A card SHALL NOT lose its pending transition without the journal that replaces it: the removal SHALL happen in the same write that records the journal. An admitted deletion SHALL always finish or fail through its own recovery surfaces. The tool SHALL NOT stop a running conversation, SHALL NOT discard local worktree changes, SHALL NOT bypass any existing deletion refusal, and SHALL refuse a card that still holds a native scripted execution lease: it SHALL check that ownership read-only, without stopping or reclaiming anything, and in both cases SHALL direct the person to interface recovery: when the lease is present, and when its record is unreadable so that no lease can be ruled out. That check SHALL read the lease from the host's execution storage itself, independently of whether an execution runtime is currently attached, because a lease outlives the host that wrote it; a host that mounts scripted execution without that reader SHALL be refused at composition rather than admit a deletion it cannot verify. A queued preflight failure, including local changes that require consent, SHALL be recorded on the card operation and reported through the existing recovery surfaces rather than as a tool-level error. The tool SHALL NOT re-admit a recorded deletion that failed, because that journal may carry force or discard consent the person gave in the interface: such a call SHALL be refused with an actionable problem that directs the person to interface recovery, and the recorded journal and its checkout SHALL be left untouched. A refusal raised before admission SHALL be reported as an actionable problem with no operation recorded.

#### Scenario: Delete a card in the calling conversation Hub

- **WHEN** the user asks an agent in a task conversation to delete another card of the same Hub and the agent invokes `delete_card` for that card with confirmation
- **THEN** the deletion is admitted and the tool returns without waiting for the cleanup
- **AND** the result identifies the card, its Hub, the queued operation phase, and the consequences read before admission

#### Scenario: Delete the card that owns the calling conversation

- **WHEN** the user asks an agent to delete the card its own conversation belongs to and the agent invokes `delete_card` without a task identifier
- **THEN** that card deletion is admitted
- **AND** the tool returns normally and the card is removed once every conversation of that card is idle

#### Scenario: Reject a card of another Hub

- **WHEN** the tool receives a task identifier whose card belongs to a different Hub than the calling scope
- **THEN** no operation is recorded and the card is unchanged
- **AND** the tool reports a scope mismatch distinct from a missing task

#### Scenario: Reject a call with no resolvable target

- **WHEN** the tool runs outside a task conversation and the call names no task identifier, or names a task identifier that exists nowhere
- **THEN** the tool reports an actionable problem
- **AND** no operation is recorded

#### Scenario: Report local changes without discarding them

- **WHEN** the target card has a worktree with local changes and the tool is invoked
- **THEN** the consequence summary reports that local changes require a separate discard confirmation
- **AND** the admitted deletion does not discard them, and the queued preflight records the applicable failure on the card

#### Scenario: Report a plain folder checkout as retained

- **WHEN** the target card checkout belongs to a project that is not Git backed
- **THEN** the consequence summary reports that the checkout will remain on disk
- **AND** the deletion still removes the card and its shared notes and archives its conversations

#### Scenario: Report consequences for a card without a worktree

- **WHEN** the target card has no associated worktree
- **THEN** the consequence summary reports that no checkout is associated
- **AND** it still reports the conversation and note counts and the relation count

#### Scenario: Return without waiting for the cleanup

- **WHEN** the tool admits a deletion whose conversations are idle and whose checkout is removable
- **THEN** the tool returns the queued phase without waiting for the checkout removal or the native archiving
- **AND** the card remains on the board with a queued or in-progress deletion status until the cleanup completes


#### Scenario: Reject a blank task identifier

- **WHEN** the call passes a task identifier that is empty or only whitespace
- **THEN** the tool reports an actionable problem naming the mistake
- **AND** no operation is recorded and the caller's own card is untouched

#### Scenario: Refuse to reopen a failed deletion

- **WHEN** the target card has a recorded deletion that failed
- **THEN** the tool refuses with a problem that directs the person to interface recovery
- **AND** the recorded journal and its checkout are unchanged, even when the journal carries a force or discard consent

#### Scenario: Refuse a Hub that is not the calling boundary

- **WHEN** a task conversation names a Hub other than its own, or names a card of another Hub
- **THEN** the tool rejects the scope with an actionable problem
- **AND** no operation is recorded

#### Scenario: Require a Hub outside a task conversation

- **WHEN** the tool runs outside a task conversation and the call names no Hub
- **THEN** the tool refuses and asks for the Hub that owns the card
- **AND** no operation is recorded

#### Scenario: Report an unreadable consequence as unavailable

- **WHEN** the checkout disposition or the local-change read cannot be determined
- **THEN** the consequence summary reports that fact as unavailable instead of a clean or retained checkout
- **AND** the deletion is still admitted, leaving the decision to the queued preflight

#### Scenario: Do not admit a cancelled call

- **WHEN** the call is cancelled while the consequences are still being read, while the command waits for the host lane, or while the journal write waits for the repository queue
- **THEN** the tool does not issue the deletion command, or the command is refused before the journal is handed to storage
- **AND** no operation is recorded, the card keeps its pending transition, and nothing is archived or removed

#### Scenario: Never interrupt an admitted deletion

- **WHEN** the call is cancelled after the deletion journal was handed to storage
- **THEN** the deletion keeps running or failing through its own recovery surfaces
- **AND** the card is not left in a state without a journal
#### Scenario: Refuse a lease left by a previous host

- **WHEN** the target card holds a native lease written by an earlier host, and the current host has no scripted execution runtime attached
- **THEN** the tool still refuses with the actionable ownership problem
- **AND** no operation is recorded, no conversation is archived, and the checkout is untouched
#### Scenario: Refuse a card that still holds a native execution lease

- **WHEN** the target card still holds a native scripted execution lease, or that lease cannot be read
- **THEN** the tool refuses with an actionable problem that directs the person to interface recovery
- **AND** it stops nothing, reclaims nothing, records no operation, and leaves the checkout untouched
#### Scenario: Expose no discard or force

- **WHEN** the tool parameter surface is read
- **THEN** it contains no parameter that discards local changes and no parameter that forces a shared checkout removal
- **AND** neither recovery is reachable through this tool
