# Proposal

## Why

The release that renamed the deterministic execution fields to scripted ones changed the persisted Hub record without accepting the names the previous build wrote. The workflow parser kept accepting the previous YAML spelling, so authored boards upgrade, but the stored normalized workflow, the task's control and handoff, and the task-history kinds still carry the previous names. The storage domain validates every record before the repository can open it, so an installation that updates with an existing board fails to open the Hub at all: `domain 'kanban_hubs': stored record '<id>' in table 'hubs' does not match its schema`. The board is unreachable until the record is repaired by hand.

## What Changes

- Read the previous execution field names when a stored Hub record is opened: a stage's `deterministic` definition, a task's `deterministic` control and `deterministicHandoff`, and the `deterministic-execution` and `deterministic-handoff` task-history kinds.
- Convert those names to their current `scripted` equivalents before the stored record is validated, so the repository, the board, and the model-facing tools receive the current aggregate.
- Keep the authored workflow YAML untouched: the YAML parser already accepts the previous spelling, and the opened workflow still matches it.
- Leave a current record as the same value, so opening an upgraded Hub rewrites nothing; the next ordinary save persists the current names.
- Keep the opened Hub aggregate strict: the previous names are accepted only in the stored shape, never in a validated aggregate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hubs`: adds the stored-record compatibility requirement, covering a record written before the scripted rename, the unchanged authored YAML, and the no-rewrite path for a current record.

## Impact

**Host**

- `src/domain/legacy-hub-record.ts` (new): identity-preserving conversion of one stored Hub record from the previous execution names to the current ones.
- `src/domain/hub-schema.ts`: the stored-record schema runs the conversion before its strict object, so the storage domain accepts an upgraded record; the opened-Hub schema is unchanged.

**Dependencies**

- None. No DSH change and no domain-version bump: the record keeps schema version 1 and the conversion is a read-time decoder.

**Tests and evidence**

- Unit tests for the conversion: a record written before the rename opens with its boards, tasks, notes, and history intact; the authored YAML keeps its spelling; a current record is not converted; an opened Hub rejects the previous names.
- The fast gates (`pnpm check`) pass.

**Out of scope**

- Rewriting the stored document eagerly on open, adding a stored schema-version marker, or changing the published team document.
