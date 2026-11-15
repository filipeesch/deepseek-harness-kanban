# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- `ClientBridge` (`src/client-bridge.ts`) owns one host board stream and every unary request the client makes. `unarySnapshot()` applies a returned snapshot and, on error, also writes the feed health with `fail()`. The health source is read by a single `FeedStatus` component rendered in two places: the Kanban page and the `questionDockServices` handed to the composer dock.
- The composer dock is registered in the host's global `conversation.input.dock` slot, so its component mounts above the composer of every native conversation, ordinary chats included. The dock's own question feed is conversation-scoped and explicitly independent of the board: `questionsFollow` takes only a session id, and the host documents it as "independent of board and attention work".
- With a task drawer open and a conversation selected, a navigation to an ordinary chat is classified `unclassified` because the catalog row has no parent — the same shape as a freshly created branch on this pinned host, which records no fork lineage. The drawer therefore asks the host to prove and attach the branch, the host refuses with `FORK_LINEAGE_MISMATCH`, and the coordinator returns silently, as the navigation contract requires.
- Every command caller already reports its own failure: the board turns a rejected command into a command-failure notice, the initial board load has its own retry notice, and a background automatic-instruction failure has its own record. The question feed has its own failure and retry in the dock.

## Goals / Non-Goals

**Goals:**

- Make the board-update status mean exactly one thing: whether the live board feed is available.
- Keep the status, its message, and its retry on the Kanban page, and remove it from every native conversation.
- Keep the composer dock a question surface that works in ordinary chats, independent of board health.
- Leave the drawer's refusal behavior untouched and make it silent by construction.
- Keep each surface dependent on a narrow contract; no surface reads another surface's health.

**Non-Goals:**

- Changing the host, the fork implementation, or the drawer's navigation classification.
- Making a refused claim an error outcome or a returned result; that would change the command contract and the host.
- Adding a new retry, notification, or toast surface for board failures outside Kanban.
- Persisting any new state; no storage format changes.

## Decisions

### 1. The feed health is written only by the feed supervisor

`ClientBridge` keeps one health observable, and only the live feed path writes it: the stream carrier failure, the stream supervisor failure, a merge failure in `accept()`, and a failure to restart the feed in `retry()`. `unarySnapshot()` stops calling `fail()`; it still applies an accepted frame and still throws the original failure to the caller that requested it.

Why: a request failure is a fact about one action, and every caller already reports it where the action started. Reporting it again as feed health both mislabels the fact ("updates are unavailable") and lets an expected refusal of a branch proof reach an unrelated chat.

Alternatives considered: a labelled status with two messages ("updates unavailable" versus "last action failed") — duplicates an error each surface already shows and adds state to test; removing the health channel entirely — loses the only signal that the live feed died while the Kanban page is mounted; passing a `report: boolean` to `unarySnapshot` — control coupling, and the feed supervisor already owns that path.

The merge-failure path stays as it is: a frame that cannot be merged leaves the board presenting a stale state, so it reports the failure and asks for one fresh read plus a restarted stream.

### 2. The status is mounted once, on the Kanban page

The strip becomes its own component with its style, mounted only where the Kanban page renders. `createQuestionDockServices` loses its `status` input, `QuestionDockServices` loses the field, and the dock no longer sees the bridge's health at all. The dock keeps its question-rounds error with its own retry, which already exists.

Why: the host gives the plugin no per-conversation flag that says "this conversation belongs to the board", and adding a membership lookup to the composition root would put a board rule in a generic conversation surface. The page that depends on the feed is the page that presents its health.

Alternatives considered: gate the dock strip by task membership from the latest snapshot — keeps a prebuilt React node in the dock contract and a belonging rule outside the board; keep the strip in every conversation — the behavior this change exists to remove.

### 3. The dock keeps one dependency boundary

`QuestionDock` continues to receive a services object built by the composition root, but that object now contains only question ports: the rounds view, submission, drafts, dismissal, tracking, and the conversation send and focus adapters. `QuestionDockBridge` stops exposing `status`, and `QuestionDockStatus` is deleted with it.

