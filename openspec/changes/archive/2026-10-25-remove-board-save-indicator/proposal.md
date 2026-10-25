# Proposal

## Why

Every board command shows a "Saving change…" line above the board columns, and that line is a normal flow element inside a fixed-height flex column. When a card move starts, the board body loses about 25 px of height, and when the command finishes it regains that height, so the whole board jumps down and back on each move. The line also fires for every command, even though moves are already placed optimistically and dialogs, the drawer, and worktree surfaces report their own progress.

## What Changes

- Remove the global "Saving change…" indicator and the in-flight counter that drives it. Board commands no longer write component state just to report progress.
- Keep the board frame stable while a command is in flight: no element is inserted, removed, or resized above the task columns for command progress.
- Do not add a replacement live region for saves. Command failures keep their board-level `role="alert"` notices, visible feedback from the surface that started the command (dialog buttons, drawer operation status, worktree states), and the optimistic card placement.
- Extract the discard-consent failure classification currently embedded in the board command runner into a pure helper, so the runner only scopes, invokes, accepts, and applies the classified outcome.
- Extract the board-level notice slot into a small component that owns the load error, the load retry action, and the action error, returning nothing when idle.
- Keep error notices in their current flow position above the board body. A failed command may still move the board once; this change does not rework error presentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: adds a requirement that the board frame stays stable during command execution and that the board does not present a global saving indicator.

## Impact

- `src/client/board.tsx`: removes the in-flight counter and the status element, simplifies the command runner, and composes the notice component.
- `src/client/styles.ts`: removes the now-unused save status rule.
- `src/client/command-failure.ts` (new): pure classification of a failed command into an optional board notice and an optional discard-confirmation request.
- `src/client/board-notices.tsx` (new): the load error, load retry action, and action error slot above the board body.
- No host, protocol, storage, or dependency changes. No change to command semantics, optimistic placement, or error visibility.
- Tests are out of scope for this change and will be planned separately.
