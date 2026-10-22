# Tasks

Implementation and completion are authorized. On October 22, 2026 the user approved the public-extension-point verification boundary in the [design](<design.md>): test this plugin, not DSH conversation/model/scheduler internals. Checked items require implemented product behavior and the agreed product/adapter/real-Git/client/GUI evidence; unchecked items still need that evidence or a product fix. G1-G5 remain product compatibility checks, not mandatory upstream-engine requalification. Do not patch DSH, repair native records, weaken destructive safety, or create replacement runtime/QA infrastructure. Review assumptions A1-A7 and the capability specs.

Evidence scope: deterministic public-service fixtures establish plugin delegation/state-machine behavior, actual temporary Git repositories establish filesystem/Git effects, provider/factory tests establish scoped native embedding, and the existing-backend GUI smoke establishes loading/navigation. DSH owns its native chat, model, scheduler and history engines. Historical exploratory Native/PTC reports retain their original outcomes; the unqualified schedule attempt is not reclassified as a pass. Unreadable native/shared-target state must still fail closed and is documented as an environment limitation, not repaired to force cleanup. Final verification passes 1,239 tests across 44 files plus both typechecks, the public consumer build, independent CR01–CR11 product review and the refreshed existing-backend GUI smoke; final verification and independent product review are recorded in the [verification report](<../../../../docs/verification-preliminary.md>) and [run register](<../../../../docs/verification-runs.json>). The separate UX issue list is deferred to the next change. Sync/archive and publication follow completion of this agreed scope, not task counts alone.

## 1. External Plugin Foundation and Navigation Gate

- [x] 1.1 Bootstrap the independent TypeScript host/client plugin package with pinned compatible DSH dependencies, public entries, web-client export metadata, and build/test scripts; verify an external consumer typecheck/build succeeds without private bundled imports or core modifications.
- [x] 1.2 Register/dispose the Kanban main panel and sidebar entry alongside Automation tasks and Plugins; verify G1 in the real DSH shell, including enable/disable and unchanged startup behavior, without running a replacement app server.
- [x] 1.3 Add the Kanban page shell, empty-state route to Projects, and local Projects/Workflow configuration access; verify navigation tests cover first use and that ordinary DSH chats remain available.

## 2. Durable Metadata, Projects, and Workflow Contracts

- [x] 2.1 Define the versioned namespaced storage domain, serialized revisioned command path, and durable change subscriptions; verify restart recovery, concurrent UI/tool writes, rejected-write consistency, and unknown-version handling using host storage tests.
- [x] 2.2 Implement project registration/editing and canonical Git root/project path resolution; verify project-contexts scenarios with a repository-root project and a monorepo subproject, including invalid/escaped/missing paths without wrong-root fallback.
- [x] 2.3 Implement YAML parsing/validation and the default Backlog/Plan/In Progress/In Review/Done workflow with no entry instructions; verify initial-stage, grouping, allowed-transition, invalid-YAML, and unsupported-field tests and that no WIP behavior is introduced.
- [x] 2.4 Protect workflow updates from orphaning existing task columns under assumption A4; verify an incompatible save preserves the last valid workflow and reports the affected column IDs instead of hiding cards.
- [x] 2.5 Implement task metadata and native-session association commands, including a reverse session-to-task lookup; verify task creation/editing persistence and revision conflicts without copying native transcripts.

## 3. Native Conversation Drawer and Embedding Gate

- [x] 3.1 Add the Conversations/Info/Git/Notes drawer and nested conversation tabs; verify opening, changing sections, closing/reopening, and the initial single-tab/plus behavior against task-conversations scenarios.
- [x] 3.2 Create fresh native sessions without blank-session reuse and bind each to the task's effective cwd before its first prompt; verify distinct IDs for repeated plus actions, base-project origin retention, active-worktree inheritance, and no automatic execution.
- [x] 3.3 Render native chat through the shipped session-retention/provider/factory pattern with plugin-owned retention sources; verify G2 with main session C and distinct A/B, correct drafts/transcripts/send/stream/Stop/approval targeting, and unchanged global selection.
- [x] 3.4 Implement tab/drawer retention teardown and reopening under A2, including protection against duplicate same-session composers; verify release does not delete history, cancel another session, or introduce card/main-chat shortcuts.
- [x] 3.5 Verify the embedded provider/factory exposes the correct scoped session to native controls and document workspace/fork/file host behavior under A7; preserve native auxiliary navigation rather than re-test or copy its implementation, and stop for review if integration would require a core patch.

