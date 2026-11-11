# Design

## Context

The board renders its notices from a single composition point. `BoardView` in
`src/client/board.tsx` builds the retained list from two sources and passes it,
with ten callbacks, into `BoardProblemNotices`, which renders `BoardNotices`
(load and action failures), `ProjectRelocationNotice`, and
`DestructiveOperationsNotice`; `ShareBanner` is rendered separately above them.
Only the retained rows have a dismiss control, and it acts on
`useState<string[]>` owned by `BoardView`.

Retention has two origins. A Git-backed deletion whose project path cannot be
resolved is recorded by the host in `app.retainedCheckouts` and projected into
every snapshot (`src/host/app.ts`), with no command that removes an entry. A
folder project's deletion returns `checkout: 'none'` from
`resolveDeletionTarget` (`src/host/deletion-target.ts`), so the host never
records it, and `useDestructiveOperations` (`src/client/destructive-operations.ts`)
infers it from the confirmation and reports it through a `retained` callback.

Constraints that shape the approach:

- The snapshot is the hot path: it is requested on every state publication, so a
  filesystem check per retained entry cannot run on each one.
- Commands travel one way: `Command` in `src/shared/types.ts`, its zod twin in
  `src/remote.ts`, the dispatch switch in `src/host/app.ts`, and
  `scopedCommand` in `src/client/command-scope.ts` injects `hubId` into every
  command that is not explicitly excluded.
- `BoardPageState` (`src/client/page-state.ts`) is created once in `apply()` and
  injected into the board, so it survives a panel switch but not a reload.
- The host must not start using a deprecated DSH host API for this work; none is
  needed, because the change stays inside the plugin's own host module.

See `proposal.md` for motivation and `specs/` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- One owner for retained checkouts and one path for dismissing them, authoritative
  across reload, panel switches, and clients.
- One place that decides which board notice is dismissible and how it presents the
  control, so a new notice cannot quietly become sticky.
- Remove the client-side duplication of the folder-project retention.
- Keep every recovery surface (failure notice, relocation notice, load retry)
  untouched.

**Non-Goals:**

- Persisting retained notices across a host restart; the registry stays in memory.
- Moving the team-changes banner into the notice stack or changing its position.
- Making destructive failures, project relocations, or load failures dismissible.
- Persisting banner or command-failure dismissal across a reload.

## Decisions

### D1. The host owns retention for both causes

`resolveDeletionTarget` gains a retain reason and returns
`{ checkout: 'retain', retainedPath, reason: 'folder' }` for a non-Git project
instead of `'none'`; the unresolvable path keeps `reason: 'unresolved'`.
`DeletionTarget` carries the reason into `destructive-operation`, which persists
it beside `retainedCheckoutPath` on the operation and calls
`onCheckoutRetained`; `app` stores it in the registry entry. Persisting the
reason keeps a resumed deletion's report accurate: a later attempt resolves no
checkout target of its own, so it reuses the recorded reason instead of defaulting
to `unresolved`.

`RetainedCheckout` becomes `{ path, projectId, taskTitle, reason }`, and the
snapshot schema and fixtures follow.

- *Alternative — keep the client heuristic*: rejected. Two owners cannot share one
  authoritative dismissal, which is the reported defect, and the client cannot
  report a retained path after a reload it never witnessed.
- *Alternative — a separate entry kind field*: rejected in favor of a single
  `reason` that also selects the wording, so the row cannot claim a reason it does
  not have.

`useDestructiveOperations` loses the `retained` callback, `pendingRetained`, and
the retained branch of `reconcile`; `plainCheckout` stays in the request because
the confirmation copy and the discard path still use it.

### D2. One dismiss command with a paths payload

`Command` gains `{ type: 'retainedCheckout.dismiss'; paths: string[] }` with no
Hub scope, because the registry is host-global. `app` filters the registry and
marks a change; the command returns the same snapshot shape every command returns,
already pruned of the dismissed paths. Unknown paths are ignored, so a repeated
dismissal is harmless. The retained group's dismiss-all action sends the same
command with every reported path.

- *Alternative — a dedicated remote method*: rejected. Every board mutation already
  runs through the command port, and a second transport surface would need its own
  client wiring, error mapping, and test double for one operation.
- *Alternative — one command per path*: rejected. Dismiss-all would fan out into
  N round trips and N snapshots, and the board would repaint N times.
- `scopedCommand` must exclude the new type; otherwise it would add a `hubId` that
  the strict command schema rejects.

### D3. Prune on a bounded interval, off the awaited path

`app.snapshot()` starts a prune when more than a short interval has elapsed since
the previous one, then returns the projection it already has. A single periodic
timer keeps the next check armed while entries remain, so an idle board whose
snapshots stop still prunes. Each check captures the paths it is verifying, removes
only entries still present whose directory does not exist, and marks a change when
it removed anything, so the next snapshot drops them. Nothing awaits the check, and
the timer is cleared when the last entry leaves or the host closes.

