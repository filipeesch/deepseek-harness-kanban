# Independent Final-Source Code Review

Change: **define-kanban-product**. Review dates: **October 21–22, 2026**. Earlier targeted re-review: **October 22, after 01:18 local runtime time**. Latest independent product CR10/CR11 re-review: **October 22, after 10:57 local runtime time**. **Not release, sync/archive, commit, or publication approval.**

## Current result

**CR01–CR08 remain fixed at the previously independently inspected source/local-regression layer.** The separate CR09 late-schedule-wake source condition was subsequently reproduced RED and corrected GREEN with a minimal public-event subscription; its implementation-owned local evidence is recorded below and was subsequently independently verified in [the schedule-wake review](<schedule-wake-review.md>). No live Native schedule failure or live acceptance is claimed. Native task 4.3 remains OPEN; source closure does not establish native/live acceptance or release/archive approval.

**Latest product-only result: CR10 (editor draft lifetime) and CR11 (attention cache refresh/recovery) are independently source/local-closed on the frozen identities below. No unresolved P1/P2 remains from these two findings in the final narrow re-review.** Fresh product checks passed 121 tests across 11 files and both separate host/client TypeScript Programs. The approved public-extension-point boundary trusts DSH conversation/model/kernel/scheduler implementations; exploratory Native/QA lifecycle instruments are not additional product implementation gates. Historical CR01–CR09 evidence and Native qualifications remain unchanged, not re-certified by these checks. No current build/GUI reconciliation, release, sync/archive or publication approval is implied.

| ID | Priority | Finding | Current source-review status |
|---|---|---|---|
| CR01 | P1 | Missing worktree could admit execution that native recovery redirected to base | Fixed and independently tested; related CR06 also closed |
| CR02 | P2 | Move and run could execute a different instruction from the displayed confirmation | Fixed and independently tested |
| CR03 | P2 | Failed-create retry could adopt a preexisting external checkout as plugin-owned | Fixed and independently tested; related CR07 also closed |
| CR04 | P2 | An older project save response could bind another draft to the wrong ID | Fixed and independently tested |
| CR05 | P2 | Ordinary-chat question preparation survived a host epoch and lost rounds | Fixed and independently tested |
| CR06 | P2 | Explicit return to base retains a ready checkout binding that the new guard mistakes for the active context | Fixed and independently tested, including retained/inactive checkout |
| CR07 | P2 | An offered remote branch creates a checkout, then create/retry/return all reject its normal detached HEAD | Fixed and independently tested with actual temporary Git and diagnostics |
| CR08 | P2 | Cold-peer cwd discovery stopped on an aggregate projection failure despite readable canonical native history | Fixed and independently tested; availability correction, not a permission bypass |
| CR09 | P2 | A late one-shot schedule deactivation could leave a waiting context operation without a wake | Independently verified source/local fix after RED→GREEN regression; Native task 4.3 gate remains OPEN |
| CR10 | P2 | A completed older Info/Notes save could erase a newer or another selected draft | Fixed and independently tested: pending locks, keyed editor lifetimes and stale-completion fences |
| CR11 | P2 | Cached early or failed attention reads could remain stale after idle or read recovery | Fixed and independently tested, including no-event initial failure and late-old-rejection ownership |

No P0 was established. All findings and follow-ups were sent to the implementation owner immediately after reproduction. Parent-reported changes alone do not close a finding; the statuses above reflect independent source and local-test inspection. Live acceptance is still separate.

CR09 is a separate, parent-authorized investigation and local correction, subsequently independently source-verified. The implementation-owned history below remains attributed to its author; the later independent review and controlled reconciliation are recorded separately. Prior CR01–CR08 findings, evidence, and qualifications remain intact.

## Scope and restrictions of the original CR01–CR08 review

Read [project instructions](<../AGENTS.md>), the [proposal](<../openspec/changes/archive/2026-10-22-define-kanban-product/proposal.md>), [design](<../openspec/changes/archive/2026-10-22-define-kanban-product/design.md>), [tasks](<../openspec/changes/archive/2026-10-22-define-kanban-product/tasks.md>), and all nine specs: [navigation](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/harness-navigation/spec.md>), [board](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/kanban-board/spec.md>), [projects](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/project-contexts/spec.md>), [conversations](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/task-conversations/spec.md>), [worktrees](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/worktree-management/spec.md>), [tools](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/product-tools/spec.md>), [questions](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/structured-questions/spec.md>), [notes](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/task-notes/spec.md>), and [lifecycle](<../openspec/changes/archive/2026-10-22-define-kanban-product/specs/task-lifecycle/spec.md>).

