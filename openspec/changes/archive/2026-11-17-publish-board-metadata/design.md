# Design

## Context

See `proposal.md` - Why. The relevant current state:

- The published layout is one stamp (`kanban-hub.yaml`, format 4) plus one append-only JSONL log per board. Each event carries its own format version, and `appendEvents` stamps every event with the minimum version that represents it (`eventVersion`: 3 for ordinary changes, 4 for descriptions, 5 for decision configurations, 6 for the new board default). Readers decode events one by one, so an event whose kind or version a peer does not know already refuses the whole log with `SHARING_DOCUMENT_VERSION_UNSUPPORTED`, which surfaces as a board that requires a plugin update.
- The blanket guard is three predicates in `assertLegacyShareable` and one in `requiresProtectedStorage`, evaluated at eleven call sites across `BoardSync`. `BoardSync` is a single 919-line class covering observation, application, publication, removal, orphans, connection preview, and the layout stamp, with two consumers: `HubSharingService` (ten methods) and `BindingLifecycle` (which declares the whole class but uses four methods).
- A newly created board always records `defaultPresetMode: 'operator'`; a received board has the field deleted. The field has no published representation, and the local draft rule treats its mere presence as an unpublished change.
- The local draft rule lives in `evaluateBoard` and uses three shortcuts: `defaultPresetMode !== undefined`, `hasAuthoredDescriptions(local.workflow)`, and a second `sameWorkflow` implementation that differs from the one in `board-plan`. The change list and the publish derivation use yet another comparison.

## Goals / Non-Goals

**Goals:**

- One comparison decides whether a published board has local changes, and publishing appends exactly what that comparison reports.
- The board default preset choice becomes part of the published board content, without rewriting authored YAML.
- The compatible-writer boundary is the board's own event formats, evaluated per board.
- The publishing code is decomposed so the compatibility policy, the change comparison, and each synchronization concern have one home.

**Non-Goals:**

- Changing the layout stamp version, the storage-provider boundary, or the concurrency guarantees.
- Introducing a second published artifact per board (sidecar) or moving board defaults into authored workflow YAML.
- Adding a Hub-level default preset, or reclassifying legacy boards as newly created.
- Changing the merge rules for concurrent stage edits, scripted configuration, or conflict copies.

## Decisions

### 1. The event format is the compatible-writer boundary

Each board's log is its own unit of compatibility. A peer that cannot decode one event refuses that board's log entirely, so it can neither apply nor publish over the fields it cannot read, and it reports the board as requiring a plugin update. Because `eventVersion` stamps each event with the minimum format it needs, a board that carries no new metadata keeps producing format-3 events and stays synchronizable by older installations. Removing the blanket guard therefore protects exactly the boards that carry new fields, instead of refusing every board.

Alternatives: an isolated per-board sidecar holding the new fields (keeps every log legacy-readable, but introduces two sources of truth, a per-provider file layout including a directory-less Google Drive, and its own merge rules); raising the layout stamp (a hard folder-wide cutoff, but one board with new metadata would suspend the whole Hub, which the per-board negotiation already prevents). The sidecar was rejected because the protection it buys — older peers continuing to edit the legacy part of a board that carries new fields — is not worth duplicating the workflow representation, and the layout bump was rejected because it is strictly coarser than the mechanism already in place.

### 2. The board default is one board-metadata event

The published log gains `board.preset-changed` at event format 6, symmetric with `board.renamed`, `board.scope-changed`, and `board.rank-changed`. Board metadata is folded from the board's events independently of any whole-workflow checkpoint, so recovery obtains the choice even when a checkpoint was appended later. The event is emitted only when the board records a choice, so a legacy board publishes nothing and a receiver keeps the host-default meaning; a received board that carries the event is applied as-is instead of the current deletion of the field. The choice is compared as part of the document signature and summarized in revisions, which already record preset provenance on both sides.

Alternatives: promoting the choice into authored YAML as `agent_preset` (rewrites authored text on publish, appears in every diff, and conflates "authored preset" with "board default mode"); leaving it local (loses the effective default across installations and contradicts the existing Board default agent preset requirement).

### 3. One document signature, proven equivalent to the publish derivation

A pure domain function compares two board documents — name, project scope, position, canonical workflow meaning, workflow description, stage descriptions, decision configurations, and default preset choice — and answers whether they differ. State, the change list shown by the interface, publish derivation, and revisions all consume it. The three shortcuts disappear, including the duplicated `sameWorkflow`. A test asserts the invariant that a board is a draft exactly when `deriveBoardChanges` would append at least one event, so the comparison and the published outcome cannot diverge later.

