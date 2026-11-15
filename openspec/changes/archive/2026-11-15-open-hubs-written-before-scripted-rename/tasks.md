# Tasks

## 1. Stored-record conversion

- [x] 1.1 Add `src/domain/legacy-hub-record.ts` with an identity-preserving conversion of one stored Hub record: a stage's `deterministic` definition, a task's `deterministic` control and `deterministicHandoff`, and the `deterministic-execution` and `deterministic-handoff` history kinds become their `scripted` equivalents. Verify unit tests cover the conversion, the current-field precedence, and the unchanged record.

- [x] 1.2 Run the conversion inside the stored-record schema in `src/domain/hub-schema.ts` before its strict object, leaving `HubStateSchema` strict. Verify a stored childless project, an unknown key, and an opened Hub with a previous name still fail.

## 2. Tests

- [x] 2.1 Add `tests/domain/legacy-hub-record.test.ts`: a record written before the rename opens with its boards, tasks, and history intact; the authored YAML keeps its spelling; an opened Hub rejects the previous names; a current record is returned unchanged. Verify the file passes with `pnpm test`.

- [x] 2.2 Confirm the workspace's real record (a board with scripted stages and history) opens through the stored schema and the opened-Hub schema. Verify `pnpm check` and the production record both parse.

## 3. Documentation

- [x] 3.1 Add the stored-record compatibility requirement to `openspec/specs/hubs/spec.md` and state the no-rewrite behavior; no README or preset change is required.
