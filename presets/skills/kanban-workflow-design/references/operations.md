# Safe workflow management

Load before board writes or choosing execution behavior. Do not bypass tool scope/intent rules through shell, state files, APIs, or another session.

## Locate the installed contract

Start each design/change with a bounded installed-version/tool-contract check. Use `cordis_inspect_list`, then its declared Host Tool provider for callable schemas. Discover Kanban via Host Config `listConfigs` with `name: dsh-kanban`; query the returned entry ID for `packageDir` (currently `include:kanban`). Read its version and relevant documentation/source, not an arbitrary checkout. Inspect is read-only. If unavailable, use shipped references conservatively and report unverified freshness; claim no new capability. If remote tools cannot read host references, use local ordinary chat or report the limitation; never bypass namespaces/policy.

## Prepare and apply

Read exact YAML, project scope, model, Hub revision, sharing state, and affected tasks/transition state. A bounded `list_cards` result is not proof that no other tasks exist; counts can expose omissions. Preserve occupied IDs and pending transition references: generic YAML writes do not migrate tasks like the UI stage editor.

Board administration rejects task-owned chat, including descendants. Provide a design summary for the user to take to ordinary chat. Task creation/text editing have different scopes but still require explicit user requests. Never create cards, notes, or team files for internal tracking.

After approval of the concrete summary/impacts:

1. `create_board` accepts a complete custom document; omission uses the default uninstructed delivery flow. Capture returned IDs. Board creation itself starts no task or agent.
2. Prefer `edit_board_yaml` for targeted changes. Copy exact old spans, including indentation/comments, with enough context to match once. Edits run sequentially against the previous result, validate together, and save all-or-nothing for **one board**.
3. Use `update_board` for rename or approved whole replacement. Preserve unrelated model, keys, layout, descriptions, comments, and formatting; omission can clear them. Board display name and workflow root name are separate.
4. Supply fresh `expected_revision` for update, literal edit, and deletion. It is **Hub-wide**: refresh after every write before the next write in that Hub, even to another board. Serialize related writes.
5. On revision/literal-match conflict, re-read and reconcile; never defeat the guard by dropping the revision. Renew approval if meaning or impacts change.
6. Re-read saved content, verify changed spans and retained model/layout/identities, and report IDs plus manual follow-up.

No cross-board transaction or automatic rollback exists. Apply prerequisites before dependents and inactive intake before enabling starts; do not depend on uncreated IDs. Stop if failure invalidates later steps. Report applied, not applied, or uncertain per board. Compensation is another authorized write with a fresh revision.

Delete only an explicitly confirmed empty board, with local/team scope when bound. Projects, directories, worktrees, conversations, and workspaces stay. These tools expose no task movement/deletion or Hub administration; explain manual UI steps.

## Local success versus publishing

A bound Hub publishes only when the user asks: local success never means “published.” Inspect `sharing` for the board's state — a draft still to publish, team changes still to get, a review that blocks both, or an unavailable storage — before reporting team impact.

Publishing failure keeps local data. Inspect before retrying; replaying creation/edits can duplicate or conflict. Other boards' drafts are not atomic parts of this operation. Report partial application/publication per board. Sharing carries workflows, not local tasks or coordinator/child IDs.

## Automation and human gates

Choose **work start**, **destination selector**, and **default advance** separately. There is no per-stage YAML automation switch.

- **Manual:** no entry instruction means no work starts on entry. With task auto mode off and no declared route, completed turns do not move it. Humans move cards in the UI.
- **Agent-selected:** explicitly instruct the stage to read `list_allowed_transitions`, choose a configured target from evidence, and call `set_next_transition` with a reason. Only its own card moves, at its next completed-turn end, even with auto mode off; the call itself does not move it. Ordinary chat cannot route other cards. Omitted transition lists offer no configurable targets.
- **Task auto mode:** eligible completed turns advance by the first configured target, or workflow order when omitted, unless a route is declared. Conditions are not evaluated. Default resolution crosses uninstructed stages toward the first instructed stage or last reachable stage, without revisiting a stage. A declared route stops exactly at its destination.

An uninstructed stage or auto mode off alone is not a human gate. Never predeclare a gated route. Ask for approval/input; for an auto-mode task needing a deliberate durable hold, use `pause_task` and ask the human to resume. `[]` prevents default exit if terminal policy fits. Pausing leaves auto mode/recorded routes unchanged, does not retract admitted advances, and records no pause for auto-mode-off tasks.

Unanswered questions, pending approvals, and queued user messages hold eligible advance; consuming them alone triggers no move. Dismissing a question is not approval. `resume_task` neither enables auto mode nor starts work, moves a card, or catches up an old completed turn. Messages, including task messages, do not resume deliberate pauses. Recheck evidence/authorization on the next turn.

Tool-created tasks in an instructed initial stage prepare execution and dispatch **in the creation call**, without the UI countdown, regardless of `auto_mode`; worktrees/conversations may be created. For capture-only intake use an uninstructed initial stage: no tool flag suppresses the instruction. Inspect `firstExecution`; creation can succeed while start fails. Recover that task, not a duplicate.

Instruction edits do not replace already delivered instructions; admitted advances retain captured destination/instruction. Failed/interrupted turns do not advance; stale declared routes block rather than fall back. Restarts/resume do not guarantee replay of missed completions. Do not promise continuous operation or durable dependency scheduling.