## 4. Worktree Operations, Directory Coordination, and Policy Gate

- [x] 4.1 Add host Git operations for branch discovery and worktree creation with a new or existing branch using confined execution and explicit argument arrays; verify clean temporary-repository tests for source branch, custom path, errors, and preserved branches.
- [x] 4.2 Add existing-worktree attachment with canonical repository identity and relative project-directory validation; verify matching repository success, different repository rejection, and absent monorepo subdirectory errors without recreating the checkout.
- [x] 4.3 Implement operation journaling and the all-conversations-idle coordinator for switching effective cwd while preserving native IDs/history; verify known turns, pending interactions, jobs, descendants, and active schedules delay the operation without forced cancellation.
- [x] 4.4 Integrate native policy preflight and actual confined effects for destination and Git metadata paths; verify G3 denies unsupported/read-only/out-of-root operations honestly and never fabricates an additional root, idle approval grant, or unrestricted retry.
- [x] 4.5 Implement partial-progress recovery, activity rechecks, and plugin-admission gating during context operations; verify G3 with an external native wake and injected per-session failures, preventing false group success or execution in unresolved contexts.
- [x] 4.6 Add the prominent missing-worktree Create/Dismiss notice, transition-time optional creation choice, and Git create/attach/status/error controls; verify declining/dismissing retains the base project path and never makes isolation mandatory.
- [x] 4.7 Implement worktree-only removal with return-to-base coordination, Git-result verification, dirty/untracked additional consent, and known shared-target protection; verify temporary repositories retain task/notes/history/branch and never remove the base project or Git root.

## 5. Board Interactions and Attention

- [x] 5.1 Render the single global multi-project board, grouped stages, task summaries, and movement affordances; verify mixed-project rendering and configured grouping without multi-board or WIP controls.
- [x] 5.2 Add top-level New task with title, Markdown description, and project inputs; verify saves use the configured initial stage, associate an initial native conversation, and do not start an agent.
- [x] 5.3 Add Info editing for title/description in every stage; verify edits with an active worktree persist without returning to Backlog, messaging agents, or starting execution.
- [x] 5.4 Implement the shared transition command and Move and run / Move only / Cancel confirmation, with existing/new conversation selection and the optional-worktree flow; verify all outcomes, prohibited transitions, selected-target-only delivery, and context validation before execution.
- [x] 5.5 Add text search and project filtering with the documented initial matching assumption; verify title/description matches and combined filtering, with no activity/worktree-status filters added.
- [x] 5.6 Aggregate execution separately from blue unread/orange awaiting-reply/red failure indicators across all task sessions; verify simultaneous states and nonselected-tab updates without priority collapse, false workflow completion, or Info-only acknowledgement of every conversation.

## 6. Approved Board and Note Tool Integration

- [x] 6.1 Register read-only board/task discovery, summary/list/detail, and necessary project discovery using the supported DSH schema/presentation mechanisms; verify ordinary chats and task chats can discover an unambiguous project/task context in native and PTC modes.
- [x] 6.2 Register create/edit tools through the same host task commands, with explicit-user-request descriptions and no additional product approval dialog; verify initial-stage creation, any-stage edits, UI synchronization, input errors, and unchanged native permission behavior.
- [x] 6.3 Verify the plugin's actual tool allowlist excludes move/delete/message-card, decision-ledger, and own TODO operations, while preserving native host tools; add registration and agent-instruction contract tests that distinguish guidance from runtime consent verification.
- [x] 6.4 Implement task-shared Markdown note storage/UI and create_note/list_notes/update_note tools; verify cross-tab reads/edits, context-change persistence, separate task collections, and missing-target errors without selecting an unrelated card.

