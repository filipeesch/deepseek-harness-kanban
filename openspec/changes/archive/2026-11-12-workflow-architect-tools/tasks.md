# Tasks

## 1. Shared diagram geometry

- [x] 1.1 Create `src/domain/diagram/` and move `routing/{orthogonal,ports,clearance,automatic,route}.ts` into it unchanged except for import paths; verify `pnpm typecheck` passes and the diff shows no logic change.
- [x] 1.2 Move the layer placement, automatic placement gate, and scene assembly into the same module; verify the existing client tests under `tests/client/` pass without edits.
- [x] 1.3 Repoint every client import to the moved modules and delete the old files; verify no file under `src/client/` imports a routing or scene module from `workflow-view` any more and `pnpm test` passes.
- [x] 1.4 Add the stage-height estimate (`max(authoredHeight, header + gaps + cards × cardHeight)`) with its constants in one module and card counts from the scene; verify a unit test covers zero, one, and many cards and that the authored size stays the floor.
- [x] 1.5 Add a browser test that renders representative stages through the real components and asserts the estimate stays within the documented tolerance; verify `pnpm test:browser` passes and that perturbing a constant makes the test fail.

## 2. Write pipeline and report

- [x] 2.1 Add a non-throwing document diagnostic that reports every parser problem with its line and column; verify a unit test returns two problems with positions for malformed YAML and that the accepting parse path is unchanged.
- [x] 2.2 Add the semantic per-stage difference between two documents, covering transitions, named exits, entry instruction, placement, size, group membership, board name, initial stage, and connection layouts; verify one unit test per field.
- [x] 2.3 Add the graph warnings — unreachable stage, non-terminal stage with no outgoing route, connection layout naming a pair the workflow does not draw, stage outside every group, instruction naming an undefined or unpermitted stage; verify one unit test per warning.
- [x] 2.4 Add the affected-card computation returning identifiers and counts only; verify a unit test covering cards in a removed stage and cards whose recorded route was removed, asserting no title or description appears.
- [x] 2.5 Compose the report value and its pipeline entry point in the domain, with bounded warning lists and a remainder count; verify a unit test asserting the shape and the cap.
- [x] 2.6 Make the workflow write path compose, validate, report, and commit as one step, persisting nothing on refusal; verify a host test where a refused write leaves the stored text and Hub revision unchanged and returns the report.
- [x] 2.7 Return the report from `edit_board_yaml`, `update_board`, and `create_board`; verify tool tests assert the report on success and on refusal without changing stored state.

## 3. Deterministic script impact

- [x] 3.1 Extract capture planning from the capture store so directory resolution, file source reading, environment and parameter collection, and exit mapping are available without writing immutable blobs; verify the existing capture tests pass unchanged.
- [x] 3.2 Add the script-impact port that resolves each allowed project's directory and returns, per deterministic stage, whether a review still holds; verify unit tests for changed source, changed exits, changed destinations, changed environment names, and a changed working-directory choice.
- [x] 3.3 Report an unresolvable directory as "cannot verify" and a task-scoped stage as depending on the card's worktree; verify unit tests for both.
- [x] 3.4 Wire the port into the write pipeline; verify a host test where retargeting an exit reports that the authorization no longer holds in every allowed project and names the reason.

## 4. Transition origin

- [x] 4.1 Add the optional origin to the stage-entry record and to the entry-writing helper; verify a stored entry without it still decodes and a new one round-trips.
- [x] 4.2 Thread the origin from the pending transition, distinguishing an operator move, a declared transition, and an automatic advance; verify one host test per origin.
- [x] 4.3 Thread the origin from the deterministic router including the named exit, and record the reserved error route as such; verify deterministic tests for both paths.
- [x] 4.4 Present the origin in the History detail; verify a client test asserting each origin renders distinctly and an unrecorded origin reads as unrecorded.

## 5. Local board log and revisions

- [x] 5.1 Define the log record — snapshot text and sequence, ordered events, and a commit index carrying moment, author, origin, and seq range — in a new local storage domain; verify a round-trip test opens, writes, reads, and closes it.
- [x] 5.2 Append exactly one commit after each accepted workflow write, attributing a tool write to the calling session and a GUI write to the operator; verify host tests for both.
- [x] 5.3 Add the replay-equality check: apply the derived events to the previous text, compare with the authored next text, and record one whole-document event when they differ; verify a test that recreates a stage entry and restores byte-identical text.
- [x] 5.4 Add retention folding by commit count, keeping the most recent documents recoverable, and report the number of revisions that are no longer retained; verify a test that overflows the bound and reads the boundary.
- [x] 5.5 Verify a refused write appends no commit and that deleting a board removes its log; two host tests.
- [x] 5.6 Implement `list_board_revisions` with a limit and a continuation; verify tool tests for the newest page, the continuation without gap or repeat, an unedited board, and the retained boundary.
- [x] 5.7 Implement `diff_board_revisions` on top of the semantic difference; verify tool tests for a changed stage, an added stage, an identical pair, and an unretained revision.
- [x] 5.8 Implement `revert_board` requiring confirmation and the observed Hub revision, saving through the write pipeline as a new commit; verify tool tests for a successful revert, the earlier revision staying listed, a refusal that would strand cards, a stale revision, and a missing confirmation.

