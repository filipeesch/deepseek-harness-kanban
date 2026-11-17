# Proposal

## Why

Task agents currently receive their initial stage but not the workflow around it, so a general-purpose PTC agent can mistake one stage for the entire task or advance without the stage requesting it. Workflow operators need compact, timely context and an explicit, narrowly scoped escape hatch for a user-requested exceptional route without becoming workflow administrators.

## What Changes

- Ship a PTC-based workflow operator preset and make it the default for newly created workflows while preserving explicit preset selection, existing workflows, existing conversations, and the independent automatic-advance control.
- Inject one compact workflow snapshot into every task conversation's existing first-turn context, regardless of preset. Retain an on-demand current workflow summary and consult current transitions before declaring a route; do not require a summary tool call at startup.
- Support optional authored descriptions for the workflow and its stages; instruct the workflow architect to fill and maintain concise descriptions of at most 150 characters each, without enforcing this limit on other authors. Preserve descriptions through edits, revisions, and team sharing.
- **BREAKING** Replace `get_board_summary` with a concise `get_workflow_summary`, adapt all consumers and role allowlists, and keep exact workflow YAML reading available only to the workflow architect. The compact response includes workflow structure, task-specific operational state when applicable, project scope, and sharing status, not full YAML, scripts, entry prompts, or administrative configuration.
- Update transition briefings so they describe routes without directing an agent to transition unless the authored instruction or user asks. Permit an explicitly flagged unconfigured destination when the agent is directly asked by the user, limited to the originating turn; this user-intent rule relies on the model's compliance, not a verified human authorization.

## Capabilities

### New Capabilities

- `workflow-operator-preset`: PTC-based task operator behavior, default selection for newly created workflows, and boundaries between operator, workflow author, and automatic advancement.

### Modified Capabilities

- `kanban-board`: Optional workflow descriptions, new-board default preset, neutral stage briefings, and turn-scoped exceptional recorded routes.
- `task-conversations`: First-turn task context carries a compact workflow snapshot for every preset without repeating or backfilling it.
- `product-tools`: Replace the board summary tool with the operator-focused workflow summary and extend transition declaration for the explicit exceptional route.
- `workflow-authoring`: Preserve optional descriptions and instruct the architect to author and maintain short descriptions without broadening its authority.
- `hub-sharing`: Preserve description changes and new-board default semantics in team publishing, synchronization, and legacy/mixed-version handling.

## Impact

The change affects workflow parsing and stored models, board creation and preset selection, task-context projection, product tool definitions and role masks, transition admission and recovery, workflow-authoring guidance, revision and sharing logic, and their documentation and tests. Removing `get_board_summary` is a deliberate API break; existing scripts, presets, and consumers must be adapted. No new product confirmation or deterministic verification of the user's natural-language intent is introduced.
