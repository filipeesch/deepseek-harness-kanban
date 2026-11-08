# Proposal

## Why

Agents can already discover Hubs and boards and read board-scoped tasks, but board administration remains UI-only. A user who asks an agent to create a board, change a stage prompt, adjust allowed transitions, or remove an empty board must leave the conversation and use **Configuration**. This change lets an agent perform those explicitly requested board changes from an ordinary DSH chat, reusing the same domain validation, workflow parser, deletion rules, and team publishing semantics as the board UI.

## What Changes

- Add four product tools: `create_board`, `update_board`, `delete_board`, and `edit_board_yaml`.
- Extend `get_board_summary` with an optional workflow payload: the exact authored workflow YAML, the parsed workflow, the Hub revision, and the board's publishing state.
- Allow board writes only from an ordinary DSH chat. A session owned by a task, including its subagent descendants, is rejected with an actionable error. Board reads remain available everywhere.
- Support two workflow write paths: whole-document replacement through `update_board`, and atomic literal partial edits through `edit_board_yaml`. Every path is validated by the existing workflow parser and the existing orphaned-stage rule before anything is persisted.
- Require `confirmed: true` and an empty board for `delete_board`. A team-bound board also requires an explicit `local` or `team` removal scope.
- Publish board changes automatically when the board's Hub is bound: continuous storage relies on its automatic synchronization, and an explicit Git binding publishes immediately. A publish failure never rolls back the local write; the result reports the publishing state and problem.
- Accept an optional `expected_revision` on board updates, workflow edits, and board deletion.
- **BREAKING**: remove the deprecated `workflow.save` command and its remote schema. The workflow editor emits `board.workflow.save` with an explicit Hub and board identity.
- Refactor the product tool module into focused modules and extract a board administration service shared by the tool path and the command path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `product-tools`: the approved tool surface grows to board administration; adds the ordinary-chat write guard, board workflow read and write behavior, board deletion rules, revision handling, and automatic publishing results.
- `hub-sharing`: a board administration tool publishes local board changes automatically when its Hub is bound, while the existing comparison, blocker, draft, and continuous-synchronization rules continue to govern what can be published.

## Impact

- **Tools**: four new tools plus one extended tool; the exact registered surface is asserted by the host tool tests.
- **Host**: a new board administration service owns create, rename, delete, and workflow writes and is used by both the tool path and the existing board commands; `KanbanApp` delegates instead of owning that logic.
- **Domain**: a pure workflow text-edit operation for partial edits, layered on the existing parser and `saveBoardWorkflow` validation.
- **Client and remote API**: the workflow editor sends `board.workflow.save` with explicit identities; the deprecated command leaves the shared union and the remote request schema.
- **No persistence change**: Hub state, revision, and storage formats are unchanged; no migration is required.
- **Docs and tests**: the tool table and board administration guidance in the README, plus host, domain, browser, and fake-API tests that assert the tool list and the deprecated command.
- **Release**: the package version is bumped in the pull request that ships this change.
