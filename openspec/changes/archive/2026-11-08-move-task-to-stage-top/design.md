# Design

## Context

See `proposal.md` for motivation and the `kanban-board` delta for the behavior contract.

The move pipeline has three producers and one host admission path:

```
Drawer stage select ──► board.moveTo(task, column) ──┐
                                                     ├─► useMoveRequest.move ──┐
Drag and drop ──► useCardDrag.onDrop(anchor) ────────┘                          │
                                                                                v
Auto mode ──► AutoAdvanceCoordinator ──► admitAutoAdvance ──► PendingTransition ─┐
                                                                                │
                             host serializes task.move ──► PendingTransition ───┤
                                                                                v
                                            drain ──► placeTask(anchor) ──► render
```

Constraints found in the current code:

- `placeTask` (`src/domain/hub-operations.ts`) accepts `beforeTaskId: string | null` and appends when no anchor matches. It already re-normalizes positions for the destination and, on a stage change, the source.
- The host validates an explicit anchor and persists `beforeTaskId` on `PendingTransition`; absent and `null` are both persisted as "no anchor" in practice, because `useMoveRequest.apply` omits `null` from the command.
- Drag always supplies a position: a task id, or `null` when dropping after the last card.
- The drawer and the automatic advance supply no anchor, so both currently land at the end.
- The card run/play action never moves a card, and the execution preparation never changes stage or position.

## Goals / Non-Goals

**Goals:**

- Place unanchored stage changes at the start of the destination, resolved atomically by the host.
- Keep drag placement exact, including a drop after the last card.
- Express placement as one domain value instead of the optional/nullable anchor, and remove the duplicate ordering sort.
- Keep the command, persisted transition, shared-document, and storage schemas unchanged.

**Non-Goals:**

- Changing the card run action, execution preparation, timed stage instruction, or workflow configuration.
- Adding a card-level stage selector or changing drag affordances.
- Changing how positions are persisted beyond the existing re-normalization.
- Migrating or versioning already-persisted pending transitions.

## Decisions

### Decision: Derive placement in the host from an absent anchor

`task.move` keeps only `beforeTaskId?: string | null`. The interpretation is:

| Command anchor | Intent | Result |
|---|---|---|
| absent | drawer or automatic advance, no position requested | start of destination |
| `null` | drag after the last card | end of destination |
| task id | anchored drop | immediately before that task |

The host drain maps the persisted value through one function when it calls `placeTask`. The drag client must therefore send an explicit `null` where it currently omits the field.

Why not compute the top anchor in the drawer or in the automatic-advance admission? The anchor would be captured from a snapshot read before the transition commits. On a live or team-synchronized board another card can arrive first, and the host would then reject the move with `INVALID_TARGET` for a placement the user never chose. Resolving the start inside the transaction has no staleness window.

Why not add a `placement` field to the command and to `PendingTransition`? It reads more explicitly, but it adds a protocol and persisted field, duplicates the existing anchor, and still needs a compatibility rule for transitions persisted without it. Absence already exists and already means "no requested position" — only the policy attached to it changes.

### Decision: Model placement as a domain value type

```ts
export type Placement = 'start' | 'end' | { readonly before: string };
```

A single pure mapping (`placementFromAnchor(anchor: string | null | undefined)`) lives beside it, so host and client interpret the wire anchor identically. `placeTask` receives a `Placement`; it no longer carries transport-level optional semantics, and an unknown `before` target keeps the current resilience of falling back to the end instead of failing a persisted transition at drain time.

Alternative considered: keep `beforeTaskId` in the domain and branch on `undefined`/`null` inside `placeTask`. Rejected because it makes the domain depend on wire-level absence and leaves the ambiguity that caused this bug.

### Decision: Send the anchor whenever the caller has one

`useMoveRequest.move` treats an omitted argument as "no position requested" and a supplied `null` as "end". `apply` sends the field whenever it was supplied. `board.tsx` and `BoardMoves.moveTo` stop defaulting the anchor to `null`, so the drawer's pass-through stays unanchored while drag keeps its explicit position.

Alternative considered: keep omitting `null` and let the host treat a same-stage move specially. Rejected because the same composite command would then have to infer intent from stage equality, which is less predictable than an explicit anchor.

### Decision: Preview the same placement optimistically

`OptimisticMove` carries a `Placement`. The board inserts at index 0 for `'start'`, at the end for `'end'`, and before the anchor otherwise. The optimistic value and the host use the same mapping, so the preview and the committed snapshot agree unless the destination changes while the command is in flight.

### Decision: Share one ordering comparator

`compareTaskOrder` (`position`, then `createdAt`) replaces the sort duplicated between `placeTask`, the destination and source re-normalization, and the board's visible tasks. Sorts that only renumber a column are behavior-equivalent because the comparator is a strict extension of the position-only order. The legacy board aggregate's normalization reuses it too where the sort is the same.

### Decision: Reconcile the stale stage-manipulation requirement

The `Direct stage manipulation on the board` requirement claims stage changes happen only through drag and drop, while the drawer stage control and the timed-instruction requirement already describe drawer changes. The delta updates that requirement instead of adding a parallel one, so placement is stated once per move kind.

### Decision: No migration for persisted transitions

A waiting `PendingTransition` without an anchor is dispatched under the new rule and lands at the start. Pending transitions are short-lived, and marking a legacy intent would add a persisted field for a behavior the user wants anyway.

## Risks / Trade-offs

- [External command callers that omit the anchor now get the start instead of the end] -> The change is documented on the command type, marked **BREAKING** in the proposal, and the plugin's client is updated in the same release. Callers that need the end send `null`.
- [Older client bundle with a newer host would still omit `null` for a drop after the last card] -> Client and host ship in the same bundle; no mixed-version deployment is supported.
- [Optimistic preview can disagree with a concurrently changed destination] -> The existing drag preview already has this window; the committed snapshot is authoritative.
- [An unknown anchor silently falls back to the end] -> Preserves today's drain behavior for a card removed between admission and dispatch; the host still rejects an unknown anchor at admission.
- [Spec wording is now split across two requirement revisions] -> The delta replaces the full requirement blocks, so archive keeps one authoritative version.

## Migration Plan

No data or document migration. Persisted tasks, workflows, shared documents, and pending transitions remain schema-compatible. Ship as a published-artifact change, so bump `version` in `package.json` in the same pull request. Rollback is a revert of the release: tasks already placed at the start keep their stored position.

## Open Questions

None.