## 6. Authoring tools

- [x] 6.1 Implement `get_board_yaml` with line offset and limit, total line count, continuation offset, and a private file path holding the exact text; verify tool tests for exactness including comments, a paged continuation, the file path content, and an unknown board.
- [x] 6.2 Implement `get_stage` with the source withheld as byte length and digest, and returned on request; verify tool tests for the withheld shape, the returned source, exactness of the rest of the block, and an unknown stage.
- [x] 6.3 Implement `set_stage_prompt`; verify tests for setting, clearing, and preserving a neighbouring comment and unrelated stages.
- [x] 6.4 Implement `set_stage_routes` for transitions, distinguishing an empty list from an omitted one, and for named exits without touching source, environment, parameters, or directory; verify one test per case plus an unknown destination refusal.
- [x] 6.5 Implement `set_layout` for placements, sizes, and connection entries including clearing an entry; verify tests for setting, clearing, preserving omitted entries, and rejecting a stale revision.
- [x] 6.6 Implement `add_stage` with insertion after a named stage or at the end; verify tests for both positions, a duplicate identifier, an invalid block, and an unknown neighbour.
- [x] 6.7 Implement `remove_stage` with reference cleanup, a cards refusal naming identifiers and counts, an initial-stage refusal without a replacement, and a confirmation requirement; verify one test per case.
- [x] 6.8 Remove the authored document from `get_board_summary` with `include_workflow`; verify the tool tests assert the field is absent and that `get_board_yaml` returns the same text with the same Hub revision.

## 7. Insights tools

- [x] 7.1 Implement route statistics per drawn transition with counts by origin; verify a test over a seeded history with four origins.
- [x] 7.2 Complete the statistics with configured exits including unused ones, stage entries and mean and p90 dwell, cards parked now, per-card loops, and configured routes unused in the window; verify one test per group.
- [x] 7.3 Add the window and project filters and assert the payload carries no card title, description, note, task message, or conversation content; verify a test that seeds titles and asserts they are absent.
- [x] 7.4 Render the scene to SVG in the domain; verify a golden-file test and that the drawing includes a stage per node, a path per edge, and one label per named exit.
- [x] 7.5 Add the rasterizer port with a dynamic optional import and a stated fallback; verify one test with a stub rasterizer and one without it.
- [x] 7.6 Support the card modes and the growing stage height in the render; verify a test where a stage with many cards is drawn taller than its authored size.
- [x] 7.7 Implement `layout_metrics` with crossings, segments through stages, overlapping segments, overlapping stages, covered exit labels, folds, total length, and a problem list naming identifiers; verify one unit test per metric and an agreement test with the rendered geometry.
- [x] 7.8 Attach the raster image only when the calling route declares image input; verify tests for attached and paths-only results.

## 8. Tool gating, preset, docs, and release

- [x] 8.1 Add the visibility predicate to tool registration and gate the document, stage, authoring, measurement, and revision tools on the workflow-architect preset; verify a host test asserting the tools are absent from the declarations of another agent and present for the workflow architect.
- [x] 8.2 Withhold the tools when the preset projection cannot answer; verify a test with an unavailable projection.
- [x] 8.3 Mount the tool set in an isolated DSH composition and confirm the tools appear for the workflow-architect preset; verify with the isolated profile from the repository instructions.
- [x] 8.4 Rewrite the bundled `kanban-workflow-design` skill and its `operations` reference to the new read and write paths, removing the superseded `get_board_summary` guidance; verify the persona stays under 4,000 characters and each skill and reference under 7,000.
- [x] 8.5 Verify the rasterizer is detected at runtime: a provided one produces PNG, an unresolved one degrades to SVG with a stated reason, and record why the manifest does not declare it.
- [x] 8.6 Bump the plugin version and verify `pnpm check` passes.

## 9. Verification

- [x] 9.1 Run `pnpm check` and confirm host and client typechecks, the full test suite, and the build pass.
- [x] 9.2 Run `pnpm test:browser` and confirm the estimator guard, the origin presentation, and the existing appearance checks pass in light and dark.
- [x] 9.3 Run the isolated real-composition lane with `DSH_SNAPSHOT=replay` for the board scenario and record the evidence under `.verification/`.
- [x] 9.4 Update the product documentation that describes the tool surface and the deterministic authorization model; verify no document still teaches the removed `get_board_summary` payload or a dry-run mode.