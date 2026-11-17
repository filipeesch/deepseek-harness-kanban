## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information, including reading several tasks in one call through `get_cards`; creating tasks; editing task titles and descriptions; reading a task's recorded relations and writing or removing them through `create_relation` and `delete_relation`; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with the concise `get_workflow_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board's exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, writing one stage's scripted configuration through `set_stage_script`, reviewing a supplied document without saving it through `validate_workflow`, running one stage's authored program in an isolated test execution through `test_script`, reading one task's scripted execution state and the reason a saved result is held through `get_script_execution`, comparing a board's local document with the version this installation last applied from the team through `diff_published_board`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and reading a board's revision history through `list_board_revisions`, `diff_board_revisions`, and `revert_board`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition, pausing a task, nor writing a relation SHALL move a task, change its stage or position, send a message, or start an execution during the call; an ordinary declared transition SHALL be followed by the task's next completed turn, while an exceptional declaration is bound to its originating completed turn as specified below.

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
- **AND** the board administration and task tools remain declared subject to the existing role policy

#### Scenario: Withhold the workflow design tools from every other agent

- **WHEN** an agent whose preset is not the workflow architect preset, including a task conversation, receives the plugin's tool declarations
- **THEN** none of the document, stage, authoring, measurement, revision, scripted-execution, validation, or comparison tools is declared
- **AND** a request naming one of them is not dispatched
- **AND** other board administration and task tools are declared only when the calling preset allows them

#### Scenario: Offer no script retry or execution control to an agent

- **WHEN** a workflow architect receives the plugin's tools for a board that holds a scripted stage
- **THEN** the surface exposes reading that stage's execution state and running an isolated test execution
- **AND** it exposes no operation that retries the delivery of a saved result, starts a real execution, stops a real execution, approves an executable version, or edits an entry's parameter values

### Requirement: Board-anchored discovery and scope

The plugin SHALL expose `list_hubs` so an agent can discover Hubs, and `list_boards` so an agent can discover the boards of a Hub. Board-scoped tools SHALL accept a board identifier and SHALL resolve the board's Hub and project registry from it. The plugin SHALL provide `list_projects`, `get_workflow_summary`, `list_cards`, and `create_card` with the board identifier as their scope. `list_cards` SHALL also accept a Hub identifier that selects every board of that Hub. `get_card`, `get_cards`, `edit_card`, and the note tools SHALL accept task identifiers and resolve each task's owning board and Hub. A task conversation SHALL allow the board identifier to be omitted for board-scoped tools and SHALL resolve it from the task. An ordinary DSH chat SHALL require an explicitly discovered board or Hub identifier for a card listing. `list_projects` SHALL return every project owned by the board's Hub and SHALL state, for each project, whether that project may create a card on the requested board. `get_workflow_summary` SHALL report the board's project scope, including the state where the board allows no project. `create_card` SHALL reject a project that the destination board does not allow with an actionable problem, before any task is created.

#### Scenario: Discover Hubs and boards before writing

- **WHEN** an agent in an ordinary DSH chat needs to create a task
- **THEN** it can call `list_hubs`, then `list_boards` with a discovered Hub identifier
- **AND** it passes a discovered board identifier and a project identifier from that board's Hub to `create_card`

#### Scenario: Read a board summary

- **WHEN** an agent calls `get_workflow_summary` with a board identifier
- **THEN** the result includes that board's name, Hub, and workflow stages without task counts
- **AND** the result reports the board's project scope

#### Scenario: List projects for a board

- **WHEN** an agent calls `list_projects` with a board identifier
- **THEN** the result contains only projects owned by the board's Hub
- **AND** each project states whether it may create a card on that board

#### Scenario: Report a board that allows no project

- **WHEN** an agent calls `get_workflow_summary` for a board restricted to no project
- **THEN** the result reports that the board accepts no new task
- **AND** `list_projects` reports that no project may create a card on that board

#### Scenario: Reject a project the board does not allow

- **WHEN** an agent calls `create_card` with a project that the destination board does not allow
- **THEN** no task is created
- **AND** the tool reports an actionable problem naming the board and the project

#### Scenario: List the cards of a whole Hub

- **WHEN** an agent calls `list_cards` with a Hub identifier
- **THEN** the result contains cards from every board of that Hub
- **AND** each card reports the board it belongs to