- *Alternative — check inside every snapshot*: rejected, it puts filesystem I/O on
  the hottest path in the plugin, including remote and network volumes.
- *Alternative — prune only at startup*: rejected by the spec, which requires
  removal without user action while the process is running.
- The duplicated private `entryExists` in `src/host/worktrees.ts` and
  `src/host/destructive-operation.ts` is extracted to one host path helper used by
  both and by the prune, so three call sites share one definition.

### D4. A notice model with injected dismissal ports replaces the page-level list

New `src/client/notices/` module:

- `model.ts` — a `BoardNotice` view model (`id`, `group`, `tone`, `title`,
  `message`, `facts`, `actions`, `dismiss`) and pure builders from host and page
  state: retained entries, the command failure, running and failed operations, and
  project relocations. No React, no transport.
- `use-board-notices.ts` — composes the builders from the snapshot, tasks,
  projects, action error, and the injected ports; owns the optimistic pending
  dismissals; returns the groups and the handlers the board passes down.
- `dismiss-button.tsx` — the single icon-only control, with the accessible name and
  tooltip for its notice, and the focus hand-off described by the spec. The
  hand-off receives every control that is about to unmount, because React has not
  removed them yet; a group action passes all of its rows.
- `notice-row.tsx`, `notice-stack.tsx` — presentation only.
- The dismissal port is `{ dismissRetained(paths), dismissFailure(), dismissBanner() }`,
  implemented in `board.tsx` by the command runner, `setActionError(null)`, and the
  page-state write. The model never imports the transport.

`BoardView` keeps only the wiring: it no longer builds the retained list, no longer
owns `dismissedRetained`, and no longer forwards ten notice props.

- *Alternative — keep deriving inside `board.tsx`*: rejected. The broken state
  ownership is inside that component, and it already composes six other hooks.

### D5. Banner dismissal is keyed by the Hub's pending-team signature

The page state stores one signature per Hub, computed from the active
`HubSharingView`: the available updates, the conflicts, and the sorted blocking
identities. The banner renders unless the stored signature equals the current one,
so a new team change re-presents it and a reload presents it again (page state is
memory only).

- *Alternative — localStorage*: rejected. The spec scopes the dismissal to the page
  session, and a persisted signature that no longer matches after a reload would hide
  a change the user has not seen.

### D6. The destructive notice splits into two groups, not two sections

`DestructiveOperationsNotice` renders one section with an operations group (no
dismiss control) and a retained group (heading, rows with per-row controls, and a
dismiss-all action shown when more than one row is reported). The section keeps its
accessible name and its position above the board body.

- *Alternative — two sibling sections*: rejected. One concept would show two
  bordered boxes, and the spec describes one notice.

### D7. One module per role instead of two `board-notices` modules

`src/client/board-notices.tsx` becomes `src/client/notices/board-error-notice.tsx`;
`src/client/board/board-notices.tsx` keeps only the page composition and becomes
`src/client/board/notice-stack.tsx`; `ShareBanner` moves to
`src/client/notices/team-banner.tsx` because it now carries behavior; the frame and
empty-state components move to `src/client/board/board-frames.tsx`.

## Risks / Trade-offs

- [A prune scheduled just before a new retention could remove the new path] → the
  prune compares against the paths it captured when it started and re-reads the
  registry before removing, so an entry recorded later is left alone.
- [A dismiss command and an in-flight snapshot race, so the row flashes back] → the
  optimistic pending set hides the path until a snapshot arrives without it; a
  rejected command clears the pending entry and reports the failure.
- [A host restart forgets retention notices while the directory stays on disk] →
  accepted non-goal; the deletion confirmation already reported the path, and the
  next deletion of that path reports it again.
- [A dismissed banner can hide a team change whose signature is identical] →
  accepted; the Hub and board tab indicators still present the state, and the
  banner's action stays reachable from Team Settings.
- [Adding `reason` to the snapshot shape breaks older fixtures] → the same change
  updates the schema, the fixtures, and the assertions that build retained entries.
- [Existence checks against a slow network volume delay the removal] → the check is
  off the awaited path and bounded by the interval; only the removal publication
  waits for it.
- [Moving focus after a dismissal can disorient keyboard users] → focus moves only
  when the activated control disappeared with its notice; otherwise it stays where
  it is.

## Migration Plan

No durable state changes hands. The retained registry is memory-only, so a rollback
leaves nothing to undo beyond reverting the change; a dismissed entry exists only in
the running process. The wire shape moves with both sides in one release, so no
compatibility window is needed.
