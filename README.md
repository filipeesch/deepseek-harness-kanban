# DSH Kanban

An independent host/client plugin for **DeepSeek Harness (DSH) 0.2 from 0.2.2-rc.1**: Hub-scoped Kanban boards, per-board workflows with a column board and a workflow diagram, optional team publishing, optional Git worktrees, shared task notes, and task drawers that reuse native DSH conversations. It does not replace the DSH core, start another server, or clone the chat/agent runtime.

> **Verification boundary:** this plugin is checked through public DSH extension-point contracts, real temporary Git repositories, client integration tests, and isolated real DSH composition lanes. Native conversation/model/scheduler engines remain DSH responsibilities. Acceptance uses a scripted, test-only model adapter; no real-model request is part of the acceptance path. See [verification status and limitations](<docs/operations.md#verification-status>).

## Requirements

- DSH **0.2.2-rc.1** or newer inside the `0.2` line. The manifest declares `engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`, so DSH refuses a bundle outside that range with its own incompatibility report instead of failing later at import time. The committed lockfile resolves the tested `0.2.2-rc.1` SDK; bounded SDK ranges admit compatible later `0.2` hosts, while `<0.3.0-0` excludes every `0.3` prerelease and release. Native admission does not prove that optional execution providers are mounted or that the bundle activated. The bundle reads the Session status table from whichever surface a release publishes — the `uiSession.sessionStatus` sub-service or that same table as a member of `uiSession` — and binds its Remote service on both the property-style and the symbol-keyed Cordis root, so a host anywhere in that range keeps the Kanban entry and its controller.
- Plugin runtime: **Node.js >=24.9.0**, aligned with that DSH baseline. The development lane uses Node.js 24.21.0.
- **pnpm 10.15.1**, as declared by `packageManager` in [the package manifest](<package.json>).
- Git available to the host for worktree operations, and an existing local project/Git repository.
- Native DSH file policy permitting the requested paths. Changing working directory does **not** grant access.

The package is private and marked `UNLICENSED`; these instructions do not grant a license.

## Install

### Install from the repository URL

Install the plugin from this repository's URL. No build is published to download, so the host resolves that address as a Git dependency and the profile builds it during installation: the installed copy is always the commit the address resolved. Releases published before the check pipeline replaced the release workflow, and their assets, remain downloadable but do not advance.

1. Open **Plugins → Add plugin**.
2. Paste the repository URL into the package field:

   ```text
   https://github.com/filipeesch/deepseek-harness-kanban
   ```

3. Allow the plugin build when pnpm refuses it. A clone has no `lib/`, because that directory is build output ignored by Git, and the manifest's `prepare` script is what produces it; pnpm does not run the build script of a Git dependency unless the profile permits it, so the first attempt fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and the host restores the profile's `package.json` and `pnpm-lock.yaml`. Copy the exact key pnpm prints in the refusal into the profile's `pnpm-workspace.yaml` and add the plugin again:

   ```yaml
   allowBuilds:
     "dsh-kanban@git+https://github.com/filipeesch/deepseek-harness-kanban#<commit>": true
   ```

   The key names the resolved commit, so it changes whenever the ref moves; pin the address to keep one key.
4. Enable **dsh-kanban** and inspect the native installation/application result. The approved run installs the checkout's own dependencies and runs `node scripts/build.mjs`, so it needs the profile's package manager on `PATH` plus registry access.
5. Confirm the installed copy carries its entries before trusting the result: `$DSH_HOME/profiles/<profile>/node_modules/dsh-kanban/lib/index.js` must exist. A copy without `lib/` can report a successful installation and fail to import on the next start; see [installation failure signatures](<docs/operations.md#installation-failure-signatures>).
6. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar. Use the URL the host printed on launch.

If the item is missing after a reinstall, check for a stale user-layer override before treating it as an activation failure: a `- id: kanban` entry with `disabled: true` in the profile's `cordis.patch.yml` survives reinstalls and hides the row. Enable Kanban in the plugin manager or remove that override, then restart. Confirm with `dsh --profile <profile> --dump-config | grep -A2 'id: kanban'`; see [installation failure signatures](<docs/operations.md#installation-failure-signatures>).

Most DSH SDK packages are peer dependencies that the host installation provides, so the profile does not need its own copy of them. The Typert protocol helper is compiled into the built entries instead: a profile can hoist an older copy of that package, and Node resolves the profile copy before the host installation (see [installation failure signatures](<docs/operations.md#installation-failure-signatures>)). pnpm also downloads the artifact's own runtime dependencies (`zod`, `yaml`, and the editor packages) from the registry, so the installation needs registry access for the build and for those dependencies.

### Update an installed plugin

A profile keeps the version it resolved, so adding the same address again does not refresh an existing copy. Update it explicitly from the checkout-independent CLI:

```sh
dsh plugin --profile <profile> update dsh-kanban
```

The command runs pnpm in `$DSH_HOME/profiles/<profile>` (by default `~/.dsh/profiles/<profile>`), re-resolves the specification the profile recorded, and reports the new manifest version in **Plugins**. A floating address (the bare repository URL) clones the default branch again, so it builds a new commit and needs a new `allowBuilds` key for it; an address pinned with `#<commit sha>` stays on that commit until you change the specification. Use `--profile desktop` only through the Desktop-owned CLI, which manages that reserved profile.

### Install or pin an exact version

The bare repository URL follows the default branch, so it moves whenever `main` moves. To install a fixed build, append a committish to the same URL:

```text
https://github.com/filipeesch/deepseek-harness-kanban#11edda3
https://github.com/filipeesch/deepseek-harness-kanban#v0.15.0
```

A commit sha is the only pin that cannot move. Tags exist for every version published while the release workflow still ran, and a tag for a later version is created by hand, so confirm the tag exists before pinning to it. Never pin a branch name: a branch is a moving ref, not a fixed build.

No standalone web server is needed. Do not start Vite or a replacement DSH instance to make this plugin visible. The plugin adds navigation beside Automation tasks and Plugins; it does not configure a startup-page override.

### Install a source checkout (for development)

Run from this checkout with the required Node and pnpm versions:

```sh
git clone https://github.com/filipeesch/deepseek-harness-kanban.git
cd deepseek-harness-kanban
node --version
pnpm --version
pnpm install --ignore-scripts --frozen-lockfile
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
4. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar.

After source changes, deliberately run `pnpm run build` again, explicitly reconcile the rebuilt plugin through the supported native Plugin Manager operation, and refresh that same GUI. On the inspected rc.2 host, public `pluginManager.setBundleEnabled('dsh-kanban', true)` reconciles changed loaded linked-target files even when already enabled; the optional helper exposes this as `enable`. See [the safe rebuild/reconcile procedure](<docs/operations.md#explicit-reconciliation-after-a-rebuild>). A linked checkout is **not** a promise of source HMR or automatic compilation. Inspect application/errors and honor any native restart-required result instead of reporting a hot update as successful.

### What the repository install builds

The repository URL is a **Git** dependency: pnpm clones the default branch, which does not contain `lib/` because that directory is build output ignored by Git, and the manifest's `prepare` script is what compiles it. Two consequences follow, both covered by the install procedure above and by [installation diagnostics](<docs/operations.md#installation-and-update-diagnostics>): the profile must approve the build for the resolved commit before the install can complete, and a copy that got installed without that build reports success and then fails to import on the next start. Confirm `lib/index.js` exists in the installed copy before treating an installation as good.

The latest source installation attempt initially failed fetching from the default registry; a one-shot `https://registry.npmjs.org` override succeeded without changing package-manager or DSH settings. This is observed network troubleshooting, not a requirement to change your registry. See [installation diagnostics](<docs/operations.md#installation-and-update-diagnostics>) and the optional local Inspector procedure there.

## Hubs and boards

A **Hub** is a logical group of projects and boards. It has a name only: no filesystem root and no native DSH workspace. Projects belong to one Hub, and every task belongs to one board and one project in that Hub. Boards are selected inside the active Hub; each board owns its own YAML workflow and its own project scope. A board with no recorded scope accepts tasks from every project of the Hub; a board can instead allow only chosen projects, and a board that allows none accepts no new task. The scope lives on the board, never in the workflow YAML, and the **New task** dialog offers only the projects the active board allows. The active Hub and the last board used per Hub are remembered in browser local storage. An installation always has at least one Hub; the last Hub cannot be deleted. Deleting a Hub is allowed only when none of its boards has a task, and it removes its empty boards and task-free project registrations without deleting project directories, worktrees, branches, native conversations, or native workspaces. The worktree base path remains global. A board can also name the **defaults** its conversations start on, in the board's own configuration under **Configuration → Boards → Edit → Defaults**. A **default model** is a `model:` mapping with `provider`, `model`, and an optional `reasoning_effort` at the root of the board's workflow YAML, chosen with a **Host default** / **Specific model** mode control and DSH's native model selector, which stays presented in both modes and is disabled while the host default is chosen; the selector is offered only when the host composes it, and otherwise the stored route is shown read-only. A **default agent preset** is a root `agent_preset` scalar chosen from the host's roster with an explicit **Host default preset** choice. An **MCP allowlist** is a root `mcp` list of `server` or `server/tool` entries: an absent list keeps every server visible to that board's conversations, and an empty list keeps none. The Defaults pane... (line truncated to 2000 chars)

## First use

1. The installation starts with **My Hub** and a **Kanban** board. Use the **+** beside the Hub or board tabs to create another Hub or board, or **Configuration → Hub** for a Hub and **Configuration → Boards → New board** for a board. A new Hub starts without boards and presents **Create your first board**. Optionally open **Configuration → General** and choose an existing absolute **Worktree base path** for new task worktrees; without one, destinations derive beside the repository. Then open **Configuration → Projects** (or **Configure projects** on a board without projects). The section is a registry list; **New project** and **Edit** open the project dialog. Choosing or typing an absolute **Project path** runs detection: a repository reports its Git root and a suggested default branch (`origin/HEAD`, then `main`, then `master`, then the current branch), while a plain directory reports that no repository was found. The Git root and default branch stay editable, detection never overwrites a field you changed, and a blank Git root registers a folder project. Saving validates existing canonical directories, containment, and, for a Git-backed project, that the Git root is the repository top level; registration does not start a native agent or grant Git access. Every project also carries a stable **project key**, derived from the project name when the field is left empty and editable in the same dialog: the key identifies the project in the board project scopes and in the published configuration, must be unique within the Hub, and cannot be duplicated by another project. Changing a key updates every board of the Hub that allows that project in the same save, and renaming or relocating a project never changes its key. The same dialog carries the project's **Worktree** policy — **Ask**, **Always create**, or **Never** — which answers the worktree question before a task's first execution: **Ask** keeps the per-task choice, **Always create** starts the task on its derived ... (line truncated to 2000 chars)
2. Select **New task** at the top of the active board's configured initial column and supply its title, Markdown description, and registered project. The project select offers only the projects the active board allows and starts empty; it must be chosen explicitly, even when a project filter is active. A board that allows no project explains that it accepts no new task and withholds **Create task**; a project that came from a published board with no directory yet is never offered. The dialog also offers **Auto mode** (off by default) and, only when the initial stage has an entry instruction, **Start execution now** (on by default). Saving creates a card in that initial stage. When the start option applies, the host creates the task's default worktree (or uses the project directory for a folder project), creates the first conversation on the board's default model and agent preset when the board names ones the host offers and on the host defaults otherwise, and arms the cancelable five-second countdown for the stage instruction; the card and drawer show a preparing state first, canceling keeps the created resources, and a failure leaves the card and its **play** action. Without the start option, saving creates no native conversation and starts no agent. The first conversation can also be created later from a preset card in the Conversations section or by the first-execution preparation that precedes an instructed move or the card play action.
3. Open the card. Its drawer contains **Conversations / Info / Git / Notes / History** for a Git-backed project, and omits **Git** for a folder project. A task starts with no conversation: the Conversations section presents the agent-preset cards, and **+** opens the same choice to create the first or another distinct, continuous native conversation. For a Git-backed task without a worktree, the first conversation waits until the worktree notice is resolved: create or attach a worktree and wait until it is ready, or choose to continue in the base project. Closing/reopening a tab or drawer preserves its association and history.
4. Send messages through the native composer when you want execution. **Info** shows the title and Markdown description read-only until you select **Edit**; saving never messages agents. **Notes** stores Markdown shared by every conversation of that task, not a per-chat collection. Each note keeps up to four lowercase tags, shows a 250px Markdown preview, and opens in a wide editor overlay with Markdown and Tags, an Edit/Preview switch, and a delete action; a tag bar filters the list by one tag at a time and remembers the choice per task. **History** presents the task's recorded flow — its creation and initial stage, every stage entry, every next-stage destination an agent recorded, every auto mode change with the reason that paused it, and every worktree creation, attachment, removal, or failure — as one table with **When**, **Event**, **Detail**, and **In stage** columns. Rows are newest first and the list is not capped; the In stage column carries how long the task stayed in each stage, refreshing while the section is open. Nothing before this feature is recorded or inferred, and the record stays out of agent tool payloads. The drawer header is one compact row on a wide drawer and two rows on a narrow one: the section icons come first, the task title sits beside its project chip, and the stage control, the next-stage action, the auto-mode chip, delete, and close follow. The Conversations tab carries one activity dot while an agent runs or background work is unsettled, with the facts in its tooltip and accessible name. The stage control lists every workflow stage in order, marks stages that require confirmation with lower emphasis, and offers a one-click advance to the next stage with the same rules. Conversation tabs use the native session title.
5. Search titles/descriptions and optionally combine that search with a project filter. The project filter lists only the projects that already have at least one card on the active board. Execution state is separate from workflow stage: a pulsing accent bar on the card's trailing edge shows a running assistant turn, and blue unread, orange awaiting-reply, and red failure indicators can coexist across the task's conversations. Background work is no longer shown on the card; the drawer's Conversations tab keeps it available as an activity dot with the labels on hover and for assistive technology. Each card's action row carries the **Auto** chip, the stage run action when it applies, and a next-stage button.

The board moves cards instead of jumping them. A card that changes stage, or that another card displaces, glides from its previous position to its new one, and a card that appears or leaves fades briefly; a leaving card fades as an inert copy that does not extend the board's scroll area. The movement follows any cause — a drop, the drawer stage control, a confirmed restricted move, an automatic advance, a team-sync update, or a deletion. A card that only grows or shrinks settles immediately, as does changing Hub or board, changing the search or project filter, and a change that makes more than eight cards enter or leave at once. The system `prefers-reduced-motion` preference removes the movement and the fades without changing card content, focus, activation, or drag behavior; the plugin adds no motion setting of its own.

Embedded chat uses native transcript, composer, tools, execution, permissions, and session services. Navigation that the open task owns stays in the drawer: selecting an owned subagent in the window's lineage or catalog opens it as a transient peek, following the breadcrumb returns to the conversation, and branching a conversation becomes a new conversation tab with the board still mounted. A target the open task does not own — an ordinary chat, another task's conversation, a fork of a subagent — keeps the host's native navigation. The plugin supplies the scoped native session/provider and delegates every other native action to DSH; it does not reimplement the window, the catalog, or the branch action.

Branching a retained task conversation adopts the fork as another conversation of that task: the host attaches it, aligns it to the task's effective directory, and the task owns it for deletion and shared-worktree protection. The drawer asks the host for that attach and makes the new conversation the active tab. The host accepts the branch only when it records the conversation as its parent or inherits the start of its log, so a fresh branch is proven before the board returns; a Session the host does not prove — a new chat, a branch of another conversation — keeps the native navigation and attaches nothing, and a branch the host proved but could not attach is reported with an action that opens it in the main chat. A fork of a subagent descendant, a fork of a session no task retains, and — on a host that records the branch's lineage — a fork created from the window's session menu without a branch navigation are appended without becoming active; a host that records no lineage leaves that last fork foreign.

In the **Conversations** section, the drawer hosts DSH's public native conversation window for the active task conversation: Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner, followed by the transcript, composer, and statistics footer. When the task has no open conversation, the drawer presents the host's agent-preset roster as cards; choosing a card creates the conversation, applies that preset, and opens it. The plus action opens the same card choice for another conversation, and a failed preset selection leaves the conversation on the host default with the card available to retry. The host's own preset seat and read-only mode label self-hide outside the main panel, so the drawer does not rely on them. View selection, pin choices, and the draft stay shared with the main panel. Lineage and subagent-catalog entries keep their native behavior inside the drawer: an owned descendant opens as a transient peek over the active conversation, the task's conversation tabs stay root-session-only, and the peek is forgotten when the drawer closes, another task opens, a task conversation is selected, the section changes away from Conversations, or the descendant is no longer available. The peek is never written to the task, so lineage, deletion counting, and shared-worktree protection keep their rules. Breadcrumb ancestors select their conversation tab. While the board is open, selecting one of the task's own Sessions in the DSH sidebar also opens it in the drawer; leave the Kanban panel first to open it in the main chat. The close action sits inside the active conversation tab. The drawer also hosts the host's right Sidebar panel beside the active conversation: it opens from the native right-bar corner control and closes from the panel's own collapse control, sharing one panel state per Session with the main chat (the same tabs, layout, history, and `dsh.sidebar-right.v1.<sessionId>` persistence, and the same ... (line truncated to 2000 chars)

When the DSH sidebar is fully collapsed on macOS, the Kanban header uses the host-published frame leading clearance so its title, subtitle, and toolbar clear the window traffic lights and shell controls. The header falls back to its normal inset when the clearance is absent and reflows at narrow widths.

## Scripted workflow steps

> **Safety limitation:** Cleanup is tracked by an inherited `DSH_SCRIPTED_RUN` token that the guard sweeps, so a descendant that detaches into another process group is normally terminated. On hosts without an OS ownership primitive the sweep is best-effort: a pid reused at the exact instant of the signal, or a descendant that changes credentials, cannot be excluded by POSIX signalling. A program that deliberately removes that token from its children's environment, or hands work to another machine, is outside the tracked set; an unreadable process table fails closed. See [the safety details](<docs/scripted-steps.md#compatibility-and-installation>).

A stage can run repeatable Bash or TypeScript code instead of an agent instruction. Its named completion selects an exact captured destination and carries an identified message to an agent, script, or manual stage. Entry requests execution even with Auto mode off and zero conversations; local approval and native policy still apply. **Stop** durably cancels the owned program without moving, while **Play** delivers a saved result and otherwise captures the latest version and starts a new execution in place; the explicit **Run again** action is the only path that captures and executes again. Active restart runs the approved primary program from the beginning with the same logical identity and original start time, not restored memory; saved results resume delivery instead of rerunning code, and a refused delivery shows its durable reason in the drawer together with the blocking background job and a **Cancel job** action. A settled failure states whether the script, the completion contract, the execution infrastructure, or the stage configuration is responsible. A script or completion failure follows the reserved **error** destination; a guard or runtime failure prefers a mapped **infrastructure** destination and falls back to **error**; a configuration refusal follows no destination and stays in the stage with the diagnosis and Play.

See [scripted steps](<docs/scripted-steps.md>) for the YAML/script ABI, loops and deadlines, output/error routing, failure origins and bounded guard retries, manual handoffs, board/project/stage-scoped write-only local variables, board-and-stage-scoped executable approval, dependency limits, capability diagnostics, and safe rollback. Team publishing never transfers executable approval, secrets, captures, or runtime state. The [local-only fixtures](<tests/e2e-dsh/scripted/workflow.yaml>) use no model or CI/CD account.

## Decision workflow steps

A stage can stop the flow for a person's authored choice instead of running an agent or a program. Its `decision` block holds a question, optional Markdown context, and one to twelve options, each with a stable id, a title, an optional description, and a destination stage. One option is a valid explicit confirmation. The block is exclusive with an entry instruction, an allowed-transition list, and a scripted configuration; the stage description stays separate context.

A task that enters the stage stops there and its card takes the attention tint with a **Decision needed** mark and status line. The drawer shows the question, context, and options above its sections, using the same presentation as the structured-question surface, together with an optional observation field. The person selects one option and confirms; the board then shows a cancelable five-second countdown on the card and in the panel. A reload or cancel applies nothing and leaves the gate waiting.

When the window closes, the host applies the choice as a host transition: the card moves to the option's destination, the history records the chosen option and the observation, and an instructed destination receives the choice as its transition reason. A scripted destination starts its own authorized execution. The stage owns its routing: a completed turn never advances out of it, no agent tool declares its route (including the exceptional flag), the card offers no advance action, and every manual move out asks for the restricted-transition confirmation. Auto mode keeps its setting; the gate simply holds.

`set_stage_decision` writes the block for the workflow architect, and the workflow summary and first-contact context report the stage type, its question, and each option's destination. A board with a decision gate publishes events in a newer format; an older installation reports that board as requiring a plugin update instead of applying it partially. See [decision steps](<docs/decision-steps.md>) for the authored shape, the routing contract, and the compatibility boundary.

## Workflow and deliberate execution

Configuration presents **General**, **Hub**, **Boards**, **Projects**, **Schedules**, and **Team Settings**, all at the same width and height and opening on **General**; the empty-board **Configure projects** action opens **Projects**. Board configuration is not a section of its own: **Boards** lists every board of the Hub with **Edit** and **Delete**, creates boards through the same dialog the header's **+** uses, and opens one board's configuration as an overlay above the list, with **General / Projects / Defaults / Workflow / Danger zone** sub-sections. The overlay edits the board it was opened for, including a board that is not active, only the topmost dialog answers Escape and pointer dismissal, and the layers below it are inert.

**Configuration → Boards → Edit → Workflow** edits that board's YAML in a code editor with line numbers, YAML highlighting, folding, search, live diagnostics, vertical resize, and a maximize toggle. Save is disabled while the YAML is invalid or still checking; the host remains authoritative for orphaned columns and revision conflicts. The draft survives sub-tab switches inside that board's configuration, and closing the board configuration or reloading with unsaved changes asks first; reopening the board starts from the saved workflow. Each new board starts with exactly five stages and **no entry instructions**:

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

A transition may also carry the condition under which the model should follow it, authored as `{ to, when }` next to the bare identifier form. Both forms are accepted, neither is deprecated, and one list may mix them; a condition never changes which transitions the workflow permits.

```yaml
columns:
  - id: in_review
    label: In Review
    allowed_transitions:
      - to: done
        when: The review approved the work with no requested changes.
      - to: in_progress
        when: The review found changes that must be implemented.
```

Groups present real columns, not extra destinations. A column's omitted `allowed_transitions` permits any other existing column; `[]` permits none. Entry instructions use `on_enter_prompt`, not generic engine settings. Unsupported fields (including WIP/agent-engine settings), invalid YAML, unknown stage references, and updates that orphan existing card stages are rejected without replacing the last valid workflow. See [the actual parser](<src/domain/workflow.ts>) and [workflow persistence](<src/domain/store.ts>).

### Workflow diagram

Every board can also be presented as a workflow diagram. The board header's **Board | Workflow** switch selects the presentation, and the choice is remembered per board in this browser; the workflow YAML's `default_view` decides which one a board opens with until the user chooses for that board:

```yaml
default_view: workflow
columns:
  - id: plan
    label: Plan
    position: {x: 400, y: 20}
    size: {width: 400, height: 300}
```

An omitted `default_view` opens the column board, and switching never edits the workflow YAML or reaches the host. The diagram fills the board body edge to edge and draws one rounded region per stage with the board's own cards, and connects stages from their configured transitions: `allowed_transitions` entries are solid lines, a stage without them gets one dashed line to the next stage, and `[]` has no outgoing line. Connections are orthogonal with rounded corners; multiple targets leave the same stage at distinct points, a target equal to its stage is a reorder rather than a line, a connection to an earlier stage runs below the stages, and pointing at a connection while editing is unlocked reveals a handle at each end and on each adjustable segment, while a locked arrow is pressed to read its route. Stage positions and the connections attached to a stage follow it while it is dragged or resized.

Stages are placed in layers automatically; each stage's authored `position` overrides that placement, and **Organize** recomputes and stores every position. A missing position is placed automatically and stays put for the session. Each stage also accepts an optional `size`, which is the minimum width and height it renders at: the stage still grows with its cards, never shrinks below that minimum, and can be resized by its trailing corner while editing is unlocked. A missing size uses the diagram's default stage size. Dragging a stage by its header or resizing it stores one workflow save; the change follows the same validation, draft, publishing, and sharing-merge rules as any other workflow edit, with sizes merging per stage exactly like positions.

An arrow's layout is authored too. `connections` holds one entry per adjusted arrow, identified by its source and target stage; an entry may name the touch point of either end and displace any adjustable segment of the route:

```yaml
connections:
  - from: plan
    to: in_progress
    source: {side: bottom, at: 4}
    target: {side: top, at: 1}
    segments: [{axis: x, offset: 64}, {axis: y, offset: -20}]
```

A touch point names one of the four stage sides and one of five points along it, at 10, 30, 50, 70, and 90 percent, so a stage boundary offers twenty anchor points; the arrow leaves and enters perpendicular to the side it names. A displacement is stored with the axis it moves and applies to the automatic segment of that axis at the same position along the route, so the shape still follows a stage that moves or resizes, and it does not move when a stage the connection does not cross is moved: a route that must clear stage regions is routed below the stages its own corridor crosses and no others; a displacement the current route has no segment for stays in the document and applies again if that shape returns. An entry whose arrow the diagram no longer draws is ignored rather than rejected, and an entry repeated for the same pair is rejected as an invalid workflow.

Drag a connection's end handle to re-anchor it, or one of its segment handles to move that segment. The marks are drawn above the stage regions with a twenty-four pixel pointer target, so a handle on a stage boundary or under the arrowhead is still reachable, and pressing one and dragging starts the adjustment in one step; the marks appear while an unlocked connection is pointed at, stay presented while it is selected, and a press that never moves selects the connection without changing its layout. Escape cancels, and one completed drag stores one workflow save. Pointing at an arrow strengthens its stroke in either mode. While the layout is locked no mark is presented, and pressing an arrow selects it for reading: the route is drawn above the stage regions, so the segments a stage hides stay visible, and the selected paint is the same in both modes. Both ends of every arrow, including the dashed default one, are reachable by keyboard: while the layout is locked, focusing an end selects its arrow; while it is unlocked, the arrow keys walk the twenty points around the stage, Enter stores the chosen point, and Escape restores the previous one. Adjustments join the same layout lock, the same undo and redo history, and the same coalesced save as stage placement and size, and team sharing merges them per arrow. A build older than this feature rejects a workflow that contains `connections`, so every installation on a team has to be updated before such a board is published.

Connections are authored in the diagram too. Pointing at a stage reveals a connection port on each of its four sides, each with a twenty-four pixel pointer target; pressing one and dragging presents the line being drawn, and while a candidate stage is under the pointer it presents the route the release would author, including its arrowhead. Drag any port onto another stage to author that transition, and the connection leaves from the side you drew from when that is not the side the automatic route would use. Drawing from a stage that allowed any other stage, or from a stage that permitted none, authors exactly the drawn destination, so the stage becomes restricted to it and the dashed default path it no longer allows stops being drawn; a stage that already authored destinations keeps them and gains the new one. Dropping on the source stage, or on a destination it already permits, changes nothing. Dragging a connection's end handle onto another stage changes the connection's destination instead of re-anchoring it, and the stage under the pointer is marked as the candidate before the release: the target end points the transition at the new stage, and the source end moves the transition to that stage as its owner, leaving the previous source permitting nothing when it had only that destination. The layout entry of the pair a connection leaves is removed with the transition, so no stale route survives it. Double-press a connection to edit the `when` of exactly that transition in a field you can resize, anchored to the arrow; the default dashed path becomes an authored transition when its condition is saved. A connection that authors no condition shows a small dashed hollow ring on its path, and both ends name whether a condition is authored; the ring waits for the unlock, because authoring that condition changes structure. Press a connection to select it and Delete or Backspace, or use the editor's **Delete**, to remove the transition; removing a stage's last destinatio... (line truncated to 2000 chars)

The stage editor's **Edit stage** action, the pencil on every stage header, opens one dialog for a single stage. The board always presents it; the diagram presents it disabled while its layout is locked. Allowed destinations have three modes: allow any other stage, choose specific destinations with an optional condition for each, or no destinations for a terminal stage. A condition is a multiline field you can resize, and clearing it stores no condition. Saving changes only the fields you edited, and every other authored character of the workflow stays as its author wrote it.


Layout edits settle on a grid by default: dragging a stage, resizing it, and moving an arrow segment all round to the nearest multiple of eight diagram units, so stages edited at different times share the same lines. The grid is absolute, so a stage whose stored position is off the grid moves onto it on its first edit; automatic placement and **Organize** keep their own geometry and are not snapped. Hold Alt (Option on macOS) while dragging to ignore the grid for that gesture, and turn snapping off with the magnet control in the bottom-left stack; the choice is remembered in this browser and never reaches the workflow YAML. An edit that settles where it started stores nothing.

The diagram keeps a layout lock, on every time it is opened: while locked, stages cannot be moved or resized, arrows cannot be adjusted, their edit marks are not presented, and **Organize**, **Undo**, and **Redo** are unavailable; cards, pan, zoom, and pressing an arrow to read its route keep working. A locked diagram presents the selected arrow's route above the stage regions without any edit mark, and focusing an end selects it. The bottom-left control stack holds zoom in, zoom out, fit, undo, redo, organize, the snapping toggle, and the lock, each with a tooltip and an accessible name, and the bottom-right minimap always shows the stages and the current viewport and can be dragged to pan. **Undo** and **Redo** cover stage placement, size, and arrow layout, including one Organize step, via the stack or Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, per board, and are cleared on reload. The wheel zooms at the pointer without a modifier, dragging the background pans, and a pinch zooms; navigation never changes board data. The pan position and zoom are remembered per board in this browser and restored when that board opens, so switching boards and reloading return to the same view; a change that adds or removes a stage and **Fit** re-frame the whole diagram and become the new stored position. The stored position stays in the browser: it is never sent to the host, never edits the workflow, and never appears in the published document.

Cards stay clickable and keyboard reachable: activating one opens the task drawer, and dragging one to another stage runs exactly the same move pipeline as the board, including restricted confirmation, first-execution preparation, and the timed stage instruction. The card's next-stage button uses the same pipeline and is hidden while the task is running. With the diagram open, a card that changes stage is announced by a short transit along the arrow the diagram draws: a bright core with a halo and a short trail, moving at a constant speed from the source stage to the destination. The card itself is never duplicated: it is presented in the destination immediately and pulses once when the transit arrives, so the pulse is what says which card moved. A stage change between two stages the diagram draws no arrow for presents no transit, and the card still pulses as it arrives. More than eight cards moving in one change, and the reduced-motion preference, settle every movement immediately without transit or pulse.

Drag a card to any workflow stage, or use the compact stage control in the task drawer. Cards no longer carry a stage selector; a card moves by being dragged, by the drawer's stage control, or by the card's next-stage button. A permitted move or same-stage reorder is immediate and organization-only; a transition the workflow does not permit opens a confirmation first and moves only after **Move anyway**. Canceling leaves the card in place. Neither the confirmation nor the move itself starts an agent. When the move or the card's play action would start the task's first execution (the task has no conversation), a preparation dialog comes first: it asks whether to create a worktree when the task has none and no recorded base choice, then creates the task's first conversation after that choice is resolved. Task creation does not show that dialog: when the initial stage is instructed and the start option is enabled, it prepares the default worktree and the first conversation automatically, on the board's default model and agent preset when it names ones the host offers and on the host defaults otherwise. A worktree binding that is preparing or in error blocks that first execution until it is resolved in the Git section; a task that already has a conversation keeps executing. When the board names a default model the host offers, the conversation is created on it and the model step is skipped; otherwise the dialog presents DSH's native model selector for the new conversation, showing the deployment default and submitting nothing unless it is changed. Canceling the preparation keeps any worktree or conversation it already created and leaves the card in place. After preparation, a move into a stage with an entry instruction starts a cancelable five-second countdown: the card's play slot becomes a countdown that cancels when clicked, and the drawer shows the same countdown above its panel without changing sections. When the window elapses, the stage's exact instruction is sen... (line truncated to 2000 chars)

Changing stage in the drawer follows the same confirmation rule for a restricted destination, and the same first-execution preparation precedes it for a task without a conversation. For a permitted or confirmed instructed destination it arms the same countdown instead of writing to the composer, and existing drafts or attachments are left untouched. There is no Replace draft flow and the drawer stays in its current section. New task conversations receive the task context once through a visible inline native context row that scrolls with the transcript; the model-facing message is native and injected before the first user message. The context includes a compact first-contact workflow snapshot, not live routing authority; use `get_workflow_summary` to refresh it or continue omitted records. The row is visible in ordinary native Chat and in the drawer when the host supports the native conversation window. Later instructions contain the stage instruction and, when the stage configures two or more transitions, the host's transition briefing. The countdown continues while the card is filtered, the Kanban panel is hidden, or another board or Hub is active; reloading sends nothing and restores the play action.

The play action and the timed send are normal prompt admissions. If one fails, inspect the conversation before retrying; a retry is a new send. Tasks created before this behavior are not backfilled with the first-turn context. Legacy confirmed transitions remain readable and retryable in the drawer, but the current UI does not create them.

### Auto mode

A task can advance without a drag. Its card shows an **Auto** chip in the activity row, and the drawer header mirrors the same chip, whose tooltip and accessible name carry the current state, including a pause reason; auto mode is off by default, belongs to the task rather than to a stage or a conversation, and moving the task by hand does not turn it off. The creation dialog can enable it; enabling it there persists the setting but does not start the first execution, which the **Start execution now** option governs. Turning it on only arms the task: it never moves the card, changes its position, or sends a prompt.


When one of the task's open conversations ends a turn as `completed` and the task owes the user nothing, the host moves the task to its next configured stage and, when that stage has an entry instruction, sends it to the first open conversation, creating a conversation when every tab is closed. The task owes the user any **pending user work** in any of its conversations, including a closed tab: an unanswered structured question round, an unanswered native question, a pending approval, or a user message still queued for the next turn. A queued stage instruction the host sent itself does not count. The host re-reads that state right before it admits the move, so a question admitted during the settle window cannot be bypassed. The destination is the transition the task recorded, while it still resolves; otherwise the first entry of the stage's `allowed_transitions`, or the next stage in workflow order when the stage does not configure transitions. A recorded transition is followed exactly: the task moves to that stage and resolution stops there. Stages without an entry instruction are crossed toward the first reachable instructed stage only on the default path; when no reachable stage has an instruction, the task stops at the last reachable stage. A configured cycle is never looped.

When a stage configures two or more transition targets, the host appends a **transition briefing** to the stage instruction it sends: every target with its authored condition, the transition already declared, the target used when nothing is declared, and the available `set_next_transition` call with the reason it requires. The briefing describes routing without directing the agent to declare a transition. It is built from the live workflow at send time, so an edited workflow never leaves a stale description in the message. A stage with fewer than two targets gets no briefing.

The model declares its choice with `set_next_transition` (or reads the options with `list_allowed_transitions`). A declaration is legitimate when the user asked for it, when the stage instruction asked for it, or when a message from another task explicitly asks for it; normally the destination must be one the current stage configures, and that stage's instruction, conditions, scripted entry, and holds still decide whether the task may leave. Declaring a destination requires a reason, which is how the next stage learns why the task arrived: a blank reason is rejected and an over-long one fails the call instead of being shortened. The call itself never moves the task, sends a message, or changes auto mode — the task moves at the end of a completed turn whether or not auto mode is enabled, which is what lets a workflow route deliberately without asking you to turn auto mode on. Clearing the declaration, by calling the tool with no destination, needs no reason and disarms the declared route: a task whose auto mode is disabled then moves nothing, while one whose auto mode is enabled still advances by the default route at the end of its next completed turn. The write tool acts only on the task that owns the calling conversation, while `list_allowed_transitions` can still read another task. A declared transition belongs to the stage it was declared in and is discarded when the task leaves that stage. If a workflow edit removes the target, the declaration no longer resolves: no advance is admitted, auto mode pauses with `transition-stale` only when it is enabled, and the drawer's next-stage action refuses with the same explanation instead of moving the card. Moving the card by hand, or choosing another stage in the drawer's stage control, clears the pause.

An agent may use the explicit exception flag for an unconfigured existing destination only when directly requested by the user in the same task conversation. The flag is the model's assertion, not independent proof of intent. The host binds it to that task entry and originating turn, admits it only after that turn is observed completing successfully, and retains the usual pending-work, destination and scripted-approval guards. Expired or unverified exceptions cannot be reused; already admitted moves retain normal durable recovery. This does not change the separate manual confirmation for restricted moves or enable auto mode.

When the advance follows a declared transition and the destination stage has an entry instruction, the delivered message is that instruction, then the reason, then the briefing when the stage configures two or more targets; a destination without an instruction moves without delivering the reason. The reason is the only account of the move that reaches the next stage: it is not stored on the task after the move and never appears in the collapsed context row's summary. Because it lives inside the task's recorded transition in this installation's local Hub document, a plugin build older than this release cannot read a Hub that holds one; clear a declared transition before downgrading.

An agent can also stop the chain deliberately. `pause_task` records a pause with a reason the agent has to supply — a blank one is rejected, and an over-long one fails the call instead of being shortened — and the task stops advancing while auto mode stays on, so the user's setting is not lost. The **Auto** chip presents the pause with that reason in the card status strip, in its tooltip, and in its accessible name. Three actions resume the task: activating the **Auto** chip, `resume_task`, or moving the card by hand; disabling auto mode also clears it along with the setting. Sending a message does not resume it, so the workflow stays where the agent left it until someone acts. Resuming never moves the card and never sends an instruction, the next completed turn remains the only trigger, and it never enables a task whose auto mode is off. An agent pause and a failed turn are separate records, so a card can present both. Pausing never clears the recorded transition, and clearing a recording never pauses. The pause is stored inside the task's auto-mode record in this installation's local Hub document, which a plugin build older than this release cannot read: tasks are never published to a shared Hub document, so the only downgrade risk is the local data, and a paused task should be resumed before downgrading.

While the task owes the user input, the **Auto** chip shows a held state (its accessible name names what is missing) and no advance is admitted; the chip returns to armed as soon as the last item is consumed, and no pause is recorded for that wait. The held state is presented only by that control, never in the card status strip or the drawer notice.
