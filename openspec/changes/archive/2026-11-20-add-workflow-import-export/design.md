# Design

## Context

See [proposal.md](proposal.md) for motivation and [specs/workflow-transfer/spec.md](specs/workflow-transfer/spec.md) for the behavior contract. This section records only the current state that constrains the approach.

A board is a Hub-owned record whose workflow lives in two synchronised fields: the authored `workflowYaml` text and its parsed `workflow` form. The Hub schema validates that they agree and that a board name is unique per Hub after trimming and case folding. Beside the document, a board carries `defaultPresetMode`, `allowedProjectKeys`, and `localStageIdentities`.

Board writes already have one owner: `BoardAdministration`. It serialises through its own tail, composes or replaces the document, records a revision, notes a local change for publishing, and refuses a document that would orphan a card's column. `HubRepository.transact` remains the authority on names, revisions, and cross-Hub ownership.

A card's relationship to a stage is held as an authored column identifier plus a stable local identity. `renameTaskStage` already rewrites the identifiers a card carries, including its stage entry, pending transition, recorded transition, pending instruction, scripted handoff, and history. `resolveStageTarget` resolves an identity back to a stage.

The product has no archive codec, no download, and no file selection today. The host exposes a directory picker only. The plugin's protocol is strict Typert with a zod codec per method, and the unary HTTP carrier accepts request bodies far larger than the 4 MB the spec permits.

## Goals / Non-Goals

**Goals:**

- Keep one board writer: an import writes through `BoardAdministration`, never around it.
- Keep the transfer format a pure domain concern, testable without a filesystem, a Hub, or a browser.
- Keep the browser's download and file selection behind a small port, so the dialogs are testable in jsdom without touching global `URL` or `FileReader`.
- Make the export deterministic, so the same Hub state produces the same bytes.

**Non-Goals:**

- Transporting tasks, notes, conversations, worktrees, project registrations, schedules, or Hub settings.
- Remapping a project scope across Hubs by project name. Only project keys that already exist in the destination survive.
- Transporting the bytes of a scripted stage's external source file.
- Making an import atomic across the document. The spec requires per-board application.
- Synchronising a Hub with another installation. Publishing already owns that, and an import is a one-shot write.

## Decisions

### Compress the payload with gzip and carry it as base64

One JSON document inside gzip gives a single versioned payload, a schema to validate, deterministic output, and no dependency. Building a ZIP or tar writer by hand was rejected: both are more code than the feature, and a ZIP would invite a reviewer to expect an archive layout with one file per board, which the format deliberately does not have. Plain JSON without compression was rejected because a Hub with many boards approaches the protocol's comfortable size for no reason.

Determinism needs three explicit choices: gzip without a stored timestamp, boards serialised in Hub order rather than map order, and every object's keys emitted in a fixed sequence rather than insertion order. `JSON.stringify` with an explicitly constructed object satisfies the third.

### Carry the whole board record, including scope and local stage identities

The document carries what the board holds that is meaningful outside the installation: name, authored YAML, recorded default-preset choice, project scope, and local stage identities. Scope and identities are carried even though the destination may not be able to use them, because dropping them at export would make the format lossy in a way the person cannot see and cannot correct.

Local stage identities travel so a board imported into a fresh installation is born with the same stable identities its source had. That matters because a scripted stage's approved destination and a card's stage entry name an identity, not an identifier; an import that fabricated fresh identities would make every future publish of that board look like a stage divergence to a peer that already knew the board.

Tasks do not travel, so nothing can arrive pointing at a card that does not exist.

### Put the format and the plan in the domain, and the archive in the host

`src/domain/workflow-transfer/` holds the document schema, its version, its bounds, and the import plan. These are pure functions over data: they parse a document, classify each entry against a Hub, propose free names, detect orphaned stages, and filter a project scope. They can be tested with plain fixtures.

`src/host/workflow-transfer/` holds gzip and base64, reading the Hub for an export, and applying a plan. Compression needs `node:zlib` and the client bundle cannot import it, so the codec stays on the host side. The client never compresses or decompresses: it downloads the exact bytes the host returned and uploads the exact bytes the person chose.

