# Safe workflow management

Load before board writes or execution choices. Never bypass tool scope, intent, or session boundaries.

## Locate the installed contract

Start with a bounded check: `cordis_inspect_list` and its Host Tool provider for callable schemas, then Host Config `listConfigs` with `name: dsh-kanban` for the resolved version. A checkout is not proof of deployment. If inspection is unavailable, report unverified freshness and claim no capability.

## Read before writing

- `get_board_yaml`: the exact authored document in line ranges, with the Hub revision, effective preset and origin, and a readable path.
- `get_stage`: one stage's authored block; inline source is withheld as a digest and length unless requested.
- `get_workflow_summary`: compact workflow, scope, and sharing state; use continuation for omitted records.
- `get_route_stats`: route and exit usage, parked cards, loops.
- `list_board_revisions` / `diff_board_revisions`: what changed, who changed it, and where retained history starts; local, never published.
- `get_script_execution`: a scripted task's phase, saved result, the hold and its clearing action, values, captured version.
- `validate_workflow`: review a document exactly as a write would.
- `diff_published_board`: the board against the last applied team version.

Also read project scope, model, revision, sharing, and affected tasks; a bounded `list_cards` proves nothing about the rest. Preserve occupied IDs and pending transition references: generic YAML writes do not migrate tasks.

Board administration rejects task-owned chat, including descendants. Task creation and text editing need explicit requests; never create cards, notes, or team files for tracking.

## Apply an approved change

1. `create_board` accepts a complete document; omission uses the default uninstructed flow.
2. Prefer `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, `set_stage_decision`, `set_layout`, `add_stage`, and `remove_stage`: each rewrites only what it names and keeps every other authored character, comments included. The script and decision writers edit their blocks in parts.
3. `update_board` renames or replaces the whole document, preserving unrelated model, keys, layout, descriptions, and comments when the replacement keeps them.
4. Every write accepts `expect_sha256` (refuse unless the stored bytes match), `dry_run` (same report, nothing saved), and `detail` (`summary` by default). The result names the digest of the stored document; verify with it instead of re-reading.
5. Read the report: changed stages and field names, graph warnings, each scripted stage's board-level authorization once, affected cards, instruction sizes. `detail: full` adds field values. A refusal saves nothing.
6. `edit_board_yaml` may scope each edit to a stage and field, disambiguating identical text across stages. A failure names the failing edit index, occurrence lines and stages, and the closest authored line.
7. A stale Hub revision is not fatal: a composed write is reapplied when every anchor still matches. A whole-document replacement with a stale revision is refused; the conflict names the current revision and what changed.
8. Re-read saved content and verify model, layout, and identities. `revert_board` restores a retained revision as a new one.

`remove_stage` refuses while the stage holds cards and names them; removing the initial stage requires naming its replacement. An undrawn layout is saved and ignored, and the report warns. There is no cross-board transaction: apply prerequisites first and report per board.

Delete only a confirmed empty board, with local or team scope when bound; projects, worktrees, conversations, and workspaces stay. No task movement, deletion, or Hub administration here.

## Scripted programs

`get_script_execution` explains a held result and what clears it. No tool retries a delivery, starts, stops, approves, or edits an entry's values; those stay operator actions. `test_script` runs the program with the values and shell answers you declare and reports the exit, destination, and commands; it never captures, approves, routes, or moves a card. A Bash program cannot be tested this way.

## Preview the diagram

`render_workflow_diagram` writes the saved or a proposed document as SVG, and PNG when a rasterizer is installed. `layout_metrics` measures the same geometry with a problem list.

## Local success versus publishing

Writes remain local until published. Inspect `sharing` and `diff_published_board`. Descriptions, decision gates, and a board's default preset publish in the board's own log; an older peer reports a plugin update and never overwrites it. Sharing carries workflows, not tasks.

## Automation and human gates

Choose **work start**, **destination selector**, and **default advance** separately. There is no per-stage YAML automation switch.

- **Manual:** no entry instruction means no work starts on entry. With auto mode off and no declared route, completed turns do not move the card.
- **Agent-selected:** when its current instruction or the user requests routing, the stage reads `list_allowed_transitions`, chooses a configured target from evidence, and calls `set_next_transition` with a reason. Only its own card moves, at its next completed-turn end, even with auto mode off. A scripted entry routes only through its captured exit. Parameters are entry data, never secrets or YAML.
- **Task auto mode:** eligible completed turns advance by the first configured target, or workflow order when omitted, unless a route is declared. Default resolution crosses uninstructed stages without revisiting one.
- **Decision step:** an authored `decision` block stops the card for the person's choice; no advance — automatic or declared — crosses it, and no agent tool answers it. The person confirms an option in the drawer; a cancelable five-second window precedes the host route, which carries the option and observation as the destination reason. A manual move out asks for the restricted confirmation. Removing a destination stage drops the options that named it, and refuses when the gate would be left with none.

An uninstructed stage or auto mode off alone is not a human gate. Ask for approval instead of predeclaring a gated route; for a durable hold use `pause_task` and ask the human to resume. `[]` prevents default exit. Unanswered questions, pending approvals, and queued messages hold advance; dismissing a question is not approval. `resume_task` neither enables auto mode nor moves a card.

Tool-created tasks in an instructed initial stage prepare and dispatch in the creation call. For capture-only intake use an uninstructed initial stage. Inspect `firstExecution`; creation can succeed while start fails — recover that task, not a duplicate.

Instruction edits do not replace delivered instructions; admitted advances keep their captured destination. Failed turns do not advance; stale declared routes block rather than fall back.