# Design

## Context

`BoardView` is a fixed-height flex column: header, then the notice slot, then `.kb-page-body` with `flex: 1; min-height: 0; overflow: auto`. The global save line is a normal flow child of that column, inserted immediately before `.kb-page-body`, so its own height is subtracted from the board body while it is mounted. Moves are already optimistic in `useMoveRequest`, which places the card in its destination before the command resolves, and most surfaces that start a command (dialog buttons, drawer operation status, worktree states) already report their own progress.

The board command runner in `board.tsx` currently mixes four concerns: resolving the command scope, invoking the API and accepting the snapshot, reporting global progress through an in-flight counter, and classifying failures into a discard-confirmation request or an action error. The notice slot is inlined in the same render expression as the board body.

See `proposal.md` for motivation and `specs/kanban-board/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Remove every layout change that command progress can cause between the header and the columns.
- Keep a single owner of board command state and policy: the runner scopes, invokes, and applies an outcome; it does not branch on failure semantics inline.
- Preserve current failure visibility, optimistic placement, and every existing command behavior.
- Make the discarded-command policy and the notice slot independently readable and testable later.

**Non-Goals:**

- Extracting a `useBoardCommands` gateway hook. It was considered and deliberately deferred; the larger blast radius across destructive flows is not justified by this change.
- Repositioning or restyling error notices. They stay in their current flow slot, so a failed command can still move the board once.
- Announcing command success or progress to assistive technology.
- Test authoring; test planning follows in a separate change.

## Decisions

### 1. Delete the global indicator instead of relocating it

`pending`, its `setPending` calls, the `finally` guard that existed only for it, and the status element are removed. Removing the state also removes two whole-board re-renders per command (`pending` lives in `BoardView`, so each toggle reconciled every column and card).

Alternatives considered: an absolutely positioned overlay pill and a permanently reserved status slot. The overlay still flashes on fast local commands, and the reserved slot permanently spends about 25 px of board height for information that is normally redundant. Both keep machinery whose only output is noise in the common case.

### 2. No replacement live region

The removed element was also the only live announcement of a write. Fast optimistic commands plus non-stop "Saving…" announcements are worse for screen-reader users than silence, and failures already render `role="alert"` notices that are announced. The board presents no global save announcement in either channel.

Alternatives considered: a persistently mounted sr-only `role="status"` (chatter on every move), a slow-command-only announcement (a timer plus in-flight store to maintain for a case the board does not have), and outcome announcements such as "Moved to Plan" (needs per-command copy and expands this change into general command feedback).

### 3. Failure classification becomes a pure function

New module `src/client/command-failure.ts`:

```ts
export interface CommandFailureAdvice {
  notice?: Problem;
  discard?: DestructiveRequest;
}

export function adviseCommandFailure(input: {
  command: Command;
  problem: Problem;
  task?: Task;
  priorOperation?: ContextOperation;
  allowDiscard: boolean;
}): CommandFailureAdvice;
```

It owns the current `DISCARD_REQUIRED` policy: a rejected delete or worktree removal, or a failed retry of one, becomes a discard request carrying the captured expected path, and a retry whose original target is unavailable becomes a board notice instead. It reads no React state, performs no state writes, and imports `DestructiveRequest` as a type only, so no runtime dependency on the dialog module is created.

The runner keeps ownership of effects: it applies `advice.discard` and `advice.notice` to its own state setters and rethrows the original error so callers keep their existing catch behavior. Returned data instead of callbacks keeps the policy inverted away from the component and trivially unit-testable.

Alternative considered: folding this into the deferred gateway hook. Extracting only the policy is behavior-preserving and reviewable on its own.

### 4. The notice slot becomes a component, not a layer

New component `src/client/board-notices.tsx`:

```ts
export function BoardNotices(props: {
  loadError: Problem | null;
  actionError: Problem | null;
  onRetryLoad: () => void;
}): ReactNode;
```

It renders the existing order — load error, load retry action, action error — and returns `null` when there is nothing to show, so the idle DOM is unchanged apart from the removed save line. It stays in the same flow position; no overlay or scroll-area move is introduced.

Alternative considered: leaving the expression inline. The render already carries the header, configuration, board body, drawer, dialogs, and confirmation, so naming this slot is the smaller part of making the component readable.

### 5. Optimistic placement is the move feedback

`useMoveRequest` and `armAfterMove` are unchanged. The card is in its destination before the command resolves, so the visible result is already immediate; no progress UI is layered on top. The drawer stage select, dialog buttons, and worktree surfaces continue to own their local pending state.

### Frame before and after

```
before                                  after
+----------------------+                +----------------------+
| .kb-header           |                | .kb-header           |
+----------------------+                +----------------------+
| Saving change...     | <- toggles     | .kb-page-body        |
+----------------------+                |   .kb-columns        |
| .kb-page-body        | <- resized     |   (constant height)  |
|   .kb-columns        |                |                      |
+----------------------+                +----------------------+
```

## Risks / Trade-offs

- **A slow command now has no board-level progress.** → The surface that starts it already reports progress (dialog button label, drawer operation status, worktree state), and a failure produces an action error. If a future command lacks local feedback, the fix belongs in that surface, not in a global banner.
- **Failure classification could drift from the discarded-command semantics.** → The runner has exactly one classification call and no remaining inline policy; the helper receives the command, task, and prior operation explicitly, so behavior is reviewable in one place.
- **Error notices still shift the board.** → Accepted by decision: errors are rare, stay visible, and remain more prominent in flow than under an overlay. The spec scenario covers command progress, not error presentation.
- **The notice component could accidentally add idle markup.** → It returns `null` with no wrapper when both errors are absent; later layout tests can assert the idle frame height directly.
- **Destructive flows lose inline branch coverage in `board.tsx`.** → They gain a pure function with the same inputs and outputs; the runner still applies the outcome to the same setters.
- **No state is left to reflect concurrent commands.** → Nothing consumed that count beyond the removed indicator, and request completion still arrives through the accepted snapshot.

## Migration Plan

No data, protocol, or storage migration. The change ships with the next plugin build: one commit removes the indicator and simplifies the runner, another adds the classifier and the notice component with no behavior change. Rollback restores the removed element and counter; no persisted state depends on either.

## Open Questions

None.
