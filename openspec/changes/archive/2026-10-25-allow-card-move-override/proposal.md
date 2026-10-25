# Proposal

## Why

A workflow's `allowed_transitions` currently behaves as a hard prohibition: the board rejects the drop and the drawer hides every restricted stage. When a workflow is incomplete or a task needs an exceptional handoff, the user has no way to move that card without editing the workflow for every card. The restriction should remain a guardrail, but an explicit, one-shot confirmation should let the user override it. Showing the full workflow in the drawer also makes the constraint understandable instead of invisible.

## What Changes

- **BREAKING — Restricted moves are allowed with explicit confirmation.** A cross-stage move whose target is not listed in the source stage's `allowed_transitions` no longer fails outright. Dropping on that stage or selecting it in the drawer opens a confirmation. Cancel leaves the task's stage and position unchanged; confirming performs a one-shot override. The workflow YAML and `allowed_transitions` are never modified, and the override is not persisted on the task.
- **The drawer stage control shows the full workflow.** The native select lists every stage in workflow order, including the current stage. Stages that require an override use a muted option style but remain selectable; a non-visual accessible label communicates the restriction without adding visible text.
- **Drag accepts every stage.** Restricted columns are no longer faded or rejected. Hovering a restricted destination shows a dashed warning-style drop indicator and a subtle column outline; dropping opens the confirmation. Permitted drops remain immediate.
- **One confirmation surface.** A neutral dialog names the task and the source and destination stages, explains that only that card is affected, keeps Cancel focused, and offers a neutral **Move anyway** action. If the host rejects the move, the dialog stays open with the problem and a retry that revalidates the latest task and workflow; a stale task or stage does not offer a pointless retry.
- **The confirmation survives retry and restart.** When a restricted move is admitted, the host records the user's consent on the transient pending transition so the same confirmed move can be completed after a retry or restart. No workflow, task, or data-version change is required.
- **Unchanged boundaries.** Same-stage reorder and permitted transitions move immediately. Unresolved operations, pending transitions, and other existing guards remain non-overridable. A move never starts an agent, and instructed-stage markers, the card run action, and drawer instruction prefill keep their current semantics.
- **Cleanup.** Replace the duplicated transition filtering with one shared transition-access policy; extract move orchestration into a move-request hook and the confirmation into a focused presentational dialog; remove the obsolete drop-disabled styling; align the README, operations documentation, and `kanban-board` spec.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the hard-prohibition requirement becomes an explicit-confirmation requirement for restricted transitions; the board must present a warning affordance during a restricted drag and permit a confirmed override while preserving immediate permitted moves, reorder behavior, and execution independence.
- `task-conversations`: the drawer stage control must list the full workflow in order, de-emphasize restricted stages while keeping them selectable, and apply the same explicit confirmation before a restricted move; instruction prefill follows the confirmed move.

## Impact

- **Domain:** `src/domain/transitions.ts` gains the access classification; `src/domain/workflow.ts` loses the now-unused re-export if no consumers remain.
- **Host and wire:** `src/shared/types.ts`, `src/remote.ts`, `src/domain/schema.ts`, `src/host/app.ts`.
- **Client:** `src/client/board.tsx`, `src/client/drawer.tsx`, `src/client/styles.ts`; new `src/client/useMoveRequest.ts` and `src/client/transition-override-dialog.tsx`.
- **Behavior:** no new task field, workflow mutation, or data-version migration; the only persisted addition is an optional override flag on the existing transient pending transition.
- **Docs and specs:** `kanban-board` and `task-conversations` spec deltas, `README.md`, and `docs/operations.md`.
- **Verification:** transition-policy coverage, host in-memory acceptance/rejection and pending retry/restart, client hook/dialog/select/drag/prefill tests, a light/dark browser lane, and one focused real-composition move/cancel scenario. The native select popup remains a manual visual check; the native composer prefill stays at the fake-draft-port layer.