Why: the dock is the only global plugin surface inside an ordinary chat, so its contract should describe questions only. This is also what keeps `decision_request` working in ordinary conversations: the round, its draft and its submit path never depended on board state, and now the component cannot accidentally couple to it.

Alternative considered: pass a narrow "board health" port instead of a React node — still a dependency the dock has no use for.

### 4. A refused claim stays silent by construction

No behavior changes in `DrawerNavigationCoordinator` or in `createForkClaim`. The coordinator keeps returning on `FORK_LINEAGE_MISMATCH`, `SESSION_NOT_FOUND`, and `INVALID_ATTACH`, and the drawer keeps reporting only an attach failure it awaited from catalog lineage.

Why: the navigation contract already says a Session the host does not prove attaches nothing and keeps the native navigation. With the health channel no longer recording request failures, the refusal has no path to a status surface, so the silence no longer depends on the coordinator remembering to swallow a code.

Alternative considered: make `conversation.attach` return `{ attached: false }` instead of a business error. Cleaner semantics, but it changes the command contract, the host handler, and their tests for a behavior the health fix already delivers. Recorded as a follow-up rather than folded into this change.

### 5. Reuse the client's existing error conversion and drop the unused field

The bridge's private `problem()` gives way to `asProblem()` from `src/client/problem.ts`, which already unwraps a nested `error` and carries `details`. `BridgeStatus` loses `connected`: it is written on every transition and read nowhere, and the status component renders only the failure.

Why: one conversion for the whole client, and a status type that states only what the UI consumes.

Alternative considered: keep `connected` and use it to render a reconnecting state. No requirement needs one: the accepted frame clears the failure, so the failure's presence is already the disconnection fact.

### 6. Verification layers

- Bridge unit tests assert the new boundary directly: a rejected command leaves the health untouched while still rejecting with its code, and a stream failure still reports and clears on the next accepted frame.
- Dock unit tests render the component with question services only, proving the rounds error and retry and the absence of any board status.
- Coordinator tests keep covering the refusal, now asserting no report and no drawer claim for a Session the host refuses.
- The browser fixture proves the dock renders no board status with the host theme; the isolated lane proves an ordinary chat shows no banner after the navigation that used to produce it.

Alternative considered: unit tests only. The defect was a composition mistake between the global dock and the page status, which unit tests alone would not catch.

## Risks / Trade-offs

- **A real feed outage is invisible outside Kanban** → Accepted and specified: the status is shown whenever the Kanban page is mounted, and the health survives the panel unmount, so returning to the page presents the failure and its retry.
- **A failed background refresh becomes silent** → The board keeps the last received state and the next accepted frame repairs it. The alternative would reintroduce the mislabelled status for a failure no user action depends on.
- **Existing tests encode the old coupling** → The bridge test that asserted a command rejection writes the status changes to assert the opposite; any other expectation is updated in the same commit so the new boundary is pinned.
- **The refusal still costs one host request and one log read per ordinary-chat navigation** → Accepted for this change; it is the price of proving a branch on a host that records no lineage. A host that records the fork's parent, or a future result-shaped attach command, removes it without touching this change's contract.
- **The dock contract loses a field** → Internal only; no persisted state, no API version, no consumer outside the client composition root and its tests.
- **Two deltas in one capability area** → The status requirement and the dock requirement are split between the capability that owns the page chrome and the capability that owns the question surface, so archiving keeps each fact in its authoritative spec.

## Migration Plan

1. Change the health boundary in the bridge and update its unit tests.
2. Extract the status component and mount it only on the Kanban page.
3. Remove `status` from the dock contract and services, and update the composition root.
4. Apply the cleanups (drop `connected`, reuse `asProblem()`).
5. Update `docs/operations.md` and add the dock and lane evidence.

Rollback is a revert: no storage, wire schema, host API, or dependency changes, so an older plugin build stays installable on the same host.

## Open Questions

- Whether a later host release records the fork's parent on the branch header, or a later change makes the attach command answer with a result instead of an error. Either would remove the per-navigation proof cost; neither changes the behavior this change specifies.
