# Tasks

## 1. Domain record

- [x] 1.1 Create `src/domain/task-history/` holding the `TaskHistoryEntry` discriminated union, the append helper, and one `record*` function per fact kind (creation, stage entry, recorded intent, auto-mode change, worktree outcome). Verify with a new `tests/domain/task-history.test.ts` covering each kind's payload, append order, and that appending never rewrites earlier entries.
- [x] 1.2 Add the optional `history` array to the strict task schema, with strict per-kind validation and an ISO timestamp per entry. Verify in `tests/domain/schema.test.ts` and `tests/domain/hub-schema.test.ts` that a stored task without the field still parses, a record with valid entries parses, and an unknown kind or missing reference is rejected.
- [x] 1.3 Verify the wire snapshot still validates: run the host tests that parse a snapshot (`tests/host/app.test.ts`) and confirm a task carrying entries round-trips through `KanbanStateSchema`.

## 2. Recording facts

- [x] 2.1 Append the creation entry, including the initial stage, in `createTask`; verify in `tests/domain/hub-operations.test.ts` that a created task starts with exactly one entry naming its initial stage.
- [x] 2.2 Append the stage entry in `placeTask` and pass the ISO moment from the drain alongside the existing monotonic entry identity; verify in `tests/domain/hub-operations.test.ts` and `tests/host/move-placement.test.ts` that one real move appends exactly one entry with origin and destination, a same-stage reorder appends none, and a refused or canceled move appends none.
- [x] 2.3 Append the intent entry in the transition-recording operation for a recorded or replaced destination, and append nothing when it is cleared; verify in `tests/domain/hub-operations.test.ts` and `tests/host/transition-tools.test.ts` that record and replace each append one entry and a clear appends none.
- [x] 2.4 Introduce the single auto-mode helper that applies the state change and appends the entry, and route enable, disable, host pause, agent pause, and resume through it; verify with a domain test that each of the four callers appends exactly one entry, that a pause entry carries its reason, and that two identical pauses append two entries.
- [x] 2.5 Append the worktree outcome entry at the operation settle point in the operation journal, for created, attached, removed, and failed, carrying path, branch, and the failure when present. Verify in `tests/host/worktree-*` and `tests/host/destructive-operation` tests that an intermediate phase appends nothing, each settled operation appends one entry, and a task deletion appends nothing.
- [x] 2.6 Verify that no excluded fact appends: run the domain and host suites after adding assertions that attaching or closing a conversation, delivering a stage instruction, saving or deleting a note, editing title or description, and waiting on a pending transition each leave the record unchanged.

## 3. Stage renames

- [x] 3.1 Extend the domain rename rule to rewrite `history` stage references, delete the duplicate rule in the sharing service, and call the domain rule from both the stage-edit path and the team-update path. Verify in `tests/domain/stage-update.test.ts` and a sharing test that both paths rename recorded entries while preserving each entry's kind, moment, and order, and that no entry is appended by a rename.

## 4. Client presentation

- [x] 4.1 Add the pure view model `src/client/history/history-view.ts`: row label per kind, composed detail (origin and destination, recorded destination marked as an intention, checkout path and branch, pause reason), stage names resolved from the board workflow, newest-first order, and duration only for stage rows. Verify with `tests/client/history-view.test.ts` using a fixed clock and an explicit timezone, including a removed stage and the empty record.
- [x] 4.2 Add `src/client/history/history-panel.tsx` rendering the table (When, Event, Detail, In stage), a caption naming the task, `<time>` elements with machine-readable timestamps, the empty state, and a one-minute refresh while mounted. Verify with `tests/client/history-panel.test.tsx` for the column set, newest-first order, empty state, placeholder in non-stage rows, and the refreshed current-stage duration.
- [x] 4.3 Wire the section: extend the drawer section type, place History after Notes, add its icon and keep the exhaustive switch, and render the panel from the drawer. Verify in `tests/client/drawer-header.test.tsx`, `tests/client/state.test.tsx`, and `tests/client/board.test.tsx` that the History tab exists after Notes, that selecting it keeps the drawer open, and that existing sections are unchanged.
- [x] 4.4 Add table styles using host theme tokens for both color schemes. Verify with a new `tests/browser/history.spec.ts` under `pnpm test:browser` asserting the rendered tokens and contrast in light and dark, with screenshots written under `.verification/`.

## 5. Task tool payloads

- [x] 5.1 Add one projection that returns a task without its record and use it in the tools that list or read tasks. Verify in `tests/host/board-tools.test.ts` that a task with entries is returned without them by both the list and the single-task tool.

## 6. Test support, docs, and release

- [x] 6.1 Make `tests/support/in-memory-board.ts` delegate placement to the domain operation instead of mirroring it, so the fake board records the same entry. Verify the suites that use it (`tests/client/*`, `tests/host/move-placement.test.ts`) still pass and that a fake-board move appends one entry.
- [x] 6.2 Update the README drawer walkthrough to include the History section and what it records. Verify the walkthrough lists the sections in the order the drawer presents them.
- [x] 6.3 Bump the package version in `package.json` for the artifact this change installs, and verify `pnpm run build` reports the new version.

## 7. End-to-end verification

- [x] 7.1 Install dependencies and run the fast gates: `pnpm install` then `pnpm check` (host and client typechecks, vitest, build) must be green.
- [x] 7.2 Run the plugin-owned browser harness (`pnpm test:browser`) and the isolated real-composition lanes that exercise the drawer (`node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --check --only board`, then `--only conversation`), keeping evidence under `.verification/`.
- [x] 7.3 On an isolated instance, create a task, move it through two stages, record a next-stage destination, pause auto mode, and create a worktree; confirm the History table shows one row per settled fact in reverse order with the stage durations, and that clearing the recorded destination adds no row.