#### Scenario: Use a task conversation's board

- **WHEN** an agent calls a board-scoped read tool from a task conversation without a board identifier
- **THEN** the plugin resolves the board from that task
- **AND** the agent does not need the native workspace to choose a Hub

#### Scenario: Reject an ambiguous or missing board

- **WHEN** an ordinary DSH chat calls a board-scoped tool without a board identifier
- **THEN** the tool rejects the request with an actionable error
- **AND** no board is chosen from the active UI selection or a default

#### Scenario: Reject a listing with no scope

- **WHEN** an ordinary DSH chat calls `list_cards` with neither a board identifier nor a Hub identifier
- **THEN** the tool rejects the request with an actionable error

#### Scenario: Return identity in results

- **WHEN** a board or card tool returns a board or task
- **THEN** the result includes the board identifier and the Hub identifier needed for a subsequent scoped call

### Requirement: Board workflow read payload

The plugin SHALL replace `get_board_summary` with `get_workflow_summary` and SHALL NOT declare or dispatch the former. The new tool SHALL resolve a board as specified by board-anchored discovery and return a concise live workflow projection with board and Hub identity, optional workflow description, initial stage, and each stage's identifier, name, optional description, and script, agent-instruction, or no-instruction type. It SHALL describe the routing policy, including targets and documentary conditions or named script exits, and distinguish unrestricted, explicitly empty, configured, and scripted routes. Conditions are documentary, not executable predicates. The projection SHALL include board project scope and sharing status. Missing or blank descriptions SHALL be absent, and unknown or unavailable state SHALL be explicit rather than fabricated.

Only when the requested board is the calling task's own board SHALL the result include that task's current stage and automatic-mode enabled, paused, and held state. It SHALL NOT attribute a task from another board to the requested board. The response SHALL omit task counts, Hub revision, model and preset settings, MCP configuration, layout, full YAML, script code, and full entry prompts. The workflow architect retains `get_board_yaml`, `get_stage`, and Hub revision reads under the existing architect-only gate; the summary SHALL NOT broaden other roles' access. The workflow projection SHALL fit within 6 KiB per page in UTF-8, report omitted records and counts explicitly, and expose a continuation cursor. An individually oversized description or condition SHALL be indicated and remain readable in pages through the same tool without silent truncation.

#### Scenario: Read a complete board workflow

- **WHEN** an agent calls `get_workflow_summary` with a board identifier
- **THEN** the result contains the initial stage and stages with their IDs, names, optional descriptions, types, and routing policy
- **AND** it contains the workflow description when authored, board project scope, and sharing status
- **AND** it distinguishes unrestricted, explicitly empty, configured, and scripted routes without treating conditions as executable predicates

#### Scenario: Omit the authored document from the workflow payload

- **WHEN** an agent calls `get_workflow_summary`
- **THEN** the result carries no authored workflow YAML, script code, or full entry prompts
- **AND** the workflow architect can read the exact document with `get_board_yaml` and a stage with `get_stage` under the existing gate

#### Scenario: Read the board's default model

- **WHEN** an agent calls `get_workflow_summary` for a board whose workflow names a default model
- **THEN** the result does not include the provider, model, or reasoning effort

#### Scenario: Report no default model

- **WHEN** an agent calls `get_workflow_summary` for a board whose workflow names no default model
- **THEN** the result does not include model settings

#### Scenario: Read a board summary without the workflow payload

- **WHEN** an agent calls `get_workflow_summary` for a board
- **THEN** the result always contains the compact workflow projection without an `include_workflow` flag
- **AND** it excludes counts, Hub revision, model, preset, MCP configuration, and workflow YAML

#### Scenario: Reject an unknown board

- **WHEN** an agent calls `get_workflow_summary` with a board identifier that does not exist
- **THEN** the tool reports that the board does not exist
- **AND** it returns no board data

#### Scenario: Include operational state for the calling task only

- **WHEN** a task conversation reads its own board's workflow summary
- **THEN** the result includes its current stage and its automatic-mode enabled, paused, and held state
- **AND** unavailable state is reported as unavailable rather than invented

#### Scenario: Do not attribute a task to another board

- **WHEN** a task conversation reads a different board, or an ordinary chat reads a board
- **THEN** the result does not present the calling task's stage or automatic-mode state as belonging to the requested board