## 7. Nonblocking Rich Question Rounds

- [x] 7.1 Register immediate-return question-page tools with runtime semantic validation and durable presentation metadata; verify invalid choice/text metadata returns an error without damaging prior pages and unsupported JSON Schema keywords are not emitted.
- [x] 7.2 Implement the canonical event projection for session/turn/page correlation, including nested PTC dispatches, actual turn completion, reload reconstruction, and genuine human-origin answer detection; verify duplicates, partial event windows, and runtime-context messages do not incorrectly complete or answer a round.
- [x] 7.3 Add the session-scoped composer-adjunct form and tool-row summary/reopen presentation through public slots; verify incremental pages, Markdown choices/context, single/multi/text, recommendation/weight/Other/notes, and retained in-round answers without replacing native input.
- [x] 7.4 Submit completed rounds as exactly one formatted ordinary text message through the originating scoped conversation service; verify all questions map to their answers and no separate turn is submitted per page.
- [x] 7.5 Support closing the form and replying through the unchanged composer; verify a later human answer retires the form without an inferred answer, decision ledger, cancellation record, or plugin-created native pending interaction.
- [x] 7.6 Complete G4 in native and PTC presentations, including reload and separate native ask-user/approval behavior; verify the plugin leaves no blocked question tool and does not change host presentation mode or replace the agent loop.

## 8. Reversible Archive and Explicit Task Deletion

- [x] 8.1 Implement task archive/restore and an archive-management view inside Kanban under A1; verify the same task details, notes, native bindings/histories, and existing worktree remain recoverable without automatic disk cleanup.
- [x] 8.2 Implement the revised permanent task deletion command and confirmation: first return all retained conversations to base projectPath with the all-idle coordinator, then remove plugin task/notes and eligible worktree and archive native conversations while preserving logs/branch; verify G5 covers later native unarchive at the original project subdirectory, failed return retaining the tree, and wording that never describes archive as history purge.
- [x] 8.3 Add idempotent cleanup recovery across native archive, Git effects, and metadata updates, respecting known activity/shared-target restrictions; verify injected failures preserve actionable progress and never claim full success or directly manipulate private native session files.
- [x] 8.4 Verify additional dirty/untracked discard confirmation and decline in both deletion and worktree-only removal, plus task-without-worktree cases; require temporary-repository assertions that base project/Git root and branch are never cleanup substitutes.

## 9. Readiness, Packaging, and Acceptance

- [x] 9.1 Map every capability scenario to unit, host-integration, client-integration, or manual UAT evidence; verify coverage includes all nine specs and the revised archive-conversation lifecycle, not merely mock UI expectations.
- [x] 9.2 Verify plugin-owned teardown/re-enable, retention release/reopen, metadata restart recovery, unknown schema and rollback through public lifecycle contracts; preserve native sessions/worktrees/branches and the same IDs without requiring a custom native OFF/ON transaction or runtime lease.
- [x] 9.3 Build/install the distributable through the supported plugin flow and verify the actual existing DSH GUI after the required refresh; record runtime/SDK versions, the agreed G1-G5 plugin-contract results and separate environment limitations without claiming a watcher or replacement server updates the GUI.
- [x] 9.4 Complete the product walkthrough using public extension-point fixtures, client integration and actual temporary Git, supplemented by the existing-GUI loading/embed smoke: project setup, task creation, tabs, transition choice, monorepo worktree, questions, notes, archive/restore and deletion; verify excluded features remain absent without requiring real-model or native-engine replay.
- [x] 9.5 Document installation, permission limitations, native Files/workspace-origin behavior, recovery, assumptions, and supported versions in en-US; verify OpenSpec strict validation and a final scope/language review before requesting release approval.
