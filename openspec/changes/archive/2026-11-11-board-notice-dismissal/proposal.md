# Proposal

## Why

Dismissing a retained-checkout notice on the board does not stick. The dismissal is
local component state inside the board view, so switching the Kanban panel away and
back, or reloading, restores the notice — while the host keeps its list of retained
paths for the whole process lifetime and has no command to acknowledge one. Every
deletion with a kept checkout therefore adds a row that the user cannot actually
clear. The wording of the notice is correct; the notice component, its state
ownership, and the missing host acknowledgement are the defect.

The same component also carries the only dismiss affordance on the board, and it is
a full text button inside the row flow. The board's other notices — a failed command
and the team-changes banner — have no dismiss affordance at all, so a stray failure
stays until the next action starts and the banner stays until the team's state
changes by itself.

## What Changes

- Retention becomes host-owned for both causes: a folder project that keeps its
  plain checkout, and a checkout whose project path or Git root could not be
  resolved. The client stops deducing the folder case from its own deletion result.
- A new host command dismisses one or more retained paths; the host removes them and
  stops projecting them, so the dismissal survives a panel switch, a reload, and
  another client.
- The board splits the destructive-operation notice into two groups: operations that
  are running or failed (not dismissible, they carry recovery actions) and checkouts
  left on disk (dismissible, with its own header and a **Dismiss all** action).
- A retained entry is pruned once its directory no longer exists, checked on a short
  interval instead of on every snapshot publication.
- Every dismissible board notice gets one compact, icon-only dismiss control at its
  trailing edge, with an accessible name, replacing the current text button.
- The board command-failure notice and the team-changes banner gain the same
  control. Their dismissal is client-side page state: a dismissed failure stays gone
  until another failure replaces it, and a dismissed banner returns when the team's
  pending changes change.
- Load failures, destructive failures, and project relocations stay non-dismissible:
  each one either exposes a recovery action or must be resolved on its own surface.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the destructive-operation notice separates dismissible retained
  checkouts from non-dismissible operations and makes retention dismissal
  authoritative; a new requirement defines which board notices are dismissible, how
  they present the control, where each dismissal lives, and when a dismissed notice
  returns.
- `hub-sharing`: the team-changes banner becomes dismissible per Hub and returns
  when the team's changes change, without resolving or altering publishing state.

## Impact

- **Host**: `resolveDeletionTarget` reports a retained checkout for a folder
  project; the retained-checkout registry gains a reason per entry and a dismiss
  operation; snapshot assembly prunes entries whose directory is gone.
- **Contracts**: `RetainedCheckout` gains a `reason` field; `Command` gains
  `retainedCheckout.dismiss` with a paths payload, and its remote schema and host
  dispatch follow.
- **Client**: the notice list moves out of the board page component into a notice
  model with injected dismissal ports; the folder-project retention heuristic
  (`pendingRetained`) and the `retained` callback of the destructive-operations
  hook are removed; the shared dismiss control is reused by the banner; the two
  differently named `board-notices` modules become one module per role.
- **Tests**: host retention projection and dismissal, the removal of the client
  heuristic, the notice model and dismiss control, the banner's reappearance rule,
  and the browser notice spec.
