# Design: Independent Kanban Plugin for DSH

## Context

See the [proposal](<proposal.md>) for motivation and the nine capability specs for observable behavior. This is a greenfield plugin repository, not an existing application implementation. [Project instructions](<../../../../AGENTS.md>) require US English for planning artifacts and source code.

The reference Railyin revision is a25520f4c5a91c24b359fce34ce9f553b9d6823c. The installed DSH runtime is 0.2.1-rc.2. Initial planning evidence was static source inspection. Implementation subsequently passed published-SDK consumer builds and actual existing-backend navigation/lifecycle checks; native execution acceptance is recorded separately in the [verification runs](<../../../../docs/verification-runs.json>). Published development types are used where declarations are absent from the desktop bundle.

### Confirmed integration seams

| Concern | Observed support and limitation |
|---|---|
| Global page/sidebar | Root main panels and sidebar entries are real extension points. See [layout](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js#L623-L650>) and [sidebar](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js#L454-L480>). |
| Embedded native chat | The shipped subagent UI retains a Session, uses the renderer-supplied SessionProvider, and renders conversation.content with variant embedded and a session-scoped chat child. See [consumer](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js#L755-L838>) and [binding](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js#L703-L760>). Use factories/slots, not private component imports. |
| Task drawer | The native right sidebar clears its session for global panels. The plugin needs its own drawer; it cannot assume that dock is a ready-made global task container. See [right sidebar](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js#L4834-L4847>). |
| Fresh native sessions | Session creation without an explicit session ID mints a new session; workspace connection helpers can reuse blanks. See [creation](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L264-L267>). |
| Same-session cwd changes | Working-directory events preserve identity/history and notify the agent; they do not move workspace membership, processes, or permissions. See [service](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L87-L163>). |
| Activity | Native ownership covers turns, pending interactions, jobs, descendants, and active schedules. A pre-step gate exists, not an atomic cross-session idle lease. See [activity/gate](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L2491-L2516>). |
| Durable state | The domain service serializes writes and publishes after durability; JSON storage atomically replaces files. See [domain](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L93-L101>) and [JSON](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js#L6-L40>). |
| Rich-question UI | Custom tool output metadata and the session-scoped conversation.input.dock support an additive form above the unchanged composer. See [tool definitions](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js#L838-L881>) and [dock](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js#L19733-L19753>). |
| Native lifecycle | Archive/unarchive preserves logs; no supported permanent session-delete operation was identified. The user revised deletion to archive conversations. See [archive](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js#L526-L559>) and [append-only persistence](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js#L233-L259>). |

## Goals / Non-Goals

**Goals**
- Integrate through an independent host/client plugin while DSH continues to own execution, histories, and permission policy.
- Separate project identity, task metadata, native workspace membership, and effective working directory.
- Make external side effects recoverable and failures visible, without pretending Git and several native sessions form one transaction.
- Reuse the same durable commands for UI and approved tools.

**Non-Goals**
- No core patches, replacement server, replacement chat/runtime, or raw edits/deletion of native session logs.
- No automatic Railyin database migration or blanket compatibility with its engine-oriented YAML.
- No promise that every native auxiliary chat action stays in the drawer; existing navigation remains native.
- No multi-host replication or general external-process inventory. The initial plugin targets one active host/profile writer.
- No parallel implementation of the exclusions listed in the proposal.

## Decisions

### 1. Use native host/client plugin packaging

Use TypeScript and the native React/renderer extension model. Declare public host/client entries and the client export/web-platform metadata expected by DSH's module loader. Register the main Kanban panel and sidebar item through declared slots, waiting through the slot injection mechanism. Dependency metadata is not an execution-order guarantee.

Use the existing DSH client connection/RPC mechanisms for validated commands and state subscriptions, not another HTTP/WebSocket service. Pin the initial compatible SDK/runtime and verify it with a real consumer build. Porting Railyin's Vue shell or starting a standalone Vite server would duplicate the host and would not update the current GUI.

#### Verified implementation compatibility decisions

- Compile host and client as separate TypeScript programs: their public Context faces assign different meanings to sessions. Externalize the native runtime/client singletons and ship a lazy native client module rather than a second application.
- Register host Typert descriptors once. The native transport result and business Outcome are two distinct envelopes; both are unwrapped. After mounting the client namespace, create a scoped Cordis consumer declaring remote.kanban. Mounting alone does not grant injection permission.
- A task already binds a concrete native Session and directory. Its reusable embedded conversation uses active/settling presentation with hero false; the ordinary native blank-workspace hero intentionally disables input without native Workspace membership. Do not create a workspace or change global navigation merely to enable the task composer.
- Creation commands return a transient exact entity receipt. Never infer the created task, project, or conversation from snapshot set differences. Capture metadata sequence before asynchronous attention reads, and order client snapshots by physical-feed epoch plus sequence.
- Bind run approval to the exact raw instruction displayed by the confirmation. Reject changed or removed instructions before admission side effects, then preserve the approved intent through waiting and retry.
- Validate task execution context both before queued delivery and at public post-assembly/pre-model request boundaries. Native ordinary-chat cwd recovery remains unchanged, but it must not silently redirect a bound task from a missing active worktree to its base. A retained checkout is not itself the active context; explicit return selects the base without deleting that binding. These are supported checks, not a universal filesystem or process lease.
- Recover a possibly committed create only with durable absent-target proof bound to operation, canonical repository/target, and requested local branch. Existing-branch choices advertise supported local heads, not remote refs that would silently detach. Unverified checkouts left by a recorded attempt are unclaimed recovery metadata, never active managed bindings or automatic destructive targets.
- Ordinary-chat question histories are prepared once per accepted host epoch and rehydrated on a new baseline, with stale-response fencing and no answered-round resurrection. Preserve note and approved-instruction bytes; trimming is only a nonblank validation.

These decisions preserve the product requirements. Acceptance follows the user-approved extension-point boundary below; historical exploratory native runs are supplemental evidence, not proof that unexecuted native scenarios passed.

### 2. Main-page navigation and local configuration

Add Kanban alongside Automation tasks and Plugins; do not set a startup override. The header provides New task, text search, project filtering, and configuration. Projects and Workflow live inside the Kanban page. Seed Backlog / Plan / In Progress / In Review / Done without entry instructions. An empty project registry offers a route to Projects before a task can be saved; no separate setup application is needed.

Selecting a card opens the plugin-owned drawer. Top-level sections are Conversations / Info / Git / Notes; Conversations contains native agent tabs and plus. Preserve page selection/filter state while navigating sections or returning from a native page. Responsive drawer sizing is a presentation refinement, not a different application.

### 3. Own metadata and reference native histories

Use a versioned, namespaced DSH storage domain and its existing JSON backend. A single global state snapshot is the initial layout: one local board does not justify porting SQLite or adding a server. Serialize plugin mutations, check revisions, and publish only after durable writes. Re-evaluate storage layout if dataset size later requires it.

| Data | Responsibilities |
|---|---|
| Project | Stable ID/name, project path, separately resolved/configurable Git root, optional default branch. |
| Board | One source YAML document, validated normalized workflow/revision, initial column. |
| Task | Project ID, title/Markdown description, column/order, archive marker, native session IDs, worktree binding. |
| Note | Task ID, Markdown content, stable ID/timestamps, optional reference metadata. Never key the collection by conversation. |
| Context operation | ID, task revision, participating sessions, prior/target cwd values, completed steps, status/error. |
| Question projection | References to native session/turn/tool payloads and human-answer anchors, not a decision ledger. |

Native sessions remain authoritative for transcripts, streams, tools, and execution. Do not duplicate histories in the plugin database. Validate IDs, project relationships, and paths on the host, not just the client. One command path backs UI and tool mutations and emits revisioned changes.

A storage write chain is not a transaction across Git and native sessions. Journal requested external operations and their results; retain recovery information until completion. Do not remove the last useful task association after a failed cleanup step.

### 4. Explicitly bound embedded sessions

Follow the shipped subagent consumer: retain sessions with a plugin-owned source, pass the reference to the renderer-provided SessionProvider, declare a session-scoped child beneath the root drawer, and render the native conversation factory in embedded/chat mode. Rendering a task conversation must not change global main-view selection.

Create fresh conversations through the host session controller, omitting a requested session ID rather than reusing workspace blanks. Use the base project path as immutable origin, then set effective cwd to the active worktree project path before a new tab's first prompt when applicable. This keeps native grouping at the original project, an explicitly accepted boundary.

Each tab has a distinct native session ID and retained history. Keep a session-to-task index and release only plugin UI retention on teardown, without cancelling or deleting sessions. Avoid mounting the same session's composer twice: the native input hub shares its editor per binding. Distinct task tabs are the supported case.

Reuse native transcript/composer, models, tools, stream, Stop, and approval behavior. Existing workspace picker/fork/file actions can have host-global effects; do not silently clone the chat to contain them. The first integration gate must verify which native auxiliary actions remain available and present unsupported embedded behavior honestly. No new card/main-chat shortcut is added.

### 5. Resolve cwd from the project, not an assumed root

For a base task, cwd is projectPath. For a worktree, compute relativeProjectPath = relative(gitRootPath, projectPath), then effectiveCwd = join(worktreeRootPath, relativeProjectPath). Canonicalize paths, reject repository escape, and require the target subdirectory to exist. Validate an attached tree using Git repository identity, not only a branch name or matching remote URL.

Keep base project path, Git root, worktree root, and effective cwd distinct. A missing monorepo subdirectory is an actionable error, not permission to fall back to the checkout root. Show effective cwd in Kanban. Native workspace grouping and Files may remain at the origin; do not describe cwd changes as workspace migration or rewrite immutable session headers.

### 6. Coordinate worktree operations and recover partial progress

A task-level coordinator owns create, attach, return, and remove:
1. Validate project/task revisions, Git identity, canonical target/subdirectory, and required policies; persist an operation record.
2. Wait until every task conversation is idle, considering known native turns/pending interactions, jobs, descendants, and active schedules rather than only a running flag.
3. During a context operation, gate plugin-originated task execution and new-tab creation. Recheck activity before each native cwd update. A pre-step hook is not proof of a global lease.
4. Resolve/retain existing agents, apply native cwd events, and journal each result.
5. Publish ready only after every participating session agrees. On failure, keep a visible operation/error and offer retry or return-to-base recovery; do not dispatch a confirmed instruction into an unresolved context.

External native actions can race an idle check; this is not an atomic global freeze. Test that race explicitly. Stop progressing when a participant is observed active, expose partial state, and return for scope review if the safe boundary cannot be met without core edits. Do not patch the core or invent transaction guarantees.

Worktree-only removal returns sessions to base projectPath first, then removes the eligible checkout, preserving task/history/notes/branch. A failed return leaves the checkout intact. Optional creation is offered on column transitions; declining does not prevent work in the base project.

### 7. Preserve real sandbox boundaries

The inspected sandbox root is derived from immutable session origin. Neither cwd changes nor one-shot approval escalation grant persistent access to another worktree. Native approval requests require an open turn and are not a ready-made idle-GUI grant dialog.

Preflight effective policy for each participant and canonical containment for all required paths, including Git metadata. In a monorepo, Git root itself can be outside the allowed project directory. Preflight is diagnostic, not authorization or a TOCTOU guarantee; actual operations remain confined by native filesystem/execution services.

On incompatible policy, keep the last valid task context and report the limitation. A user can choose a permitted destination or configure native access separately. Do not manufacture roots, broaden policy, retry unrestricted, imply creation approval authorizes future writes, or default to danger-full-access.

### 8. Shared workflow, execution choices, and independent attention

Normalize and validate YAML before publishing it. Groups contain real stages; allowed transitions restrict moves. Do not implement WIP or silently import Railyin engine settings. Reject unsupported fields with clear compatibility feedback. Keep the last valid workflow if validation fails.

New task creates in the initial column and supplies its first conversation without executing an agent. Title/description edits do not message agents. Move affordances use the same transition command; within-column ordering is not a new stage entry.

An instructed move offers Move and run / Move only / Cancel and a selected existing/new conversation. Include optional worktree choice if absent. Cancel means neither move nor run; declining worktree creation is not cancellation. Submit a confirmed instruction through the selected native conversation only after context checks/changes complete, not through a new execution engine.

Execution activity is an OR across task conversations, separate from workflow column. Blue unread, orange awaiting-reply, and red failure indicators are independent ORs and can coexist. A pending rich-question round can contribute orange without a blocking native tool; native pending interactions retain their own semantics. Reuse native session state/events and a small question projection, not one priority enum.

### 9. Approved board and note tools

Register normal DSH tools for board discovery/summary/list/detail and create/edit. Familiar source names can be retained; exact wire schemas must use the supported DSH subset. Read-only project discovery supports selecting an unambiguous registered project. UI and tools call the same durable commands.

Descriptions/native instructions require an explicit user request for create/edit, without an extra product approval modal. This is an agent-use policy, not a claim that text descriptions deterministically verify consent. Enforce the actual operation allowlist and input/relationship validation in code; preserve native permission checks.

Do not register board move/delete/message, decision-record, or plugin TODO tools; do not remove host-native equivalents. Note tools address the same task-scoped collection shown by Notes. Missing target context is an error, not a fallback to another task. Do not copy unsupported JSON Schema keywords such as minItems/minLength: enforce semantic constraints in execution validation.

### 10. Nonblocking rich-question rounds

Keep a one-question-per-call page contract for incremental UX: text/type/context, rich choices, recommendation/rationale, weight, Other, and notes. Validate and publish a page, return immediately, and persist rich validated payload through native result presentation metadata. Never await a human inside this tool or create a native approval/pending-question entity.

Group by native session and owning turn using durable call IDs and event order, including nested PTC dispatches. Do not assume an exec.turn property exists. Native turn/end finalizes the round; instructions ask the model to finish after its question pages. If concludeTurn is used, apply it only to finalization, not every page. No new agent loop is needed.

Render the paginated form in conversation.input.dock above the unchanged composer; a keyed tool row can summarize/reopen it. Users can fill received pages while more arrive and retain answers while navigating. After verified round completion and basic form validity, Submit sends one ordinary textual question/answer message through the originating session's scoped conversation service.

Closing hides the form and leaves native input available. A subsequent genuine human-origin message retires the pending form; injected runtime-context user/message records do not count as human answers. Reconstruct from canonical native events after reload, including PTC correlation. An incomplete event window or absent openTurn value is not evidence of turn completion. Partial form answers need only survive the live round; restart durability is not promised.

Relevant seams: [metadata](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js#L3636-L3665>), [tool renderer](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/lib/client.js#L1916-L1993>), [dock](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js#L17820-L17854>), [text send](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js#L4658-L4669>), [human origin](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L2997-L3003>).

**Rejected alternative:** native userQuestions takeover blocks on a separate answer channel; hiding that panel and sending ordinary text does not settle its pending tool. Leave native ask-user/approval tools independent and unchanged.

### 11. Archive tasks, delete plugin data, archive native chats

Task archive is reversible metadata: keep details, notes, session associations/histories, and worktree files. Restore brings back the same task. Permanent task deletion has the explicitly revised meaning: remove plugin task/notes and eligible worktree, keep its branch, and archive native conversations without erasing their histories. Before archiving these retained conversations and removing the checkout, use the same all-idle coordinator to return every conversation to the base projectPath. If any return fails, retain the checkout and recovery record. A later native unarchive must resume at the original project subdirectory, not a deleted checkout or Git root. Explain the exact effects before confirmation. Never unlink private native session logs.

Dirty/untracked checkout removal requires additional discard consent. Confirm the canonical target, never substitute base project/Git root, verify every Git exit result, and stop on failure. Refuse cleanup of a checkout known to be used by another task/session rather than deleting unrelated work; external attachment does not automatically establish safe deletion ownership.

Native archiving, Git cleanup, and plugin state writes are separate effects. Journal them, retry idempotently, preserve remaining associations/recovery information on failure, and report completion only when the chosen effects are accounted for. Do not turn warnings into false success.

## Planning Assumptions for Review

These are conservative planning defaults, not additional interview answers:
- **A1:** Task archive keeps worktree files and session bindings without disk cleanup or native-session archiving. The distinct confirmed task-deletion flow archives native sessions; neither flow purges their histories.
- **A2:** Closing a tab/drawer hides/releases its view, not its native session/history; task association remains reopenable. Plus creates a fresh history, not a transcript copy.
- **A3:** Destructive cleanup waits for known activity rather than cancelling agents automatically. Shared/in-use checkouts and unresolved context operations block cleanup.
- **A4:** Saving a workflow that would orphan existing column IDs is rejected with an explanation; no migration wizard or silent remapping now.
- **A5:** Search initially uses case-insensitive title/description matching and intersects project filtering. No new bulk-action feature is implied.
- **A6:** Missing-tree dismissal is local view preference, not an opt-out from the transition question. Unread/failure acknowledgement follows native session visibility/outcomes; opening Info alone must not acknowledge every chat.
- **A7:** Native auxiliary chat actions retain supported host behavior. Verify that the plugin supplies the correct scoped session/provider and leaves native controls available; DSH owns transcript/composer/stream/tools/approval/Stop and native file/fork/workspace behavior. Do not require all auxiliary actions to remain embedded or re-test their native implementation.

If review changes a default in a way that changes specs or dependencies, update the artifacts before implementing. Do not disguise an assumption as a confirmed product choice.

## Compatibility Gates and Verification Strategy

### User-approved integration boundary (October 22, 2026)

The user explicitly approved completing this plugin by validating public DSH extension points, not by requalifying DSH itself. Functional requirements remain unchanged. Native chat rendering, model/provider responses, scheduler delivery, history persistence and native permission engines are upstream responsibilities. Real-model calls were declined for this change. No new core implementation, internal-record diagnosis, private-state repair or custom QA runtime is required for completion. The UX requests in the user-owned issue file remain a separate next change.

Use deterministic product/adapter tests, controlled public-service fixtures, actual temporary Git repositories, TypeScript consumer builds, and small existing-backend UI smokes. A controlled native port verifies our calls and failure handling; it is not labeled a native engine execution. Historical exploratory native reports retain their original pass/failure status and do not become successful by changing this boundary.

- **G1: Loading/navigation.** Build the published entries, validate an external consumer, and use the supported manager flow and the existing GUI after refresh. Preserve startup and existing navigation; never substitute another server.
- **G2: Scoped native embed.** Validate the shipped provider/factory/retention contract, distinct A/B IDs, correct scoped send/Stop/approval delegation, draft/view selection and release/reopen behavior without retargeting main session C. An existing-shell embed smoke establishes compatibility. DSH's conversation engine and model responses are not re-tested; native auxiliary actions keep documented host behavior.
- **G3: Plugin cwd/policy coordinator.** Exercise the product state machine through public native ports and real temporary Git repositories. Cover all advertised native activity categories, external activity notifications, denied/missing paths, partial writes, journal restart/retry, unchanged IDs, exact instruction targeting and no permission broadening. Verify adapter argument/schema/hook contracts; do not manufacture native turns/jobs/schedules or a global lease merely to test upstream engines.
- **G4: Plugin question presentation.** Verify semantic validation, native/PTC metadata correlation, session-scoped dock/form, ordinary text submission and reload/close behavior. Existing native presentation slices supplement these contracts. Built-in ask-user and approvals remain delegated to DSH; no additional real-model run is required.
- **G5: Plugin lifecycle and destructive safety.** Use controlled native lifecycle ports and real temporary Git to prove return-to-base before archive/removal, retained IDs/log ownership, branch/base preservation, dirty consent, shared-target denial, errors and idempotent recovery. Test unknown native metadata as a safe refusal. A current-profile cleanup refusal is a documented environment limitation, not permission to repair DSH, skip peers, weaken safety or claim that physical deletion succeeded there.

Map every capability scenario to product, host/real-Git, public-adapter, client-binding or bounded GUI evidence. Distinguish executed tests, trusted upstream contracts, environment limitations and deferred real-model validation. Mark tasks complete only when their product behavior and this agreed integration evidence are present; do not infer completion merely from task counts or relabel an old failed run.


## Risks / Trade-offs

- **[SDK/type drift]** -> Pin the version and compile a real external consumer; bundled JS is not a typecheck.
- **[Binding/editor collisions]** -> Use supplied factories/providers/retains, distinct IDs, and G2.
- **[Workspace/Files remain at origin]** -> Show effective cwd and document the user-approved boundary.
- **[Policy blocks Git metadata or tree]** -> Canonical preflight plus real confinement and honest denied-state UX; no fabricated root.
- **[No cross-session transaction]** -> Journal, gate plugin admission, recheck activity, show partial state, and test external wakes.
- **[History deletion mismatch]** -> Follow archive-native-conversations semantics; no private log manipulation.
- **[Question/composer interference]** -> Additive dock, ordinary text send, native/PTC correlation, human-origin filtering, and G4.
- **[Snapshot scale/multiple hosts]** -> Host serialization/durability, one active host writer, restart tests; no replication claim.
- **[Legacy behavior mistaken for scope]** -> Keep the inventory below non-normative and honor exclusions.

## Migration Plan

This is a new plugin, not a Railyin database migration. Bootstrap an external host/client package, pass G1-G4 in thin slices, then complete the remaining commands/views and G5. Initialize versioned metadata when enabled; add a navigation destination without replacing host startup, workspace, conversation, or persistence behavior.

Before schema upgrades, preserve a recoverable metadata snapshot and reject unsupported versions instead of silently resetting state. Disabling/uninstalling removes plugin slots/tools/listeners and releases UI references; it does not delete native sessions, Git branches, worktrees, or stored metadata. Re-enable compatible metadata to reconnect the same native IDs. Rollback cannot undo a user-confirmed Git deletion or pretend an archived conversation was purged.

## Open Questions

Only deferrable presentation refinements remain: final iconography, drawer sizing/breakpoints, and exact user-facing copy/localization beyond confirmed default stage labels. Compatibility gates are explicit acceptance work, not permission to silently choose another product.

## Railyin UX Reference Inventory

Observed reference behavior is not an extra requirement. Older Railyin specs disagree with source on drawer sizing, edit guards, and project restrictions.

| Area | Observed Railyin UX | Target disposition |
|---|---|---|
| Setup | Own workspaces, projects, multiple boards, paths/Git roots, theme/preferences. [Setup](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/views/SetupView.vue>), [project form](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/ProjectDetailDialog.vue>). | Project registry retained; no Railyin workspace hierarchy; one board and native host. |
| Board | Ordered/grouped columns, stacked subcolumns, pointer drag/drop/reordering and scrolling. [Board](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/views/BoardView.vue>). | Kanban/groups/transitions retained; no pixel clone or bulk-action promise. |
| Workflows | YAML validation/reload/templates, allowed transitions, entry prompts and optional WIP. [Editor](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/WorkflowEditorOverlay.vue>). | YAML/groups/allowed moves, confirmed instructions; no WIP/engine port. |
| Task text | Title, Markdown description/project; backlog-hardcoded creation/edit guards. [Form](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskDetailOverlay.vue>). | Global New task in configured initial stage; edit any stage, no implicit agent message. |
| Summary | Project/execution badge, unread dot, toasts; one task conversation. [Card](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskCard.vue>), [activity](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/App.vue#L34-L41>). | Multi-session activity plus independent blue/orange/red indicators; toast redesign not a separate capability. |
| Discovery | No visual card search/filter or dependency/subtask graph identified; tools can search. | Add text/project filtering only; no priority/labels/due dates/assignees/dependencies approved. |
| Details | Resizable shared drawer, Chat/Info/Git/Decisions/Notes, retry/model controls. [Task chat](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskChatView.vue>), [drawer](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/ConversationDrawer.vue>). | Two-level sections and native continuous tabs; no decision-ledger section. |
| Worktrees | Per-task branch/path/status, new/existing branch, retry/removal; no global dashboard/external-tree adoption UI. [Create](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/WorktreeCreateForm.vue>), [Git](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskGitTab.vue>). | Optional create/attach, monorepo cwd, coordinated sessions and honest errors. External-tree attachment is new. |
| Review | File list/diff, accept/reject/change request, line comments, editable diff, feedback; not merge/commit. [Review](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/CodeReviewOverlay.vue>). | Excluded; bulk reject and single-hunk rejection have different source semantics, not a contract to copy. |
| Terminal/editor/launch | Multi-session terminal, code-server iframe, launch profiles/external tools. [Terminal](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TerminalPanel.vue>), [editor](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/CodeServerOverlay.vue>), [launch](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/LaunchButtons.vue>). | No product integration now; existing native features are not removed. |
| Board tools | list_boards/get_card/get_board_summary/list_cards/create_card/edit_card/delete_card/move_card/message_card. [Definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts>). | Read/create/edit only; necessary read-only project discovery; no extra product approval. |
| Questions | Incremental pages, one/multi/text, Markdown choices, recommendation/weight/Other/notes, batch submit. [Form](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/DecisionRequest.vue>), [panel](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/DecisionInterviewPanel.vue>). | Rich nonblocking UX for a normal text reply, also ordinary chats. |
| Decisions | Four ledger tools, soft delete/revisions; read-only list with revision count, not full revision UI. Record-as-decisions depends on later agent calls. [List](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/DecisionsPanel.vue>). | Excluded; question projection is not a ledger. |
| Notes | Markdown/tags/filter/AI badge, visual create/edit/delete; create/list/update tools, conversation-scoped. [Notes](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/NotesPanel.vue>). | Approved note UI/tools shared by task. Tag/badge polish is reference detail, not a new metadata-editor requirement. |
| TODOs | Ordered phase-aware checklist, statuses, six tools/detail UI. [Checklist](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TodoPanel.vue>). | Own checklist excluded; preserve native DSH tools. |
| Chat/composer | Standalone chats, rename/archive, history/stream, editable queue, task attachments, slash/file/symbol/MCP completion, compaction/model/context controls. [Composer](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/ConversationInput.vue>), [completion](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/ChatEditor.vue>). | Reuse DSH, not clone each Railyin composer feature. |
| Host settings | MCP picker/config/OAuth/reload, shell approvals, models and LSP setup. [MCP](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/McpToolsPopover.vue>), [Setup](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/views/SetupView.vue>). | No parallel settings/model engine/LSP implementation. |
| Lifecycle | Delete task/data/tree, keep branch; chat archiving. Git force/ignored exit and stale paths are source risks. [Git removal](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/git/GitRepositoryManager.ts#L58-L69>). | Reversible task archive, reliable cleanup, archive native chats on task deletion, never delete base directory. |

Other observed limitations are not requirements: orphaned cards after incompatible workflow changes, tool mutations without immediate UI push, and consent text mistaken for authorization. Dedicated merge/rebase/PR UX and full global worktree management were not identified.
