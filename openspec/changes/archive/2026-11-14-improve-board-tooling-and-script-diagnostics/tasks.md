# Tasks

## 1. Read a scripted step's execution state

- [x] 1.1 Move the deterministic summary projection, the handoff reservation and acceptance, and the handoff dispatch out of `src/host/app.ts` into a host module that takes the ports the composition root already supplies; verify `pnpm test` and the host typecheck pass with no behavior change
- [x] 1.2 Build a pure execution-state projection over the task's durable scripted state, the stored hold record, and the task history, mapping each hold code to the action that clears it; verify unit tests for a held result, a running execution, a task with no execution, and a task history bound
- [x] 1.3 Declare `get_script_execution` in the architect-gated tool set and verify the tool-surface test lists it and the gate test withholds it from a non-architect session
- [x] 1.4 Verify the reported case: a saved result held by a busy conversation returns its hold code, bounded facts, exit, and destination, and the call appends no history row, no diagnostic, and no revision

## 2. Verifiable writes and a bounded report

- [x] 2.1 Compute one sha256 digest from the composed bytes before review and report it in the write result for both saved and refused writes; verify a test that re-reads the stored document and matches the reported digest byte for byte
- [x] 2.2 Accept `expect_sha256` on every workflow write and refuse a mismatch without persisting or recording a revision; verify a test that asserts the board, its revisions, and its tasks are unchanged and both digests are reported
- [x] 2.3 Accept `dry_run` on every workflow write and return the same report while persisting nothing; verify a test that compares a dry-run report with the report of the same write performed for real
- [x] 2.4 Add a `detail` mode whose default is the summary — stages changed, changed field names, counts, grouped warnings, authorization impact, affected cards, sizes — and whose full mode returns the per-field values; verify tests for both modes
- [x] 2.5 Update the write result projections and the tool descriptions so no default response carries the text of an unchanged field; verify a fixture board with thirty stages and a 100 KiB inline script produces a summary under the tool-result budget and the same write in full mode still returns the text
- [x] 2.6 Verify the reported case: the write that produced more than 100 KB now returns a summary naming the changed stages and fields plus the digest, and the stored document matches that digest

## 3. Actionable anchor failures and scoped edits

- [x] 3.1 Make the edit engine report structured failure facts instead of throwing on the first miss: edit index, failure kind, every occurrence offset and line, the stage each occurrence falls in, and the closest authored line with its line number; verify unit tests for missing, ambiguous, and last-edit failures
- [x] 3.2 Surface those facts through the refusal projection and as bounded report problems; verify a tool-level test that reads the failed index and the occurrence lines from the result
- [x] 3.3 Accept an optional stage and an optional field on each edit and narrow the match to that authored span; verify tests for a scoped match in one of two identical stages, a scoped miss, an unknown stage, and an unknown field
- [x] 3.4 Add `set_stage_script` as a partial write over one stage's deterministic configuration; verify tests for changing only the source, only the parameter declaration, only the environment names, only the exits, two simultaneous sources, and preserved comments
- [x] 3.5 Verify the reported cases: `Exit code 4 means the space is not configured` present in two stages with different indentation is scoped to one of them, and a wrong line break is reported with the failing edit index and the closest line

## 4. Rebase a composed write on a stale revision

- [x] 4.1 Re-read the board inside the write lane and recompose when the stored document changed, proceeding only when the composition still succeeds; verify tests for a successful rebase and for a composition that no longer applies
- [x] 4.2 Report the current Hub revision together with the target board's changed stages and fields when a rebase cannot proceed; verify the conflict payload in a test
- [x] 4.3 Keep a whole-document replacement pinned to the supplied revision; verify a test that refuses a stale replacement
- [x] 4.4 Verify the reported case: the revision advanced because a task moved on another board, and the workflow write still applies and reports the revision it saved

## 5. Warning precision, grouping, and authorization impact

