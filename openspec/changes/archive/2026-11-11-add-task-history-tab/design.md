# Design

## Context

See `proposal.md` for motivation and `specs/task-history/spec.md` for the behavior contract. The constraints that shape the approach:

- A task is persisted inside its Hub aggregate (`HubState.tasks`), validated by a strict task schema, and sent to the client inside the same snapshot that the drawer already consumes. The same schema validates the stored Hub and the wire snapshot, so one schema field covers storage and transport.
- Every task mutation goes through one transaction entry point, and the domain operations already receive an injected clock. The one exception is `placeTask`, which receives a monotonic millisecond identity (`enteredAt`) instead of an ISO moment.
- A stage change has a single write path: the move command only records a pending transition, and the drain calls `placeTask` inside a transaction. Automatic advances, confirmed transitions, and drawer changes all converge there.
- Worktree and context operations are already serialized by an operation journal that guards writes with the operation identity and records the phase; the settle moment is known only there.
- Tasks are never published to team storage; only board workflows and a manifest are published.
- The plugin already carries two precedent mechanisms that are *not* this: the board journal (event-sourced workflow authoring) and the progress journal (operation progress toward the drawer).
- Renaming a stage identifier already has to carry the rename into task references, and that rule is currently implemented twice.

## Goals / Non-Goals

**Goals:**

- One durable, append-only, ordered record on the task, appended exactly once per settled fact, with one module owning its shape and its appends.
- Keep the drawer section a pure function of the task plus the board workflow, so it needs no new host read, command, or fetch.
- Keep the record cheap per entry, so an uncapped record stays acceptable inside a Hub that is written whole and sent whole.
- Leave the existing status surfaces (operation, pending transition, stage instruction) as the only place that shows interim state.

**Non-Goals:**

- An audit log of conversations, delivered stage instructions, notes, or task text edits.
- Recording intermediate operation phases, pending transitions, or the act of clearing a recorded intent.
- Publishing the record to team storage, or exposing it to agent tool payloads.
- Virtualizing or paginating the table; the record is rendered whole.

## Decisions

### D1. The record is an optional field on the task

Add `history` to the task record, validated as an optional array by the existing strict task schema, so a stored Hub without it keeps parsing and needs no migration.

Rationale: the task is the aggregate that owns these facts, the drawer already receives the task, and deletion removes the record for free. Alternatives considered:

- **Per-board append-only log** (the pattern the board journal already uses): unbounded history outside the snapshot and publishable, but it needs a new storage table, a new read path, a new client fetch, and a merge story for team use. The cost is disproportionate to "stage plus time", and the table contract would not change if it later becomes the better option.
- **Deriving from existing fields**: impossible. The task stores only its current stage, an entry marker, and one recorded intent; earlier moments are overwritten.

Trade-off: every appended entry enlarges the Hub record, which is written on every transaction and sent in every snapshot. Accepted by decision (no cap). Mitigation: entries stay compact — a kind, one or two identifiers, and one timestamp, plus a failure reason only when a fact carries one — and the high-churn families (conversations, notes, text edits) are deliberately excluded.

### D2. One discriminated union and one domain module

`TaskHistoryEntry` is a discriminated union: `created`, `stage`, `intent`, `auto-mode`, `worktree`. A single domain module owns the union, the append helper, and one `record*` function per fact; call sites describe the fact, never the entry shape.

Rationale: a new kind is one union member plus one render registration, existing appends stay untouched, and validation lives in one place. Rejected alternative: separate arrays per family (`stageLog`, `autoModeLog`, `worktreeLog`) — simpler per family, but the ordered-record contract would have to be reconstructed by merging at read time, and the table's "newest first" order would depend on three arrays agreeing.

The entries carry no rendered text: the stage names, labels, durations, and reason phrasing all belong to the client presentation, so changing copy never rewrites stored rows.

### D3. Each fact is appended inside the transaction that settles it

- `created`: inside task creation, together with the initial stage.
- `stage`: inside `placeTask`, which is the only place a task changes stage — only when the destination differs from the current stage, so a reorder adds nothing.
- `intent`: inside the transition-recording operation, for a recorded or replaced destination. The clearing branch and the implicit clear during a move append nothing.
- `auto-mode`: one domain helper applies a computed next state and appends the entry, and the four callers describe which change happened. Enable/disable and the host pause compute their next state through it; the agent pause and the resume keep the hold helpers that own their state transition and append through the same record function, which remains the single writer of the record. A placement that clears a pause or hold records the resume it caused, including a same-stage reorder, because the clear is an auto mode change wherever it happens.
- `worktree`: inside the operation journal write that turns the operation final. The journal is already the only writer of operation state and guards each write with the operation identity, so the outcome and its entry cannot be separated or duplicated. A deletion outcome is not recorded here because the record itself is removed with the task, and a return to the base project is not one of the outcomes the record carries.

