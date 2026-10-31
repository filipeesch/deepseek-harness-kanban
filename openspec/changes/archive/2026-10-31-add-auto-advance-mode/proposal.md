# Proposal

## Why

Every routine pipeline transition on the board needs a human: drag the card, then run the new stage's instruction, then repeat in the next stage. The plugin already owns the pieces that make this mechanical — the persisted stage-entry marker, the durable confirmed-transition record, the host's observation of every session event, and a deterministic instruction target — but nothing connects a finished turn to the next stage.

This change adds an opt-in per-task auto mode: when the task's agent turn completes, the task advances to its next configured stage and the next stage's instruction is dispatched automatically, so a multi-stage pipeline can run without a drag and a play click between stages.

## What Changes

- **Per-task auto mode, off by default.** A card exposes an always-visible toggle and indicator in its context region, mirrored by a toggle in the task drawer header. Enabling arms the task; it never moves the card or sends anything by itself. Disabling stops future advances and does not retract an already admitted one.
- **Automatic advance on a completed turn.** The host watches the task's open conversations. When a turn ends as `completed` and the whole task is idle, it resolves the next configured stage and admits one durable advance: the task is placed in that stage and, when the stage has an entry instruction, the instruction is sent to the task's first open conversation, creating a conversation when none is open. The advance works while the board is closed or filtered, survives a UI reload, and requires no confirmation and no five-second countdown.
- **Only completion advances.** `error`, `blocked`, `aborted`, and `max-tokens` endings leave the task in place and record a visible pause reason. A failed advance also pauses without automatic retry, and the existing stage run action remains available for the unresolved entry.
- **Configured destination with a cascade.** The destination is the first entry of the stage's `allowed_transitions`, otherwise the next stage in workflow order. A stage without an entry instruction is crossed toward the first reachable instructed stage; when no instructed stage remains, the task advances to the last reachable stage. A stage already visited in the same resolution is never revisited.
- **No catch-up.** A turn that ended while the host was not observing is not replayed after a restart. A pending advance that was already persisted is still dispatched, exactly like a confirmed transition today.
- **Refactors in scope.** Extract the shared persisted-schema fragments duplicated between the legacy board schema and the Hub schema; record whether a pending transition came from the user or from auto mode; unify stage-instruction dispatch behind one host admission path shared by the card action, confirmed transitions, and automatic advance; extract the auto-mode card control out of `TaskCard`.
- **Behavior amendments, not breaking changes.** "Movement never runs an agent" applies to user movement only: the automatic advance is the one movement that dispatches the destination instruction, and it never arms the timed countdown. Persisted task data gains optional fields only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: adds the auto-mode control and indicator to the card context region and the automatic-advance states to the status strip; adds the automatic advance trigger, destination and cascade rules, dispatch, pause and failure semantics; clarifies that board movement rules and "movement never runs an agent" govern user movement while automatic advance is the separate host action that runs the destination instruction.
- `task-conversations`: the drawer header mirrors the auto-mode toggle and the drawer presents the automatic-advance state and pause reason above its section panel; a task's first conversation may also be created by an automatic advance's instruction when none is open.

## Impact

- **Domain:** new pure auto-advance resolution (destination, cascade, cycle guard) beside `domain/transitions.ts` and `domain/stage-entry.ts`; new shared persisted-schema fragments used by both `domain/schema.ts` and `domain/hub-schema.ts`; the task record gains an optional auto-mode state and `pendingTransition` gains an optional origin.
- **Host:** new auto-advance coordinator fed by `KanbanApp.observe` with injected tasks, facts, target resolution, admission, dispatch, scheduler, and report ports; new shared stage-instruction admission service used by `runInstruction`, the confirmed-transition drain, and the advance; `app.ts` gains wiring only. A new `task.autoMode` command and its remote schema.
- **Client:** new auto-mode control, derived card/drawer state, and drawer notice; `TaskCard` composes the extracted control; `board.tsx` and `drawer.tsx` pass the toggle command through the existing run path. Existing five-second countdown behavior is unchanged.
- **Contracts:** no data-version bump; legacy board states and Hub states without the new optional fields remain valid. Reading a conversation does not clear the pause reason.
- **Tests:** domain coverage for destination, cascade, cycle, terminal stage, and instruction capture; host coverage for every turn-end reason, the idle gate, admission guards, failure, no catch-up, and persisted-transition resume; client coverage for the chip, status strip, drawer toggle and notice; the existing browser harness and a deterministic real-composition lane extended for the automatic path.
- **Docs:** `README.md` board and drawer sections and the relevant specs.
