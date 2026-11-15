# Design

## Context

- A Hub is one `kanban_hubs` record: its boards (each with the normalized workflow), tasks (with stage entry, execution control, handoff, and history), notes, and schedules. The storage domain validates every record with its declared schema when the domain opens, before `HubRepository.open` can read or convert anything.
- The scripted rename replaced `deterministic` with `scripted` in a workflow column and in a task, `deterministicHandoff` with `scriptedHandoff`, and the `deterministic-execution` and `deterministic-handoff` history kinds with their `scripted` spellings.
- `parseWorkflow` already accepts the previous YAML spelling and normalizes it, so an authored `workflowYaml` needs no conversion; the persisted normalized workflow does.
- The stored schema deliberately tolerates a project that predates project keys, for the same reason: the facility validates first, and the repository backfills and persists.

## Goals / Non-Goals

**Goals:**

- Open an existing Hub record after an upgrade without losing or dropping anything.
- Convert only the stored shape, keeping cross-record validation on the current aggregate.
- Make the conversion cheap and idempotent, so a second open of a converted record does no work.

**Non-Goals:**

- Rewriting the stored document during open, bumping the domain version, or introducing a migration runner.
- Changing the authored workflow YAML, the published team document, or the opened-Hub schema.

## Decisions

### 1. Convert inside the stored schema, not in the repository

The storage domain parses the record before the repository sees it, so a repository-side conversion cannot run for an invalid record. The stored schema is the only seam with the raw value, and `z.preprocess` keeps the strict object behind it.

Alternative: a tolerant duplicate of the stored schema carrying both spellings, converted and persisted by the repository, mirroring the project-key backfill. Rejected as the primary shape: it duplicates the board, workflow, task, and history schemas, and every future rename would add another variant.

### 2. Convert by pure, identity-preserving rename

`normalizeLegacyHubRecord` returns a new record only when it converted something; otherwise it returns the same reference. That keeps the conversion idempotent and lets a test distinguish "already current" from "converted", and it means a current record cannot be rewritten just by being opened. A field that already carries the current name wins over the previous spelling, so a partially written record converges instead of conflicting.

### 3. No eager rewrite and no schema-version marker

The converted record is persisted by the next ordinary save. Nothing on the open path depends on the stored spelling again, and a record that is never written stays readable because the conversion is part of the decoder. An eager rewrite would add a write on every start of an upgraded installation and would break a downgrade to the previous build, which cannot read the current names.

Alternative: a `recordSchemaVersion` in the Hub metadata, written once with the converted keys. Rejected: it adds persisted state and a second schema surface (the domain global) for no user-visible behavior, and the decoder already makes the conversion safe on every open.

### 4. Keep the opened aggregate strict

`HubStateSchema` still rejects the previous names, so a code path that writes an old spelling into a live Hub fails loudly instead of persisting data that only the decoder can read.

## Risks / Trade-offs

- The stored file keeps the previous names until the next save. This is intentional: it keeps a downgrade readable and costs nothing on the next open.
- A hand-edited record that mixes both spellings converges to the current name. The previous value is dropped, which is the only deterministic choice; both spellings can never be valid at once.
- The conversion covers the fields this rename touched. A future rename needs its own conversion step, in the same module, beside the current one.

## Verification

- Unit tests: the conversion, the unchanged YAML, the identity for a current record, and the strict opened aggregate.
- `pnpm check`: host and client typechecks, the vitest suite, and the build.
