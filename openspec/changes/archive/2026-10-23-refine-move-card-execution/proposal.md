# Proposal

## Why

Moving a card into a stage with an entry instruction interrupts the board with a modal that combines the move, the agent choice, and the instruction. It is the wrong surface for a direct-manipulation gesture: the user cannot see the board, the agent selector is easy to misread, and "Move only" is a dead end because the instruction cannot be run later. The New task dialog also preselects the first project, so the project is chosen by position rather than by the user.

This change makes a move a plain organization action. Execution becomes an explicit action on the card or an ordinary composer send, and each task conversation receives its task context once through native injection instead of repeating an envelope on every instruction.

## What Changes

- **BREAKING — Instructed moves no longer open a dialog.** Every permitted board drop or drawer stage change moves immediately. The Move and run / Move only / Cancel modal is removed.
- **Card run action.** A card in an instructed stage exposes a play action that sends the current stage's exact instruction to the first open conversation, creating one when none is open. It does not move the task, offers no agent picker, and reports failures inline. The action can be used again and remains the run-later affordance.
- **Drawer move-and-prefill.** A drawer stage change moves immediately. For an instructed destination, the drawer switches to Conversations and inserts only the new stage instruction into the active conversation's composer. An existing draft or attachments are preserved with an explicit Replace action; Replace clears both. The composer is focused after insertion.
- **BREAKING — First-turn task context, not per-message envelopes.** The first model step of a task conversation receives a native, model-facing task-context message (task title and ID, description, and workflow stage at first contact) before the first user message. It does not start a turn and is not repeated. Later stage instructions contain only the new stage's instruction. Each new conversation gets its own context; conversations with existing history are not backfilled.
- **Task creation project input.** The New task project select starts empty and remains required. No project is preselected, including when a project filter is active.
- **Cleanup.** Remove `src/client/move.tsx` and the board's move-dialog state; introduce a card run action and a small instruction-draft port; extract the shared stage-transition rule; add a host run-instruction command and a native task-context injector. Keep the legacy `task.move` run path for compatibility, but send only the instruction; the UI no longer creates run transitions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: instructed moves become immediate; the Move-and-run confirmation and explicit agent-choice requirements are replaced by a card run action with a deterministic target; movement never runs an agent; task creation starts with an unselected project.
- `task-conversations`: the first model step of a task conversation receives a native injected task-context message once; later stage instructions carry only the stage instruction; the drawer stage control moves immediately and pre-fills the active conversation composer instead of opening the confirmation dialog.

## Impact

- **Client:** `board.tsx`, a new card run action, `drawer.tsx`, `client.tsx` (instruction-draft port), `forms.tsx` (project default), `icons.tsx`, and `styles.ts`; delete `move.tsx`.
- **Host:** `app.ts` (run-instruction command and instruction-only legacy text), `index.ts` (context-injector registration), new `host/task-context.ts`, `shared/types.ts`, and `remote.ts`.
- **Dependencies:** `@deepseek-ai/dsh-llm` becomes a runtime dependency for `createUserMessage` and the task-context source type.
- **Behavior:** no new persisted board state or data-version change; the context lives in the native session log. The old `task.move` run path remains for compatibility but is no longer used by the UI.
- **Tests:** new in-memory unit and module coverage for the task-context injector, host run command, draft port, card action, drawer prefill, bridge adapter, and project default; the MoveDialog tests are replaced; one owner-authorized GUI smoke covers the native context row and composer.
- **Docs and specs:** `kanban-board`, `task-conversations`, the README, and operations; the verification approach is specified in `design.md` and `tasks.md`.
