# Agent Tools

Board reads are available in ordinary chats and task conversations. Board writes are available only in an ordinary DSH chat, and a session owned by a task or by one of its subagent descendants is rejected.

Board and note writes require the user's explicit request; they are not an internal progress-tracking channel. There is no additional product approval modal for those requested writes, and native permissions still apply. Intent text is an agent-use rule, not a scripted consent detector.

## Tool surface

| Scope | Tools |
| --- | --- |
| Discover Hubs, boards, projects, and tasks | `list_hubs`, `list_boards`, `list_projects`, `get_board_summary`, `list_cards`, `get_cards`, `get_card` |
| Explicitly requested card creation and text changes | `create_card`, `edit_card` |
| Recorded relations between cards | `create_relation`, `delete_relation` |
| Declaring the transition the turn ends in | `list_allowed_transitions`, `set_next_transition` |
| Pausing and resuming automatic advance | `pause_task`, `resume_task` |
| Explicitly requested board administration | `create_board`, `update_board`, `edit_board_yaml`, `delete_board` |
| Workflow architect only: exact reads, review, and structured edits | `get_board_yaml`, `get_stage`, `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, `set_layout`, `add_stage`, `remove_stage`, `validate_workflow` |
| Workflow architect only: usage, drawing, history, scripts, team comparison | `get_route_stats`, `render_workflow_diagram`, `layout_metrics`, `list_board_revisions`, `diff_board_revisions`, `revert_board`, `diff_published_board`, `get_script_execution`, `test_script` |
| Shared task notes | `create_note`, `list_notes`, `update_note` |
| Hub team files | `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, `delete_team_file` |
| Optional question page | `decision_request` |
| Cross-card message from a task conversation | `send_task_message` |

The registry is defined by [the product tool names](<../../src/host/tools/names.ts>) and the implementations live under [the host tools](<../../src/host/tools/index.ts>).

## Discovering the board

The board is the discovery anchor: use `list_hubs`, then `list_boards`, then pass `board_id` to board-scoped tools. A task conversation can resolve its own board for reads; an ordinary chat without a board receives an actionable error rather than using UI state or a default.

`create_card` accepts `auto_mode`. When the board's initial stage has an entry instruction it prepares the first execution and dispatches the stage instruction in the same call and reports the outcome, because the agent surface has no cancelable countdown.

## Reading and changing a workflow

Read the exact authored YAML with `get_board_yaml`, one stage with `get_stage`, and the parsed workflow, default model, default agent preset, and MCP allowlist with `get_board_summary` and `include_workflow: true`.

The workflow-design tools are registered globally but declared only for the `kanban-workflow-architect` preset, so other agents share the registry without seeing them.

Prefer the structured edits (`set_stage_prompt`, `set_stage_routes`, `set_stage_script`, `set_layout`, `add_stage`, `remove_stage`) for one stage or one layout: each rewrites only the named part and preserves every other authored character, comments included, and `set_stage_script` writes one stage's scripted configuration in parts.

Use `edit_board_yaml` for spans those tools do not cover: each `old` text must occur exactly once inside the stage and field the edit names when it names one, every edit in the call is applied together, and a failure reports the failing edit index, the occurrence lines and stages, and the closest authored line. Use `update_board` with the complete YAML only when restructuring.

Every workflow write reports the sha256 digest of the exact document it stored and the same report on success and on refusal: the changed stages with their changed field names, graph warnings, the board-level reviewed authorization of each scripted stage once, and the affected cards. `detail: full` returns the per-field values, `expect_sha256` refuses a document that does not match, and `dry_run` returns the report without saving anything. `validate_workflow` reviews a supplied document with no board. A refused write saves nothing.

A stale Hub revision no longer forces a re-read: a composed write is reapplied to the current document when every anchor still matches, and only a real conflict refuses, naming the current revision and what changed; a whole-document replacement still requires the current revision.

`list_board_revisions` and `diff_board_revisions` show what changed and who changed it, state where the retained history starts, and `revert_board` restores a retained revision as a new revision. The log is local and never published. `diff_published_board` compares a board with the version this installation last applied from the team.

`delete_board` requires explicit confirmation and an empty board. A board bound to the team configuration is refused with `BOARD_REMOVAL_REQUIRES_INTERFACE`: removing it is a publishing decision made in the interface, where the local or team scope is chosen. Projects, worktrees, conversations, and native workspaces are kept.

A board tool write never publishes: it saves locally and leaves a bound board a draft, so publishing stays the operator's action in the interface, and no tool result reports a published state, a blocker, or a failure. Hub creation, rename, and deletion remain UI-only.

