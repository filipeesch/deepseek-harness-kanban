# Proposal

## Why

Every task conversation in a board starts on whatever model the deployment defaults to. The
only way to run a board on a different model is DSH's native model selector, and it appears
once — in the first-execution preparation — for that one conversation. A second tab, a card
created by an agent tool, or an automatic start on an instructed initial stage silently returns
to the deployment default, so "this board runs on this model" cannot be expressed at all.
Schedules already solved this exact shape: a stored selection that applies to the conversation
the run created, host default when absent. Boards never got the equivalent.

## What Changes

- A board's workflow YAML gains an optional root `model:` mapping with `provider`, `model`, and
  an optional `reasoning_effort`. This is the board's default model. When it is absent, behavior
  is exactly today's: DSH's own default.
- The board's default model is applied to **every new conversation of that board**, not only the
  first: first-execution preparation, later conversation tabs, automatic first execution on task
  creation, and conversations started through the agent tools.
- A change made with the native selector inside a conversation stays with that conversation and
  is never written back to the board. The plugin never writes the installation-wide default.
- The execution preparation stops presenting DSH's native model step when the board names an
  available model. It presents that step when the board names no model, when the named model is
  absent from the host catalog, or when the catalog could not be read.
- When the board's model cannot be applied, the conversation is still created and runs on the
  deployment default, and that conversation shows a dismissible notice naming what was requested
  and what was used. Board configuration shows a persistent state readout for the same condition.
  Board defaults fail open; schedules keep failing closed.
- Board configuration gains a model control that writes and clears the root `model:` key in the
  authored YAML, sharing the control the schedule editor already has.
- Publishing: the model travels as workflow text, and a change to it alone counts as a change to
  the workflow's meaning — not to its layout — in the team comparison.
- Agent tools: `update_board`, `create_board`, and `edit_board_yaml` accept the field through
  workflow YAML, and `get_board_summary` with `include_workflow` reports it.

**Non-goals**: no Hub-level default, no per-stage or per-column default, no model stored outside
the board's workflow YAML, no per-model parameters (temperature and friends), no model selection
for schedules beyond what they already carry.

## Capabilities

### New Capabilities

None. This change extends capabilities the project already specifies.

### Modified Capabilities

- `kanban-board`: adds the "Board default model" requirement (authoring, strict validation,
  storage in the board's workflow YAML, the configuration control, publishing participation, and
  the preparation skip/reopen rule); modifies "YAML workflow configuration" to count the board's
  default model among the per-board workflow settings; modifies "Execution preparation before a
  task's first execution" so the model part applies only when no available board default exists.
- `task-conversations`: modifies "Model selection for the first conversation", which currently
  states that the selector always shows the deployment default while the conversation has no
  recorded selection; adds that the board's default seeds every new conversation of that board
  and that an inapplicable default is announced on the affected conversation.
- `product-tools`: modifies "Board workflow read payload" and "Whole-document board workflow
  replacement" so the board's default model is readable and authorable through the tools.

`hub-schedules` is deliberately not modified. A schedule targets a project, not a board, and
carries its own optional selection, so an occurrence has no board to inherit from; the existing
fail-closed rule for a schedule's own model stands. See design assumption A1.

`hub-sharing` is deliberately not modified. The published document already carries the workflow
YAML exactly as authored, and the team comparison already treats everything that is not stage
placement, stage size, or connection layout as the workflow's meaning, so a model change lands
in the existing per-board choice path without a new requirement.

## Impact

- **Domain**: `src/domain/workflow.ts` (accepted root key, parse, validation), 
  `src/domain/schema-parts.ts` (`workflowShape`, which feeds both the integrity check and the
  meaning comparison), `src/shared/types.ts` (`Workflow.model`), and a new pure
  `src/domain/model-preference.ts` holding the precedence, the catalog-key encoding, and the
  availability predicate that the host and the client must agree on.
- **Host**: `src/host/schedule-model.ts` becomes a session-scoped model port used by both the
  schedule runner and the app; `src/host/app.ts` applies the board default where every task
  conversation is created and reports the outcome on the conversation receipt;
  `src/host/schedule-runner.ts` keeps its fail-closed behavior at the call site;
  `src/host/tools/boards.ts` states the field in the tool surface.
- **Client**: a new model control and state readout under `src/client/settings/board/`, the
  schedule editor switching to the extracted shared control, the execution preparation gating the
  model step on availability, and a dismissible per-conversation notice.
- **Persisted state**: no migration and no backfill. A stored workflow without `model:` keeps
  today's behavior. The board's stored workflow keeps the parsed workflow and the authored YAML
  in sync, so the field must enter both or every existing board fails its integrity check.
- **Tests**: parser and root-field writer round-trips, workflow meaning, preparation gating,
  notices, board configuration, and the tool surface.
- **Documentation**: the README board-configuration section and `docs/operations.md` describe the
  board default model and its fallback.
