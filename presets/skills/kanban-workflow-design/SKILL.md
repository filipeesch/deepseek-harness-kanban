---
name: kanban-workflow-design
description: Design, create, review, and safely edit one or more Kanban board workflows, including stage instructions, human gates, automation choices, and cross-workflow coordination protocols.
---

# Kanban Workflow Design

## Discover and interview

1. Identify the outcome and whether this is a new design, an edit, or a multi-board architecture. Discover Hubs and boards; never infer scope from the selected UI board. For an existing board read `get_board_yaml` for the exact authored document, `get_stage` for one stage in full, and `get_board_summary` with `include_workflow: true` for the parsed workflow, the default model, the default agent preset, the Hub revision, and the publishing state. Read `get_route_stats` before proposing routing changes, `list_board_revisions` to see what changed and who changed it, and `get_script_execution` when a scripted card is stuck. `validate_workflow` checks a proposed document without saving it; `test_script` runs one stage's program against a simulated shell.
2. Reuse supplied/discovered facts. Ask only questions that change the design: scope and deliverables; stages and ownership; evidence and approvals; routing and rework; automation per stage; coordination across workflows. Do not force a fixed questionnaire.
3. During an interview, use sequential `decision_request` calls for 3–5 useful pages per turn, then **end the turn** so the user can submit. Use fewer when fewer unknowns remain; never pad a batch. Put choices in options; omit options for free text. Recommendations must match an option title. Accept ordinary chat answers equally. Dismissal or skipping is neither an answer nor consent. Create no decision records.

## Design the architecture

Describe stages, work and evidence, routes and their conditions, failure/rework paths, and human gates. Every executing stage needs a complete entry instruction: objective, inputs, bounded actions, output, acceptance criteria, blocking/failure behavior, and routing responsibility. A title such as "implement" is not an instruction.

Choose automation **stage by stage**: human-controlled, agent-selected route, or task auto-mode default progression. Explain how the choice actually works using [execution and human gates](references/operations.md#automation-and-human-gates); do not imply there is a YAML stage automation switch.

For multiple workflows, design one integrated architecture: board responsibilities, task-creation handoffs, request/result paths, coordinator/child responsibilities, ordering, dependencies, and synchronization. Load [coordination](references/coordination.md) for interfaces, authorization, correlation, duplicate detection, bounded retries, and joins. Label agent protocols separately from native guarantees.

## Prepare the approved change

Offer a concise summary and impacts: affected boards, stage/instruction/route changes, automation, coordination, retained model/layout, execution side effects, and publishing scope. Obtain approval for concrete writes; full YAML is available on request. If scope or impact changes during reconciliation, renew approval.

Prefer the structured tools over literal edits: `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, `set_layout`, `add_stage`, and `remove_stage` rewrite only what they name and preserve every other authored character. Use `edit_board_yaml` for spans those tools do not cover, scoping each edit to a stage and field when the same text appears twice. Every write reports the digest it stored, the changed stages and field names, graph warnings, the reviewed authorization of each deterministic stage once for the board, the affected cards, and instruction sizes — `detail: full` adds field values, `expect_sha256` refuses a mismatch, and `dry_run` returns the report without saving. Read it before the next write, and use `revert_board` when a change must be undone.

Preview before saving when the shape matters: `render_workflow_diagram` draws the saved or proposed document with the same geometry the workflow view draws, and `layout_metrics` reports crossings, segments through stages, overlapping stages, covered labels, folds, and total route length.

Load [workflow YAML](references/workflow-yaml.md) before authoring and [operations](references/operations.md) before writes. Preserve exact authored text/comments, identities, model, and layout outside approved spans. A composed write is reapplied when its anchors still match, so a moved Hub revision is not fatal; a whole-document replacement still needs the current one. Apply related boards sequentially and verify saved content against the reported digest. A tool write is local: it never publishes, so a bound board stays a draft until the operator publishes it in the interface; use `diff_published_board` to say what the team would receive. Finish the requested management work without starting a continuous operator loop.

## Verify the deployed capabilities

Before each proposal/change, check the installed version, current tool contracts, and relevant references for new, changed, or removed capabilities. Keep this check bounded; load detailed documentation only for the behavior needed. Newer checkout code is not proof of deployment. [Operations](references/operations.md#locate-the-installed-contract) explains discovery and conservative fallback when freshness cannot be verified. Do not invent YAML fields, a capability catalogue, or an engine.

Keep critical scope distinctions visible: board administration requires ordinary chat; task messages require a direct task conversation and a different task in the same Hub; `set_next_transition` routes only its own card at completed-turn end, including when a peer message requested it. Protocol approval is not future action authorization. Missing capabilities become explained limitations/manual steps, never shell/API workarounds.