## Card reads and activity

`list_cards` covers one board or every board of a Hub and, with `get_cards`, returns the compact card: identity, stage, position, worktree, auto mode and transition records, the per-task activity, and each relation as its identifier, type, direction, and the other card's identifier — without the description.

`get_card` returns the detail payload at the top level: the compact fields plus the description, the project, the board and Hub, the relations carrying the other card's title and stage, and the epic roll-up. A listing's title-and-description search still matches a description the listing does not return. `get_cards` reports the identifiers that name no task and, above its batch limit, the identifiers it dropped.

Activity is the native fact the host owns — whether an agent is running, the pending user work, the queued prompt count, the background count, and each settled conversation's last outcome — aggregated over the task's open conversations only, computed on every read, and never persisted. A durable read (`get_card`, and the delivery result) reports the activity as unavailable when a conversation cannot be read, instead of presenting an idle task; a listing uses only the facts the host already resolved, so a scan never waits on a cold native read and an unresolved card reports its activity as unavailable.

The epic roll-up lists direct children with their title, stage, and activity, bounded at 50 with an explicit total and truncation flag; each child is read from the resolved facts for the same reason.

## Relations

Cards record relations to each other, stored locally in the Hub beside the tasks. An `epic` relation is directed from the epic to a card that belongs to it, and a `related` relation has no direction and is stored once for the pair.

Cardinality is many-to-many, a card may belong to more than one epic, an epic may itself belong to another epic, both endpoints must live in the same Hub, and epic relations may not form a cycle. Deleting a card removes every relation it takes part in, in the same transaction that removes it, so a stored relation never points at a missing task.

Relations stay local to the installation and never enter the published layout; teams share workflows, not each other's cards. `create_relation` and `delete_relation` apply a batch all or nothing, at most 100 per call, and require the user's explicit request, a direction in the stage instruction delivered to the conversation, or an explicit request in a cross-card message. Both are declared read-write, so they never join a parallel call group.

## Notes and team files

`list_notes` filters by any of the given tags, and `update_note` accepts content, tags, or both. Missing task context in an ordinary chat needs an explicit task ID, not a fallback to another task. Note deletion is UI-only.

Team file tools are available in task conversations and ordinary chats and resolve the Hub the same way board reads do: from the task in a task conversation, and from an explicit `hub_id` otherwise. Search and read are read-only. Create, edit, and delete require the user's explicit request, describe that rule in their own guidance, and add no product approval dialog. `edit_team_file` applies literal replacements where each existing text must occur exactly once, and `delete_team_file` requires `confirmed: true`. Reading and searching are concurrency-safe; the three writes are not.

## Questions and cross-card messages

`decision_request` adds one structured question page to the current round; the agent sends every page the round needs and ends its turn after the last one. The per-call result repeats that short rule. [Conversations](conversations.md) describes the surface the person sees.

`send_task_message` is available only inside a task conversation and requires the user's explicit request there or an explicit direction in that conversation's stage instruction; it is not an internal progress-tracking channel.

It targets another task in the same Hub and rejects the sending task, a subagent session, an empty body, and a target in another Hub. The plugin delivers one durable, plugin-sourced context message with the host's steer semantics — a running target reads it at its next step and an idle target starts a new turn — and presents it as a collapsed row that names the sending task and expands to the message.

The target's first open conversation receives it; when the task has none, the plugin creates its default worktree for a Git-backed task without a worktree and without a recorded base-project choice, then the first conversation, using the board's default model and agent preset when the board names them and the host defaults otherwise. The message names the sending task's Hub, board, title, and identifier.

A message may also explicitly request that the target declare a transition: the sender reads the target's targets with `list_allowed_transitions`, names the destination stage identifier and the reason in the body, and the target's own stage rules decide whether it declares. The send call validates nothing about the target's workflow and moves no card, and a request cannot authorize a task, board, note, or team-file write.

A reply uses the same tool with the sending task as `task_id` and is allowed only when the received message explicitly asks for one or when the user in the target conversation explicitly asks for a reply. There is no reply flag, thread, inbox, unread state, or message history; the transcript row is the record. No product size or delivery-rate limit and no deferral are added, and the message writes nothing to Hub state, team files, or sharing. A turn started by a message remains an ordinary turn for automatic advance.

## Boundaries of the tool surface

Recording a transition is routing information for the next advance, not a move: it never changes the task's stage or position. There are no model tools to move or delete cards or to administer Hubs, no plugin checklist or decision ledger, and no plugin terminal or full Git and code-review integration; the workflow surface has a YAML editor. Existing native DSH features are not removed.
