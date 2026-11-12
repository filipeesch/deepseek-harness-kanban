# Proposal

## Why

Waiting for CI, human review, or deployment completion currently requires model-driven behavior or manual intervention. These waits should execute repeatable code without model tokens or prompt drift, survive host restarts, and route their result into the existing task workflow.

## What Changes

- Add deterministic stages with Bash or TypeScript scripts, authored inline in workflow YAML or loaded from an external file. TypeScript exposes only `tools.bash` from the tool surface; scripts own their loops, sleeps, and business deadlines.
- Start the stage on entry even when task auto mode is disabled. Provide Stop and Play in the card/drawer: Stop cancels the running program and its Bash children; Play starts a new execution in the same stage using the latest configuration. Moving a card cancels its previous execution.
- Capture approved executable configuration per execution. Recover an active execution after a host restart by running the captured script from the beginning with the same execution identity and original start time; never claim to restore program memory or replay a script after its terminal result was durably recorded.
- Map named script exits to exact workflow destinations and carry a message to the destination, including another deterministic stage or a manual stage. Executor failures use an optional reserved `error` route; otherwise they remain recoverable failures in the current stage.
- Require local trust for each executable version, independent of team publication. Support explicitly authorized local variables isolated by project and stage, using native credential storage and never publishing values, trust, or execution state.
- Extend the visual stage editor, runtime projections, task history, and shared workflow journal without changing the documentary meaning of transition `when` text or the existing prompt-stage countdown.
- **BREAKING (host baseline):** move the supported SDK/runtime baseline to the DSH 0.2.2 line instead of retaining 0.2.1-rc.2 as a constraint. Align SDK dependency ranges, engine compatibility, lockfile, and verification fixtures with the tested 0.2.2 release; the available checkout currently reports 0.2.2-rc.1.

## Capabilities

### New Capabilities

- `deterministic-steps`: script authoring and execution, durable supervision, local trust and variables, named exits, error recovery, and cross-stage handoff.

### Modified Capabilities

- `kanban-board`: recognize deterministic execution boundaries, activate them on entry, cancel on manual moves, and include script activity without confusing it with conversation turns.
- `stage-editing`: edit deterministic stage configuration alongside the existing instruction mode, preserving authored YAML and stage identity.
- `task-conversations`: deliver deterministic exit messages as identified native context when entering an agent stage without creating conversations for script-only execution.
- `task-history`: record settled deterministic execution and handoff facts without adding rows for each polling iteration or storing secrets.
- `hub-sharing`: preserve deterministic configuration through the workflow journal while keeping executable trust, variables, and runtime records installation-local.
- `plugin-distribution`: declare and verify the DSH 0.2.2 compatibility baseline and required native execution capabilities.

## Impact

The change touches workflow types, validation and YAML editing, shared journal codecs, host composition and narrow runtime adapters, task transition admission/delivery, credentials integration, runtime snapshots, the stage editor, card/drawer controls, and history presentation. It adds cancellable non-model execution through public DSH TypeScript and shell seams rather than the chat `run_code` transport or a parallel secret store. Existing schedules remain session schedules, not a workflow engine.

Verification includes pure-domain, host race/recovery, adapter contract, client, and isolated real-composition tests. No acceptance run may use real CI/CD accounts, live model traffic, the developer profile, or personal task data.

Out of scope: built-in CI/review/CD providers, webhooks, arbitrary DSH/MCP tools inside scripts, side-effecting deployment actions, instruction-pointer checkpointing, transitive dependency freezing, and a dry-run mode that suppresses successful transitions.
