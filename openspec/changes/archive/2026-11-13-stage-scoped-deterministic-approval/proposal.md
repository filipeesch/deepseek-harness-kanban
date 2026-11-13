# Proposal

## Why

A deterministic stage is supposed to start work without a model turn, but its local approval currently behaves like a repeated gate. The approved version includes the task's resolved execution directory, so the same stage asks for approval again for every card with a different worktree; any source edit asks again; and the only control that approves is an overlay reachable from a detail panel, while the card itself shows Stop for a script that never started. A stage-level approval that is requested once per changed version, visible on the card and the board, removes the repeated gate without weakening the review of executable code.

## What Changes

- Approval becomes a property of a stage's executable version, scoped to the board and the stable stage identity. One approval covers every project the board allows and every future card of that stage.
- The executable version is identified by program source, language and program format, source form and authored reference, directory choice, named exits, authorized variable names, and declared parameter names. The resolved execution directory leaves the version and remains a captured execution fact validated at admission.
- A change to any reviewed input creates a new version and exactly one new approval request. Repeated cards, restarts, and recovery of an approved version never ask again.
- Approval is reachable from three surfaces: the card that waits for it, a board queue that lists one row per unapproved stage version with its waiting card count, and the stage editor, which can approve the stored version before any card enters.
- The card presents the pending approval with the same attention surface used for a pending decision request, an attention mark, a status line, and an `Approve and run` action in place of Stop.
- The review presents the exact primary program with syntax highlighting and the reviewed capabilities. It no longer presents project variable values or configured/missing state; local variable configuration moves to its own surface on the task's script panel.
- Approving from any surface resumes every waiting card of that stage version. Approval is rejected when the stage version changed during the review.
- **BREAKING (internal):** the trust scope, the version fingerprint content, the approval command, and the workflow write report's authorization shape change. Existing local approvals are not migrated; each stage requests one approval after the upgrade. Old approval records are ignored and may be cleaned up.
- There is no revoke action. Editing the stage is what requests a new review; Stop remains the way to end a running execution.

## Capabilities

### New Capabilities

None. The change modifies existing behavior only.

### Modified Capabilities

- `deterministic-steps`: the reviewed authority becomes a board-and-stage executable version shared by all projects and cards; the capture separates the version from the resolved execution directory; one approval per changed version; approval review and its surfaces; awaiting approval replaces the per-card trust wait; local variable configuration leaves the review.
- `kanban-board`: the card attention surface and status strip recognize a pending stage approval, the activity region presents the approval action instead of Stop, and the board presents an approval queue for unapproved stage versions.
- `stage-editing`: the deterministic editor presents the stored version's approval state, keeps the editor open after a save that creates an unapproved version, and offers review and approval without running code.
- `workflow-authoring`: the write validation report describes the authorization state of one executable version per stage instead of per project, and drops the per-card execution-directory verdict.

## Impact

- Host runtime: `src/host/deterministic/` (ports, capture/plan, trust store, executor admission), `src/host/deterministic-supervisor.ts`, `src/host/deterministic-control.ts`, `src/host/deterministic-impact.ts`, and the application command dispatch.
- Trust and ownership scopes split: approval is hub+board+stage; variables and process ownership remain hub+board+project+stage.
- Shared types and transport: `src/shared/deterministic.ts`, `src/shared/types.ts`, `src/host/app.ts`, `src/remote.ts`, `src/client-bridge.ts`.
- Client: task card and attention projection, script panel and actions, deterministic review dialog, a new local-variables dialog, the context-row-free script surfaces, and the board notice stack.
- New dependency: CodeMirror language support for TypeScript and Bash used read-only by the review.
- Specs, the workflow architect reference material, host/client/browser tests, and the isolated real-composition lane. The installed plugin version is bumped in the implementing pull request.
