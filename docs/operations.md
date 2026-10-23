# Operations and Recovery

For the independent DSH **0.2.1-rc.2** plugin. Start with [installation and usage](<../README.md>); this guide covers diagnostics, durable operations, policy boundaries, and acceptance evidence. It is not authorization to change the DSH core, profiles, permissions, signing, or authentication.

## Installation and update diagnostics

1. Use the required Node/pnpm versions from [the manifest](<../package.json>): runtime Node **>=20.19**, development helpers Node **22+**, and `pnpm@10.15.1`.
2. Build the checkout before adding it through **the existing GUI → Plugins → Add plugin**, using the absolute built package root/local `link:` specification, then enable it. This is the primary installation path, not an Inspector requirement.
3. Check the native installation result and plugin row. A downloaded package, enabled flag, active host row, and working client page are distinct evidence. A native restart-required result is not a successfully applied hot reload.
4. After a deliberate rebuild, explicitly reconcile the changed built files through native Plugin Manager, then refresh the **same existing GUI URL** and inspect it; see [the rebuild/reconcile procedure](<operations.md#explicit-reconciliation-after-a-rebuild>). Do not start a replacement server, edit a profile to force loading, or assume a source watcher exists. A browser refresh alone is not proof that a changed host module reloaded.

The currently exercised backend is `http://127.0.0.1:51781/`. Preserve your own existing host URL outside this environment. Neither a standalone Vite build nor another server updates that GUI.

### Network failure during installation

The recent native install failed on the default registry network path. An explicitly requested **one-shot** `https://registry.npmjs.org` override subsequently succeeded, without changing registry settings. Treat this as evidence about that attempt, not a universal registry diagnosis or permission to persist new settings.

Check the actual package-manager exit/application result. If an install times out, it may still be running: inspect current bundle inventory before retrying. Do not loop installs, silently change global registries, disable TLS checks, or treat a timeout as proof that nothing happened.

### Optional existing local Inspector helper

[The Inspector helper](<../scripts/dsh-inspect.mjs>) is optional and targets an **already-running local DSH Inspector**, default `http://127.0.0.1:9230`. Port 9230 is not the GUI port. The helper does not start an Inspector/browser/server, restart DSH, obtain authentication, edit profiles, or provide arbitrary evaluation verbs. Use it only when this current local Inspector is already available and you are authorized to inspect it.

Read-only examples, from the checkout with normal **Node 22+**:

```sh
node scripts/dsh-inspect.mjs --help
node scripts/dsh-inspect.mjs inventory --package dsh-kanban
node scripts/dsh-inspect.mjs clients
node scripts/dsh-inspect.mjs snapshot
# When multiple inspected Clients exist, select the source returned by clients:
node scripts/dsh-inspect.mjs snapshot --client SOURCE_ID
```

`inventory` returns projected public plugin/bundle status, not configuration secrets. `snapshot` distinguishes DSH's **Cordis semantic DOM** from the rendered browser DOM and returns text/value-free page structure only when a connected Client Inspector realm is available. Host-only semantic output is not visual GUI verification. No connected Client means no rendered-page evidence; do not improvise an auth-extraction or browser-attachment workaround.

The helper also has **explicit mutations**, never implicit fallbacks. Only an authorized operator choosing this alternative should run them; installation can fetch dependencies:

```sh
node scripts/dsh-inspect.mjs install --path /absolute/path/to/deepseek-harness-kanban --allow-mutation
# Enable is separate; installation deliberately starts disabled.
node scripts/dsh-inspect.mjs enable --path /absolute/path/to/deepseek-harness-kanban --allow-mutation
```

For the specific network failure above, the authorized one-shot install used:

```sh
node scripts/dsh-inspect.mjs install --path /absolute/path/to/deepseek-harness-kanban --allow-mutation --registry https://registry.npmjs.org
```

Before either mutation, the helper validates the built package's public entries and native bundle patch. It uses public plugin-manager operations, not direct profile edits. Helper exits are **0** for a successful result, **1** for a helper error, **2** for an application result other than applied, and **3** for restart-required. Inspect returned stage/application/error and package-manager exit data as well; do not report installation success from the outer exit code alone. A timed-out mutation includes a request identity and can remain in progress: inspect inventory before any retry.

[The separate live-verification helper](<../scripts/live-verify.mjs>) requires explicit owner-test authorization and can launch an ephemeral authenticated HTTP browser client of the existing backend. It is **not** an ordinary read-only Inspector command, not the original Desktop renderer, and not needed for installation. Do not invoke it without that authorization or capture/share secret-bearing login URLs, credentials, browser state, or native chat contents as evidence.

### Explicit reconciliation after a rebuild

On the inspected DSH **0.2.1-rc.2** host, the public `pluginManager.setBundleEnabled('dsh-kanban', true)` operation runs profile reconciliation **even when the bundle is already enabled**. Reconciliation detects changed loaded files in linked-package targets and can replace their host modules. This explicit operation does not require a root source watcher, compile source, or promise automatic source HMR.

After active task work/operations have settled, an authorized operator with the **existing local Inspector** can use the already-documented optional helper:

```sh
pnpm run build
node scripts/dsh-inspect.mjs enable --path /absolute/path/to/deepseek-harness-kanban --allow-mutation
node scripts/dsh-inspect.mjs inventory --package dsh-kanban
```

This calls the public manager method, not an internal reload hook. Read `application`, `restartReason`, errors, and active plugin state, then refresh **the same existing GUI URL** and verify the changed behavior. `changed: false` means the persisted selection did not change; it can legitimately accompany `application: applied` after reconciliation. Neither field alone proves the feature works. Honor `restart-required`; a failed replacement can leave the old plugin stopped, so do not assume stale code is still serving after an error.

Normal **Plugins disable/enable** remains a supported native lifecycle action, but switching off/on does not guarantee eviction of unchanged bundle modules. Do not call a nonexistent `hmr.reload`, private manager reload methods, or arbitrary Inspector evaluation to force a refresh. This procedure reconciles a **completed build**; it does not watch or rebuild the checkout for you. Actual own-bundle off/on and sidebar coexistence passed in the recorded ephemeral HTTP-client G1 run; the original Desktop renderer was not directly exercised.

### Historical exploratory helpers

The scripts under `scripts/verify-native-*` and the lifecycle helpers are optional, guarded historical experiments, not a required part of installation or product acceptance. Do not run them as routine diagnostics, enable consent flags automatically, replay DSH internals, or create native fixtures merely to satisfy a test count. The user-approved boundary is public-adapter/product contracts plus controlled Git and an existing-GUI smoke. Acceptance uses a deterministic, test-only model adapter; real-model requests are not part of it. Native activity and archive/history behavior remain upstream contracts; our coordinator still must respect those contracts and fail safely.

Old reports remain time-scoped and honest. The inconclusive schedule attempt was not qualified, its script was stopped with explicit user consent, and its fixture/base/archive/guard cleanup remains unverified. That does not authorize deleting user data or repairing DSH. Optional local artifacts remain ignored and are not published. See the [current evidence](<verification-preliminary.md>).

## Working directory and policy boundaries

Keep four paths distinct: **base project path**, **Git root**, **worktree root**, and **effective agent cwd**. The effective cwd is exposed only in the Git section's secondary details; the drawer header and Info do not repeat it. For a base monorepo project `/repos/platform/services/api` in Git root `/repos/platform`, a worktree at `/worktrees/task-42` must contain `/worktrees/task-42/services/api`. A missing subdirectory is an error, not a reason to run at the checkout root.

New task conversations join a native workspace for their effective project or worktree path instead of being created with cwd only. The base workspace is shared; a worktree workspace belongs to its task and is removed with the task when no other session uses it. Existing conversations keep their creation-time workspace when the effective directory changes. Native `workingDirectory` changes preserve session IDs, prior histories, and immutable header cwd. The committed **effective cwd**, not the mere presence of a retained ready worktree binding, selects the active context: after an explicit return, chats and new tabs use base even if the old checkout remains bound. **Native Files and sandbox root stay at the original location**; neither a displayed cwd nor an attached checkout is an access grant.

[The native adapter](<../src/host/native.ts>) resolves actual participant policies. Write preflight checks canonical paths against those policies; required Git commands use native confinement unless every participant already has an applicable full-access policy. It does not manufacture a union root, call idle GUI approval as a persistent grant, or auto-escalate/fall back to full access. Missing/incomplete confinement and incompatible participant policies fail visibly. Preflight is diagnostic, not a replacement for actual confinement or a race-free authorization guarantee.

Expected denials include read-only creation/removal and writes outside an original workspace root. Monorepo Git metadata can itself lie outside a subproject's permitted root even when its effective cwd exists. A prior successful Git create does not promise subsequent conversation access or future write permission.

[Task execution guards](<../src/index.ts>) validate the existing canonical expected and observed directories before send, at native pre-step, and after downstream request middleware before model use. Native assembly/ensure can recover a missing cwd to its original directory; that recovery does not authorize task execution at the wrong root. A missing **active** tree/subdirectory/base or native context drift blocks execution; an inactive retained tree is not probed as if it were active. These are admission checks, not an atomic filesystem lease or permission grant.

When denied, keep the last committed context, inspect any partial progress, and choose an already-permitted destination or have the owner review native policy separately. Do not retry the denied operation unrestricted or rewrite session headers/permission roots. Returning to base can still need a functioning native adapter and accessible base directory; it is recovery, not a bypass.

## Failed or partial operations

[The coordinator](<../src/host/worktrees.ts>) journals requested intent, canonical target, prior per-session directories, completed switches, Git completion, archived session IDs, and failure details in durable task metadata. Git, native sessions, and metadata do **not** form one transaction. A failed response can follow a real external effect.

1. Open the affected card's **Conversations** or **Git** section. Read its status/error, target directory, and **Conversations switched** count. Do not infer that every tab moved from one successful switch or from the card's last committed cwd.
2. **Waiting** means all associated chats must become idle, including closed tabs and known turns, pending native interactions, jobs, descendants, and schedules. Waiting resumes on native activity events/startup; cleanup does not automatically cancel agents or owned work. Resolve the actual native activity deliberately, then use **Retry operation** if needed.
3. During active context work, plugin admission of new chats/runs is gated and activity is rechecked before individual switches. Native actions can still race checks; there is no global idle lease. Do not send work into a mixed/unresolved context.
4. On **failed**, address the reported condition and choose **Retry operation** to resume the recorded intent. Create recovery requires the persisted, operation-bound absent-target precondition plus the exact canonical repository/path/local-branch match; merely finding an existing matching checkout is not ownership proof. A preexisting destination is not adopted or blindly recreated: use explicit attach after reviewing it. Shared-target and policy failures are not instructions to force deletion or broaden access.
5. Alternatively, **Return chats to base project** cancels a pending confirmed transition and coordinates all retained conversations back to the exact base project path. This is **not rollback of external side effects**: it retains a verified created/attached checkout and binding for explicit later management while base becomes the active cwd; it does not delete the checkout or branch. A legacy/interrupted detached or mismatched-ref checkout can instead be recorded as diagnostic-only **Unclaimed worktrees**, without replacing a distinct known binding.
6. If native conversation archiving has begun during task deletion, Return is refused with `DELETE_IN_PROGRESS`. Use **Retry operation** after resolving the failure. The plugin cannot silently unarchive chats or recreate a removed checkout.

**Unclaimed worktrees are read-only diagnostics**, never ownership, active context, or a removal target. The Git notice lists path/branch/reason with no automatic attach/remove or prefilled destructive target. Inspect with Git and choose a separate explicit attach if appropriate; successful attach clears the matching diagnostic. Task deletion leaves unclaimed checkout files on disk and warns about them.

**Branch modes:** discovery and Existing branch accept only supported local heads. A remote ref may be entered as the source of a New branch, which creates an attached local branch. Remote-only existing selections fail before checkout creation; do not retry them as if detached HEAD were supported existing-branch recovery.

Failed operations remain recorded for explicit recovery; nonfailed recorded work is reconsidered on restart. If a durable write itself failed, external state may be ahead of metadata. Preserve the error and inspect the known target before retrying; do not delete the journal or manually erase native logs to clear the UI.

### Queued confirmed entry instructions

[The host command path](<../src/host/app.ts>) requires equality with the **exact raw instruction displayed for approval** before creating a new conversation, performing Git work, or journaling the move. A missing/changed instruction produces `INSTRUCTION_CHANGED`: review the current instruction rather than silently approving a replacement. Once admitted, the destination, chosen conversation, captured approved text, placement anchor, and stable native request ID are persisted; waiting/retry does not substitute a newer workflow instruction. A transition does not create or prompt for a worktree; use the notice or Git section instead. The notice's **Create worktree** uses the displayed derived branch, destination, and source directly; it refreshes collision-aware defaults when untouched, routes to Git when no destination is configured, and keeps a Git failure inline with a review path. **Move only** never submits a prompt. **Move and run** queues the instruction into only the selected native conversation; other chats are not messaged.

The drawer shows waiting/sending/failed confirmed-action status. Once context is ready, **Retry confirmed action** resumes the saved choice; **Cancel action and return to base** clears it when prompt admission is not in progress. A stage may already have changed when native prompt admission fails, so check both stage and status rather than interpreting the error as a complete rollback.

After an interrupted admission, `DELIVERY_UNCERTAIN` requires an explicit retry using the **same** native request identity; native deduplication protects that request. Admission uses native queue mode: it is not proof the turn started, finished, or succeeded. Do not manually send the instruction again just because a waiting/uncertain status is visible, and do not change targets while admission is in progress.

## Archive, remove, and delete

| Action | Successful effect | Retained |
| --- | --- | --- |
| **Remove worktree** | Returns every retained chat to the base project, then removes only the eligible bound checkout. | Card, notes, native chats/histories, branch. |
| **Delete task** | Returns every retained chat to the base project; removes an eligible bound checkout; removes the owned worktree workspace registration; archives native chats; finally removes card/notes. A best-effort bulk selection skips busy, operation-pending, or dirty tasks and reports them. | Native histories and Git branch. |

For removal or deletion:

- Review the task identity, exact worktree path, and consequences in the confirmation. The command carries the expected target; a changed binding/canonical target requires new review instead of silently deleting a different directory.
- All associated conversations must be idle. A failed return to base preserves the checkout and recovery information; do not report deletion success. A later native unarchive must resume at the original project subdirectory, not a deleted worktree or the Git root.
- Modified tracked files **or untracked files** require the additional **Discard local worktree changes?** confirmation. **Keep local changes** preserves those files and checkout. Retry does not itself grant discard consent; when still required it presents that extra choice again.
- Refuse cleanup of a checkout shared with another task or known native session. External attachment does not establish exclusive ownership or permission to remove unrelated work. Registered-repository identity, safe canonical target, Git lock, policy, and checked Git exit results still apply.
- Unclaimed diagnostic checkouts are excluded from the expected destructive target and remain on disk even after task deletion.
- No associated worktree means **no filesystem cleanup substitute**. Never remove the base project, Git root, their ancestor, or Git metadata in place of a checkout. A branch is not deleted by either flow.
- Native chat archiving is **not history deletion**. No private native session log is directly unlinked. If cleanup/archive/storage fails halfway, retained associations and the journal support retry; do not claim completion until the remaining effects are accounted for.

These plugin behaviors are verified in controlled public native-port fixtures and real temporary repositories through [Git handling](<../src/host/git.ts>), [the coordinator](<../src/host/worktrees.ts>) and [host lifecycle commands](<../src/host/app.ts>). The host owns native archive/history implementation. If canonical native/shared-target metadata cannot be read, cleanup must fail closed: preserve the checkout, branch and recovery metadata and report the limitation. Do not skip a peer, inspect conversation content, repair native records or claim that physical cleanup succeeded in that host profile.

## Questions, notes, and stale views

- A `decision_request` page returns immediately. The form is optional text-composition UX, not a native pending-tool/approval interaction. Received pages can be answered while the round streams; Submit waits for actual native turn completion and valid answers, then sends one ordinary question/answer message through the originating conversation.
- The expanded footer's **Dismiss** action removes every unresolved round in that conversation. An untouched round closes immediately; entered answers or notes show an inline discard confirmation first. Dismissal sends no conversation message, persists a dismissed-turn marker, prunes stored question-page payloads for those turns, and does not modify the native transcript. Reload, reconnect, and transcript replay do not restore the round; future rounds still appear. The awaiting-reply indication clears because the dismissed round is no longer pending.
- Closing submits no answer. A normal human reply retires the pending round; injected runtime-context records do not count as an answer. The tool row can reopen/review question pages. Canonical events reconstruct the round after reload, including PTC correlation; unsent form drafts are not promised durable.
- A genuine native ask-user or permission request stays independent. Dismissing a rich form or sending its text does not settle an unrelated native pending interaction.
- Notes are shared by the task. Missing task context in an ordinary chat needs an explicit task ID, not a fallback to another task. There is no decision ledger or plugin TODO list.
- For feed errors use **Retry updates**; for initial board load use **Retry loading board**. Reopen a failed native tab or use its displayed retry action. A duplicate Kanban composer warning means close the other plugin view first, not copy the chat implementation.
- Creation commands return a **transient exact entity receipt** for that command; the UI does not infer a new project/task/tab/note by comparing snapshots. A missing receipt or unavailable created entity means inspect/refresh and select the saved entity explicitly before trying another creation. Receipts are not a persisted ledger or execution-success record. Project drafts/selection are locked during saves, and stale completion cannot rebind another draft.
- Workflow editing uses a code editor with line numbers, YAML highlighting, folding, search, live syntax/schema diagnostics, vertical resize, and a maximize toggle. Save is disabled while the document is invalid or still checking. The draft survives Configuration tabs; closing Configuration or reloading with a dirty draft asks first. Invalid workflow saves leave the last valid workflow intact; retaining referenced column IDs avoids orphaning active or pending-transition tasks.

## Metadata, disabling, and rollback

The plugin uses the native storage-domain service's namespaced **kanban**, version **1**, single-snapshot domain; see [the adapter](<../src/host/storage.ts>) and [validated durable store](<../src/domain/store.ts>). It stores projects/workflow/tasks/notes/operation references, not a second transcript database. Mutations are serialized, revision checked where supplied, and published after durable writes. One active host/profile writer is the supported boundary; there is no multi-host replication guarantee.

Use the correct host/profile's supported backup procedure before an upgrade or manual recovery, including both plugin metadata and native session storage as needed. The physical backing path belongs to that host configuration; do not guess it from cwd. This plugin provides no general backup/restore or export UI. Unsupported schema versions fail rather than silently reset; preserve the original snapshot and use compatible code or reviewed migration, not a blank-state overwrite.

Disabling/uninstalling through native plugin management removes plugin UI/tools/listeners and releases its UI session references. It does not mean delete tasks, native histories, branches, worktrees, or stored metadata. A compatible re-enable can reconnect the same native IDs. Reverting plugin code does not undo confirmed checkout deletion or native-chat archiving. Do not use source/core/profile edits to disguise partial cleanup.

## Build and test troubleshooting

Use a normal Node development installation, not the hardened executable embedded in the DSH app:

```sh
node --version
pnpm --version
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
# Combined sequence: typechecks, tests, then build
pnpm run check
# Real-composition e2e is manual before release against a pinned DSH checkout:
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
```

`pnpm run test:browser` is the separate Playwright harness for real CSS layout, CodeMirror, and animation behavior. It is intentionally not part of `pnpm run check`, which stays portable. `scripts/e2e-dsh.mjs` requires a DSH `dsh-v0.2.1-rc.2` checkout installed and built; it copies the plugin-owned scenario templates into that checkout's web test tree, runs them with `DSH_SNAPSHOT=replay`, and removes them afterward. The scenarios seed a question session without a model call and exercise real temporary Git for the worktree flow.

The hardened bundled Node failed loading the Rollup native addon due to a **Team ID/code-signing mismatch**. This does not justify disabling library validation, removing signatures/quarantine, or re-signing the app. Run the suite under normal Node instead and keep the actual failure distinct from test assertions.

Host and client native SDK augmentations belong to **separate TypeScript Programs**: [host typecheck](<../tsconfig.host.json>) and [client typecheck](<../tsconfig.client.json>). Declaration output is also separate via [host declarations](<../tsconfig.build.json>) and [client declarations](<../tsconfig.build.client.json>). [The build](<../scripts/build.mjs>) uses external native host packages and wraps the client bundle for DSH's browser module loader; it is not a standalone app. Do not fix augmentation conflicts by combining Programs or patching the installed SDK/core.

## Verification status

Acceptance follows the user-approved [public-extension-point boundary](<../openspec/changes/archive/2026-10-22-define-kanban-product/design.md#compatibility-gates-and-verification-strategy>), not requalification of DSH itself. The [current verification report](<verification-preliminary.md>), [scenario matrix](<scenario-evidence.md>), [run register](<verification-runs.json>) and [independent product review](<code-review.md>) contain exact executed results and outstanding product fixes.

| Gate | Required plugin evidence |
| --- | --- |
| G1 | Public host/client build and external-consumer types; supported manager reconciliation and actual existing-GUI navigation/startup smoke. |
| G2 | Published provider/factory/retention contracts, correct A/B/main-C identity and delegated send/Stop/approval targets; existing-shell embed smoke. No native chat/model-engine replay. |
| G3 | Our coordinator, public native-port/activity/error/hook contracts, persistent waiting/partial/retry state and real temporary Git paths. No forced native scheduler/kernel tests or global lease. |
| G4 | Our tool/schema/PTC correlation, dock/form/ordinary-text forwarding and reload behavior; historical native presentation slices supplement the contracts. |
| G5 | Real temporary Git plus controlled native lifecycle ports for return-before-remove, archive-not-purge, dirty confirmation, branch/base preservation, unknown/shared-target refusal and recovery. |

**Host limitations remain explicit.** Native Files and sandbox origin are not migrated by cwd changes. Actual policy/confinement can deny operations. An unreadable native record prevents safe shared-target exclusion and therefore physical cleanup in that profile; this is a safe refusal, not a reason to weaken checks or repair native data. Acceptance uses the deterministic test adapter; a real-model end-to-end conversation is not claimed.

### Published records versus local-generated evidence

Tracked reports and source tests are clone-accessible. Paths under `.verification` in historical records identify local-generated, ignored evidence only; raw QA JSON, screenshots, auth state and native conversation content are not publication assets. No old failed run or time-scoped resource observation is retroactively rewritten as a pass. The temporary schedule verifier was explicitly stopped; that transport stop did not prove native fixture or guard disposal.

The UX improvements change owns the workflow editor, worktree notice, content-height columns, drawer animation, and question-dismissal scope. Release completion is determined by the agreed product scope, final source review/build/tests and existing-GUI smoke, not by upstream DSH internals or historical QA-script counts.
