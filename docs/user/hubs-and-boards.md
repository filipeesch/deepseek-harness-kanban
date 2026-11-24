# Hubs and Boards

A **Hub** is a logical group of projects and boards. It has a name only: no filesystem root and no native DSH workspace. Projects belong to one Hub, and every task belongs to one board and one project in that Hub.

Boards are selected inside the active Hub. Each board owns its own YAML workflow, its own project scope, its own defaults, and its position in the board order.

The active Hub and the last board used per Hub are remembered in browser local storage. An installation always has at least one Hub, and the last Hub cannot be deleted.

## Hub scope and deletion

A board with no recorded scope accepts tasks from every project of the Hub. A board can instead allow only chosen projects, and a board that allows none accepts no new task. The scope lives on the board, never in the workflow YAML, and the **New task** dialog offers only the projects the active board allows. A scope names each project by the identity the board records, which a received board keeps naming as its team published it; [Team sharing](team-sharing.md) owns how a received identity is answered.

Deleting a Hub is allowed only when none of its boards has a task. It removes the Hub's empty boards and task-free project registrations without deleting project directories, worktrees, branches, native conversations, or native workspaces. The worktree base path is global and survives.

Deleting a board keeps the registered projects, worktrees, conversations, and native workspaces it referenced; a placeholder only that board named is dropped. A board that belongs to the published team configuration asks whether the removal applies only here or for the team; see [Team sharing](team-sharing.md).

## Board configuration

**Configuration → Boards** lists every board of the Hub with **Edit** and **Delete**, creates boards through the same dialog the header's **+** uses, and opens one board's configuration as an overlay above the list. It also carries **Export workflows** and **Import workflows**, which act on a chosen set of boards rather than on one row; [Workflows](workflows.md) describes both. The overlay edits the board it was opened for, including a board that is not active, and its sub-sections are **General**, **Projects**, **Defaults**, **Workflow**, and **Danger zone**.

Only the topmost dialog answers Escape and pointer dismissal, and the layers below it are inert.

**General** edits the board name and its order. **Projects** edits the board's project scope, naming each project by the identity the board records and marking one that awaits adoption or was ignored. A project can be linked to a team's identity, so the same project answers both its local key and the key a received board names. **Workflow** edits the YAML and the diagram; see [Workflows](workflows.md). **Danger zone** deletes the board.

## Board defaults

A board names the defaults its conversations start on under **Configuration → Boards → Edit → Defaults**. The pane writes three root fields of the board's workflow YAML in one guarded save.

A **default model** is a `model:` mapping with `provider`, `model`, and an optional `reasoning_effort`. Choose **Host default** or **Specific model** with the mode control; DSH's native model selector stays presented in both modes and is disabled while the host default is chosen. The selector is offered only when the host composes it; otherwise the stored route is shown read-only with a notice.

A **default agent preset** is a root `agent_preset` scalar chosen from the host's roster with an explicit **Host default preset** choice. A stored preset the roster no longer offers stays presented and is kept.

An **MCP allowlist** is a root `mcp` list of `server` or `server/tool` entries. An absent list keeps every server visible to that board's conversations; an authored empty list keeps none, and the control distinguishes the two. The control offers the servers the host reports, accepts a typed entry the list cannot offer, and keeps a stored entry a host does not report. The mask applies to every agent of a task conversation on that board when it starts, including an agent created later by resume or fork, and is recomputed when the tool catalog changes; an ordinary DSH chat belongs to no board and is never masked.

Every new conversation of that board starts on those defaults unless the activated card overrides them: from a preset card, the first-execution preparation, a stage instruction, an agent tool, or a cross-card message.

When the host no longer offers a stored route or preset, or cannot apply it to one conversation, the conversation is still created and runs on the host default, with a dismissible notice naming what the board asked for. A board default never blocks a move, a preparation, or a send. The installation-wide defaults are never written by this setting.

The authored model and preset are part of the workflow and are covered by workflow conflict detection. The workflow architect reads them in the exact YAML with `get_board_yaml`, which also reports `effectiveDefaultPreset` and the origin of that choice — including a default held outside the authored YAML. [Agent tools](agent-tools.md) describes the compact summary.

New boards that author no preset start their conversations on **Kanban Workflow Operator**, a default held outside the YAML: an explicit host choice and a legacy absence remain distinct, and the author can still choose another roster preset. Existing boards and conversations are not changed.

Workflow and stage descriptions, decision gates, and the new-board preset default are part of what the team shares: they travel in the board's own log and are preserved through publishing, receiving, and revisions. Each board negotiates its format on its own, so an installation on an older plugin version reports that board as requiring a plugin update instead of applying or overwriting it, and the rest of the Hub keeps synchronizing. See [Team sharing](team-sharing.md).

While the Workflow sub-section holds unsaved edits, the Defaults controls stay available and only the save is unavailable, with a way to open Workflow.

## Board presentation and order

The board header's **Board** and **Workflow** switch selects the presentation, remembered per board in the browser. The workflow YAML's `default_view` decides which one a board opens with until you choose for that board; an omitted value opens the column board. See [Workflows](workflows.md).

A board's position is a short value ordered as text, so moving a board appends one event to that board's log. When the Hub is bound to a team storage, saving a board's name, workflow, project scope, or order changes only local state and marks the board as a draft; publishing is a separate action described in [Team sharing](team-sharing.md).
