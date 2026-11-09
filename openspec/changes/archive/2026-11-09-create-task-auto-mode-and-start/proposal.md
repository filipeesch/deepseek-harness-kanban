# Proposal

## Why

Creating a task is currently organization-only. Even when the initial stage has an entry instruction, the card waits for a manual play action, and auto mode can only be enabled after creation. Users want to capture a task and have the configured first stage start working immediately with the default worktree and the default model, without an extra dialog. The same users also hit a configuration gap: with no worktree base path, a Git-backed task cannot derive a worktree destination at all, so the automatic first execution has nowhere to run.

## What Changes

- The **New task** dialog gains an **Auto mode** option, off by default, and an **Start execution now** option, on by default, shown only when the active board's initial stage has an entry instruction.
- When the initial stage has an entry instruction and start is requested, the host prepares the task's first execution immediately after creation: it creates the default worktree for a Git-backed project, creates the first conversation with the deployment default model, and arms the existing cancelable five-second stage-instruction countdown. Expiry sends the stage instruction through the existing stage-instruction admission.
- **BREAKING** (behavioral): creating a task in an instructed initial stage now starts an execution by default instead of leaving the card idle. Unchecking **Start execution now** keeps the previous organization-only creation.
- `create_card` gains `auto_mode`, always follows the start rule, and prepares and dispatches the first execution in the same call because the agent surface has no countdown. Its result reports the start outcome.
- **BREAKING** (behavioral): `create_card` no longer guarantees that creating a card starts no agent.
- The default worktree destination changes for the whole product: when no worktree base path is configured, a Git-backed task derives a sibling of the repository named `<repository>-<branch>` instead of an empty, user-supplied destination. The missing-worktree notice, the Git section, and the first-execution preparation always have a destination for a Git-backed project.
- The creation path's first-execution preparation is automatic and presents no dialog: no worktree question (the default worktree is created), no native model selection (the conversation keeps the deployment default). The interactive preparation before a user move or play action is unchanged.
- A failed creation start keeps the card and its unresolved entry, reports the failure on the card and in the drawer, exposes the play action, and does not retry automatically.
- Supporting refactors within scope: one shared first-execution planner for move, run, and creation; discriminated worktree-default results instead of an empty-path sentinel; `create_card` through the same creation/start use case as the command; one consolidated `NewTask` schema.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: task creation collects auto mode and start, starts the first execution for an instructed initial stage, arms the countdown after that preparation, presents the preparing state, and derives worktree destinations beside the repository when no base path is configured.
- `task-conversations`: the first conversation can be created by the automatic creation preparation, and that path uses the deployment default model without the native model selector.
- `worktree-management`: the title-derived default destination falls back to a repository sibling when no base path is configured, removing the empty destination and the no-destination paths from the notice, Git section, and preparation.
- `product-tools`: `create_card` accepts `auto_mode`, always follows the start rule, and reports the first-execution outcome.

## Impact

- **Host**: `task.create` input and domain creation, a first-execution preparation use case, `worktreeDefault` and worktree default derivation, the `create_card` tool, and wire schemas.
- **Client**: the New task dialog and its creation flow, the auto-run controller's preparing state, the worktree draft, notice and Git panel, the execution-preparation gate, and the worktree-default client API.
- **Domain**: a new shared first-execution planner, a worktree destination helper that supports the repository-sibling fallback, and a consolidated `NewTask` schema.
- **Wire**: `task.create` gains `autoMode`; a first-execution preparation command/port is added; `worktreeDefault` returns a discriminated result.
- **Specs and documentation**: deltas for the four capabilities above and the README sections for creation, auto mode, and worktrees.