Alternatives: computing the draft state directly from `deriveBoardChanges` (correct by construction, but it parses and canonicalizes YAML for every board of every snapshot, which the board view requests often); keeping an ad-hoc comparison in `board-plan` (smallest diff, and precisely the arrangement that produced the false drafts).

### 4. Publishing a board without differences is a no-op

`publishBoard` now derives first and appends only when the derivation is non-empty; otherwise it re-reads the board against the storage, refreshes head, probe, and applied state, and reports success. The current refusal happens before any derivation, which is why a board that never changed still answered with an incompatibility error.

Alternative: a domain error naming that nothing was published (turns an idempotent convergence into a failure for tools and agents).

### 5. `BoardSync` becomes a thin facade over injected collaborators

The facade keeps the public surface used by `HubSharingService` and owns: the storage-ready guard, record loading through the session, error translation, and the sequencing of refresh. Collaborators:

- `BoardObserver`: `check`, log observation, refresh, orphan reconnection.
- `BoardApplier`: applying one or all boards, removal application, conflict resolution.
- `BoardPublisher`: single and bulk publication, position calculation, stage-identity seeding.
- `BoardRemoval`: local-only removal, removal events, pending removals, restore.
- `ConnectionOperations`: connection preview, receive preview, publish-initial, orphan publication — the only surface `BindingLifecycle` needs, declared as its own narrow port.
- `LayoutStampPolicy`: stamp creation and format negotiation.

`SharingSession` encapsulates record load/save, layout resolution, the readiness guard, and failure persistence, so a collaborator never calls the store directly and the guard stops being repeated. The compatibility policy becomes a small module the publisher and applier consult, replacing the eleven scattered call sites.

Alternatives: dissolving the facade so the service composes collaborators directly (repeats guards and ordering in every command); two halves, reader and writer (fewer files, still 400+ lines each and still mixing responsibilities).

### 6. The stored publishing record gains one optional field

`StoredBoard` gains the applied preset choice, so local and applied values can be compared. The record layout version stays 4 and the field is optional, which keeps every existing record readable. A downgrade quarantines the record exactly as any shape change does today: the binding is re-established by reconnecting, and the team's logs are untouched.

Alternatives: bumping the record version with a migration (more code, same downgrade effect); accepting unknown fields in the record schema (survives a downgrade, but weakens the strict validation that keeps invalid publishing state out of storage).

### 7. The banner reports whose work it is

The banner derives from the same evaluation: it names the active board when the change is that board's, states that another board of the Hub has pending work when it is not, offers no publish action for an untouched board, and presents a block where the action is offered rather than after it is activated.

Alternative: dropping the Hub-wide banner for a board-local indicator (less noise, more chance a pending board goes unnoticed).

### 8. Feature first, then the split, in one change

The feature ships first because a person cannot publish any board today. To keep the split from rewriting the feature, the new compatibility policy and the document signature are born in their own modules from the first commit; the split then mostly moves existing methods behind the facade and introduces the session.

Alternative: split first (cleaner isolation, but keeps the publish failure in place for another full cycle).

## Risks / Trade-offs

- **Older peers lose per-board synchronization for boards that carry new fields** → Only emit the highest event format a change actually needs; legacy-only boards keep emitting format 3. An affected board states that a plugin update is required, and the rest of the Hub keeps synchronizing.
- **A local difference that the signature misses would never be published** → The equivalence test with `deriveBoardChanges` plus the existing black-box publishing suite; any new published field must extend both.
- **Removing `requiresProtectedStorage` also accepts legacy format-3 replacements whose text carries descriptions or decisions** → Those fields are representable now, so adopting such a log is correct; the suite gains a case that applies one.
- **A downgrade quarantines the local publishing record** → Team logs and local boards are untouched and reconnecting restores the binding; documented in the recovery guide.
- **The signature runs for every board of every snapshot** → It is a pure canonical comparison with no YAML derivation; if profiling shows cost, memoize per local/applied pair rather than loosening the comparison.
- **Extraction can silently change error codes or ordering** → The sharing service suite stays the behavior contract during the split, one collaborator per step, with collaborator-level unit tests added as each is extracted.

## Migration Plan

- No data migration. The event format is additive, the layout stamp stays at version 4, and existing records stay readable.
- Boards that were stuck as drafts become publishable on upgrade; publishing them writes the events they actually differ in.
- Rollback: revert the release. Publishing records written by the new build are quarantined by the older build (reconnect to restore the binding), and boards whose logs carry format-4, 5, or 6 events report that a plugin update is required instead of being modified.
- Bump the package version in the same pull request, per the release rules.

## Open Questions

None. Every decision above was settled before this change was written; anything still unresolved would change the specs or the task breakdown, so it is not deferred here.
