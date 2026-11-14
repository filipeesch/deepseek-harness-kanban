# Proposal

## Why

A workflow architect spent a long working session with the board tools and lost most of its effort to tooling friction instead of design work. It could not learn why a scripted step's saved result was stuck, because no tool reported the execution state at all. A single accepted write returned more than 100 KB, mostly the unchanged text of a field, so the agent had to extract the result to a file and compare it with Python. Among 10 to 33 literal edits in one call, a missing or repeated anchor failed with a message that named neither the edit nor the line, and the only way to find it was trial and error. Every write required re-reading the Hub revision because it moved for unrelated task edits on other boards. And the warning list was dominated by prose words that happen to match stage identifiers.

Three of these defects are silent rather than loud, which is why they cost the most: the revision log re-seeds itself at revision 1 when its record is missing and cannot tell that apart from a new board, and its revision numbers are journal sequences that are renumbered when the log is folded. Meanwhile every board tool write publishes to team storage automatically when the Hub is bound, which turns an agent's draft into team-visible configuration without the operator asking.

## What Changes

- Add `get_script_execution`, a read-only tool that reports one task's scripted-step phase, the reason a saved result is held, the captured parameter values and executable version, restart count, the chosen exit and destination, and the last executions. Card payloads stay unchanged.
- Add an optional `expect_sha256` to every workflow write, verified against the exact bytes about to be stored; a mismatch refuses the write and persists nothing. Every accepted write reports the digest of the document it stored.
- Add a response `detail` mode: `summary` by default (stages changed, the names of the fields that changed, the digest, grouped warnings, authorization impact, affected cards) and `full` for the current per-field payload.
- Add `dry_run` to every workflow write and a standalone `validate_workflow` that reviews a supplied document without a board change.
- Extend `edit_board_yaml` so each edit may name the stage and field it targets, and so a failed anchor reports the edit index, the occurrence line numbers, and the closest matching text. **BREAKING**: a successful or refused write reports a `sharing` outcome of a local save rather than a publication.
- Add `set_stage_script`, a partial write over one stage's deterministic configuration: language, source, directory, environment names, declared parameters, and named exits, changing only the parts the call names.
- Rebase a workflow write onto the document the board holds at write time when every anchor still matches, instead of refusing because the Hub revision moved for unrelated reasons. A real conflict reports the current revision and what changed on the target board.
- Match stage identifiers in instructions only when they are cited explicitly, demote a plain prose mention to an informational observation, and group and de-duplicate every warning. Report authorization impact once per deterministic stage instead of once per project.
- Add cross-stage lint: a destination stage that declares a parameter its origin stage's instruction never names, and a card parked in a stage that declares parameters it has no values for.
- Add `test_script`, which runs one stage's authored program against a declared input and a simulated `tools.bash`, returning the chosen exit, the message, the destination, the recorded shell calls, and any error, without capturing, approving, routing, or moving anything.
- Give the local revision log a creation baseline, reconcile it against the stored document, number revisions with a counter that never renumbers, and declare the storage version compatibility that today silently treats an unreadable record as an absent log.
- Add `diff_published_board`, a read-only comparison between a board's local document and the version this installation last applied from the team.
- **BREAKING**: stop publishing board changes from tool writes. A tool write is local and leaves the board as a draft; publishing stays a manual operator action in the interface, as the shipped preset guidance already states. Because a removal's local-or-team scope is itself a publishing decision, a tool refuses to remove a team-bound board and points the operator at the interface.
- Report each stage's instruction size, and the script's source size, in the write summary, so an oversized instruction is visible before it is saved.

## Capabilities

### New Capabilities

None. Every behavior below belongs to a capability the project already specifies.

### Modified Capabilities

- `product-tools`: the declared agent tool surface gains `get_script_execution`, `set_stage_script`, `validate_workflow`, `test_script`, and `diff_published_board` for the workflow architect preset; `edit_board_yaml` accepts a target scope per edit, a digest expectation, and a response mode; the write result's publishing outcome changes; and a board tool write no longer publishes.
- `workflow-authoring`: writing a workflow document gains scoped anchors and indexable anchor failures, an expected-digest refusal, a dry review, a summary report shape, cross-stage lint, instruction size, and one partial write over a stage's deterministic configuration.
- `workflow-revisions`: the local change log gains a creation baseline, startup reconciliation against the stored document, revision identity that survives folding, and an explicit storage-version compatibility contract.
- `hub-sharing`: a board-owning tool write is local only and leaves the board a draft; a read-only comparison between the local board and the last applied team version becomes available to the workflow architect.
- `deterministic-steps`: an agent can read one task's scripted execution state and the reason a saved result is held, and can run a stage's authored program in an isolated test execution that simulates the shell and never captures, approves, routes, or moves a card.

## Impact

- Tools: five new tool definitions, all gated to the `kanban-workflow-architect` preset; changed parameters and result shape on `edit_board_yaml`, `update_board`, `create_board`, and every stage-authoring tool.
- Host: `BoardAdministration` publishing policy for the tool path, revision storage format and startup reconciliation, the deterministic supervisor's read projection and a new isolated test execution, and card-independent script execution.
- Specs and docs: `hub-sharing`'s automatic-publishing requirement is replaced; the preset skill and its three references are at the 7,000-character ceiling, so tool guidance is rewritten rather than appended, and `README.md` and `docs/deterministic-steps.md` follow.
- Tests: the existing tool-publishing tests invert their expectation; card projection tests stay unchanged; new coverage for every real case in the source report.
- Compatibility: a team-bound Hub stops receiving agent writes automatically, so an operator must publish after an agent edits a board. Revision numbering changes for existing logs, which migrate on first read.