#### Scenario: Preserve access when limiting the projection

- **WHEN** a workflow summary exceeds an applied response limit
- **THEN** the result identifies the truncation and offers continuation or another read mechanism for all routes
- **AND** authored descriptions are not silently truncated

#### Scenario: Remove the previous summary tool

- **WHEN** product tools are declared or dispatched
- **THEN** `get_board_summary` is absent and cannot be dispatched
- **AND** roles that previously allowed it use `get_workflow_summary` subject to their existing role boundaries

### Requirement: Board write concurrency

`update_board`, `edit_board_yaml`, and `delete_board` SHALL accept an optional Hub revision. The Hub revision is shared by every board of the Hub and advances on any Hub change, including a task move, a conversation change, and a note edit on another board, so it SHALL NOT be treated as the identity of the target board's document.

A tool that composes its document from the stored one SHALL, when the supplied revision no longer matches the current Hub revision, re-read the board and apply its composition to the current document. It SHALL proceed and save the composed result when the composition still succeeds and every anchor the call names still matches what it names. When the composition no longer succeeds, the tool SHALL reject the request without changing the board and SHALL report the current Hub revision together with the stale revision the caller supplied. When the installation still retains the document the most recent accepted write replaced, the report SHALL also name the stages and fields that changed on the target board. A tool that replaces the whole document SHALL reject a stale revision without changing the board, because a replacement cannot be rebased. When the revision is omitted, the tool SHALL apply the change to the current stored state. An architect-gated board workflow document read SHALL include the current Hub revision; the compact workflow summary SHALL NOT include it.

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

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`.

`list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, the currently recorded transition together with the reason it carries, and, for every target stage that declares parameters, that target's declared parameter names with their optional descriptions. When explicitly given a different existing destination, it SHALL also report that destination's declared parameter names and optional descriptions without claiming the destination is configured or exposing script code. This lookup SHALL preserve the normal task and board scope.

`set_next_transition` SHALL act only on the task that owns the calling conversation: it SHALL offer no task identifier, and a call made outside a task conversation SHALL be rejected. It SHALL accept an optional target stage, an optional reason, an optional parameter value set, and an explicit exception flag. A provided target SHALL be one of the current stage's configured targets unless the exception below applies, and SHALL require a nonempty reason; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. An omitted target SHALL clear the recording and SHALL NOT require a reason. A declaration MAY follow the user's explicit request in that conversation, a stage instruction delivered to it, or an explicit request in a cross-card message from another task; a peer request SHALL NOT relax any rule of this requirement, and the declaration SHALL remain attributed to the task that owns the calling conversation.

The exception flag permits a different existing destination not configured by the current non-scripted stage. Tool instructions SHALL require a direct, explicit user request in the same task conversation for using the flag; a stage instruction, peer request, or the model's own decision does not qualify. The model supplies the flag, which is not independent proof of user intent; the host SHALL NOT claim to verify natural-language intent or add a product confirmation. Without the flag an unconfigured destination SHALL be rejected. Script-controlled entries and script exits SHALL NOT gain a generic override. All non-intent validations, including task scope, reason, existing destination, exact parameters, current stage entry, pending work, and destination script approvals, remain in force.

An exceptional declaration SHALL be bound to the exact task entry, calling session, open turn, source, and destination. Only the matching observed turn end with reason kind completed MAY consume it; another conversation or a later turn cannot. The serialized admission SHALL revalidate its identity, current entry, recorded value, destination, and guards. An unadmitted exception SHALL be discarded or invalidated when its owner turn fails, aborts, is interrupted, cannot be verified, or admission is blocked by a held or busy task; a restart or lost identity SHALL fail closed. Automatic mode SHALL NOT resurrect an expired exception, but retains its independently enabled normal behavior. A successfully admitted advance remains durable under existing dispatch and recovery. If open-turn identity cannot be safely established, the tool SHALL refuse the exceptional declaration with an actionable result.

