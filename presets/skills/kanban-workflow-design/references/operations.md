# Safe workflow management

Load before board writes or execution choices. Never bypass tool scope, intent rules, or session boundaries through shell, state files, APIs, or a session.

## Locate the installed contract

Start each design/change with a bounded installed-version/tool-contract check. Use `cordis_inspect_list`, then its Host Tool provider for callable schemas. Discover Kanban via Host Config `listConfigs` with `name: dsh-kanban`, and read the resolved `packageDir` version and relevant documentation/source. Never read an arbitrary checkout as proof of deployment. If inspection is unavailable, use these references conservatively and report unverified freshness; claim no new capability and never bypass namespaces or policy.

## Read before writing

- `get_board_yaml`: the exact authored document, in line ranges, with the Hub revision and a file path for ordinary file reading.
- `get_stage`: one stage's authored block; inline script source is withheld as a digest and byte length unless requested.
- `get_board_summary` with `include_workflow: true`: parsed workflow, default model, Hub revision, publishing state — never the authored text.
- `get_route_stats`: route and named-exit usage, parked cards, and loops. Origin exists only from the upgrade on; earlier entries read as unrecorded.
- `list_board_revisions` / `diff_board_revisions`: what changed and who changed it; the log is local and never published.

Also read project scope, model, revision, sharing state, and affected tasks. A bounded `list_cards` result is not proof that no other tasks exist. Preserve occupied IDs and pending transition references: generic YAML writes do not migrate tasks like the UI stage editor.

Board administration rejects task-owned chat, including descendants; give the user a summary for ordinary chat. Task creation and text editing still require explicit requests. Never create cards, notes, or team files for internal tracking.

## Apply an approved change

1. `create_board` accepts a complete document; omission uses the default uninstructed flow. Creation starts no task or agent.
2. Prefer `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`: each rewrites only the named field and preserves every other authored character. Use `edit_board_yaml` for spans they do not cover, copying exact old text with enough context to match once. Validation and saving are all-or-nothing for **one board**.
3. Use `update_board` for rename or approved whole replacement, preserving unrelated model, keys, layout, descriptions, comments, and formatting; omission can clear them. Board display name and workflow root name are separate.
4. Supply fresh `expected_revision` for every write. It is **Hub-wide**: refresh after every write before the next one in that Hub, even to another board. Serialize related writes.
5. Read the report every write returns: per-stage difference, graph warnings, the reviewed authorization of each deterministic stage in every allowed project, and affected cards. A refusal saves nothing and returns the same report; reconcile and retry rather than dropping the revision.
6. Re-read saved content and verify changed spans with the retained model, layout, and identities. `revert_board` restores a retained revision as a new revision.

`remove_stage` refuses while the stage holds cards and names them by identifier and count. Removing the initial stage requires naming its replacement. A connection layout for a pair the workflow does not draw is saved and ignored, and the report warns about it. There is no cross-board transaction or automatic rollback: apply prerequisites first, stop when failure invalidates later work, and report per board.

Delete only a confirmed empty board, with local/team scope when bound; projects, worktrees, conversations, and workspaces stay. These tools expose no task movement, deletion, or Hub administration; explain manual UI steps.

## Preview the diagram

`render_workflow_diagram` writes the saved or a proposed document as SVG, and as PNG when a rasterizer is installed; it attaches the image only for an image-capable model. `layout_metrics` measures the same geometry — crossings, segments through stages, overlapping segments and stages, covered exit labels, folds, total route length — with a problem list. Stage heights are an estimate from the authored size and each stage's cards, not a measurement.

## Local success versus publishing

Bound-Hub writes can publish automatically: disclose team impact before approval. Inspect `sharing`; local success may mean blocked or failed publishing, preview or unbound local state, or pending sync, not "published." Publishing failure keeps local data; inspect before retrying, since replaying creation or edits can duplicate. Sharing carries workflows, not local tasks or IDs.

## Automation and human gates

Choose **work start**, **destination selector**, and **default advance** separately. There is no per-stage YAML automation switch.

- **Manual:** no entry instruction means no work starts on entry. With auto mode off and no declared route, completed turns do not move the card.
- **Agent-selected:** the stage reads `list_allowed_transitions`, chooses a configured target from evidence, and calls `set_next_transition` with a reason. Only its own card moves, at its next completed-turn end, even with auto mode off. A task message may ask for a route; the receiving stage decides, and a deterministic entry routes only through its captured exit. Parameters are entry data, never secrets or YAML; a value-less entry fails in place and is repaired from the panel.
- **Task auto mode:** eligible completed turns advance by the first configured target, or workflow order when omitted, unless a route is declared. Conditions are not evaluated. Default resolution crosses uninstructed stages toward the first instructed stage or last reachable stage, without revisiting a stage.

An uninstructed stage or auto mode off alone is not a human gate. Ask for approval instead of predeclaring a gated route; for a deliberate durable hold use `pause_task` and ask the human to resume. `[]` prevents default exit. Pausing leaves auto mode and recorded routes unchanged. Unanswered questions, pending approvals, and queued messages hold eligible advance; dismissing a question is not approval. `resume_task` neither enables auto mode nor moves a card.

Tool-created tasks in an instructed initial stage prepare execution and dispatch in the creation call, without a countdown, regardless of `auto_mode`. For capture-only intake use an uninstructed initial stage. Inspect `firstExecution`; creation can succeed while start fails — recover that task, not a duplicate.

Instruction edits do not replace delivered instructions; admitted advances keep their captured destination. Failed turns do not advance, and stale declared routes block rather than fall back. Do not promise continuous operation or durable dependency scheduling.