Read the actual production source, relevant tests, [scenario evidence](<scenario-evidence.md>), [preliminary verification](<verification-preliminary.md>), [durable run record](<verification-runs.json>), and [operations guide](<operations.md>). All new source was in review scope despite the unborn Git baseline. Focus: cross-file correctness, target authorization/canonical roots/confinement, partial operations/retry/cancellation, run intent/idempotence, native session scope/retention, typed RPC/Cordis injection, and canonical question history/send boundaries.

This reviewer owns and edits only this report. No code, tests, tasks, specs, profile, goals, commits, live Native APIs, authentication, live browser, LLM, or live fixture data were changed/invoked. Reproductions compile actual source in memory with esbuild `write:false`. React reproduction uses jsdom; Git reproduction uses the existing guarded local temporary-repository unit helper and cleans its verified temporary root. No core/server/restart changes occurred.

## Resolved CR06 — P2: Explicit base recovery and active-context selection

**Original reproduction:** create a ready checkout, explicitly return to base, then validate the retained conversation. The former guard selected the retained ready tree instead of the committed base cwd and rejected execution. This is a recorded historical reproduction, not the current behavior.

**Independently verified correction:** [active context resolution](<../src/host/app.ts#L58-L69>) treats the task's committed base cwd as authoritative after an explicit return, without probing an inactive retained checkout. A non-base context must still resolve to the exact ready tree/subproject; the final validation rereads project/session/context identity. This does not accept native fallback to base while task metadata still selects the tree.

**Exact verified regressions:** [retained ready tree, absent inactive tree, fresh plus at base, selected-target execution, and failed-send cancellation/return](<../tests/host/app.test.ts#L82-L100>). These passed together with the original missing-tree, missing-base, native-recovery/drift and public pre-model guard tests in the final 211-test run. The checkout remains retained rather than being silently deleted. **Closed at source/local-regression level.**

## Resolved CR07 — P2: Supported branch choices and safe unclaimed-checkout recovery

**Original actual-Git reproduction:** a remote-only origin/feature was offered by branch discovery; existing-branch create produced a detached checkout, then create/retry/return all rejected HEAD. The checkout existed on disk with no task binding and a stuck operation. This is a historical reproduction, not the current advertised contract.

**Independently verified correction:** [discovery offers only supported local heads](<../src/host/git.ts#L106-L109>), and [existing mode verifies the exact local ref before any write](<../src/host/git.ts#L128-L152>). Remote refs remain valid as an explicitly entered **New branch source**, producing an attached local branch; same-named local/remote/tag ambiguities are tested against actual Git. Unsupported remote-only existing selections now fail before creating a checkout and can return cleanly.

For an already-created legacy/interrupted detached or mismatched-ref checkout, [explicit return validates canonical target/repository/proof, preserves any distinct known binding, and records diagnostic-only unclaimed paths](<../src/host/worktrees.ts#L139-L174>) rather than claiming them. The [public task type](<../src/shared/types.ts#L24-L30>) and [strict optional persisted field](<../src/domain/schema.ts#L52-L57>) give those diagnostics no ownership/active/removal authority. [Successful explicit attach clears the matching diagnostic](<../src/host/worktrees.ts#L359-L367>); [cleanup targets only the bound worktree](<../src/host/worktrees.ts#L371-L385>), never diagnostic paths.

The [Git notice](<../src/client/git.tsx#L39-L49>) displays paths/branches/reasons read-only, with no automatic attach/remove or prefilled target. The [deletion confirmation](<../src/client/board.tsx#L99>) warns that unclaimed checkouts remain on disk and still submits only the bound expected target.

**Exact independently executed tests:** [local-only discovery/remote rejection, explicit remote source, attached local/tag ambiguity, branch preservation and unsupported pseudo refs](<../tests/worktrees/git.test.ts#L101-L139>); [coordinator pre-effect rejection, real local-branch storage retry, durable restart/dedup, deletion leaving diagnostics on disk, partial migration return, distinct binding preservation, foreign-repository rejection, actual legacy detached recovery and storage failure retaining its journal](<../tests/worktrees/coordinator.test.ts#L427-L533>); [strict optional diagnostic persistence and rejection of authority fields](<../tests/worktrees/unclaimed-state.test.ts#L11-L24>); [read-only notice and bound-only destructive confirmation](<../tests/client/unclaimed.test.tsx#L19-L39>). **Closed at source/local-regression level.**


## Original findings: independently verified fixes

### CR01 — P1: Missing directory / native recovery to the wrong checkout

**Original reproduced defect:** the run path only compared recorded strings and admitted a prompt when both named an absent worktree/subproject. Pinned native [assembly recovery](<../node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L48-L65>) and [ensure](<../node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L87-L101>) validly restore an ordinary conversation to its original cwd; the plugin previously had no task-context execution guard against that consequence. This is not an SDK defect.

**Verified correction:** [application context resolution and validation](<../src/host/app.ts#L58-L65>) precedes [run send](<../src/host/app.ts#L158-L162>). The native [validation adapter](<../src/host/native.ts#L178-L193>) checks canonical existing expected/observed directories, rereads native commitment, and does not call native ensure or confer access. Public [pre-step/request hooks](<../src/index.ts#L15-L35>) validate again before model use, including after downstream request middleware, and leave unrelated conversations alone. No atomic lease is claimed.

**Exact independent regression inspection/execution:** [missing tree/subdirectory/base and drift admission](<../tests/host/app.test.ts#L67-L79>), [native validation and simulated recovery](<../tests/native/native.test.ts#L115-L185>), and [public hook/request/cancellation/disposal tests](<../tests/native/execution-guards.test.ts#L24-L74>). These use real filesystem checks/public Cordis with native/model doubles, not live turns. Original defect is fixed at this layer; CR06 is the separate recovery regression.

### CR02 — P2: Displayed instruction was not bound at admission

**Original reproduced defect:** display APPROVED IN DIALOG; replace the column instruction before submitting the UI payload; the actual application sends REPLACED BEFORE ADMISSION.

**Verified correction:** the [dialog freezes exact raw displayed instruction text](<../src/client/move.tsx#L8-L17>), the [wire schema preserves it](<../src/remote.ts#L17>), and the [host requires equality before new-conversation/Git/journal effects](<../src/host/app.ts#L122-L139>). A previously admitted instruction remains frozen during subsequent wait/retry, without demanding approval of a later replacement.

**Exact tests:** [host changed/removed/missing/raw-text/wait/retry cases](<../tests/host/app.test.ts#L26-L65>) and [actual dialog stale-display/raw-Markdown/Move-only cases](<../tests/client/approval.test.tsx#L20-L49>). Independently executed; fixed at this layer.

### CR03 — P2: Failed-create retry inferred ownership of a preexisting checkout

**Original actual-Git reproduction:** externally create the requested matching-branch checkout; create/new fails because the branch exists; retry silently adopts it and publishes owned:true.

**Verified correction:** the [coordinator establishes an absent destination and durably records operation-bound intent before Git](<../src/host/worktrees.ts#L294-L317>), [validates the canonical proof](<../src/host/worktrees.ts#L210-L219>), [disarms known pre-effect failures](<../src/host/worktrees.ts#L375-L386>), and [requires the proof for return recovery](<../src/host/worktrees.ts#L145-L149>). The [strict domain schema preserves the proof](<../src/domain/schema.ts#L40-L46>). A preexisting matching checkout now fails without ownership inference; explicit attach remains available. Real post-effect/acknowledgment/storage-failure recovery is retained.

**Exact tests:** [preexisting types, branch-validation race, persisted-intent race, proof durability, serialized restart, mismatched ref/proof and legacy cases](<../tests/worktrees/coordinator.test.ts#L279-L421>). Independently executed with actual temporary Git plus session/storage doubles. Original defect is fixed; CR07 is the separate offered-ref regression. No external filesystem lease is inferred.

### CR04 — P2: Save response rebound another project draft

**Original actual-component reproduction:** defer X creation; select Y while pending; resolve the correct X receipt; next Save sends X ID with Y name/paths.

**Verified correction:** [project editor locks selection and draft fields while pending, tracks draft generation, and rejects stale completion](<../src/client/forms.tsx#L36-L47>). Exact receipts are retained, with ID/fields/revision no longer split across two drafts.

**Exact tests:** [deferred creation/edit, New/Edit locks, missing receipt/error, close/remount and late completion](<../tests/client/project-race.test.tsx#L28-L70>) and [existing concurrent-actor receipt cases](<../tests/client/identity.test.tsx#L43-L51>). Independently executed; fixed at this layer.

### CR05 — P2: Ordinary question cache survived a host epoch

**Original actual-bridge reproduction:** ordinary history fetch returns one round; accept fresh seq-0 host baseline with no ordinary history; explicit prepare/reopen never refetches (calls=1, rounds=0).

**Verified correction:** [accepted physical baselines clear preparation and rehydrate tracked sessions](<../src/client-bridge.ts#L112-L120>); [history promises join the current epoch, fence stale response/error, merge without rewinding current answered/complete state, and publish per-session retry errors](<../src/client-bridge.ts#L171-L215>). [Dock errors remain session-scoped](<../src/client.tsx#L114-L129>) rather than falsely failing the board feed.

**Exact tests:** [restart/rehydration/reopen, late previous-epoch history, current answered monotonicity and background error/retry](<../tests/bridge/bridge.test.ts#L181-L232>). Independently executed using the real SDK stream supervisor with mock transport. Fixed at this layer; no live G4 claim.

## Additional batched correction and unchanged boundaries

The [blank standalone task-session embedded factory](<../src/client.tsx#L64-L79>) now uses active/hero:false instead of the main-workspace hero. Checked the pinned public [workspace/hero inert condition](<../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js#L17768-L17832>) and the [exact no-native-navigation regression](<../tests/bridge/plugin.test.tsx#L141-L153>). The change is source-contract correct and independently regression-tested; it does not prove actual G2 send/stream/approval compatibility.

The original review also inspected canonical Git identity/target guards, destructive consent and shared-target checks, real participant policy selection/native confinement, output/lifetime bounds, stable prompt request identity and pinned deduplication, retained session/provider binding, owner-only typed RPC and post-mount namespace injection, separate host/client TypeScript Programs, the board/note tool allowlist and missing-context behavior, Markdown note preservation, canonical native/PTC question metadata and genuine human-origin retirement. No additional reproducible security bypass, private-core import, shadow agent/chat, or SDK defect was established. Prior F01–F04 and the exact creation receipts/early snapshot sequence capture were not re-reported.

## Independent execution evidence

**Initial review:** 126 tests / 9 suites passed, exit 0, 17.69 seconds, start 23:26:42. Overlaps later runs and the parent suite; do not add it to their totals.

**Batch re-review:** **266 tests across 14 distinct suites passed**, all exit 0, in three nonoverlapping focused commands under normal Node:

```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/host/app.test.ts tests/native/native.test.ts tests/worktrees/git.test.ts tests/worktrees/coordinator.test.ts tests/domain/schema.test.ts tests/client/identity.test.tsx tests/client/board.test.tsx tests/bridge/bridge.test.ts tests/bridge/plugin.test.tsx tests/bridge/generation.test.tsx tests/bridge/cordis.test.ts --reporter=dot
# 239 tests / 11 suites; 29.50 seconds; start 23:52:28

/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/native/execution-guards.test.ts tests/client/project-race.test.tsx --reporter=dot
# 22 tests / 2 suites; 1.95 seconds; start 23:53:14

/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/client/approval.test.tsx --reporter=dot
# 5 tests / 1 suite; 0.70 seconds; start 23:55:16
```

The earlier 266-test batch did not cover the subsequently established CR06/CR07 regressions. The final targeted run below now exercises their corrections and retained negative safety cases. The initial bundled hardened-Node test attempt failed before assertions with the existing Rollup addon Team-ID/code-signing mismatch; normal Node worked. No dependencies, signatures, or security settings were modified.

**Final CR06/CR07 re-review:** independently ran **211 tests across 8 suites**, all passed, exit **0**, duration **33.00 seconds**, start **00:17:17 on October 22**. This run overlaps the earlier review runs; do not add their counts together. It includes actual temporary Git, production app/native adapter code with native/model doubles, public Cordis hooks, strict schema persistence, and React diagnostics/confirmation checks.

```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/host/app.test.ts tests/native/native.test.ts tests/native/execution-guards.test.ts tests/worktrees/git.test.ts tests/worktrees/coordinator.test.ts tests/worktrees/unclaimed-state.test.ts tests/domain/schema.test.ts tests/client/unclaimed.test.tsx --reporter=dot
```

The parent reports a later full 600-test pass that also predates the final CR06/CR07 diagnostic fixes; neither that nor the earlier 453-test pass is treated as final-batch verification here. This reviewer did not rebuild/reconcile the plugin or run the new full parent suite. Updated full-suite/build provenance belongs in the [durable run record](<verification-runs.json>).

## Resolved CR08 — P2: Aggregate projection failure unnecessarily blocks cold-peer cwd discovery

**Scope and provenance:** the parent reported a live G3 shared-target-stage failure classified as projection-related and requested review of a narrow directory-reader correction. The particular peer and projection responsible have **not** been identified. This review does not claim an unregistered projection, missing filesystem path, unreadable native log, or SDK defect as the live root cause. The source-level availability condition is independently established below.

**Original source condition:** cold-session directory discovery awaited the complete aggregate projection read before attempting exact canonical inspection. Any error from an unrelated aggregate projection aborted the shared-peer catalog, even when the native header plus complete canonical event history remained readable. Refusing an unknown peer was conservative, but the already-supported authoritative read path was unreachable on this error condition.

**Independently verified correction:** [cold directory reads](<../src/host/native.ts#L164-L182>) create one 30-second read-budget signal, try the aggregate projection, and fall back only to public exact native inspection when that aggregate read fails. The same signal is passed to both reads: the correction does not grant a new second 30-second budget. An aborted budget or gateway/cancelled rejection is propagated without starting inspection. A sequenced cwd remains preferred; migration hints remain ignored.

The pinned public [cold inspection implementation](<../node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L144-L176>) explicitly observes with projectionMode:none and returns the persisted header and complete event prefix without repairing/resuming/publishing an Agent. The adapter [folds actual working-directory change events over the initial origin](<../src/host/native.ts#L59-L64>), not the stale cwd from a list row. Attached public inspection also returns its exact native snapshot rather than resuming the Agent.

**Safety review:** [shared-session enumeration](<../src/host/native.ts#L263-L268>) retains every listed/live peer and propagates an unreadable canonical inspection; no peer is skipped. No native ensure, Agent resolution, prompt, filesystem-policy grant, private API, or unrestricted retry was added. Exact activity admission still requires its existing projection checks; the patch does not infer idleness from missing projections. No weakened target authorization or confinement boundary was found. As before, the read deadline depends on the public native reader honoring its cancellation signal; it is not an added global deadline for a catalog containing many peers.

**Exact independently executed regressions:** [aggregate failure with canonical cwd event, retained cold shared peer, both reads unavailable, and gateway cancellation](<../tests/native/native.test.ts#L282-L304>), alongside [existing exact/migration-history behavior](<../tests/native/native.test.ts#L273-L280>) and [unreadable-peer rejection](<../tests/native/native.test.ts#L306-L314>). The tests verify that the event-derived current directory, rather than immutable header/list cwd, is returned, and that no peer activation or native ensure occurs.

**Independent run:** **178 tests / 6 suites passed, exit 0**, normal Node, **35.23 seconds**, start **01:18:39 on October 22**. This overlaps prior runs and is not added to their totals.


```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/native/native.test.ts tests/native/execution-guards.test.ts tests/worktrees/git.test.ts tests/worktrees/coordinator.test.ts tests/worktrees/unclaimed-state.test.ts tests/host/app.test.ts --reporter=dot
```

The parent stated that this source correction was not yet built or activated when review was requested. This reviewer did not build/reconcile it or retry live cleanup. **CR08 is closed at source/local-regression level; actual G3 shared-target recovery remains separate acceptance evidence.**

## Acceptance and publication

The latest [durable gate record](<verification-runs.json#L362-L452>) now records **G1 passed through the existing-backend HTTP client** and **G2 passed through existing-backend native model/UI**, including scoped approval rejection, with their stated limitations. G3 has actual policy/confinement/migration evidence but remains partial; G4 has actual native/PTC question evidence but remains partial; G5 is incomplete. These are parent-recorded live results, not independently executed by this source reviewer. The original Desktop renderer remains unverified. The CR08 source correction itself is not treated as an activated/live cleanup pass.

Unchecked checklist items are acceptance/administrative work, not proof that code is absent. CR01–CR08 are independently source-closed; preserve their negative safety regressions and complete the remaining actual G3–G5/end-to-end evidence. The parent owns live execution and publication decisions; this reviewer does not invoke those flows or infer unrecorded outcomes. Remote publication destination remains a human-confirmation matter for the parent. **No final release, sync/archive, commit, force-push, or wrong-repository overwrite approval is provided.**


## CR09 — P2: Late schedule deactivation has no product wake subscription

### Provenance and scope

This is a separate parent-authorized source investigation and minimal correction, not a reopening or retrospective revalidation of CR01–CR08. The earlier reviewer-ownership/method statements describe those earlier independent batches. This CR09 block records implementation-owned RED-before/GREEN-after evidence and still requires the parent's independent frozen-source review before a controlled build/reconciliation.

The investigation ran only local synthetic tests and TypeScript checks. It did not call a Host, Native API, schedule/reminder API, profile, GUI, authentication, provider, or real Native executor; did not append canonical Native history; and did not build, install, reload, restart, reconcile, or modify live fixture/user data. Local unit fixtures use a temporary filesystem root with guarded cleanup, in-memory public-service fakes, a real Cordis bus, and the existing TestGit boundary. The real product registration, native activity adapter, BoardStore, KanbanApp, and WorktreeCoordinator execute, with only the approved public-event listener added to production.

### Source condition and deterministic RED

The pinned public [schedule delivery path](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L1586-L1609>) follows up the Agent and awaits Session persistence before committing one-shot inactivity. Its [public activity contribution](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2043-L2055>) treats active owner schedules as busy, including future one-shots. The generated [schedule/changed contract](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L845-L857>) is an emit notification with no payload.

Before this correction, production registration subscribed only to Native Session events. [Application observation](<../src/host/app.ts#L46-L51>) schedules a single 50ms retry, not a periodic retry. If the last Native notification's retry observes the schedule still active, later schedule inactivity alone does not produce another product wake.

The new [real-registration regression](<../tests/host/schedule-wake-race.test.ts#L151-L166>) demonstrated this ordering directly:

1. All fake Agents are idle, but the exact public schedule activity row is active. A real worktree operation persists phase:waiting and no Git create occurs.
2. Emit one fixture-only public Session turn-end notification through actual Cordis/production registration, without appending it to any canonical Native log. Advance the fake clock 51ms. The actual one-shot resume runs exactly once, still observes schedule activity, and remains waiting.
3. Mark the public schedule activity inactive and emit only payloadless schedule/changed. No further Native notification or manual retry occurs. On the old production registration, the operation remains {phase:waiting, worktreeStatus:null} instead of {phase:null, worktreeStatus:ready}.
4. A [positive control](<../tests/host/schedule-wake-race.test.ts#L191-L206>) with the same real fixture emits one later Native notification after inactivity and reaches ready. This rules out an incapable Git/port fixture as the reason for the RED result.

**Before patch:** one RED race test and one GREEN positive control, reproduced twice. Strict scoped TypeScript passed after the new test documented the optional schedule activity-type extension with a bounded test-only adapter matching the pinned public shape.

This is deterministic source-ordering evidence for the stated late-commit interleaving. It does not prove that a live Native schedule exhibited that interleaving in the installed runtime, and it is not a separate claim that ordinary turn-end/idle microtask ordering needs a new status hook.

### Minimal approved correction

The [host entrypoint subscription](<../src/index.ts#L49-L56>) now observes the public payloadless event and calls the existing app.activityChanged method. The subscription belongs to the actual plugin fiber via ctx.on. A [narrow public Cordis Events augmentation](<../src/index.ts#L15-L16>) mirrors the exact generated event signature because the optional schedule SDK's ambient declaration is not part of this package's dependencies. No schedule service is injected or required; the host still loads without such an event source/service.

No private schedule catalog, actor-status hook, polling interval, timer/debounce alteration, runtime dependency, core patch, or directory/model/policy behavior was added. The existing debounce coalesces activity notifications, and the existing coordinator continues to check exact owned activity before performing any pending operation.

### GREEN and lifecycle proof

**After patch:** all three focused tests passed:

- the former RED late-inactivity case naturally reaches ready using only the public schedule change;
- the existing later-Native-notification control still reaches ready;
- [actual host-fiber disposal](<../tests/host/schedule-wake-race.test.ts#L168-L189>) removes the listener and clears a pending activity timer; a subsequent public schedule notification invokes no app activity method, creates no timer, resumes no operation, and changes no board state.

The new tests assert no prompt, archive, Native executor, or child-process spawn. The public turn-end object is only a fixture notification and is never persisted or presented as canonical Native evidence. Both full host and full client TypeScript Programs passed, resolving the concurrently observed new-fixture activity-union typing error without weakening the production native interfaces.

The complete local suite was also collected successfully: **1147 tests across 39 suites passed**, exit **0**, duration **37.37 seconds**, start **07:09:20 on October 22, 2026**. Managed job bash-51c5949a40614dc0 was collected after completion. This includes existing guarded temporary-Git unit tests and synthetic QA-helper tests, not live helper CLIs or Native runtime acceptance. These counts overlap the focused three tests and must not be added to their total.

Commands used the bundled Node/pnpm runtime:

~~~sh
tsc -p tsconfig.host.json --noEmit
tsc -p tsconfig.client.json --noEmit
vitest run tests/host/schedule-wake-race.test.ts
vitest run
~~~

### Source versus acceptance decision

**CR09 is corrected at source/local-regression level, subject to independent frozen-source review.** Native active-schedule lifecycle acceptance remains OPEN under task 4.3/A7 and requires separately authorized actual evidence. No real reminder, natural wake, canonical inbox/delivery correlation, model request, or live idle/wait transition was exercised by this source regression. The currently installed runtime was not rebuilt or reconciled by this work. Parent owns any later independent review, controlled build, GUI/runtime reconciliation, fixture authorization, and Native schedule validation; no such action is approved or performed here.

### Subsequent independent review and controlled reconciliation

The independent [CR09 review](<schedule-wake-review.md>) found no material source defect, verified all frozen hashes, independently passed the three focused regressions and both host/client typechecks, and retained the source-only qualification. Parent then built host hash `0e5e36dcf53de94133abe3f138357733d58c35411da7519a35605b42940aac6a`; the client and remote hashes were unchanged. Public `pluginManager.setBundleEnabled` on the already enabled owned bundle reported `application: applied`, zero warnings, request `345170d6-971c-4ae4-876c-bafe146ff4b1`. A fenced ephemeral browser verified the existing `http://127.0.0.1:51781/` after a same-tab refresh: unchanged startup selection, one Kanban entry, all five columns, zero page errors, and closed browser/context. This is not a Desktop-renderer check or an active-schedule lifecycle pass. No explicit task, session, schedule or model command was issued by that GUI smoke. Parent also collected 1,156 tests across 39 files and both typechecks passing after the latest QA correction. Task 4.3, G3/G5, journal/reload, release, archive and publication remain open.

## PRODUCT CR10 — P2: Deferred editor saves can erase a newer draft

### Original independent reproduction

The product-only source audit after 10:31 executed the actual React InfoPanel/NotesPanel in local jsdom with a deferred RunCommand and in-memory BoardStore/SessionPort/GitPort fixtures. No live browser or DSH service was used.

- Notes: start saving note A; select note B while A is pending; type **UNSAVED B DRAFT**; resolve A. The old completion reset noteId/content and erased B's draft to an empty New note editor.
- Info: submit **FIRST SAVE**; edit to **NEW UNSAVED DRAFT** before that save resolves; publish its first-save state/resolve. The old dirty-reset effect replaced the newer draft with FIRST SAVE.

These were independently executed source/local failures. The author's separate five-RED/editor-GREEN sequence is implementation-owned background, not an independently rerun old-source test count. Existing project-draft race protection did not cover these product editors.

### Frozen correction and independent closure

The corrected [Info editor](<../src/client/forms.tsx#L19-L33>) and [Notes editor](<../src/client/forms.tsx#L64-L71>) use keyed inner lifetimes by task ID, lock mutable fields/selection while the save is pending, and fence stale/unmounted completion. A late task-A success or error cannot act on task B's new editor. Failed saves unlock without losing the draft. [Workflow editing](<../src/client/forms.tsx#L57-L62>) receives the same pending/fenced-save treatment without expanding UX scope. The shared action lifetime guard and exact Markdown payload behavior are retained.

Independent replay of the original actual-component probes now shows pending edits and note-B selection blocked, then normal editing restored: **NEXT B DRAFT** and **NEXT INFO DRAFT** remain after the completed save. The seven [editor regression tests](<../tests/client/editor-race.test.tsx>) cover all three pending locks plus task-switch completion/error isolation. They pass in both independent scoped runs recorded below.

**CR10 is closed at the source/local-regression layer on the frozen forms/test identities below.** This does not claim a new live embedded-conversation or Native retention test.

## PRODUCT CR11 — P2: Attention cache can remain stale after idle or read recovery

### Original failure and initially incomplete correction

The independent actual KanbanApp/BoardStore probe used existing memory SessionPort/GitPort doubles. It observed the last event while the port returned running=true, obtained a snapshot, then made the port idle. After the existing 50 ms debounce had run, the old product still returned running=true while the current port returned false. This was a product cache invalidation/notification defect, not a claim that DSH's Agent kernel or scheduler was broken.

The first correction made the original event/debounce replay pass and advanced the product sequence. Its independent selected suite passed **119 tests / 11 files** at **10:48:59**, duration **3.83 s**, with both TypeScript Programs green. Nevertheless, a new concrete residual P2 was found before closure: on an initial rejected attention read with **no observer event**, the failure fallback was cached indefinitely. A recovered memory port returned failed=false while the next ordinary snapshot still returned failed=true. That result kept CR11 open despite the 119-test pass.

The author reports a separate residual RED at 10:54:15; that time is attributed, not an independently rerun old-source test result. The independent d9a4 probe itself recorded **initialFailed:true, currentPortFailed:false, refreshedFailed:true**. The earlier partial fix is not retrospectively labeled complete.

### Final correction and independently executed probes

The [shared existing 50 ms retry](<../src/host/app.ts#L46-L55>) invalidates attention and publishes a newer sequence in finally after the owned retry/dispatch settles, including its error path. It coalesces the same event boundary, does not poll, and guards disposal. No new Native status hook or SDK behavior is required.

The final [pending-read error handler](<../src/host/app.ts#L56-L59>) evicts a failed read only if the map still holds **that exact pending promise**. Existing awaiters receive the conservative failed fallback, but the next ordinary snapshot may read the recovered port without an event, timer or extra notification. A late old rejection cannot evict a newer successful read.

Fresh independent actual-App memory probes on the final freeze recorded:

~~~json
{"probe":"original-no-event-read-failure","initialFailed":true,"nextFailed":false,"cachedFailed":false,"portCalls":2,"notifications":0}
{"probe":"late-old-rejection","oldFailed":true,"newFailed":false,"portCalls":2,"oldSequenceLower":true}
{"probe":"original-event-debounce","earlyRunning":true,"lateRunning":false,"newerSequence":true}
~~~

The supplementary probe's first setup attempt omitted the required task description and exited before exercising attention. That invalid setup is not product RED evidence; after supplying valid input the replay above completed with exit 0. An immediately premature probe-success message was explicitly withdrawn and corrected before this record was written.

All ten [attention regressions](<../tests/host/attention-refresh.test.ts>) pass, including both entry points, rejected reads with/without the existing retry, stale old success/rejection, retry failure, coalescing, pending close and no late publish after disposal.

**CR11 is closed at the source/local-regression layer on the final app/test identities below.** No DSH provider/conversation/kernel/scheduler implementation was tested or re-qualified by this product fix.

## CR10/CR11 final independent product evidence

- **121 tests / 11 files passed**, Vitest **3.2.7**, start **10:57:25 on October 22**, duration **3.98 s**, exit **0**.
- Breakdown: **77 client tests / 8 files**, including seven editor and five lifecycle-consent assertions; **44 host tests / 3 files** = 31 app + 10 attention + 3 existing schedule-wake registration regressions.
- Both actual separate host/client TypeScript no-emit Programs passed on the current tree. The concurrent product walkthrough test was not edited or independently executed as part of this selection; a global typecheck passing is not a claim that its scenarios ran.
- All commands ran in the foreground and completed; no background review jobs or job-control actions were used.
- The earlier 119-test run and older product/QA/full-suite totals overlap this run and are not summed. No full-repository test count is claimed here.

~~~sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/client tests/host/app.test.ts tests/host/attention-refresh.test.ts tests/host/schedule-wake-race.test.ts
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.client.json --noEmit
~~~

### Verified final identities

All five supplied values matched before and after the independent tests/probes:

| Input | SHA-256 |
|---|---|
| [Product forms](<../src/client/forms.tsx>) | 9bfaa5facd35785faa1cc8264a10d6276dafb1f01da43adfa226aa9c0138f667 |
| [Editor regressions](<../tests/client/editor-race.test.tsx>) | ab312d7d66db4f4612f0a5daf31a442ad18446c9c9c5e7d50b1999b9598294c9 |
| [Product app](<../src/host/app.ts>) | d12918ade45329ed03aa7d6dc604af25fdbfdd7d6fdf9b1e0dab823d6774ef05 |
| [Attention regressions](<../tests/host/attention-refresh.test.ts>) | 36ccdaa2b579d5710e129c9fc5b691a48c080f295339a0a8f4beaccbf1d4e963 |
| [Lifecycle consent tests](<../tests/client/lifecycle-consent.test.tsx>) | cdd8e82467f66d83969219b82035f00d9d287b29cda3a57747f4d9f9a81638f3 |

### Product boundary and limits

The latest approved scope is the external Kanban product using public DSH extension points. Product tests should verify our delegation/arguments, session/receipt ownership, editor/retention lifetimes, workflow text/admission, attention, tools/notes isolation, canonical cwd/confinement, failure recovery, temporary-Git effects, explicit destructive consent and unknown/shared-target fail-closed behavior. They do not need to re-prove DSH's model/chat/kernel/scheduler implementation or build more QA lifecycle machinery. Existing real GUI smoke remains integration evidence with its recorded limits; this reviewer performed no new live smoke.

Only this review document was changed. No source, test, other document, QA infrastructure, Native/current-data/API/browser/auth/model/GitHub/goal/metadata or job operation was performed by this re-review. No the deferred user-supplied UX list (not included in this release) UX work was included. Historical CR01–CR09 findings, prior Native reports and the human-stopped old run remain unchanged and unqualified where originally unqualified. These new source files do not establish any old Native cause or guard-disposal fact.

**No unresolved P1/P2 remains from CR10/CR11 in this narrowed final review.** This is not a blanket guarantee about unrelated work or an approval to build/install/reconcile, sync/archive, publish or release; Parent owns the separately authorized completion and final product verification steps.