A parameter value set SHALL be accepted only for a target that declares parameters. For that target the call SHALL supply exactly the declared names, each with a nonempty string value within the accepted per-value and total size limits; an unknown name, a missing declared name, an empty value, or an oversized value SHALL be rejected with an actionable error that names the accepted parameter names, so the agent can correct the declaration in the same turn. A parameter value set supplied for a target that declares no parameters SHALL be rejected. A parameter value set SHALL NOT be accepted together with a cleared or omitted target.

Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call, including the recorded parameter values when the recorded target declares parameters. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task during the call, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. An ordinary recorded transition SHALL arm the advance the task performs at the end of its next completed turn, whether or not auto mode is enabled; an exceptional recording is limited to its originating completed turn and its admission guards. A rejected target, a rejected reason, a rejected parameter value set, or a missing required reason SHALL leave the task, its recorded transition, and its recorded parameters unchanged. The host SHALL revalidate the recorded parameter names against the destination's current declaration before the task enters it, and SHALL fail that transition with an actionable error rather than creating an entry whose declaration no longer matches.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition and the reason it carries

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures and a nonempty reason
- **THEN** the task records that transition together with that reason
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Declare on a peer request

- **WHEN** a cross-card message explicitly asks the task to declare a transition to a target its current stage configures and the agent calls `set_next_transition` with that target and a reason
- **THEN** the task records that transition
- **AND** the task's stage and position are unchanged during the call
- **AND** the declaration is recorded as the task's own, not as a user action or the requesting task's action

#### Scenario: Keep the transition rules under a peer request

- **WHEN** a cross-card message asks for a target the current stage does not configure and the agent calls without the exception flag, or the agent supplies no reason
- **THEN** the tool rejects the declaration under the existing rules
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a declaration without a reason

- **WHEN** an agent calls `set_next_transition` with a target and no reason, or with a reason that is blank after trimming
- **THEN** the tool reports the rejection with an actionable error
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a reason over the accepted length

- **WHEN** an agent calls `set_next_transition` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the recorded reason is never a silent truncation of what the agent wrote

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared without requiring a reason
- **AND** the result reports that no transition is recorded

#### Scenario: Reject a target the stage does not configure

- **WHEN** an agent calls `set_next_transition` without the exception flag with a target that is not one of the current stage's configured targets
- **THEN** the tool reports the rejection
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a recording without configured transitions

- **WHEN** an agent calls `set_next_transition` without the exception flag for a task whose stage does not configure transitions
- **THEN** the tool reports that the stage has no configurable transitions
- **AND** the task is unchanged

#### Scenario: Recording does not move the task

- **WHEN** an agent declares or clears a transition
- **THEN** the task's stage and position are unchanged while the call runs
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Arm the advance with auto mode disabled

- **WHEN** an agent declares an ordinary configured transition for a task whose auto mode is disabled
- **THEN** the recording is stored and auto mode remains disabled
- **AND** the task's next completed turn advances to the declared stage

#### Scenario: Disarm the advance by clearing with auto mode disabled

- **WHEN** an agent clears the recorded transition of a task whose auto mode is disabled
- **THEN** the task does not advance at the end of its next completed turn

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls `set_next_transition` inside a task conversation
- **THEN** the recording applies to the task that owns that conversation
- **AND** the tool offers no way to name another task

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls `set_next_transition` in an ordinary DSH chat
- **THEN** the tool rejects the request with an actionable error
- **AND** no task records a transition

#### Scenario: Read another task from an ordinary chat

- **WHEN** an agent calls `list_allowed_transitions` with an explicit task identifier
- **THEN** the result describes that task's stage and targets

#### Scenario: Report a target's declared parameters

- **WHEN** a configured target's stage declares a pipeline and an app parameter with descriptions
- **THEN** `list_allowed_transitions` reports both names and descriptions for that target
- **AND** it reports no parameters for a target whose stage declares none

#### Scenario: Discover parameters for an exceptional destination

- **WHEN** an agent explicitly asks transition discovery about an existing destination outside the configured route set
- **THEN** it returns that destination's declared parameter names and optional descriptions
- **AND** it does not claim the destination is configured or reveal the script code

#### Scenario: Record a transition with every declared parameter

- **WHEN** an agent calls `set_next_transition` with a target that declares two parameters and supplies both values and a reason
- **THEN** the task records the transition together with those values
- **AND** the result reports the recorded values
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a missing or unknown parameter

- **WHEN** an agent supplies a value set that omits a declared name, adds an unknown name, or carries an empty or oversized value
- **THEN** the tool reports the rejection and names the accepted parameter names
- **AND** the task, its recorded transition, and its recorded parameters are unchanged

