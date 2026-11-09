# Proposal

## Why

An automatic advance currently follows a workflow's branch structure by position: it takes the first entry of the stage's `allowed_transitions`, then crosses stages that have no entry instruction. A workflow that branches therefore has exactly one usable path from any stage, and the branch exists only on paper. The model doing the work has no way to say which branch it actually took, and no way to see the conditions the workflow author wrote for each target.

This change gives every configured transition a condition, exposes the current stage's options to the model, and lets the model record which one it will follow when the turn ends. The host then routes the task through that recorded transition on the automatic advance and on the drawer's next-stage action. The workflow's branches become usable without turning every move into a manual decision.

## What Changes

- A configured transition entry gains an optional condition: `allowed_transitions` accepts `{ to, when }` mappings in addition to the existing identifier strings. Both forms stay supported; the string form is not deprecated, and a list may mix them.
- The host injects a transition briefing into the stage instruction message it sends when the current stage configures two or more transition targets. The briefing lists each target with its condition and names the default.
- The model records its routing intent through a new `set_next_transition` tool, and reads the current options through a new `list_allowed_transitions` tool.
- A recorded transition becomes the destination of the next automatic advance. The task moves exactly to the recorded stage; the stage-crossing rule stays with the default path only.
- The drawer's next-stage action follows the recorded transition when one is valid, and refuses with an explanation when the recorded transition no longer resolves.
- A recorded transition that no longer resolves pauses auto mode with the new `transition-stale` reason.
- A recorded transition expires when the task leaves the stage it was recorded for.
- The card and drawer auto-mode controls present the recorded destination.
- No data migration: workflows already persisted in the string form stay valid, and the parsed workflow normalizes both forms on read.

## Capabilities

### New Capabilities

None. The behavior belongs to the existing board, conversation, and product-tool capabilities.

### Modified Capabilities

- `kanban-board`: the YAML workflow configuration gains per-transition conditions; the automatic advance destination, its default path, the stale-choice pause, the auto-mode control presentation, and the stage instruction message contents change.
- `task-conversations`: the drawer next-stage action resolves the recorded transition, names it, and refuses a recorded transition that no longer resolves.
- `product-tools`: the restricted tool surface gains `list_allowed_transitions` and `set_next_transition`, including the boundary that recording a transition does not move a task.

## Impact

- Domain: `src/domain/workflow.ts` (parse and validate both transition forms), `src/domain/transitions.ts` (transition entry access), `src/domain/auto-advance.ts` (routing resolution and default path), a new routing module, `src/domain/schema-parts.ts` and `src/domain/hub-schema.ts` (normalized read of both forms, new task field, new pause reason), `src/domain/hub-operations.ts` (expire the recorded transition when the task changes stage).
- Host: `src/host/stage-instruction.ts` (compose the briefing), new `src/host/stage-briefing.ts`, `src/host/auto-advance.ts` and `src/host/auto-advance-admission.ts` (stale pause and choice-aware destination), new `src/host/tools/transitions.ts`, `src/host/tools/index.ts`, `src/host/app.ts` (wiring).
- Client: `src/client/auto-mode.tsx` (recorded destination and the new pause label), `src/client/drawer.tsx` and `src/client/drawer-stage-control.tsx` (next-stage target and refusal).
- Persisted data: `Column.allowedTransitions` becomes a list of transition entries, `Task` gains an optional recorded transition, and `AutoModePauseReason` gains `transition-stale`. The Hubs schema accepts stored workflows in both forms; `DATA_VERSION` is unchanged.
- Docs: `README.md` workflow and auto-mode sections.
- Tests: domain, host, browser, and the isolated `auto-mode` lane.