### D4. Entries carry the domain clock's ISO moment

`placeTask` gains the ISO moment alongside the monotonic `enteredAt` it already takes; the monotonic value stays the stage-entry identity the instruction marker needs. Every other append uses the injected clock the domain already has.

Rationale: one time representation in the schema, directly sortable and directly displayable, and the monotonic identity keeps its own job.

### D5. Rename migration is unified before it is extended

The rule that carries a renamed stage identifier into a task's references is currently duplicated: the domain exposes it and the sharing service re-implements it. Extend the domain function to rewrite the recorded entries and delete the duplicate, so both the stage-edit path and the team-update path run one implementation.

Rationale: the record adds a third and fourth place where the same rule would otherwise be copied.

### D6. Client: a section, a pure view model, and a thin table

- The drawer's section type gains `History`; the section list puts it after Notes; the section icon switch gains its glyph and keeps its exhaustive typing.
- `history/history-view.ts` is pure: given the task, the board workflow, and "now", it produces the rows (label per kind, composed detail, resolved stage names, duration for stage rows). No React, no clock.
- `history/history-panel.tsx` renders the table, the empty state, and a one-minute tick while mounted so the current stage's duration stays honest.

Rationale: the panel owns layout and refresh only; the classification and formatting are testable without a DOM; the drawer component does not grow another concern. Rejected alternative: render the table inline in the drawer alongside the other sections.

The table keeps table semantics: a header row with column scope, an accessible name identifying it as the task's history, and a `<time>` element carrying the machine-readable moment.

### D7. Task tool payloads project the record away

The tools that list or read tasks return the task without its record, through one shared projection used by both, so a long-running task never carries its whole history into a model's context.

### D8. Rolling back keeps the field readable

Because the task schema is strict, a rollback that also removed the field would reject a Hub already carrying it. Rollback therefore removes the section and the appends but keeps the field readable in the schema, and a follow-up release drops it once no installation carries rows.

## Risks / Trade-offs

- **Unbounded growth inside a Hub that is written and sent whole** → compact entries, excluded high-churn families, and an explicit fallback: if a record ever becomes a size problem, moving it to a per-board log changes no table behavior, only the read path. Verify the final size of a long-lived task in the browser check.
- **A fifth auto-mode mutation bypassing the helper** → the helper is the only way to change auto mode; add a domain test that asserts each of the four callers appends exactly one entry.
- **Divergence between the domain move and the test support that mirrors it** → make the test support call the domain operation instead of re-implementing placement, or delete the mirror.
- **A task tool forgetting the projection** → one shared projection function used by every task-reading tool, with a test that both tools omit the record.
- **Local time in assertions** → the browser lane must pin the timezone (and the clock when asserting a duration) instead of depending on the machine.
- **A one-minute tick re-rendering the panel** → the interval lives in the panel, is created only while the section is mounted, and is cleared on unmount.
- **Very long tables** → the section scrolls; a virtualization or pagination follow-up is recorded as an open question rather than built now.
- **A rename that reuses a removed stage's identifier** collapses a historical entry to the same identifier on both sides → the record accepts it rather than refusing the rename: refusing would block an otherwise valid stage edit, and dropping the entry would lose history. The entry keeps its kind and moment and reads as the identifier it now names; the write path still refuses a placement that changes no stage.

## Migration Plan

1. Land the schema field, the domain appends, the rename migration, and the host settle path with the section absent.
2. Land the section, the view model, and the styles.
3. Bump the installed artifact's version in the same change, per the repository's release rule.
4. No data migration: absent records stay absent, and each task records from its next settled fact.
5. Rollback: remove the section and the append calls, keep `history` accepted by the schema; a later release removes the field.

## Open Questions

- If a task's record becomes large enough to slow the drawer, should the table paginate or virtualize, and should the record move to a per-board log? Both are deferrable: neither changes the stored facts nor the table's columns.
- Should clearing a recorded next-stage intent ever become a row of its own? Deferred; today it is deliberately excluded so a move does not produce a bookkeeping row right after its stage row.