#### Scenario: Reject parameters for a target that declares none

- **WHEN** an agent supplies a parameter value set for a target whose stage declares no parameters
- **THEN** the tool reports the rejection
- **AND** the task records no transition

#### Scenario: Fail a placement whose declaration changed

- **WHEN** a recorded target's declaration changes between the recording and the placement so the recorded values no longer match
- **THEN** the transition fails with an actionable error instead of creating an entry
- **AND** the task remains in its current stage

#### Scenario: Record an exceptional route requested directly by the user

- **WHEN** a user directly and explicitly requests a different existing unconfigured destination in the task conversation and the agent supplies the exception flag, a reason, and any required parameters
- **THEN** the tool records the exceptional declaration for that task entry, calling session, open turn, source, and destination without moving the task
- **AND** only that session's observed completed originating turn can consume it, subject to admission revalidation

#### Scenario: The flag is not proof of user intent

- **WHEN** an agent supplies the exception flag for a structurally valid exceptional route
- **THEN** the flag is a model assertion rather than verified evidence of a direct user request
- **AND** tool instructions require that request but the host does not claim to determine the origin or meaning of natural-language intent

#### Scenario: Enforce non-intent guards on an exception

- **WHEN** an exceptional declaration has an invalid destination, reason, task scope, or parameter set, or violates a stage-entry, pending-work, or script-approval guard
- **THEN** it is rejected or not admitted under the applicable guard
- **AND** no invalid task entry is created

#### Scenario: Preserve script authority

- **WHEN** a declaration attempts to use the exception flag to override a script-controlled entry or script exit
- **THEN** no generic override is admitted

#### Scenario: Refuse or invalidate an unverified turn

- **WHEN** the calling open turn cannot be safely identified, or an unadmitted exception's originating turn fails, aborts, is interrupted, is unverifiable, or cannot be admitted because the task is held or busy
- **THEN** the declaration is refused or the unadmitted exception is invalidated
- **AND** another session, later turn, automatic mode, or restart cannot resurrect or consume it

#### Scenario: Revalidate an exception at admission

- **WHEN** an exceptional declaration's originating turn completes
- **THEN** serialized admission revalidates its identity, current entry, recorded value, destination, and applicable guards
- **AND** a successfully admitted advance remains durable under existing dispatch and recovery

### Requirement: Product tools are declared per role

The plugin SHALL declare a product tool for an agent only when that agent's preset allows it. A preset
that names a role allowlist SHALL receive exactly the product tools in that allowlist: a product tool
outside it SHALL be absent from the declared tool set and SHALL NOT be dispatchable, rather than
declared and refused at call time. An agent whose preset is not a project role, including an agent on
the host default preset and the workflow architect, SHALL keep its existing product tool surface apart from the replacement of `get_board_summary` by `get_workflow_summary`,
and the workflow-architect-only declaration stated in the product tool surface requirement SHALL
remain unchanged. The allowlist SHALL be read from the preset's own composition, so two boards that
select different role presets get different surfaces without a board setting. This restriction SHALL
NOT bypass native DSH permission behavior or any authorization the tool already enforces, and it SHALL
NOT change what a product tool does when it is declared.

#### Scenario: Select the planner's surface

- **WHEN** an agent runs on a preset that allows board reading, card creation and editing, relations, notes, messages, transitions, pause and resume, team files, and the structured-question tool
- **THEN** those product tools are declared for it
- **AND** the workflow-authoring and board-administration tools are not

#### Scenario: Select the manager's surface

- **WHEN** an agent runs on a preset that allows board reading, notes, messages, transitions, pause and resume, and the structured-question tool
- **THEN** exactly those product tools are declared for it
- **AND** no card creation or card editing tool is declared

#### Scenario: Absence rather than refusal

- **WHEN** an agent on a role preset is asked about a product tool outside its allowlist
- **THEN** the tool does not appear in its declared tool set
- **AND** a call to it is reported as an unknown tool rather than as a permission refusal

#### Scenario: Leave other presets alone

- **WHEN** an agent runs on the host default preset or on the workflow architect preset
- **THEN** it keeps its existing product tool surface except for the replacement of `get_board_summary` by `get_workflow_summary`
- **AND** the workflow-architect-only declaration is unchanged
