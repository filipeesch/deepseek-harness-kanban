# Proposal: Kanban Product Inside DeepSeek Harness

## Why

Bring Railyin's delivery-management UX into DeepSeek Harness (DSH), making a global Kanban board the center of task work while retaining native DSH conversations and execution. This proposal captures the October 21, 2026 requirements interview; it plans the product without implementing it.

## What Changes

- Deliver an independent DSH plugin, without core changes. Add a **Kanban** main page and sidebar item alongside Automation tasks and Plugins. Do not change DSH startup behavior. Put project and workflow configuration inside the Kanban page.
- Provide one global, multi-project board with text search, project filtering, editable task details, YAML workflows, grouped columns, and allowed transitions. Start with **Backlog / Plan / In Progress / In Review / Done**, with no entry instructions enabled by default. A top-level **New task** action creates in the configured initial column without starting an agent.
- Retain a project registry with distinct Git root and project path, including monorepos. A task's effective agent directory is its project path or the equivalent subdirectory in its worktree. DSH workspace grouping is not the same as effective working directory.
- Open cards in a task drawer with **Conversations / Info / Git / Notes**. Conversations contains one initial native DSH chat and a **+** action for additional continuous conversations. All task chats share its effective directory and retain their histories.
- Keep worktrees optional. Show a prominent Create/Dismiss notice above chat when absent; support new/existing branches and attachment of an existing external worktree through Git. Wait for all task conversations to become idle before switching their directories; removing only the worktree returns them to the base project path. Native workspace grouping and Files may remain at the original location in this version.
- On entry to an instructed column, offer **Move and run / Move only / Cancel**. Running requires confirmation and selection of an existing or new conversation; worktree creation remains optional.
- Show execution activity separately from coexisting task indicators: blue for unread messages, orange for awaiting a reply, and red for failure.
- Expose board read/create/edit tools only. Writes require an explicit user request, without another approval dialog. Board tools and rich question forms also work in ordinary DSH chats.
- Port rich, paginated question rounds as an alternative way to compose a textual reply. Users can close the form and reply normally. Do not add a decision ledger. Port Markdown notes shared by the task, not by individual chat.
- Support archive/restore and permanent task deletion. Deletion removes plugin-owned task data and the worktree, archives the associated native DSH conversations without erasing their histories, and keeps the branch. The confirmation states these effects; discarding local changes requires additional explicit confirmation.

## Capabilities

### New Capabilities

- `harness-navigation`: plugin entry point, main-page access, local configuration, first use, and native-chat integration boundaries. ([spec](<specs/harness-navigation/spec.md>))
- `kanban-board`: global board, YAML workflow, task creation/editing, transitions, search, and independent activity/attention indicators. ([spec](<specs/kanban-board/spec.md>))
- `project-contexts`: project registry, Git root/project path separation, DSH workspace semantics, and monorepo directory mapping. ([spec](<specs/project-contexts/spec.md>))
- `task-conversations`: task drawer, native conversation tabs, shared directory, and retained session identity/history. ([spec](<specs/task-conversations/spec.md>))
- `worktree-management`: optional worktrees, creation/attachment, coordinated directory changes, policy-aware errors, and independent removal. ([spec](<specs/worktree-management/spec.md>))
- `product-tools`: permitted board operations and availability inside and outside task chats. ([spec](<specs/product-tools/spec.md>))
- `structured-questions`: rich question rounds that submit ordinary textual responses without a separate decision lifecycle. ([spec](<specs/structured-questions/spec.md>))
- `task-notes`: task-scoped Markdown notes and corresponding UI/tools. ([spec](<specs/task-notes/spec.md>))
- `task-lifecycle`: archive/restore, permanent deletion, retained branches, and explicit destructive-action consent. ([spec](<specs/task-lifecycle/spec.md>))

### Modified Capabilities

None. This project had no capability specs before this change.

## Impact

The future plugin adds host-side task/project/worktree state and client-side navigation, board, drawer, forms, and configuration. It integrates with native DSH sessions, working-directory, renderer, tools, activity, and permission services rather than replacing the agent loop. All planning artifacts and future source code use US English (`en-US`), as required by [project instructions](<../../../../AGENTS.md>).

The installed DSH `0.2.1-rc.2` contains real main-page/sidebar extension points and an embedded native-conversation consumer. It does **not** provide a ready-made multi-session directory transaction or a persistent additional-worktree permission grant. The design must preserve sandbox policy, report incompatible destinations, and verify the identified integration seams. No changes to the installed app or Railyin reference are authorized.

## Scope Exclusions

No multiple boards, WIP limits, own TODO checklist, decision ledger/record tools, agent tools to move/delete/message cards, rich code review, full Git operations, terminal/editor integrations, activity/worktree filters, startup override, or new card-to-main-chat navigation shortcuts. Existing native DSH features remain available; excluding a Railyin implementation does not remove a Harness feature. Card dependencies, priorities, labels, due dates, and assignees have not been approved.

## Evidence, Inventory, and Planning Status

Railyin reference: [public source](<https://github.com/filipeesch/railyin/tree/a25520f4c5a91c24b359fce34ce9f553b9d6823c>), revision `a25520f4c5a91c24b359fce34ce9f553b9d6823c`; clean working tree when recorded. Evidence is static inspection of source, contracts, and tests, not a running-app UX verification. The detailed reference inventory, observed-versus-target differences, DSH seams, risks, and explicitly labeled planning assumptions belong in the [design](<design.md>). Requirements belong in this change's capability specs.

The user initially authorized planning and subsequently requested implementation, verification, independent review/corrections, spec synchronization/archive and publication. On October 22, 2026 the user approved an extension-point verification boundary: validate this plugin rather than re-test DSH conversation/model/scheduler internals. Preserve the functional requirements and document unsupported host states honestly. Use the existing DSH GUI, no replacement server or core changes. The separate UX issue list belongs to the next change. Publication targets the user-confirmed public repository `filipeesch/deepseek-harness-kanban`.
