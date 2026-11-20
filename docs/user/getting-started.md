# Getting Started

Install the plugin first; [install](../operations/install.md) covers the repository URL, the build approval, and the built-entries check.

## First run

The installation starts with **My Hub** and a **Kanban** board. Use **+** beside the Hub tabs to create a Hub and **+** beside the board tabs to create a board; **Configuration → Hub** and **Configuration → Boards → New board** open the same flows. A new Hub starts without boards and presents **Create your first board**.

**Configuration** presents **General**, **Hub**, **Boards**, **Projects**, **Schedules**, and **Team Settings** at the same width and height, opening on **General**. The Kanban page is the working surface; configuration is where a Hub, its boards, its projects, its schedules, and its sharing connection are changed.

## Register a project

Open **Configuration → Projects**, or **Configure projects** on a board that has none. The section is a registry list; **New project** and **Edit** open the project dialog.

Choosing or typing an absolute **Project path** runs detection. A Git repository reports its Git root and a suggested default branch, taken from `origin/HEAD`, then `main`, then `master`, then the current branch. A plain directory reports that no repository was found. Detection never overwrites a field you changed, and a blank Git root registers a folder project.

Saving validates existing canonical directories and containment, and for a Git-backed project that the Git root is the repository top level. Registration does not start an agent or grant Git access.

Every project carries a stable **project key**. It is derived from the project name when the field is left empty, stays editable in the same dialog, must be unique within the Hub, and cannot be duplicated. A key change updates every board of the Hub that allows that project in the same save; renaming or relocating a project never changes the key.

The dialog also carries the project's **Worktree** policy: **Ask**, **Always create**, or **Never**. It answers the worktree question before a task's first execution. **Ask** keeps the per-task choice, **Always create** starts the task on its derived default worktree without asking, and **Never** uses the project directory, hides the missing-worktree notice, and stops withholding the first-conversation action. A project saved without a policy is **Ask**, the policy stays local to the installation, and a choice a task already recorded for itself still wins. See [Git and worktrees](git-worktrees.md).

An optional **Worktree base path** in **Configuration → General** decides where new task worktrees are created; without one, destinations derive beside the repository.

## Create the first task

**New task** sits at the top of the board's configured initial column. The dialog asks for a title, a Markdown description, and a registered project, and the project select starts empty and must be chosen explicitly, even while a project filter is active. Only the projects the active board allows are offered. A board that allows no project explains that it accepts no new task and withholds **Create task**; a project that arrived from a published board without a directory is never offered.

The dialog also offers **Auto mode** (off by default) and, only when the initial stage has an entry instruction, **Start execution now** (on by default).

Saving creates a card in the initial stage. When the start option applies, the task's default worktree is created in the background, or the project directory is used for a folder project, the first conversation is created once that worktree is ready on the board's default model and agent preset when the board names ones the host offers and on the host defaults otherwise, and the cancelable five-second countdown for the stage instruction is armed when that conversation exists. Cancel keeps the created resources. A failure leaves the card and its **play** action.

Without the start option, saving creates no conversation and starts no agent. [Execution](execution.md) describes the worktree question that precedes an instructed move or the card play action, and the background preparation that follows it.

## The task drawer

Opening a card shows its drawer. A Git-backed project presents **Conversations**, **Info**, **Git**, **Notes**, and **History**, with the card's relations in a read-only section before History; a folder project omits **Git**. Closing or reopening a tab or the drawer preserves its association and history.

A task starts with no conversation. The Conversations section presents the host's agent-preset cards, and **+** opens the same choice for the first or another conversation. For a Git-backed task without a worktree, the first conversation waits until the worktree notice is resolved: create or attach a worktree and wait until it is ready, or choose to continue in the base project. See [Conversations](conversations.md).

**Info** shows the title and description read-only until you select **Edit**; saving never messages an agent. It also lists the task's files, which you can attach, download, and remove there. [Task files](task-files.md) describes the sources and what removal does.

**Notes** stores Markdown shared by every conversation of the task; [Conversations](conversations.md) describes tags, the preview, the editor, and the filter.

**History** presents the task's recorded flow, newest first, with how long the task stayed in each stage; [Conversations](conversations.md) describes the columns and what is recorded.

## Search, filters, and cards

Search matches titles and descriptions and combines with a project filter. The project filter lists only the projects that already have at least one card on the active board.

Execution state is separate from the workflow stage. A pulsing accent bar on the card's trailing edge shows a running assistant turn, and blue unread, orange awaiting-reply, and red failure indicators can coexist across a task's conversations. Background work is not shown on the card; the drawer's Conversations tab keeps it as an activity dot with labels on hover and for assistive technology. Each card's action row carries the **Auto** chip, the stage run action when it applies, and a next-stage button.

The board moves cards instead of jumping them. A card that changes stage, or that another card displaces, glides from its previous position to its new one; a card that appears or leaves fades briefly. A card that only grows or shrinks settles immediately, as do changing Hub or board, changing the search or project filter, and a change that makes more than eight cards enter or leave at once. The system `prefers-reduced-motion` preference removes the movement and the fades without changing content, focus, activation, or drag behavior; the plugin adds no motion setting of its own.

## Chat inside the drawer

Embedded chat uses the native transcript, composer, tools, execution, permissions, and session services. Navigation that the open task owns stays in the drawer: selecting an owned subagent opens it as a transient peek, following the breadcrumb returns to the conversation, and branching a conversation becomes a new conversation tab with the board still mounted. A target the open task does not own keeps the host's native navigation. The plugin supplies the scoped native session and provider and delegates every other native action to DSH.

## Next steps

- Organize the Hub and its boards: [Hubs and boards](hubs-and-boards.md).
- Write the workflow: [Workflows](workflows.md).
- Understand moves, instructions, and auto mode: [Execution](execution.md).
