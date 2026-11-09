# DSH Kanban

An independent host/client plugin for **DeepSeek Harness (DSH) 0.2 release candidates from 0.2.1-rc.2**: Hub-scoped Kanban boards, per-board workflows with a column board and a workflow diagram, optional team publishing, optional Git worktrees, shared task notes, and task drawers that reuse native DSH conversations. It does not replace the DSH core, start another server, or clone the chat/agent runtime.

> **Verification boundary:** this plugin is checked through public DSH extension-point contracts, real temporary Git repositories, client integration tests, and the existing DSH GUI. Native conversation/model/scheduler engines remain DSH responsibilities. Acceptance uses a deterministic, test-only model adapter; no real-model request is part of the acceptance path. See [verification status and limitations](<docs/operations.md#verification-status>).

## Requirements

- DSH **0.2.1-rc.2** or newer inside the `0.2` line. The manifest declares `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`, so DSH refuses a bundle outside that range with its own incompatibility report instead of failing later at import time. `0.2.1-rc.5` is the verified host; the range also admits later `0.2` release candidates such as `0.2.2-rc.1`, and the `<0.3.0-0` bound excludes every `0.3` prerelease and release.
- Plugin runtime: **Node.js >=20.19**. Use a normal development Node installation; **Node.js 22+** is required for the optional Inspector helpers' native WebSocket support.
- **pnpm 10.15.1**, as declared by `packageManager` in [the package manifest](<package.json>).
- Git available to the host for worktree operations, and an existing local project/Git repository.
- Native DSH file policy permitting the requested paths. Changing working directory does **not** grant access.

The package is private and marked `UNLICENSED`; these instructions do not grant a license.

## Install

### Install the released plugin

Every release publishes one installable file, `dsh-kanban.tgz`, built from the commit that landed on `main`. Its name is fixed and is part of the install contract, so the install specification never changes between versions. Releases are immutable: each manifest version is published once, and a merge that does not bump the version fails instead of overwriting an existing release.

1. Open **Plugins → Add plugin**.
2. Paste the release asset address into the package field:

   ```text
   https://github.com/filipeesch/deepseek-harness-kanban/releases/latest/download/dsh-kanban.tgz
   ```

3. Enable **dsh-kanban** and inspect the native installation/application result.
4. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar. Use the URL the host printed on launch.

If the item is missing after a reinstall, check for a stale user-layer override before treating it as an activation failure: a `- id: kanban` entry with `disabled: true` in the profile's `cordis.patch.yml` survives reinstalls and hides the row. Enable Kanban in the plugin manager or remove that override, then restart. Confirm with `dsh --profile <profile> --dump-config | grep -A2 'id: kanban'`; see [installation failure signatures](<docs/operations.md#installation-failure-signatures>).

The asset already contains the compiled entries, so this path runs no build and needs no dependency build-script approval. The host treats the address as a tarball, not as a repository, and installs it without scripts. Most DSH SDK packages are peer dependencies that the host installation provides, so the profile does not need its own copy of them. The Typert protocol helper is compiled into the published entries instead: a profile can hoist an older copy of that package, and Node resolves the profile copy before the host installation (see [installation failure signatures](<docs/operations.md#installation-failure-signatures>)). pnpm still downloads the artifact's own runtime dependencies (`zod`, `yaml`, and the editor packages) from the registry, so the installation needs registry access but no build.

### Update an installed plugin

A profile keeps the version it resolved, so adding the same address again does not refresh an existing copy. Update it explicitly from the checkout-independent CLI:

```sh
dsh plugin --profile <profile> update dsh-kanban
```

The command runs pnpm in `$DSH_HOME/profiles/<profile>` (by default `~/.dsh/profiles/<profile>`), fetches the artifact from its release address again, and reports the new manifest version in **Plugins**. Use `--profile desktop` only through the Desktop-owned CLI, which manages that reserved profile.

### Install or pin an exact version

`releases/latest/download/dsh-kanban.tgz` moves to the newest published version. To install a fixed build, use the tag address instead, where the tag is `v` followed by the manifest version:

```text
https://github.com/filipeesch/deepseek-harness-kanban/releases/download/v0.1.2/dsh-kanban.tgz
```

No standalone web server is needed. Do not start Vite or a replacement DSH instance to make this plugin visible. The plugin adds navigation beside Automation tasks and Plugins; it does not configure a startup-page override.

### Install a source checkout (for development)

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
4. Refresh the **existing** GUI URL, then select **Kanban** in its sidebar.

After source changes, deliberately run `pnpm run build` again, explicitly reconcile the rebuilt plugin through the supported native Plugin Manager operation, and refresh that same GUI. On the inspected rc.2 host, public `pluginManager.setBundleEnabled('dsh-kanban', true)` reconciles changed loaded linked-target files even when already enabled; the optional helper exposes this as `enable`. See [the safe rebuild/reconcile procedure](<docs/operations.md#explicit-reconciliation-after-a-rebuild>). A linked checkout is **not** a promise of source HMR or automatic compilation. Inspect application/errors and honor any native restart-required result instead of reporting a hot update as successful.

### Do not install with the repository URL

Pasting `https://github.com/filipeesch/deepseek-harness-kanban` adds a **Git** dependency, not the release download: pnpm clones the default branch, which does not contain `lib/` because it is build output ignored by Git. The host validates the bundle patch after installing but not the package's public entry points, so an unbuilt clone can install as successful and then fail to import on the next start.

The manifest declares a `prepare` script, so pnpm refuses to build a Git dependency unless the profile allows it. The install then fails, and the host restores the profile's `package.json` and `pnpm-lock.yaml` instead of selecting a bundle that cannot load. The host offers no approval button for that refusal. To install from Git anyway, copy the exact key pnpm prints in the refusal into the profile's `pnpm-workspace.yaml` and retry. The key names the resolved commit, so it changes whenever the ref moves:

```yaml
allowBuilds:
  "dsh-kanban@git+https://github.com/filipeesch/deepseek-harness-kanban#<commit>": true
```

An approved run installs the dependency and then runs the build, which needs the profile's package manager on `PATH` plus registry access for the checkout's dependencies. The release asset skips that build and the inner install, but both paths download the artifact's own runtime dependencies from the registry. Prefer the release asset unless you are testing the Git path itself. See [installation diagnostics](<docs/operations.md#installation-and-update-diagnostics>) for the failure signatures.

The latest source installation attempt initially failed fetching from the default registry; a one-shot `https://registry.npmjs.org` override succeeded without changing package-manager or DSH settings. This is observed network troubleshooting, not a requirement to change your registry. See [installation diagnostics](<docs/operations.md#installation-and-update-diagnostics>) and the optional local Inspector procedure there.

## Hubs and boards

A **Hub** is a logical group of projects and boards. It has a name only: no filesystem root and no native DSH workspace. Projects belong to one Hub, and every task belongs to one board and one project in that Hub. Boards are selected inside the active Hub; each board owns its own YAML workflow and uses every project of that Hub. The active Hub and the last board used per Hub are remembered in browser local storage. An installation always has at least one Hub; the last Hub cannot be deleted. Deleting a Hub is allowed only when none of its boards has a task, and it removes its empty boards and task-free project registrations without deleting project directories, worktrees, branches, native conversations, or native workspaces. The worktree base path remains global.

## First use

1. The installation starts with **My Hub** and a **Kanban** board. Use the **+** beside the Hub or board tabs, or Configuration → Hub, to create another Hub or board. A new Hub starts without boards and presents **Create your first board**. Optionally open **Configuration → General** and choose an existing absolute **Worktree base path** for new task worktrees; without one, destinations derive beside the repository. Then open **Configuration → Projects** (or **Configure projects** on a board without projects). The section is a registry list; **New project** and **Edit** open the project dialog. Choosing or typing an absolute **Project path** runs detection: a repository reports its Git root and a suggested default branch (`origin/HEAD`, then `main`, then `master`, then the current branch), while a plain directory reports that no repository was found. The Git root and default branch stay editable, detection never overwrites a field you changed, and a blank Git root registers a folder project. Saving validates existing canonical directories, containment, and, for a Git-backed project, that the Git root is the repository top level; registration does not start a native agent or grant Git access.
2. Select **New task** at the top of the active board's configured initial column and supply its title, Markdown description, and registered project. The project select starts empty and must be chosen explicitly, even when a project filter is active. The dialog also offers **Auto mode** (off by default) and, only when the initial stage has an entry instruction, **Start execution now** (on by default). Saving creates a card in that initial stage. When the start option applies, the host creates the task's default worktree (or uses the project directory for a folder project), creates the first conversation with the deployment default model, and arms the cancelable five-second countdown for the stage instruction; the card and drawer show a preparing state first, canceling keeps the created resources, and a failure leaves the card and its **play** action. Without the start option, saving creates no native conversation and starts no agent. The first conversation can also be created later from a preset card in the Conversations section or by the first-execution preparation that precedes an instructed move or the card play action.
3. Open the card. Its drawer contains **Conversations / Info / Git / Notes** for a Git-backed project, and omits **Git** for a folder project. A task starts with no conversation: the Conversations section presents the agent-preset cards, and **+** opens the same choice to create the first or another distinct, continuous native conversation. For a Git-backed task without a worktree, the first conversation waits until the worktree notice is resolved: create or attach a worktree and wait until it is ready, or choose to continue in the base project. Closing/reopening a tab or drawer preserves its association and history.
4. Send messages through the native composer when you want execution. **Info** shows the title and Markdown description read-only until you select **Edit**; saving never messages agents. **Notes** stores Markdown shared by every conversation of that task, not a per-chat collection. Each note keeps up to four lowercase tags, shows a 250px Markdown preview, and opens in a wide editor overlay with Markdown and Tags, an Edit/Preview switch, and a delete action; a tag bar filters the list by one tag at a time and remembers the choice per task. The drawer header is one compact row on a wide drawer and two rows on a narrow one: the section icons come first, the task title sits beside its project chip, and the stage control, the next-stage action, the auto-mode chip, delete, and close follow. The Conversations tab carries one activity dot while an agent runs or background work is unsettled, with the facts in its tooltip and accessible name. The stage control lists every workflow stage in order, marks stages that require confirmation with lower emphasis, and offers a one-click advance to the next stage with the same rules. Conversation tabs use the native session title.
5. Search titles/descriptions and optionally combine that search with a project filter. Execution state is separate from workflow stage: a pulsing accent bar on the card's trailing edge shows a running assistant turn, and blue unread, orange awaiting-reply, and red failure indicators can coexist across the task's conversations. Background work is no longer shown on the card; the drawer's Conversations tab keeps it available as an activity dot with the labels on hover and for assistive technology. Each card's action row carries the **Auto** chip, the stage run action when it applies, and a next-stage button.

The board moves cards instead of jumping them. A card that changes stage, or that another card displaces, glides from its previous position to its new one, and a card that appears or leaves fades briefly; a leaving card fades as an inert copy that does not extend the board's scroll area. The movement follows any cause — a drop, the drawer stage control, a confirmed restricted move, an automatic advance, a team-sync update, or a deletion. A card that only grows or shrinks settles immediately, as does changing Hub or board, changing the search or project filter, and a change that makes more than eight cards enter or leave at once. The system `prefers-reduced-motion` preference removes the movement and the fades without changing card content, focus, activation, or drag behavior; the plugin adds no motion setting of its own.

Embedded chat uses native transcript, composer, tools, execution, permissions, and session services. Under design assumption **A7**, auxiliary native file/fork/workspace actions are **not guaranteed to remain contained in the drawer**. The plugin supplies the scoped native session/provider and delegates these actions to DSH; it does not reimplement or requalify their navigation. Do not assume every native action is an embedded-only action.

Branching a retained task conversation adopts the fork as another conversation of that task: the plugin appends it as an open tab, aligns it to the task's effective directory, and owns it for deletion and shared-worktree protection. The host still opens a branch in the native session view, and the drawer does not select the new tab automatically. A fork of a subagent descendant, or a fork whose adoption failed, stays outside the task.

In the **Conversations** section, the drawer hosts DSH's public native conversation window for the active task conversation: Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner, followed by the transcript, composer, and statistics footer. When the task has no open conversation, the drawer presents the host's agent-preset roster as cards; choosing a card creates the conversation, applies that preset, and opens it. The plus action opens the same card choice for another conversation, and a failed preset selection leaves the conversation on the host default with the card available to retry. The host's own preset seat and read-only mode label self-hide outside the main panel, so the drawer does not rely on them. View selection, pin choices, and the draft stay shared with the main panel. Lineage and subagent-catalog entries follow native DSH navigation instead of opening a drawer-local peek, so the task conversation tabs remain root-session-only. The close action sits inside the active conversation tab. The window requires a DSH host that declares `conversation.window`; on an older host the drawer shows an update notice instead of a hand-built header. Pinning the manifest to that host release remains a follow-up.

When the DSH sidebar is fully collapsed on macOS, the Kanban header uses the host-published frame leading clearance so its title, subtitle, and toolbar clear the window traffic lights and shell controls. The header falls back to its normal inset when the clearance is absent and reflows at narrow widths.

## Workflow and deliberate execution

**Configuration → Board** edits the active board's YAML in a code editor with line numbers, YAML highlighting, folding, search, live diagnostics, vertical resize, and a maximize toggle. Save is disabled while the YAML is invalid or still checking; the host remains authoritative for orphaned columns and revision conflicts. The draft survives Configuration tab switches, and closing or reloading with unsaved changes asks first. Configuration opens on **General**; the empty-board **Configure projects** action opens **Projects**. Each new board starts with exactly five stages and **no entry instructions**:

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

An omitted `default_view` opens the column board, and switching never edits the workflow YAML or reaches the host. The diagram fills the board body edge to edge and draws one rounded region per stage with the board's own cards, and connects stages from their configured transitions: `allowed_transitions` entries are solid lines, a stage without them gets one dashed line to the next stage, and `[]` has no outgoing line. Connections are orthogonal with rounded corners; multiple targets leave the same stage at distinct points, a target equal to its stage is a reorder rather than a line, a connection to an earlier stage runs below the stages, and pointing at a connection reveals its contact points at both ends. Stage positions and the connections attached to a stage follow it while it is dragged or resized.

Stages are placed in layers automatically; each stage's authored `position` overrides that placement, and **Organize** recomputes and stores every position. A missing position is placed automatically and stays put for the session. Each stage also accepts an optional `size`, which is the minimum width and height it renders at: the stage still grows with its cards, never shrinks below that minimum, and can be resized by its trailing corner while editing is unlocked. A missing size uses the diagram's default stage size. Dragging a stage by its header or resizing it stores one workflow save; the change follows the same validation, draft, publishing, and sharing-merge rules as any other workflow edit, with sizes merging per stage exactly like positions.

The diagram keeps a layout lock, on every time it is opened: while locked, stages cannot be moved or resized and **Organize**, **Undo**, and **Redo** are unavailable; cards, pan, and zoom keep working. The bottom-left control stack holds zoom in, zoom out, fit, undo, redo, organize, and the lock, each with a tooltip and an accessible name, and the bottom-right minimap always shows the stages and the current viewport and can be dragged to pan. **Undo** and **Redo** cover stage placement and size, including one Organize step, via the stack or Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, per board, and are cleared on reload. The wheel zooms at the pointer without a modifier, dragging the background pans, and a pinch zooms; navigation never changes board data.

Cards stay clickable and keyboard reachable: activating one opens the task drawer, and dragging one to another stage runs exactly the same move pipeline as the board, including restricted confirmation, first-execution preparation, and the timed stage instruction. The card's next-stage button uses the same pipeline and is hidden while the task is running. With the diagram open, a card that changes stage travels along the drawn connection (or a direct path when none is drawn) with short fades; more than eight travelling cards and the reduced-motion preference settle immediately.

Drag a card to any workflow stage, or use the compact stage control in the task drawer. Cards no longer carry a stage selector; a card moves by being dragged, by the drawer's stage control, or by the card's next-stage button. A permitted move or same-stage reorder is immediate and organization-only; a transition the workflow does not permit opens a confirmation first and moves only after **Move anyway**. Canceling leaves the card in place. Neither the confirmation nor the move itself starts an agent. When the move or the card's play action would start the task's first execution (the task has no conversation), a preparation dialog comes first: it asks whether to create a worktree when the task has none and no recorded base choice, then creates the task's first conversation after that choice is resolved. Task creation does not show that dialog: when the initial stage is instructed and the start option is enabled, it prepares the default worktree and the first conversation automatically, using the deployment default model. A worktree binding that is preparing or in error blocks that first execution until it is resolved in the Git section; a task that already has a conversation keeps executing. The dialog then presents DSH's native model selector for the new conversation, showing the deployment default and submitting nothing unless it is changed. Canceling the preparation keeps any worktree or conversation it already created and leaves the card in place. After preparation, a move into a stage with an entry instruction starts a cancelable five-second countdown: the card's play slot becomes a countdown that cancels when clicked, and the drawer shows the same countdown above its panel without changing sections. When the window elapses, the stage's exact instruction is sent to the task's first open conversation, creating the first conversation when none is open (for example, when every conversation is closed). Cancel stops only the automatic send; the move stays and the card's **play** action returns. The play action also sends the current instruction immediately for an unresolved entry, after the same preparation when the task has no conversation. A failed timed send is reported on the card and in the drawer and is not retried automatically. Worktree creation is offered from the missing-worktree notice, the Git section, or the first-execution preparation.

Changing stage in the drawer follows the same confirmation rule for a restricted destination, and the same first-execution preparation precedes it for a task without a conversation. For a permitted or confirmed instructed destination it arms the same countdown instead of writing to the composer, and existing drafts or attachments are left untouched. There is no Replace draft flow and the drawer stays in its current section. New task conversations receive the task context once through a visible inline native context row that scrolls with the transcript; the model-facing message is native and injected before the first user message. The row is visible in the drawer and in ordinary native Chat wherever that conversation is rendered. Later instructions contain the stage instruction and, when the stage configures two or more transitions, the host's transition briefing. The countdown continues while the card is filtered, the Kanban panel is hidden, or another board or Hub is active; reloading sends nothing and restores the play action.

The play action and the timed send are normal prompt admissions. If one fails, inspect the conversation before retrying; a retry is a new send. Tasks created before this behavior are not backfilled with the first-turn context. Legacy confirmed transitions remain readable and retryable in the drawer, but the current UI does not create them.

### Auto mode

A task can advance without a drag. Its card shows an **Auto** chip in the activity row, and the drawer header mirrors the same chip, whose tooltip and accessible name carry the current state, including a pause reason; auto mode is off by default, belongs to the task rather than to a stage or a conversation, and moving the task by hand does not turn it off. The creation dialog can enable it; enabling it there persists the setting but does not start the first execution, which the **Start execution now** option governs. Turning it on only arms the task: it never moves the card, changes its position, or sends a prompt.


When one of the task's open conversations ends a turn as `completed` and the task owes the user nothing, the host moves the task to its next configured stage and, when that stage has an entry instruction, sends it to the first open conversation, creating a conversation when every tab is closed. The task owes the user any **pending user work** in any of its conversations, including a closed tab: an unanswered structured question round, an unanswered native question, a pending approval, or a user message still queued for the next turn. A queued stage instruction the host sent itself does not count. The host re-reads that state right before it admits the move, so a question admitted during the settle window cannot be bypassed. The destination is the transition the task recorded, while it still resolves; otherwise the first entry of the stage's `allowed_transitions`, or the next stage in workflow order when the stage does not configure transitions. A recorded transition is followed exactly: the task moves to that stage and resolution stops there. Stages without an entry instruction are crossed toward the first reachable instructed stage only on the default path; when no reachable stage has an instruction, the task stops at the last reachable stage. A configured cycle is never looped.

When a stage configures two or more transition targets, the host appends a **transition briefing** to the stage instruction it sends: every target with its authored condition, the transition already recorded, and the target used when nothing is recorded, together with the `set_next_transition` call that records the choice. The briefing is built from the live workflow at send time, so an edited workflow never leaves a stale description in the message. A stage with fewer than two targets gets no briefing.

The model records its choice with `set_next_transition` (or reads the options with `list_allowed_transitions`); recording, replacing, or clearing a transition never moves the task, sends a message, or changes auto mode, and it works while auto mode is off. A recorded transition belongs to the stage it was recorded in and is discarded when the task leaves that stage. If a workflow edit removes the target, the recording no longer resolves: the automatic advance admits nothing and pauses with `transition-stale`, and the drawer's next-stage action refuses with the same explanation instead of moving the card. Moving the card by hand, or choosing another stage in the drawer's stage control, clears the pause.

While the task owes the user input, the **Auto** chip shows a held state (its accessible name names what is missing) and no advance is admitted; the chip returns to armed as soon as the last item is consumed, and no pause is recorded for that wait. The held state is presented only by that control, never in the card status strip or the drawer notice.

The advance is a host action: it works while the Kanban panel is hidden or another board or Hub is active, and reloading the UI neither cancels nor duplicates it. It does not arm the five-second countdown, requires no confirmation, and never asks for a worktree choice. Only a completed turn advances: `error`, `blocked`, `aborted`, and `max-tokens` endings leave the card in place and show a pause reason on the card and in the drawer, and the next completed turn re-evaluates the task. An advance that cannot be admitted before a durable transition pauses with an admission-failure reason. An admitted advance that fails is reported through its transition state, keeps auto mode enabled, and is not retried automatically: the card play action remains available for the unresolved entry, and the drawer offers an explicit retry or a dismiss of the failed record. Sending the stage instruction manually also clears the failed record. Reading a conversation does not clear a pause. Disabling auto mode stops future advances, forgets a turn that has not settled yet, and does not retract an advance that was already admitted.

The host does not catch up: a turn that ended while the plugin was not observing its conversations is not replayed after a restart, and the chain resumes on the next completed turn. An advance that was already persisted is still dispatched after a restart, exactly like a confirmed transition.

## Team Settings

Team sharing is optional and applies per Hub. **Configuration → Team Settings** starts with a **Storage** choice presented as four cards, each with an icon and a one-line description: **Git repository**, **Google Drive Cloud**, **Google Drive Local**, and **Local folder**. The section then renders that storage's surface. A Hub binds exactly one storage, and changing the storage requires **Disconnect**.

### Git repository

With Git selected, the section connects the active Hub to a repository. The plugin creates a managed clone under the DSH data root (`$DSH_HOME/kanban/shared/<hubId>`, by default `~/.dsh/kanban/shared/<hubId>`), commits there, and never stores credentials: Git supplies them from the machine's own configuration. Without a connection, no clone, check, or sharing state exists and the rest of the product behaves exactly as before.

Saving a board or workflow changes only local state and marks that board as a **Draft**. The workflow editor offers **Save workflow** and **Save and share**; a share that fails leaves the local save in place and reports the failure. **Publish** sends every draft of the Hub as one document, and it is unavailable while team updates are unapplied. **Get updates** compares the last received document, the local Hub, and the team document; boards changed only by the team are applied, boards changed only locally stay drafts, and a board changed on both sides requires a per-board choice. Stage placement stored in the workflow YAML never requires that choice: a placement-only difference is merged per stage, the locally moved stage wins when both sides moved it, and the authored text of the side that changed the workflow's meaning is kept. The merged board stays a draft until it is published.

### Google Drive Cloud

With Google Drive Cloud selected, **Connect Google Drive** opens the system browser. The plugin uses an installed-application OAuth flow (loopback redirect plus PKCE), stores the authorization in the host credential store, refreshes it without another sign-in, and supports disconnecting and switching accounts. Tokens never appear in the document, snapshot, logs, or board content. The default OAuth client id is versioned in the plugin; `DSH_GOOGLE_DRIVE_CLIENT_ID` and `DSH_GOOGLE_DRIVE_CLIENT_SECRET` override it for an organization's own Google Cloud client. The consent request asks for `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive`; the Drive scope is the one required to list the chosen location, read and write the Hub document, and observe changes. The client must be of type **Desktop app**.

The authorization is stored in the host credential store (`$DSH_HOME/.credentials.yaml`, mode 0600), not in an OS keychain: any process running as the same user can read it. The browser and the DSH host must run on the same machine, because the OAuth callback returns to a loopback port on the host; a remote browser cannot complete the flow. The default client's real-world consent and restricted-scope verification have not been accepted by this implementation and remain release prerequisites.

The published external app must complete Google's restricted-scope verification before accounts outside its test list can authorize it. While the app is in Testing, refresh tokens expire after seven days; an Internal Workspace app avoids that limit but serves only the organization. The plugin attempts the token exchange without a client secret because Google's installed-app documentation marks it optional; if the client requires the public desktop secret, configure it through the same override and the failure is reported explicitly.

After authorization, choose My Drive or a Shared Drive and a folder. The binding records the Drive, folder, and document file IDs; names are not used after the connection. The plugin creates `kanban-hub.yaml` when the folder is empty and adopts it when present, never touches other files in the folder, and never deletes the team document on Disconnect or Hub deletion. A folder already bound to another Hub is refused.

Google Drive synchronizes automatically and in both directions. Saving a board, board name, order, or workflow marks the Hub pending and synchronizes after a short debounce; a check every minute uses the Drive change feed and reads the document only when its revision changed. Team-only changes apply automatically in one Hub transaction. A board changed on both sides, a blocker, or a concurrent write requires review and is never overwritten silently. Offline changes stay pending, retry on later checks, and survive a restart. Drive has no Publish or Get updates action; **Sync now** retries immediately, and the section shows pending, conflict, offline, and error states.

A Drive write compares the document token before writing and verifies the written content after writing. Google Drive provides no server-enforced conditional write, so a concurrent change can be detected but not prevented; the previous content remains in the Drive revision history, and the local changes stay pending for review. Git keeps its atomic stale-write refusal.

### Google Drive Local

With **Google Drive Local** selected, the Hub publishes into a folder that the installed Google Drive for desktop application already mounts on this computer. This storage needs no Google account authorization and never calls the Google Drive API: the desktop client carries the document between machines, exactly like any other synchronized folder. Projects, tasks, notes, conversations, worktrees, and Hub names stay local.

The plugin discovers the mounted locations from local evidence only. On macOS it reads the File Provider accounts under `~/Library/CloudStorage`, the per-account mount points in the `com.google.drivefs.settings` preferences, and the legacy `/Volumes` mounts; on Windows it reads the configured mount point from the DriveFS registry keys and validates the volumes the system reports. No fixed path, volume name, or drive letter is assumed, and one unreadable source does not hide the others. A machine without the application, a platform without it, an account that is not mounted, and unreadable settings are reported as distinct states with a **Rescan** action.

**Choose folder** opens a browser over the discovered locations: the accounts on the left, a clickable breadcrumb and the folders of the current location on the right, a filter for the current level, and the host's native folder picker as an alternative. The browser marks whether the current folder already contains `kanban-hub.yaml`, and it shows the real folder names: My Drive and Shared Drives are grouped only when the names are recognized, and an unrecognized localized name is shown literally. The plugin never creates, modifies, or deletes anything while browsing.

Connecting requires the folder to resolve inside a discovered location; a folder outside every location, an unavailable mount, a path that is a file, a folder the plugin cannot write, a folder already bound to another Hub, and the plugin's own managed workspace are each refused with the specific condition named. The plugin creates or adopts `kanban-hub.yaml` in the chosen folder and never touches another file.

The binding records the resolved folder path plus the account and location labels for display. A folder that moves, a mount that disappears, or the application being removed turns the Hub unavailable with a typed failure, keeps every local change pending, and resumes without a new selection when the same path becomes readable again. **Change folder** is available while the Hub is connected: after a confirmation it opens the same browser and follows the first-connection choice for the new folder, keeping every local board, task, note, project, conversation, and worktree while discarding the previous board bindings.

Google Drive Local synchronizes automatically and in both directions, exactly like a local folder: saving a board, board name, order, or workflow marks the Hub pending and synchronizes after a short debounce; a check every minute observes the document's last-modified time and size and reads it only when they changed; team-only changes apply automatically in one Hub transaction; a board changed on both sides, a blocker, a conflict copy, or a concurrent write requires review. Offline changes stay pending, retry on later checks, and survive a restart. **Disconnect** removes the binding and keeps the folder, `kanban-hub.yaml`, every other file, and the installed application.

### Local folder

With Local folder selected, the Hub publishes into one directory on this machine. That directory is normally one that a desktop client already synchronizes: Google Drive for desktop, OneDrive, Dropbox, or any other. The plugin reads and writes `kanban-hub.yaml` there and never touches another file, so the desktop client carries the document between machines and the plugin needs no account, credential, network call, or managed workspace.

The path field is pre-filled with `~/.dsh-kanban/<hubId>`. Connecting to exactly that path creates the folder; connecting to any other path requires a folder that already exists and is writable. A path that is missing, is a file, cannot be written, is already bound to another Hub, or sits inside the plugin's own managed publishing workspace is refused with the specific condition named. The folder picker fills the field when the host provides one, and typing a path always remains available. Symlinks are resolved before the binding is stored, so two spellings of one directory cannot bind two Hubs.

The local folder synchronizes automatically and in both directions, exactly like Google Drive: saving a board, board name, order, or workflow marks the Hub pending and synchronizes after a short debounce; a check every minute compares the document's last-modified time and size and reads the content only when they changed; team-only changes apply automatically in one Hub transaction; a board changed on both sides, a blocker, or a concurrent write requires review. Offline changes stay pending, retry on later checks, and survive a restart. A local folder has no Publish or Get updates action; **Sync now** retries immediately.

A write compares the document token, writes a temporary sibling file, renames it over the document, and verifies the written content. A reader therefore sees either the previous complete document or the new one, never a partial file, but the filesystem cannot make "compare and replace" atomic against another process: the guarantee is the same as Google Drive's, not Git's atomic refusal. Because the desktop client uploads asynchronously, a change made on another machine is only visible here once the client downloads it, and two machines writing close together can produce a conflict copy.

When the client creates a conflict copy, the check reports it as a storage review that names the copies, blocks automatic synchronization, and never merges, renames, deletes, or prefers a version. Decide which version is current, delete or rename the other copies in the folder, and the next check clears the review and resumes synchronization. Disconnecting, deleting the Hub, or rebinding never deletes the folder, the document, or any other file.

### Shared document and board rules

The shared document is `kanban-hub.yaml`. It contains a format version and one ordered entry per board: a stable key, the board name, and the board's workflow YAML exactly as authored. Projects, tasks, notes, conversations, worktrees, Hub names, and settings stay on the local machine, and the board key survives renames.

When the team removes a board, an empty board disappears locally, while a board with tasks or unpublished changes stays as an **orphan** with an indicator on its board tab. An orphan can be published again as a new board with a new key, deleted locally, or reconnected automatically when the team publishes a board with the same key or the same name. Removing a board that belongs to the published configuration asks whether the removal applies only here or for the team; a local-only removal is not included in later updates, while a team-wide removal is sent with the next publish (Git) or automatic synchronization (Google Drive Cloud, Google Drive Local, or a local folder).

A published Hub checks its storage automatically: every five minutes by default for Git and every minute for Google Drive Cloud, Google Drive Local, or a local folder. The interval is editable per Hub (minimum one minute; `0` disables automatic checks and leaves **Refresh** or **Sync now**), and a check never blocks the board. Sharing state appears in the host snapshot, so the Hub tab and each board tab show their own indicators and the board shows a banner when team changes need review. **Disconnect** removes the binding and any plugin-managed workspace (the Git clone) and keeps every local board, workflow, task, note, project, conversation, and worktree; the Google Drive account authorization remains available to other Hubs, the installed Google Drive for desktop application is untouched, and the team document and the bound folder are unchanged.

## Worktrees and native boundaries

Worktree and Git affordances exist only for Git-backed projects; a folder project uses its project path directly. A task can work directly in its base project. The notice above chat previews the derived branch, destination, and source and offers **Create worktree** to create immediately with those values, **Review in Git**, or **Continue in base project**. The base-project choice is persisted on the task and hides the notice; it creates no Git resources and leaves every effective directory unchanged. While a Git-backed task has no worktree and no recorded choice, its first explicit Start/`+` is withheld; creating or attaching a ready worktree or choosing the base project unlocks it. The first execution from a move or the play action asks the same question in its preparation; the creation start uses the default worktree without asking. A Git-backed project always has a derivable default destination: with a configured base path it is the base path joined with the branch, and without one it is a sibling of the repository named `<repository>-<branch>`. **Git** presents the worktree as no-worktree, creating, ready, or error and shows only the applicable branch, path, state, and actions. The Git form also accepts an empty source branch and lets the host fall back to the project default branch or HEAD. Branch selectors are searchable over local branches; remote refs are accepted only as an explicitly entered source for a **new** branch. Existing-branch mode never silently creates a detached remote checkout. Attaching an existing checkout remains a secondary action in the no-worktree state; attachment reuses the checkout and branch rather than creating them. Unclaimed checkouts appear as a compact warning.

**Configuration → General** sets an optional worktree base path. The Git form derives a new branch name from the task title (lowercase ASCII, hyphenated, at most 48 characters, with `task` as the fallback) and prefills the destination with the base path joined to that branch; without a configured base path it prefills the repository sibling `<repository>-<branch>`. Collisions append `-2`, `-3`, and so on to both values, checking local branches and occupied destinations. Both fields stay editable: the destination follows the branch until you edit it, and **Use default path** restores the derived destination. Existing-branch mode keeps the chosen branch and does not apply a counter. Changing or clearing the base path never moves or renames existing worktrees, and existing UUID-based branch names are left unchanged. Workflow columns are content-height: a column grows with its cards instead of clipping them, and the board page scrolls vertically.

For a monorepo, the effective agent directory is:

```text
base:     <git-root>/<relative-project-path>
worktree: <worktree-root>/<relative-project-path>
```

The required subdirectory must exist. There is no fallback to the Git root or worktree root. The all-idle coordinator waits for **every** associated conversation, including closed tabs and known native jobs, descendants, schedules, and pending interactions. Partial switches are journaled, not represented as an atomic all-session transaction. An explicit return can retain a checkout binding while the **active effective cwd is the base project**; the retained checkout is not automatically active again. **Unclaimed worktrees** are diagnostic-only paths left on disk, never active or destructive targets; task deletion leaves them untouched.

Clearing a project's Git root makes it a folder project; the change is rejected while a task of the project has an unresolved context operation or a pending worktree request. A checkout that loses its Git association becomes a plain checkout: its conversations keep running there, every Git action is withheld, and the checkout is never deleted by the plugin. Deleting such a task archives its conversations, removes its card and notes, leaves the checkout on disk, and reports the retained path. The first task conversation, and every later one, joins a native DSH workspace for its effective project or worktree path instead of being created with cwd only. A worktree created before the first conversation therefore gives that conversation's native session the worktree header. Existing conversations keep their creation-time workspace when the effective directory changes; relative image references in those conversations can continue to resolve against that creation-time header, which is an accepted limitation. The base-project workspace is shared by tasks in that project; a worktree workspace belongs to its task and uses the `project · branch` title. A pre-existing workspace is reused and never renamed. Task worktree and session-directory workspaces are registered hidden by default when the host exposes workspace visibility; the shared base-project workspace stays visible. A pre-existing worktree workspace is hidden once when the plugin adopts it, and an owned worktree workspace is removed when its task is deleted if no session outside the task's conversation lineage uses it. Hiding is best effort and never blocks a conversation. Existing workspaces are not hidden retroactively, and a workspace revealed in the DSH sidebar is never re-hidden by startup reconciliation. On a DSH build without workspace visibility, the plugin uses the original workspace API and every workspace remains visible. A task's own direct and nested native subagent descendants belong to its lineage, and a fork the task adopted is another retained conversation; a fork no task adopted and unrelated sessions remain foreign. Successful native `workingDirectory` changes preserve session IDs, histories, and immutable header cwd. **Native workspace grouping, Files, and sandbox root remain tied to the original location.** Effective cwd is shown in Git details, not as workspace migration or authorization. Policy preflight plus native confinement can honestly deny out-of-root or read-only operations, including access to monorepo Git metadata. Execution guards revalidate existing canonical context after native recovery and before model use. See [policy and recovery](<docs/operations.md#working-directory-and-policy-boundaries>).

Task archiving is removed. **Delete task** is the only task lifecycle action. A confirmed deletion is admitted from persisted state only (the task exists, its recorded worktree binding still matches the confirmation, and no other operation holds it), recorded, and then executed in the background, where the authoritative checks for idleness, the canonical target, checkout sharing, and local changes run before any cleanup: it returns every retained chat to the base project, removes the eligible bound worktree, archives native chats **without erasing histories**, and removes the card/notes; the branch is preserved. The confirmation closes on acceptance and the card, board notice, and drawer report queueing, progress, and failure. A plain checkout whose project has no Git root is the exception: its chats are archived in place, the checkout stays on disk, and the result reports the retained path. **Remove worktree** retains the task and uses the same background admission and queue. Neither cleanup substitutes the base project/Git root for a missing worktree. Target checks, shared-use protection, and additional dirty/untracked-file discard consent apply. When a deletion or worktree removal fails the sharing preflight with `SHARED_WORKTREE`, the failure surfaces offer a consented **Force remove checkout** action: it lists every affected task and native conversation, requires an explicit opt-in, and removes the shared checkout, marking other bound tasks with a persisted worktree error without rewriting their effective directory. Force bypasses only the sharing guard; host policy, discard consent, idleness, and the refusal to force while another task operates on the same checkout still apply. A task's own retained conversations, a fork the task adopted, and their direct/nested native subagent descendants form its conversation lineage; a fork no task adopted and unrelated sessions remain foreign. An already-absent checkout is treated as already removed, and the structured confirmation identifies an externally attached checkout and states that the checkout itself will be removed while its branch is kept. A bulk selection uses one confirmation that closes on accept and leaves selection mode immediately, so the board is never held while the deletions are admitted. Every selected task is dispatched as an individual background deletion, tasks accepted by the host leave the selection, and a task whose persisted state cannot be admitted is reported as a board error. There is no bulk result dialog: later failures appear in each card's status and in the destructive-operation notice, where a busy conversation defers the deletion and local changes still require their own discard consent. Review [the lifecycle procedure](<docs/operations.md#archive-remove-and-delete>) before destructive actions.

## Questions and model-facing tools

Rich question rounds work in task and ordinary DSH chats: single/multiple choice or text, Markdown explanations, recommendations/rationales, importance, Other, and notes. The active round is a fixed strip docked directly above the composer, like the host Todo and Goal bars: the chat scrolls while the strip stays in place, it collapses to its header bar, and it is expanded by default. Every question is one slide with its choices, focused-choice description, optional per-answer Notes, and Next; the last slide is always **Additional Notes**, and Submit exists only there. Pages may arrive incrementally and stack into the strip while answers are retained; a page that arrives while Additional Notes is open is announced with an action that opens it without losing the draft. **Submit** sends **one ordinary textual reply** in the originating conversation and the strip leaves the dock immediately, restoring the draft and showing the admission error if the send fails. Submit stays disabled until the agent's turn ends and every answer is valid, and the footer explains that turn-completion gate. Question state streams per conversation, independently of the board snapshot, so turn completion, retirement after Submit, and retirement after an ordinary chat reply do not wait for board attention projection. Question rounds are stored durably per conversation, not per task, so an unanswered round returns after reload. Form drafts and the collapsed state remain live UI state; do not rely on unfinished answers surviving reload. This does not create a native pending tool/question, settle native approvals, or write a decision ledger.

Registered tool names are defined in [the product tool implementation](<src/host/tools/index.ts>):

| Scope | Tools |
| --- | --- |
| Discover Hubs, boards, projects, and tasks | `list_hubs`, `list_boards`, `list_projects`, `get_board_summary`, `list_cards`, `get_card` |
| Explicitly requested card creation and text changes | `create_card`, `edit_card` |
| Transition routing for the next advance | `list_allowed_transitions`, `set_next_transition` |

| Explicitly requested board administration | `create_board`, `update_board`, `edit_board_yaml`, `delete_board` |
| Shared task notes | `create_note`, `list_notes` (tag filter), `update_note` (content and/or tags) |
| Optional question page | `decision_request` |

Board reads are available in ordinary chats and task conversations; board writes are available only in an ordinary DSH chat, and a session owned by a task or by one of its subagent descendants is rejected. `create_card` accepts `auto_mode`; when the board's initial stage has an entry instruction it prepares the first execution and dispatches the stage instruction in the same call and reports the outcome, because the agent surface has no cancelable countdown. The board is the discovery anchor: use `list_hubs`, then `list_boards`, then pass `board_id` to board-scoped tools. A task conversation can resolve its own board for reads; an ordinary chat without a board receives an actionable error rather than using UI state or a default. Read the exact authored YAML with `get_board_summary` and `include_workflow:true`. Prefer `edit_board_yaml` for targeted prompt or transition changes: each `old` text must occur exactly once, every edit in the call is applied together, and the result is validated before saving. Use `update_board` with the complete YAML only when restructuring. `update_board`, `edit_board_yaml`, and `delete_board` accept the optional Hub revision from the read and reject a stale one. `delete_board` requires explicit confirmation and an empty board; a team-bound board also requires a `local` or `team` removal scope, and projects, worktrees, conversations, and native workspaces are kept. A board write publishes automatically when its Hub is bound: explicit Git publishes after the local save, continuous storage is left to automatic synchronization, and a publishing failure never rolls back the local change. A local-only removal never publishes. Hub creation, rename, and deletion remain UI-only. Board/note writes require the user's explicit request, not unsolicited internal progress tracking; there is no additional product approval modal for those requested writes, and native permissions still apply. Intent text is an agent-use rule, not a deterministic consent detector.

The question strip's footer has a **Dismiss** action on the left. An untouched round dismisses immediately; a populated draft asks for inline confirmation. Dismissing removes every unresolved round in that conversation, sends no chat message, and permanently hides the round from reload/replay while leaving the composer available. Future rounds still appear.

Recording a transition is routing information for the next advance, not a move: it never changes the task's stage or position. There are **no model tools to move or delete cards, message another card, or administer Hubs**, no plugin checklist or decision ledger, and no plugin terminal or full Git/code-review integration; the workflow surface has a YAML editor. Existing native DSH features are not removed.

## Development and evidence

```sh
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
# Or run those checks in sequence:
pnpm run check
# Manual before release, against an installed and built DSH checkout:
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
```

Host and client types deliberately compile as **separate TypeScript Programs** through [host configuration](<tsconfig.host.json>) and [client configuration](<tsconfig.client.json>); do not combine their native SDK augmentations into one Program. [The build script](<scripts/build.mjs>) emits host ESM, the browser module-loader bundle, and separate public declarations. [The check script](<scripts/check.mjs>) runs both typechecks, tests, and the build with the invoking Node executable. Use normal development Node for tests: the hardened DSH-bundled Node has rejected the Rollup native addon because its Team ID differs. Do **not** weaken code signing to run the suite.

The [initial product change](<openspec/changes/archive/2026-10-22-define-kanban-product/proposal.md>) and [approved verification boundary](<openspec/changes/archive/2026-10-22-define-kanban-product/design.md#compatibility-gates-and-verification-strategy>) define the base release. The [current UX refinement change](<openspec/changes/refine-kanban-ux/proposal.md>) captures the delete-only lifecycle, direct-manipulation board, workspace binding, compact drawer/Git surfaces, and deterministic test adapter. The [verification report](<docs/verification-preliminary.md>), [scenario matrix](<docs/scenario-evidence.md>), [run register](<docs/verification-runs.json>) and [independent product review](<docs/code-review.md>) distinguish product contracts, actual Git effects, existing-GUI smokes and historical exploratory runs. Test totals and exact build fingerprints are kept in those records rather than duplicated here. A failed historical QA run is not relabeled a pass. Real-model replay and native engine repair remain outside this product boundary.
