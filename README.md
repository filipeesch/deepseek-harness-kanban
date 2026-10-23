# DSH Kanban

An independent host/client plugin for **DeepSeek Harness (DSH) 0.2.1-rc.2**: one multi-project Kanban board, optional Git worktrees, shared task notes, and task drawers that reuse native DSH conversations. It does not replace the DSH core, start another server, or clone the chat/agent runtime.

> **Verification boundary:** this plugin is checked through public DSH extension-point contracts, real temporary Git repositories, client integration tests, and the existing DSH GUI. Native conversation/model/scheduler engines remain DSH responsibilities. Acceptance uses a deterministic, test-only model adapter; no real-model request is part of the acceptance path. See [verification status and limitations](<docs/operations.md#verification-status>).

## Requirements

- DSH **0.2.1-rc.2**. SDK dependencies are pinned to that release candidate; compatibility with other versions is not established.
- Plugin runtime: **Node.js >=20.19**. Use a normal development Node installation; **Node.js 22+** is required for the optional Inspector helpers' native WebSocket support.
- **pnpm 10.15.1**, as declared by `packageManager` in [the package manifest](<package.json>).
- Git available to the host for worktree operations, and an existing local project/Git repository.
- Native DSH file policy permitting the requested paths. Changing working directory does **not** grant access.

The package is private and marked `UNLICENSED`; these instructions do not grant a license.

## Build and install into the existing GUI

Run from this checkout with the required Node and pnpm versions:

```sh
git clone https://github.com/filipeesch/deepseek-harness-kanban.git
cd deepseek-harness-kanban
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
```

Then use the **already-running DSH GUI**:

1. Open **Plugins → Add plugin**.
2. Add the absolute path to the **built package root**, not a source file or build subdirectory. Use the local package/link specification with the absolute path to your checkout:

   ```text
   link:/absolute/path/to/deepseek-harness-kanban
   ```

   If the GUI offers a local-path input, select that same absolute directory.
3. Enable **dsh-kanban** and inspect the native installation/application result.
4. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar. The current local backend is `http://127.0.0.1:51781/`; use your existing host URL in other environments.

No standalone web server is needed. Do not start Vite or a replacement DSH instance to make this plugin visible. The plugin adds navigation beside Automation tasks and Plugins; it does not configure a startup-page override.

After source changes, deliberately run `pnpm run build` again, explicitly reconcile the rebuilt plugin through the supported native Plugin Manager operation, and refresh that same GUI. On the inspected rc.2 host, public `pluginManager.setBundleEnabled('dsh-kanban', true)` reconciles changed loaded linked-target files even when already enabled; the optional helper exposes this as `enable`. See [the safe rebuild/reconcile procedure](<docs/operations.md#explicit-reconciliation-after-a-rebuild>). A linked checkout is **not** a promise of source HMR or automatic compilation. Inspect application/errors and honor any native restart-required result instead of reporting a hot update as successful.

The latest installation attempt initially failed fetching from the default registry; a one-shot `https://registry.npmjs.org` override succeeded without changing package-manager or DSH settings. This is observed network troubleshooting, not a requirement to change your registry. See [installation diagnostics](<docs/operations.md#installation-and-update-diagnostics>) and the optional local Inspector procedure there.

## First use

1. Optionally open **Configuration → General** and choose an existing absolute **Worktree base path** for new task worktrees. Then open **Configuration → Projects** (or **Configure projects** on an empty board) and save a name, absolute **Project path**, separate **Git root**, and optional default branch. Saving validates existing canonical directories and containment. Repository identity is validated when a scoped Git action is requested; registration does not start a native agent or grant Git access.
2. Select **New task** at the top of the configured initial column and supply its title, Markdown description, and registered project. The project select starts empty and must be chosen explicitly, even when a project filter is active. Saving creates a card in that initial stage and one fresh native conversation; it does **not** start an agent.
3. Open the card. Its drawer contains **Conversations / Info / Git / Notes**. Use **+** for another distinct, continuous native conversation. Closing/reopening a tab or drawer preserves its association and history.
4. Send messages through the native composer when you want execution. **Info** shows the title and Markdown description read-only until you select **Edit**; saving never messages agents. **Notes** stores Markdown shared by every conversation of that task, not a per-chat collection. The drawer header shows the task and project, the compact toolbar shows only permitted stage transitions, and conversation tabs use the native session title.
5. Search titles/descriptions and optionally combine that search with a project filter. Execution activity is separate from workflow stage; blue unread, orange awaiting-reply, and red failure indicators can coexist across the task's conversations.

Embedded chat uses native transcript, composer, tools, execution, permissions, and session services. Under design assumption **A7**, auxiliary native file/fork/workspace actions are **not guaranteed to remain contained in the drawer**. The plugin supplies the scoped native session/provider and delegates these actions to DSH; it does not reimplement or requalify their navigation. Do not assume every native action is an embedded-only action.

## Workflow and deliberate execution

**Configuration → Workflow** edits YAML in a code editor with line numbers, YAML highlighting, folding, search, live diagnostics, vertical resize, and a maximize toggle. Save is disabled while the YAML is invalid or still checking; the host remains authoritative for orphaned columns and revision conflicts. The draft survives Configuration tab switches, and closing or reloading with unsaved changes asks first. Configuration opens on **General**; the empty-board **Configure projects** action opens **Projects**. The default is exactly five stages with **no entry instructions**:

```yaml
name: Delivery Flow
initial_column: backlog
columns:
  - id: backlog
    label: Backlog
  - id: plan
    label: Plan
  - id: in_progress
    label: In Progress
  - id: in_review
    label: In Review
  - id: done
    label: Done
```

An optional, parser-compatible customization keeps those stage IDs and adds a group, transition restrictions, and a Plan instruction:

```yaml
name: Delivery Flow
initial_column: backlog
columns:
  - id: backlog
    label: Backlog
    allowed_transitions: [plan]
  - id: plan
    label: Plan
    allowed_transitions: [backlog, in_progress]
    on_enter_prompt: |
      Review the task description and propose an implementation approach.
      Ask any necessary questions before changing files.
  - id: in_progress
    label: In Progress
    allowed_transitions: [plan, in_review]
  - id: in_review
    label: In Review
    allowed_transitions: [in_progress, done]
  - id: done
    label: Done
    allowed_transitions: [in_progress]
groups:
  - id: delivery
    label: Delivery
    columns: [in_progress, in_review]
```

Groups present real columns, not extra destinations. A column's omitted `allowed_transitions` permits any other existing column; `[]` permits none. Entry instructions use `on_enter_prompt`, not generic engine settings. Unsupported fields (including WIP/agent-engine settings), invalid YAML, unknown stage references, and updates that orphan existing card stages are rejected without replacing the last valid workflow. See [the actual parser](<src/domain/workflow.ts>) and [workflow persistence](<src/domain/store.ts>).

Drag a card to another allowed column, or use the compact stage control in the task drawer. Cards no longer carry a stage selector, and the board has no other move action. Every permitted move is immediate and organization-only; no move starts an agent. An instructed stage exposes a **play** action on its cards after a transition into the stage and until a prompt is sent in that stage. The action sends the current stage's exact instruction to the task's first open conversation, creating a conversation when none is open. It never moves the task, never opens an agent picker, and reports admission failures inline. Worktree creation is offered from the missing-worktree notice or the Git section, never from a move or drop.

Changing stage in the drawer moves immediately. For an instructed destination, the drawer switches to **Conversations** and inserts only that instruction into the active conversation's composer; the user reviews it and presses Send. An existing draft or attachments are preserved with an explicit **Replace draft** action. New task conversations receive the task context once through a visible task-context row above the native transcript; the model-facing message is native and injected before the first user message. The plugin row follows the native transcript's loaded history; use the native Chat's own older-message paging to load earlier messages. The plugin adds no separate paging control. Later instructions contain only the stage instruction.

The card instruction is a normal prompt admission. If it fails, inspect the conversation before retrying; a retry is a new send. Tasks created before this behavior are not backfilled with the first-turn context. Legacy confirmed transitions remain readable and retryable in the drawer, but the current UI does not create them.

## Worktrees and native boundaries

A task can work directly in its base project. The notice above chat previews the derived branch, destination, and source and offers **Create worktree** to create immediately with those values, **Review in Git**, or **Dismiss**. Dismissing changes no Git resources; a missing base path routes to Git instead of attempting an empty-path create. **Git** presents the worktree as no-worktree, creating, ready, or error and shows only the applicable branch, path, state, and actions. The Git form also accepts an empty source branch and lets the host fall back to the project default branch or HEAD. Branch selectors are searchable over local branches; remote refs are accepted only as an explicitly entered source for a **new** branch. Existing-branch mode never silently creates a detached remote checkout. Attaching an existing checkout remains a secondary action in the no-worktree state; attachment reuses the checkout and branch rather than creating them. Unclaimed checkouts appear as a compact warning.

**Configuration → General** sets an optional worktree base path. The Git form derives a new branch name from the task title (lowercase ASCII, hyphenated, at most 48 characters, with `task` as the fallback) and prefills the destination with the base path joined to that branch. Collisions append `-2`, `-3`, and so on to both values, checking local branches and occupied destinations. Both fields stay editable: the destination follows the branch until you edit it, and **Use default path** restores the join. Existing-branch mode keeps the chosen branch and does not apply a counter. Changing or clearing the base path never moves or renames existing worktrees, and existing UUID-based branch names are left unchanged. Workflow columns are content-height: a column grows with its cards instead of clipping them, and the board page scrolls vertically.

For a monorepo, the effective agent directory is:

```text
base:     <git-root>/<relative-project-path>
worktree: <worktree-root>/<relative-project-path>
```

The required subdirectory must exist. There is no fallback to the Git root or worktree root. The all-idle coordinator waits for **every** associated conversation, including closed tabs and known native jobs, descendants, schedules, and pending interactions. Partial switches are journaled, not represented as an atomic all-session transaction. An explicit return can retain a checkout binding while the **active effective cwd is the base project**; the retained checkout is not automatically active again. **Unclaimed worktrees** are diagnostic-only paths left on disk, never active or destructive targets; task deletion leaves them untouched.

New task conversations join a native DSH workspace for their effective project or worktree path instead of being created with cwd only. The base-project workspace is shared by tasks in that project; a worktree workspace belongs to its task and uses the `project · branch` title. A pre-existing workspace is reused and never renamed. Existing conversations keep their creation-time workspace when the effective directory changes. DSH has no hidden-workspace state, so a registered workspace remains visible in the sidebar; an owned worktree workspace is removed when its task is deleted if no other session uses it. Successful native `workingDirectory` changes preserve session IDs, histories, and immutable header cwd. **Native workspace grouping, Files, and sandbox root remain tied to the original location.** Effective cwd is shown in Git details, not as workspace migration or authorization. Policy preflight plus native confinement can honestly deny out-of-root or read-only operations, including access to monorepo Git metadata. Execution guards revalidate existing canonical context after native recovery and before model use. See [policy and recovery](<docs/operations.md#working-directory-and-policy-boundaries>).

Task archiving is removed. **Delete task** is the only task lifecycle action: it first returns every retained chat to the base project, then removes the eligible bound worktree, archives native chats **without erasing histories**, and removes the card/notes; the branch is preserved. **Remove worktree** retains the task and first returns all retained chats to the base project. Neither cleanup substitutes the base project/Git root for a missing worktree. Target checks, shared-use protection, and additional dirty/untracked-file discard consent apply. A bulk selection uses one confirmation and deletes eligible tasks best-effort: tasks with running chats, an unresolved operation/transition, or local worktree changes are skipped and reported. Review [the lifecycle procedure](<docs/operations.md#archive-remove-and-delete>) before destructive actions.

## Questions and model-facing tools

Rich question rounds work in task and ordinary DSH chats: single/multiple choice or text, Markdown explanations, recommendations/rationales, importance, Other, and notes. The active round is a fixed strip docked directly above the composer, like the host Todo and Goal bars: the chat scrolls while the strip stays in place, it collapses to its header bar, and it is expanded by default. Every question is one slide with its choices, focused-choice description, optional per-answer Notes, and Next; the last slide is always **Additional Notes**, and Submit exists only there. Pages may arrive incrementally and stack into the strip while answers are retained. **Submit** sends **one ordinary textual reply** in the originating conversation; an ordinary chat reply also retires the round, and the strip leaves the dock. Question rounds are stored durably per conversation, not per task, so an unanswered round returns after reload. Form drafts and the collapsed state remain live UI state; do not rely on unfinished answers surviving reload. This does not create a native pending tool/question, settle native approvals, or write a decision ledger.

Registered tool names are defined in [the product tool implementation](<src/host/tools.ts>):

| Scope | Tools |
| --- | --- |
| Read board/projects/tasks | `list_boards`, `list_projects`, `get_board_summary`, `list_cards`, `get_card` |
| Explicitly requested card text changes | `create_card`, `edit_card` |
| Shared task notes | `create_note`, `list_notes`, `update_note` |
| Optional question page | `decision_request` |

Board reads/create/edit are available in ordinary chats without a task binding. Note tools need an explicit task ID there; a task conversation can resolve its own task. Board/note writes require the user's explicit request, not unsolicited internal progress tracking; there is no additional product approval modal for those requested writes, and native permissions still apply. Intent text is an agent-use rule, not a deterministic consent detector.

The question strip's footer has a **Dismiss** action on the left. An untouched round dismisses immediately; a populated draft asks for inline confirmation. Dismissing removes every unresolved round in that conversation, sends no chat message, and permanently hides the round from reload/replay while leaving the composer available. Future rounds still appear.

There are **no model tools to move/delete cards or message another card**, no plugin checklist or decision ledger, and no plugin terminal or full Git/code-review integration; the workflow surface has a YAML editor. Existing native DSH features are not removed.

## Development and evidence

```sh
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
# Or run those checks in sequence:
pnpm run check
# Manual before release, against a pinned DSH dsh-v0.2.1-rc.2 checkout:
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
```

Host and client types deliberately compile as **separate TypeScript Programs** through [host configuration](<tsconfig.host.json>) and [client configuration](<tsconfig.client.json>); do not combine their native SDK augmentations into one Program. [The build script](<scripts/build.mjs>) emits host ESM, the browser module-loader bundle, and separate public declarations. [The check script](<scripts/check.mjs>) runs both typechecks, tests, and the build with the invoking Node executable. Use normal development Node for tests: the hardened DSH-bundled Node has rejected the Rollup native addon because its Team ID differs. Do **not** weaken code signing to run the suite.

The [initial product change](<openspec/changes/archive/2026-10-22-define-kanban-product/proposal.md>) and [approved verification boundary](<openspec/changes/archive/2026-10-22-define-kanban-product/design.md#compatibility-gates-and-verification-strategy>) define the base release. The [current UX refinement change](<openspec/changes/refine-kanban-ux/proposal.md>) captures the delete-only lifecycle, direct-manipulation board, workspace binding, compact drawer/Git surfaces, and deterministic test adapter. The [verification report](<docs/verification-preliminary.md>), [scenario matrix](<docs/scenario-evidence.md>), [run register](<docs/verification-runs.json>) and [independent product review](<docs/code-review.md>) distinguish product contracts, actual Git effects, existing-GUI smokes and historical exploratory runs. Test totals and exact build fingerprints are kept in those records rather than duplicated here. A failed historical QA run is not relabeled a pass. Real-model replay and native engine repair remain outside this product boundary.
