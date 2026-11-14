# Safe workflow management

Load before board writes or execution choices. Never bypass tool scope, intent, or session boundaries.

## Locate the installed contract

Start with a bounded check: `cordis_inspect_list` and its Host Tool provider for callable schemas, then Host Config `listConfigs` with `name: dsh-kanban` for the resolved version. A checkout is not proof of deployment. If inspection is unavailable, report unverified freshness and claim no capability.

## Read before writing

- `get_board_yaml`: the exact authored document, in line ranges, with the Hub revision and a path for file reading.
- `get_stage`: one stage's authored block; inline source is withheld as a digest and byte length unless requested.
- `get_board_summary` with `include_workflow: true`: parsed workflow, defaults, Hub revision, publishing state.
- `get_route_stats`: route and exit usage, parked cards, loops.
- `list_board_revisions` / `diff_board_revisions`: what changed, who changed it, and where retained history starts. The log is local and never published.
- `get_script_execution`: a task's scripted phase, saved result, the hold that withholds delivery with the action that clears it, values, captured version, recent records.
- `validate_workflow`: review a supplied document exactly as a write would, without a board.
- `diff_published_board`: the local board against the version last applied from the team.

Also read project scope, model, revision, sharing state, and affected tasks. A bounded `list_cards` is not proof that no other tasks exist. Preserve occupied IDs and pending transition references: generic YAML writes do not migrate tasks like the UI editor.

Board administration rejects task-owned chat, including descendants. Task creation and text editing still require explicit requests. Never create cards, notes, or team files for internal tracking.

## Apply an approved change

1. `create_board` accepts a complete document; omission uses the default uninstructed flow.
2. Prefer `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, `set_layout`, `add_stage`, and `remove_stage`: each rewrites only what it names and keeps every other authored character, comments included. `set_stage_script` writes one stage's deterministic configuration in parts.
3. `update_board` renames or replaces the whole document, preserving unrelated model, keys, layout, descriptions, and comments; omission can clear them.
4. Every write accepts `expect_sha256` (refuse unless the stored bytes match), `dry_run` (same report, nothing saved), and `detail` (`summary` by default). The result names the digest of the stored document; verify with it instead of re-reading.
5. Read the report: changed stages and field names, graph warnings, each scripted stage's board-level authorization once, affected cards, instruction sizes. `detail: full` adds field values. A refusal saves nothing.
6. `edit_board_yaml` may scope each edit to a stage and field, disambiguating identical text across stages. A failure names the failing edit index, occurrence lines and stages, and the closest authored line.
7. A stale Hub revision is not fatal: a composed write is reapplied when every anchor still matches. A whole-document replacement with a stale revision is refused; the conflict names the current revision and what changed.
8. Re-read saved content and verify model, layout, and identities. `revert_board` restores a retained revision as a new one.

`remove_stage` refuses while the stage holds cards and names them; removing the initial stage requires naming its replacement. An undrawn layout is saved and ignored, and the report warns. There is no cross-board transaction: apply prerequisites first and report per board.

Delete only a confirmed empty board, with local or team scope when bound; projects, worktrees, conversations, and workspaces stay. No task movement, deletion, or Hub administration here; explain UI steps.

## Scripted programs

`get_script_execution` explains a held result and what clears it. No tool retries a delivery, starts, stops, approves, or edits an entry's values; those stay operator actions. `test_script` runs the authored program with the values you supply and the shell answers you declare, reporting the chosen exit, its destination, and every command it would run; it never captures, approves, routes, or moves a card. A Bash program is the shell script itself, so it cannot be tested this way.

## Preview the diagram

`render_workflow_diagram` writes the saved or a proposed document as SVG, and as PNG when a rasterizer is installed; it attaches the image only for an image-capable model. `layout_metrics` measures the same geometry with a problem list.

## Local success versus publishing

A tool write never publishes. It saves locally and leaves a bound board a draft; publishing stays the operator's action in the interface, and no tool reports “published”. Inspect `sharing` for the board's state and use `diff_published_board` to say what the team would receive. A publishing failure keeps local data. Other boards' drafts are not atomic parts of this work; report per board. Sharing carries workflows, not local tasks or coordinator IDs.

## Automation and human gates

Choose **work start**, **destination selector**, and **default advance** separately. There is no per-stage YAML automation switch.

- **Manual:** no entry instruction means no work starts on entry. With auto mode off and no declared route, completed turns do not move the card.
- **Agent-selected:** the stage reads `list_allowed_transitions`, chooses a configured target from evidence, and calls `set_next_transition` with a reason. Only its own card moves, at its next completed-turn end, even with auto mode off. A deterministic entry routes only through its captured exit. Parameters are entry data, never secrets or YAML.
- **Task auto mode:** eligible completed turns advance by the first configured target, or workflow order when omitted, unless a route is declared. Default resolution crosses uninstructed stages without revisiting one.

An uninstructed stage or auto mode off alone is not a human gate. Ask for approval instead of predeclaring a gated route; for a durable hold use `pause_task` and ask the human to resume. `[]` prevents default exit. Unanswered questions, pending approvals, and queued messages hold advance; dismissing a question is not approval. `resume_task` neither enables auto mode nor moves a card.

Tool-created tasks in an instructed initial stage prepare execution and dispatch in the creation call, without a countdown. For capture-only intake use an uninstructed initial stage. Inspect `firstExecution`; creation can succeed while start fails — recover that task, not a duplicate.

Instruction edits do not replace delivered instructions; admitted advances keep their captured destination. Failed turns do not advance, and stale declared routes block rather than fall back. Do not promise continuous operation.
