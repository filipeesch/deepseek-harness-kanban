---
name: kanban-workflow-design
description: Design, create, review, and safely edit one or more Kanban board workflows, including stage instructions, human gates, automation choices, and cross-workflow coordination protocols.
---

# Kanban Workflow Design

## Discover and interview

1. Identify the outcome and whether this is a new design, an edit, or a multi-board architecture. Discover Hubs and boards; never infer scope from the selected UI board. For an existing board, `get_board_yaml` gives the exact authored document, Hub revision, and effective preset; `get_stage` one stage in full; `get_workflow_summary` the compact workflow, scope, and sharing state. Read `get_route_stats` before routing changes, `list_board_revisions` for what changed, and `get_script_execution` when a scripted card is stuck. `validate_workflow` checks a document without saving; `test_script` runs one stage against a simulated shell.
2. Reuse supplied/discovered facts. Ask only questions that change the design: scope and deliverables; stages and ownership; evidence and approvals; routing and rework; automation per stage; coordination across workflows. Do not force a fixed questionnaire. When an unresolved answer would change the goal, stage ownership, or completion criteria, ask a short, adaptive batch before proposing; that answer is discovery, never approval to write.
3. Use sequential `decision_request` calls for 3–5 useful pages per turn, then **end the turn** so the user can submit; fewer when fewer unknowns remain, never padding a batch. Put choices in options; omit options for free text, and make a recommendation match an option title. Ordinary chat answers count equally. Dismissal or skipping is neither an answer nor consent. Create no decision records.

## Design the architecture

Within the approved scope, provide and maintain a workflow description and a description for each stage, each at most 300 characters. A stage description states its responsibility, the work it owns, for the operator who decides ownership from it. Write each exit condition as the `when` of its transition, not in the description. Load [stage contracts](references/stage-contracts.md) before authoring or reviewing stage text. Preserve existing longer or absent descriptions on unrelated edits; the ceiling guides the architect, not other authors, and the write report observes it. Describe routes, failure and rework paths, and human gates. Every executing stage needs a complete instruction: objective, inputs, bounded actions, output, acceptance criteria, blocking behavior, and routing responsibility. A title such as "implement" is not an instruction.

Choose automation **stage by stage**: human-controlled, agent-selected route, or task auto-mode default progression. Explain how it works using [execution and human gates](references/operations.md#automation-and-human-gates); do not imply a YAML stage automation switch. Where the person must choose a path or confirm explicitly, author a decision step: it stops the card for one authored choice, needs no instruction or program, and holds routing by construction. Prefer it to an instruction that asks a question.

For multiple workflows, design one integrated architecture: board responsibilities, task-creation handoffs, request/result paths, coordinator/child responsibilities, ordering, dependencies, and synchronization. Load [coordination](references/coordination.md) for interfaces, authorization, correlation, duplicate detection, retries, and joins. Label agent protocols separately from native guarantees.

## Prepare the approved change

Offer a concise summary and impacts: affected boards, stage/instruction/route changes, automation, coordination, retained model/layout, execution side effects, and publishing scope. Obtain approval for concrete writes; full YAML is available on request. Renew approval when scope or impact changes.

Declare a specialist once at the root with `agents` and bind the stages it runs with `agent`; see [agents](references/agents-and-stage-conversations.md). Its instruction must ask for `set_next_transition`, and its preset must not mask the tools it needs.

Prefer the structured tools over literal edits: focused setters rewrite only what they name, `edit_board_yaml` covers spans they do not, and `preview_workflow_batch` composes coupled edits into one candidate that `apply_workflow_batch` saves exactly. Follow [batch authoring](references/batch-authoring.md) before a coupled or routing change: review the exact candidate, diff, digest, findings, and impacts, and say what you inspected, validated, or exercised. Every write reports the stored digest, changed stages, field names, warnings, scripted authorizations, affected cards, and instruction sizes — `detail: full` adds field values, `expect_sha256` refuses a mismatch, `dry_run` saves nothing. Read it before the next write, and use `revert_board` to undo one.

Preview before saving when the shape matters: `render_workflow_diagram` draws the saved or proposed document with the same geometry the workflow view draws, and `layout_metrics` reports crossings, segments through stages, overlapping stages, covered labels, folds, and total route length. A validation pass or a measurement never proves that a stage runs or a route is taken.

Load [workflow YAML](references/workflow-yaml.md) before authoring and [operations](references/operations.md) before writes. Preserve exact authored text, comments, identities, model, and layout outside approved spans. A composed write is reapplied when its anchors still match, so a moved Hub revision is not fatal; a replacement and an applied preview need the current one. Apply related boards sequentially and check saved content against the reported digest. A tool write is local: it never publishes, so a bound board stays a draft until the operator publishes it in the interface; use `diff_published_board` to say what the team would receive. Finish the requested management work without starting a continuous operator loop.

## Verify the deployed capabilities

Before each proposal or change, check the installed version, current tool contracts, and relevant references for new, changed, or removed capabilities. Keep this bounded; load detail only for the behavior needed. Newer checkout code is not proof of deployment. [Operations](references/operations.md#locate-the-installed-contract) explains discovery and conservative fallback when freshness is unverifiable. Do not invent YAML fields, a capability catalogue, or an engine.

Keep critical scope distinctions visible: board administration requires ordinary chat; task messages require a direct task conversation and a different task in the same Hub; `set_next_transition` routes only its own card at completed-turn end, including when a peer message requested it. Protocol approval is not future action authorization. Missing capabilities become explained limitations/manual steps, never shell/API workarounds.