The alternative, one module doing everything, was rejected because it would put `node:zlib` behind a client-reachable import and force the format tests to run under the host test environment.

### Write the import through BoardAdministration, not a second writer

An import needs to create boards, replace workflow documents, set scopes, and record revisions. Every one of those exists in `BoardAdministration` behind one serialising tail. The import therefore adds one method there that walks the plan and, per board, performs the create or the replace inside the same enqueue the other writes use.

A parallel writer was rejected for the reasons the codebase already reflects: it would duplicate `noteRevision`, `noteLocalChange`, the orphan-column refusal, and the publishing bookkeeping, and it would give the Hub two writers whose ordering nobody arbitrates.

The per-board loop is inside the tail, so an import cannot interleave with a board write from another surface. Failures are caught per board and collected rather than thrown, because the spec requires the boards that pass to be applied.

### Model the plan explicitly and render it verbatim

The analysis returns a plan: one row per entry with its imported name, its destination kind, the existing board it targets when it conflicts, the free name proposed for a copy, the cards that would be orphaned, and the dropped project keys. The client renders that plan and lets the person override one row's settlement. Applying posts the plan's decisions back, so the host re-derives nothing from the UI and the two sides cannot disagree about which board was meant.

Re-deriving the plan at write time was rejected as an invitation to a mismatch: the Hub can change between the read and the write, and the person's settlement names a specific existing board.

### Resolve a replaced card's stage by identity, not by identifier

The orphan check already exists. What the import adds is the step before it: for each card whose column the incoming document does not define, look for an incoming stage carrying the identity that card's stage held. When one exists, the card moves to it and `renameTaskStage` rewrites every fact that names the old identifier. When none exists, the board is refused with the stage identifier and the card count.

Reusing the existing refusal keeps one product rule: nothing moves a card silently, and nothing deletes a card's stage out from under it. Implementing the refusal inside the import instead of reusing `saveBoardWorkflow` was rejected because the two would drift.

### Keep the browser transfer behind a port

The dialogs depend on a `WorkflowFilePort` with two operations: offer a document for download, and ask the person for a file. The real implementation uses a Blob URL and an anchor for download and a hidden file input for selection; a test supplies a fake. This is the project's established pattern for a host capability the client cannot assume, as `DirectoryPickerPort` already shows.

## Risks / Trade-offs

**A partial import leaves the Hub in a mixed state** → The spec accepts this deliberately. Mitigation: the result enumerates every entry, the surface stays open showing it, and the Boards list behind it is already refreshed, so the person can see exactly which boards landed.

**A scripted stage with an external file source imports as a reference to a path that may not exist** → Mitigation: export reports the advisory, and the review surface the product already defines keeps the version unapproved until a person reviews it, so the board cannot silently run an unresolvable program.

**A project scope key means nothing outside the Hub that recorded it** → Mitigation: unknown keys are dropped and reported, and an emptied scope is reported as opened. The alternative, refusing the board, would make a scope mismatch block an otherwise portable workflow.

**A 4 MB compressed document can still hold many boards and a large replace operation** → Mitigation: the limit is checked before the payload is read, decompression is bounded, and each board is applied in its own transaction so one large board cannot hold the Hub's write lane for the whole document.

**Local stage identities can collide with the destination's existing identities** → Mitigation: an imported board is a distinct board with its own identity namespace; identities are compared only within one board, so a collision across boards is not observable. A duplicate identity inside one imported document is a schema failure that blocks that entry.

**An exported board records a default preset the destination host may not offer** → Mitigation: the board keeps the recorded choice, exactly as a published board already does when it arrives with a preset the host does not report; the Defaults control presents it as unavailable rather than discarding it.

## Migration Plan

No stored data changes shape. The new document format is versioned from its first release, and a version this installation does not understand is refused with an actionable problem rather than parsed optimistically. No existing board, task, note, project, schedule, revision, or published layout is read differently. Rolling back is removing the two section-level actions and the new modules; every board an import created or replaced is an ordinary board, and every revision it recorded is an ordinary revision.

## Open Questions

None. The transfer format, the conflict settlement, the card-placement rule, the project-scope rule, and the size limit are settled; the remaining implementation choices are file-level and do not alter the specs or the task breakdown.