- [x] 5.1 Match a cited stage identifier only between backticks or after an authored citation phrase, and record a plain prose token that equals a stage identifier as a separate informational observation; verify tests for a citation problem, an informational prose mention, and a stage that permits every destination
- [x] 5.2 Group and de-duplicate observations by kind, stage, and reference, and bound each group with a count of what it left out; verify a test where the same fact appears five times and is reported once with its count
- [x] 5.3 Report the executable authorization state once per deterministic stage for the board; verify a test where the board allows three projects and the stage is reported once
- [x] 5.4 Verify the reported case: an instruction containing `the`, `nothing`, and the prose words `explore`, `scope`, and `backlog` produces no routing warning while an explicit citation of an unpermitted stage still warns

## 6. Review and test without saving

- [x] 6.1 Declare `validate_workflow` over the same review the write enforces, accepting an unsaved document; verify tests for a valid document, a document with a positioned parse problem, and an unchanged board afterwards
- [x] 6.2 Build a simulated shell port whose calls resolve against declared responses in order with an optional default, and record every call with the response that resolved it; verify unit tests for a match, a default fallback, and an uncovered command that never reaches the host
- [x] 6.3 Declare `test_script` over the isolated function-body runtime with the simulated shell and without capture, trust, approval, entry, or routing; verify tests for the chosen exit, the message, the destination, the recorded calls, and parameter validation
- [x] 6.4 Verify that a test execution changes no task, entry, execution, handoff, history row, revision, workflow, or executable approval, and that no approval is requested
- [x] 6.5 Verify the reported case: a stage script that waits on CI output is debugged with declared shell responses and reports the chosen exit and destination without moving any card

## 7. Cross-stage observations

- [x] 7.1 Report a destination stage that declares a parameter its origin stage's instruction never names, naming both stages and each unnamed parameter; verify a test with a named and an unnamed parameter
- [x] 7.2 Report a card parked in a stage that declares parameters it holds no value for, by identifier and missing parameter names only; verify a test that asserts no value appears in the report
- [x] 7.3 Verify the reported case: a card left in a stage whose instruction was updated now declares a parameter and the report names that card

## 8. Truthful history, local-only tool writes, and the published comparison

- [x] 8.1 Stop publishing from the board tool path and add a publishing outcome that states that no publishing was attempted; verify the inverted tool-publishing tests and that a bound board stays a draft after a tool write
- [x] 8.2 Add a monotonic revision counter, a creation or recovery baseline, and read-time migration of existing logs without renumbering; verify tests for a new board, a reopened log, a folded log, and a migrated log
- [x] 8.3 Reconcile each board's log head with the stored document at startup and append a recovery revision when they differ; verify a test that diverges the two and reads the log afterwards
- [x] 8.4 Declare the accepted storage versions and report an unreadable record as unreadable instead of absent; verify a test with a record written in an unknown version
- [x] 8.5 Declare `diff_published_board` as a read-only comparison between the local document and the last applied team version; verify tests for a draft board, a board that matches, and an unbound Hub
- [x] 8.6 Verify the reported case: a board whose log record is absent while the Hub revision is 776 gains a recovery baseline, the listing states where history starts, and no retained revision is renumbered

## 9. Instruction size and the deployed guidance

- [x] 9.1 Report each changed instruction's character count, byte length, and estimated token count, and the script source size, in the write summary; verify a test for a changed instruction and for a stage whose source changed
- [x] 9.2 Rewrite the preset skill and its references so the new tools, the local-only publishing rule, and the write controls are covered while the persona and every reference stay under their enforced bounds; verify the bundle check that asserts those sizes
- [x] 9.3 Update `README.md` and `docs/deterministic-steps.md` for the new tools, the summary report, and manual publishing; verify no document still states that a tool write publishes automatically
- [x] 9.4 Run `pnpm check` and verify the host and client typechecks, the vitest suite, and the build all pass
- [x] 9.5 Run the isolated real-composition lane for the affected areas and verify it passes without real-model traffic
