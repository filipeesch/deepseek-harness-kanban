# Independent Coordination Runner Safety Review

Date: **October 22, 2026**. Initial source review and local verification: **02:55–03:06 local runtime time**. Frozen-fix independent re-review: **after 03:27 local runtime time**. Fresh QR06 final-retention re-review: **after 07:39 local runtime time**. Scope: [coordination CLI/controller](<../scripts/verify-native-coordination.mjs>) and [controller](<../tests/coordination-uat-helper/coordination.test.ts>)/[orchestration](<../tests/coordination-uat-helper/runner.test.ts>) contract tests, with imported fixture/inspector/browser-fence boundaries read as necessary.

## Decision

**QR01, QR02, QR04, QR05 and QR06 are independently closed at the source/local-regression level. QR03 remains CLOSED–QUARANTINED, not implemented.** Fresh QR06 review verified the central uncertainty latch and independent Native-resource/gate/socket retention fences on the exact frozen source; **314 local tests across five suites, syntax checks and both host/client TypeScript Programs passed**. The original QR06 reproduction and initial OPEN review are retained below as historical evidence, followed by the latest closure. Earlier QR04/QR05 and question-shape source closures retain their recorded bounds. No new material finding was established in this narrow QR06 re-review. This is not a full new Stage A review, Stage B/C readiness, a live question/descendant/schedule pass, or whole-G3/release approval. Lifecycle remains refused before capability access, and the mandatory pending-journal gate remains unsupported/not-tested with fullGatePass=false. Native retries still require the parent’s next explicit FULL READY and all outstanding human/single-writer preconditions; source closure is not live gate or publication approval.

| ID | Priority | Finding | Status |
|---|---|---|---|
| QR01 | P2 | Cleanup can archive a fixture conversation still at its temporary checkout after return-to-base fails | Closed — exact-base archive and retained-guard recovery independently verified |
| QR02 | P2 | A successful creation with an unusable receipt does not latch uncertainty, allowing more fixture writes | Closed — receipt/DTO uncertainty fence independently verified |
| QR03 | P1 | A delayed OFF request can enter its mutation after an applied ON restoration because helper preflight is outside manager serialization | CLOSED–QUARANTINED — no lifecycle implementation; mandatory journal gate OPEN |
| QR04 | P2 | The owned-drive pre-step permit matched text but not the exact minted input identity | Closed — exact role/id/rpc/content matcher and zero-effect regressions independently verified |
| QR05 | P2 | Entered child creation could reject after materialization but be downgraded to harmless unsupported | Closed — unconditional uncertainty, unknown-child exclusion and Node effect fences independently verified |
| QR06 | P2 | Main/child uncertainty can retain an independent controller but still close its caller-owned connection via a clean app gate | Closed — central retain latch and external-resource/gate/socket fences independently verified on frozen source; local only |

No new production defect is alleged. The product CR01–CR08 source closures in [the product review](<code-review.md>) are unchanged. This review does **not** authorize a live run, model request, policy change, plugin lifecycle, physical cleanup, profile repair, release, sync/archive, or publication.

## Historical findings and original reproductions

The following three findings describe the original pre-fix snapshot. Current corrections and independent regression evidence are recorded in the closure section below; present-tense descriptions here are historical, not claims about the corrected runner.

### QR01 — P2: Cleanup archival did not require the committed base cwd

**Locations in the reviewed snapshot:** [common directory admission](<../scripts/verify-native-coordination.mjs#L86-L90>) and [failure cleanup](<../scripts/verify-native-coordination.mjs#L132-L140>).

The common native façade admits either the base directory or any owned target directory for every action. Archive then verifies idle activity, but never requires cwd to equal the base project. If public return/migration fails, the fallback still selects read-only and archives the known session. It can subsequently dispose its guards and report archive success even though the session still points into the temporary checkout.

This violates the requested **base-only** fallback cleanup boundary. It does not by itself delete the retained checkout, but it leaves archived native history bound to a temporary target instead of the safely committed base context.

**Independent reproduction:** imported only the exported façade, provided synthetic inspect/working-directory/activity/archive services, set immutable origin to base and current native cwd to the owned target, and invoked archive. No Native API, job, filesystem, auth, browser, or model call occurred.


```json
{"currentCwd":"/unit/owned/tree/apps/api","requiredBase":"/unit/owned/monorepo/apps/api","archiveCalled":true}
```

**Specific fix:** archive only after verifying exact committed base cwd, and recheck as near the archive commit as the public API permits. Narrowing to read-only may still be appropriate, but an unknown/non-base cwd must leave archive/guard disposal incomplete, retain the checkout/branch and journal, and report the recovery requirement truthfully. Do not directly rewrite cwd or skip global shared-reference protection.

**Regression:** inject a public return failure or partial A-target/B-base state; assert no archive of the target-cwd conversation, no guard disposal for incomplete safety cleanup, and explicit retained-tree/incomplete output. Existing corrupt-delete coverage begins after a successful return and does not exercise this boundary.

### QR02 — P2: Missing receipt did not stop subsequent effectful cases

**Locations:** [receipt claim](<../scripts/verify-native-coordination.mjs#L109-L110>), [case error continuation](<../scripts/verify-native-coordination.mjs#L118>), and [creation outcome handling](<../scripts/verify-native-coordination.mjs#L103-L105>).

An explicit failed creation Outcome correctly sets creation uncertainty. A successful Outcome with a missing/mismatched/malformed receipt follows a different path: claim records an error and throws, but never sets uncertainty. The per-case catch therefore continues to later cases. The runner can create additional fixture tasks despite having no authoritative identity for the first successful write. A receipt whose entity is absent/inconsistent in the returned DTO and an unusable B-conversation receipt need the same treatment.

**Independent reproduction:** invoked actual runVerification with only in-memory inspector, board, fixture, and report dependencies. A valid project receipt was returned; each task-create changed synthetic state but omitted its receipt. No real native service, process, filesystem, browser, or model was used.


```json
{"taskCreates":4,"cleanupErrors":["creation-receipt-unavailable","creation-receipt-unavailable","creation-receipt-unavailable","creation-receipt-unavailable"],"trackedFixtures":0}
```

The four task-create commands are real calls through the runner's injected orchestration path, **not live DSH writes**. The point is continued execution after the first unknown identity, not a successful gate.

**Specific fix:** latch creation uncertainty before throwing on every unusable receipt or post-receipt identity/DTO validation failure, including project/task/conversation creation. Stop later fixture/tool/job/policy/lifecycle writes; preserve only already receipt-owned IDs and guards, without guessing, archiving, or deleting an unknown session/task. Record a sanitized creation-uncertain reason.

**Regression:** first successful-but-malformed task receipt stops at one creation; no next cases/lifecycle writes. Cover missing, wrong kind, malformed ID, missing/inconsistent DTO identity, project receipt, and B-conversation receipt. Verify no unknown-ID archive/delete. The existing ok:false creation test does not cover this branch.

### QR03 — P1: Delayed lifecycle preflight could overtake successful restoration

**Locations:** [awaited list prelude before each mutation](<../scripts/verify-native-coordination.mjs#L85>), [separate OFF and ON Host calls](<../scripts/verify-native-coordination.mjs#L127>), and [uncertain lifecycle handling](<../scripts/verify-native-coordination.mjs#L102>).

The parent identified an important ordering gap after the public manager implementation was checked. The manager serializes its own mutation, but the helper awaits listBundles **before** invoking setBundleEnabled. A timed-out OFF call can still be held in that prelude. The client's finally issues ON; its faster prelude and mutation can finish first, reporting restored/applied. The earlier OFF then reaches the manager and disables the shared bundle after restoration. A mutex around mutations does not order work that has not entered that mutex.

**Independent reproduction:** called the actual exported Host façade twice with a wholly synthetic manager: hold the first listBundles, allow ON to finish, then release OFF. No Native, profile, plugin, auth, or filesystem action occurred.

```json
{"restoreReportedApplied":true,"mutations":["ON","OFF"],"finalEnabled":false}
```

The earlier provisional conclusion that the public manager lock alone disposed of this concern is **retracted**. It proves non-overlap inside manager mutation, not whole helper-call ordering.

**Specific fix:** keep the lifecycle test disabled until one server-owned awaited transaction owns preflight, OFF, the permitted native work, and ON restoration in finally, or an equivalent durable serialized protocol proves that a timed-out predecessor cannot execute after successful restoration. Do not issue Kanban RPC while off, restart the server, or treat an uncertain restore as success. A failure may still require explicit operator recovery.

**Regression:** delay the first OFF list prelude beyond the client timeout, permit a restoration request, then release the old prelude. Assert the final state remains the original enabled state, with no late OFF. Cover delayed/rejected OFF, failed ON, restart-required, and transport timeout while the server transaction still owns restoration.

**Current parent restriction:** the first native coordination run must omit --allow-plugin-lifecycle, independent of QR01/QR02 fixes. This report authorizes no lifecycle execution and does not close the journal-reload gate.

## Frozen-fix independent closure

### QR01 — Closed at source/local-regression level

The [raw archive action](<../scripts/verify-native-coordination.mjs#L89-L93>) rejects any non-base current cwd, awaits activity, then rereads complete canonical history and the actual live actor/session cwd immediately before public archive. The [runner fallback](<../scripts/verify-native-coordination.mjs#L139-L143>) narrows all known A/B sessions first, proves **all** are idle at base before archiving any, proves the archived/base result, then disposes guards. A partial return failure leaves both sessions unarchived/read-only, the target/branch/journal intact, and the guard retained. [Child release and final controller disposal](<../scripts/verify-native-coordination.mjs#L78>) also require exact base through the controller methods rather than inferring it from the immutable header.

Independently read and executed [live/cold raw-action rejection, post-activity cwd drift and failed A-target/B-base return](<../tests/coordination-uat-helper/runner.test.ts#L53-L65>) plus [actual controller retained-guard recovery](<../tests/coordination-uat-helper/coordination.test.ts#L50>). Replaying the original raw-action reproduction now yields archiveCount=0 with exact-base rejection. No atomic filesystem or cross-request lease is claimed.

### QR02 — Closed at source/local-regression level

The [claim function](<../scripts/verify-native-coordination.mjs#L112-L113>) sets uncertainty and its creation classification **before** throwing for any unusable receipt or entity validator. Project, task and B-conversation validators require exact receipt kinds/IDs and matching returned DTO identity/path/title/session order, not a snapshot difference. [Case continuation](<../scripts/verify-native-coordination.mjs#L121>) exits on uncertainty, and [cleanup](<../scripts/verify-native-coordination.mjs#L135-L142>) does not release children, change policy, archive, delete or dispose guards after that fence; it can still drain already-owned work and read defaults.

Independently read and executed the [12 project/task/conversation missing/wrong-kind/absent/mismatched DTO cases](<../tests/coordination-uat-helper/runner.test.ts#L66-L69>). All later mutation categories remain untouched, and unknown B never enters the claimed scope. Replaying the original missing-task-receipt reproduction now issues **one** creation, not four, and records one receipt error with incomplete cleanup.

### QR03 — CLOSED–QUARANTINED, not implemented

[Authorization entry](<../scripts/verify-native-coordination.mjs#L26-L27>), [controller entry](<../scripts/verify-native-coordination.mjs#L30-L33>), and the [raw Host façade](<../scripts/verify-native-coordination.mjs#L81-L83>) reject the lifecycle flag/action with LIFECYCLE_TRANSACTION_UNVERIFIED before adapter or service lookup. The old orchestration case is removed. [Help/plan](<../scripts/verify-native-coordination.mjs#L22-L27>) remain pure and mark the journal category unsupported. [safeReport](<../scripts/verify-native-coordination.mjs#L98-L99>) overrides even a supplied passed journal result to not-tested, preventing fullGatePass.

Independently read and executed [pre-adapter refusal](<../tests/coordination-uat-helper/runner.test.ts#L40>), [held-list ON/OFF regression with zero manager access](<../tests/coordination-uat-helper/runner.test.ts#L50>), [forced-open report classification](<../tests/coordination-uat-helper/runner.test.ts#L71>), and [pure help/plan and controller refusal](<../tests/coordination-uat-helper/coordination.test.ts#L51>). Replaying both old raw bundle calls now produces **zero capability lookups**, no ON/OFF calls, and no changed enablement. This removes the reachable unsafe feature; it does **not** implement a safe transaction or pass native pending-journal acceptance. Any separate lifecycle prototype is outside this review and is not integrated or approved by it.

### Independent post-fix run

**55 tests / 2 suites passed**, exit **0**, normal Node, **276 ms**, start **03:27:02 on October 22**. This supersedes the initial 35-test baseline for this frozen helper snapshot; counts overlap and are not added together. The same exact command below was run. The three original reproductions were also replayed against actual exported functions using only in-memory dependencies, with the corrected outcomes above. No Native, auth, browser, filesystem fixture, job, model, policy or lifecycle action occurred.

## Pinned public SDK contract checks

Read the exact bundled public source through the read tool, not a live probe, core patch, extraction, or private import. ASAR directories are not glob-searchable here, but exact-file reads succeeded.

- [Native jobs.start](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L412-L501>) runs the synchronous producer starter, commits the record, records canonical registration, emits registered, then attaches producer completion and returns a **JobId string**. The runner defers actual tool execution to a microtask and arms its waiter in the exact canonical registration callback, before completion processing.
- [Canonical job recording](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L604-L624>) appends real native job events. [Settlement](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L763-L795>) releases live waiters and reports awaited accordingly. [waitJob](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js#L656-L688>) requires a finite positive bound.
- [Native job completion delivery](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tool-jobs/lib/index.js#L263-L295>) skips awaited settlement; otherwise it can call owner.followup. Thus the runner's finite 120000-ms, non-aborted, immediately registered waits are materially necessary, not cosmetic. The provider fuse alone is not proof of correct awaited settlement.
- [Public child setup](<../node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts#L85-L103>) is completed before publication. The runner installs child guards there, uses parentAgent plus durable parentSession/origin metadata, then verifies actual ownership. Its native-turn path uses public prompt, awaits real native tool/job work in pre-step, and rejects before provider use; idle topology or maintenance alone is not labeled descendant-busy.
- Public [setBundleEnabled](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js#L1944-L1958>), [configure](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js#L2324-L2330>), and [change](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js#L2373-L2400>) serialize the mutation/reload with a file lock and HMR runExclusive. This does **not** cover the helper listBundles prelude. QR03 is a runner ordering defect, not an SDK defect; the optional lifecycle flag remains prohibited for the first run.

## Other inspected safety boundaries

- Required owner/fixture/policy/native-producer flags are checked before capabilities are accessed. Extra native-turn, paired fixture-PTC-selection, and own-bundle-lifecycle flags gate their respective actions. Even allow-model-requests does not remove the zero-provider fuse.
- Fixed native tool arguments permit only the owned sleep hold or the exact root-A question via an existing reserved PTC transport. Scope/root/owner checks do not guard unrelated user agents. No manually forged turn/job/question history is used by production helper code; the tests explicitly synthesize their own events in memory only.
- Real outer and inner jobs retain owner/root IDs. Cancellation, finite waits, terminal-state checks and consuming reads are tracked through drain. Unexpected work fails safety checks rather than being counted as gate evidence. Loss of the inspector/unknown activity may require retained guards and manual recovery; successful cleanup is not guaranteed on every transport failure.
- Partial-cwd injection is armed before the command and starts real B work from exact A commit observation. A/B canonical cwd, original IDs and switched-session journal must match; an elapsed busy window is not relabeled success.
- Fresh exclusive fixture paths, canonical containment, exact creation receipts, and fresh native histories constrain writes. Only fixture A can select the existing PTC preset, with public permission roots/defaults/B checked unchanged. No global preset/model selection is altered.
- The former own-bundle mutation orchestration is quarantined, not executed. Lifecycle flag/action refusal occurs before every adapter, and the journal category cannot be passed through injected evidence. QR02 now latches uncertainty for malformed successful receipts as well as explicit creation failure; no new mutation is authorized after that fence.
- The optional private browser uses an authenticated official launch URL transiently, a fresh context, GUI-only HTTP requests and constrained GUI/inspector-ingest WebSockets. The question locator is exact task/root A with a root-free has predicate; screenshots are scoped to the owned question. No private cookie extraction, broad screenshot, tracing, or token output was found. Raw evaluation errors are sanitized before the report/CLI output.
- [Report classification](<../scripts/verify-native-coordination.mjs#L95-L96>) does not allow injected synthetic dependencies to claim a real full gate, and missing required categories or incomplete cleanup prevent success.

## Executed local verification

**35 tests / 2 suites passed**, exit **0**, normal Node; **277 ms**, start **02:55:53 on October 22**. No helper live CLI command was executed. The three additional reproductions above call only exported functions with in-memory doubles; they did not create real fixture data or exercise Native services.


```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts --reporter=dot
```

The initial 35-test baseline did not cover QR01/QR02/QR03. The frozen 55-test run and independent reproduction replays now verify their correction/quarantine. Author-reported TypeScript/syntax/full-suite passes are not substituted for this post-fix independent verification.

## Scoped owned-agent driver review — QR04 closed

Reviewed only the later frozen [coordination helper](<../scripts/verify-native-coordination.mjs>) and [coordination](<../tests/coordination-uat-helper/coordination.test.ts>)/[orchestration](<../tests/coordination-uat-helper/runner.test.ts>) tests. The separate lifecycle module and its LT01–LT03 corrections are outside this request. Prior QR01/QR02 source closures and QR03 quarantine are preserved.

### QR04 — P2: Historical pre-step identity gap

The description and fault output below are from the pre-fix snapshot. The verified correction follows them.

**Original location:** [pre-step human matching and work admission](<../scripts/verify-native-coordination.mjs#L55>) versus [strict canonical admission verification](<../scripts/verify-native-coordination.mjs#L71-L81>).

The caller message is validated and later matched against canonical inbox insertion by exact id/source/rpcId/text. At the actual work boundary, however, the pre-step guard accepts one source.kind=user message based only on its text. For owned-agent drive it does not require role=user, id=permit.messageId and source.rpcId=permit.requestId before marking the permit used and starting native Bash/jobs. A canonical admission mismatch can therefore be detected only **after** the pre-step has started work under a text-only permit.

**Independent fault reproduction:** use the actual exported controller with the existing author fixture transpiled in memory. Deliver the fixed text under a different valid id/rpcId in the synthetic followup implementation. The strict canonical postcheck rejects admission, while the pre-step still authorizes and starts work:

```json
{"admissionRejected":true,"approvedTurnSteps":1,"jobsStarted":2,"humanMatched":true,"nativeInboxAccepted":false,"realWorkStarted":true,"providerCalls":0}
```

These are **synthetic job calls**, not real Native jobs. No actual SDK identity mutation is alleged: the pinned kernel preserves identified input. The fault demonstrates the helper's advertised exact-input authority is not enforced at its effect boundary, rather than diagnosing a live kernel failure. A concurrent/unexpected same-text input must not receive the one approved permit merely because it has the right text.

**Specific fix:** for the ownedAgentDrive branch, match the exact user role, message ID, source kind/rpcId, and complete fixed content before permit.used, counters or any tool/job work. The generic root-A prompt branch must remain distinct because that public API may mint its own message ID; pin the fields actually known for that route. Record a sanitized unexpected-input/identity failure rather than approving the turn.

**Regression:** correct text with wrong id, rpcId or role must start **zero** jobs/tools and must not increment approvedTurnSteps. The intended SDK-minted message must still pass canonical admission, real turn boundaries, pre-step work and settlement under the strict owned handle. Keep provider requests denied and do not fabricate native events/status.

### QR04 frozen-fix closure

The [corrected pre-step matcher](<../scripts/verify-native-coordination.mjs#L55-L61>) requires exactly one human-source message with user role, the known RPC ID and exactly one fixed text block before permit use, approved counters or any tool/job. For ownedAgentDrive it additionally requires the hold kind and exact SDK-minted message ID; there is no generic fallback. The distinct root-A question route requires its known RPC/user/content/kind/root identity without incorrectly demanding the caller's request ID as the kernel-generated message ID. Both [private permit records](<../scripts/verify-native-coordination.mjs#L77-L89>) retain their appropriate identity fields. Unexpected or reused input is rejected and counted; other-user agent scopes remain untouched.

Independently read and executed [six altered kernel-delivery negatives](<../tests/coordination-uat-helper/coordination.test.ts#L70-L74>): wrong valid ID, wrong valid RPC, role, text, source and extra content. Each reaches the actual exported controller's pre-step, rejects canonical admission, starts **zero** synthetic jobs/tools/generic prompts/providers, and leaves approvedTurnSteps=0, humanMatched=false, inputIdentityMatched=false and realWorkStarted=false. The [generic root wrong-RPC negative](<../tests/coordination-uat-helper/coordination.test.ts#L75-L78>) also starts no tool/job; valid owned and valid root-question cases still pass. This verifies the effect boundary, not just pre-call DTO validation.

**QR04 closed at source/local-regression level.** Independently ran **84 tests / 2 suites**, exit **0**, normal Node, **293 ms**, start **04:48:57 on October 22**, using the same focused coordination command. This overlaps the earlier 35/55/77-test snapshots and is not added to their totals. No helper source/test file, production code or separate lifecycle module was changed by this reviewer; no Native/Host/auth/browser/job/prompt/model/policy/lifecycle/profile/fixture-data operation occurred.

### Independently checked positive changes

- [Root-A public prompt](<../scripts/verify-native-coordination.mjs#L83>) now carries an explicit AbortSignal and caller-created request UUID; its admission promise is retained. Pinned [public prompt admission](<../node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L3212-L3230>) does require that signal. Generic child routing remains unchanged/rejected, rather than being bypassed with forged managed-subagent descriptors.
- The parent's explicitly authorized creator-owned route uses the actual AgentHandle, current registry identity, exact live parent, public isOwnedBy, durable parent/origin/depth, base cwd, empty inbox and fresh canonical history; authority is checked again immediately before one followup. No private manager, state assignment or shadow engine is added.
- [Public message factory](<../scripts/verify-native-coordination.mjs#L188-L189>) resolves the pinned public dsh-llm factory, rather than constructing an event or using ambient Host crypto. Pinned [factory identity/freeze](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js#L25-L64>) mints an immutable identified UserMessage. Pinned [followup/send](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L800-L808>) calls the kernel, whose [inbox splice](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L180-L207>) commits the real event synchronously. Followup is void, not an acceptance receipt; the helper correctly requires actual canonical acceptance evidence afterwards. QR04 concerns the missing identity pin before work, not this choice of public API.
- Extra owned-drive/native-turn flags are paired before child fixture creation; absent flags leave descendant-busy not-tested. Setup installs model DENY and strict tool guards before publication, without guarding other user agents.
- The [selected-case fence](<../scripts/verify-native-coordination.mjs#L138-L145>) skips unselected callbacks, and [two-case orchestration](<../tests/coordination-uat-helper/runner.test.ts#L72-L80>) does not rerun the prior six case assertions or missing-branch fixture. A partial retry cannot become a full gate.
- [Named checkpoints and pre-cleanup safe audit](<../scripts/verify-native-coordination.mjs#L137-L145>) preserve admission/turn/work evidence without raw exceptions, transcript bodies or authentication data. Counters distinguish unexpected wakes/model attempts rather than relabeling them success.
- Exact base/read-only/idle archival and guard retention from QR01, receipt uncertainty from QR02, and raw/CLI lifecycle quarantine from QR03 remain in source and tests. This review authorizes no scope relaxation.

### Independent execution

**77 tests / 2 suites passed**, exit **0**, normal Node, **328 ms**, start **04:36:06 on October 22**, using the same focused command recorded above. This overlaps prior 35/55-test runs and is not added to them. The QR04 fault was an additional in-memory exported-controller reproduction; no test file or helper source was edited. No Host, auth, browser, real job, Native prompt/turn, model, policy, lifecycle, profile or fixture-data effect occurred.

The parent reports six actual earlier cases passed with zero providers and two pre-prompt failures; that is parent-owned live evidence, not replayed or independently validated here. QR04 is now independently source-closed, but a real native owned-child turn and root-A question remain separate acceptance evidence. Any retry still waits for the parent’s explicit authorization, outstanding human choices and exclusive-writer scheduling; this report does not preempt reserved G4 activity. Lifecycle quarantine and the mandatory journal gate remain unchanged.

## Question argument-shape correction — independently source-verified

Scoped review date: **October 22, after 05:33 local runtime time**. Reviewed only the frozen question-correlation correction in [the helper](<../scripts/verify-native-coordination.mjs>) and its local tests. Existing QR01/QR02/QR04 source closures and QR03 lifecycle quarantine remain unchanged; descendant production, child routing, presets, policy, mode and foreground behavior were not changed or reauthorized by this review.

### Source contract and correction

The parent supplied narrowly scoped actual metadata showing that the owned question's root/parent/subcall/name/nonce matched but the canonical PTC arguments value was a **record**, not JSON text. The previous unconditional JSON.parse path could therefore throw and falsely fail audit. This is a verifier contract error, **not** a Native core defect, proof that no foreground question existed, or a diagnosis of the cancellation-classified result observed during cleanup.

Independently checked pinned public [argument normalization](<../node_modules/@deepseek-ai/dsh-tools/lib/types/ptc.js#L125-L145>): it creates detached lossless JSON dispatched/logged values, not a JSON-text wrapper. Public [PTC subcall generation](<../node_modules/@deepseek-ai/dsh-tools/lib/index.js#L1362-L1376>) uses the actual root-derived native subcall ID; [START](<../node_modules/@deepseek-ai/dsh-tools/lib/index.js#L1423-L1430>) and [END](<../node_modules/@deepseek-ai/dsh-tools/lib/index.js#L1392-L1409>) append arguments:normalized.logged directly with rootCallId, parentCallId, subCallId and name.

The [corrected predicate](<../scripts/verify-native-coordination.mjs#L52-L55>) accepts the canonical record directly and normalizes an explicitly supported legacy JSON-string representation. Within the lossless JSON contract it compares the complete question object recursively, including exact object keys, array lengths/order and leaf values, rather than a nonce substring or a JSON.stringify comparison that would silently discard an extra undefined object field.

Both canonical START and END must match the owned question root, exact parent root, actual subcall recorded by the native execution guard, ask_user_question name and whole fixed arguments. [Question state](<../scripts/verify-native-coordination.mjs#L104>) additionally requires an error-free END for canonicalAnswered. [Start/nonce diagnostic counting](<../scripts/verify-native-coordination.mjs#L102-L103>) uses the same predicate, preventing another false mismatch between the audit and its diagnostics. There is no fabricated top-level tool/call or relaxed root/call identity fallback.

### Exact independent regressions

The [SDK-shaped local fixture](<../tests/coordination-uat-helper/coordination.test.ts#L37-L45>) now emits arguments records with the actual native parent/root/subcall structure. These are explicitly in-memory synthetic events, not claims that the helper created or observed a live Native question.

Independently inspected and executed [record and legacy-string positives](<../tests/coordination-uat-helper/coordination.test.ts#L92>) and [22 START/END negatives](<../tests/coordination-uat-helper/coordination.test.ts#L93-L97>): wrong root, parent, subcall, tool name, whole nonce, extra field, extra undefined field, malformed text, array, null and primitive. The negatives do not become canonical question success and start no job/provider. The positive test explicitly has no fabricated top-level tool/call. The targeted-case filter and previous safety regressions are retained in the same suite run.

**111 tests / 2 suites passed**, exit **0**, normal Node, **358 ms**, start **05:33:35 on October 22**, using the focused coordination command already recorded. Counts overlap prior 35/55/77/84-test snapshots and are not summed. Verified all supplied SHA-256 hashes exactly:

| File | SHA-256 |
|---|---|
| [Helper](<../scripts/verify-native-coordination.mjs>) | 9a75a75ae288413ee906bc614f4d0b1483808ea1efabc10988acb7ba6a965e95 |
| [Controller tests](<../tests/coordination-uat-helper/coordination.test.ts>) | 0e92fa7557d766a4f43b68356226b8d853dcd0b586362bc286329f81f3f36c31 |
| [Unchanged runner tests](<../tests/coordination-uat-helper/runner.test.ts>) | ce6a1b27c06eaa1c1873572a7d0b68792df387966fd7f9829e7a7d10408a0b01 |

**Source correction verified; no new concrete defect found in this question-only scope.** No helper/test/product/module file was edited. No Host, Native inspection, auth, browser, real job, prompt/turn, model, permission, lifecycle, profile or fixture-data effect was invoked by this reviewer. This does not establish actual root-A question display/answer/turn completion, authorize a descendant retry, or close any pending Native coordination/journal/full gate. A new question-only live attempt still needs the parent's explicit scoped READY and applicable human/exclusive-writer conditions.

## Child-composition review — QR05 closed

Scoped frozen review: **October 22, after 06:09 local runtime time**. Reviewed the new explicit child-composition inheritance path only; no question/six-case/lifecycle Native run was performed. Prior QR01/QR02/QR04 and question-shape source closures, QR03 quarantine, and separate lifecycle/bridge reviews are preserved.

### QR05 — P2: Historical rollback-assumption gap

The following finding and model output describe the initial snapshot before correction. The frozen-fix closure follows; they are not claims about the corrected helper.

**Original location:** [entered create/setup failure classification](<../scripts/verify-native-coordination.mjs#L90-L99>).

After agents.create has been entered, setup or commit errors set setupFailed. The catch then deletes the child from local tracking, labels the stage SETUP_ROLLED_BACK, and returns harmless CHILD_COMPOSITION_FAILED with creation uncertainty false. That is safe only if no durable child could remain. The public API supplies no authoritative no-publication/no-durable receipt for this rejection.

**Primary-source boundary, checked rather than assumed:**

- Pinned [AgentLoop setup ordering](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L1893-L1955>) runs setup/commit before appendUnstoredSuffix and publication. Its [ordinary unmaterialized-close explanation](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L1851-L1870>) supports normal setup rollback when the handle has not materialized.
- Actual [JSONL create](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L2465-L2479>) first registers/adopts a pending writer. The public [handle flush](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L125-L138>) explicitly materializes an empty header. [Service-wide flushAll](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L385-L397>) flushes every adopted writer, not just already-materialized ones.
- [Handle close](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L149-L173>) drains/releases; [tracker release](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L373-L377>) removes pending data only if it was not materialized. It does not erase an already materialized log.

Therefore normal deferred staging is not a universal no-durable guarantee if a permitted service-wide flush interleaves before setup fails. **This review does not claim that a flush, orphan or SDK defect occurred in the current profile.** It identifies an unsupported assumption in the helper's outcome classification; operator inactivity alone is not an authoritative no-durable creation receipt.

**Independent in-memory reproduction:** the actual exported controller and existing author fixture are used with a modeled public flush that retains an empty durable-header record during composition, followed by setup rejection. No Native backend or filesystem is instantiated:

```json
{"result":{"unsupported":"CHILD_COMPOSITION_FAILED"},"creationState":{"uncertain":false,"inFlight":false,"stage":"SETUP_ROLLED_BACK"},"modeledMaterializedHeaderRemains":true,"controllerDisposed":true,"childArchived":false,"jobsStarted":0,"toolCalls":0,"providerCalls":0}
```

The model follows the public staging/flush/close behavior above. It demonstrates that the helper can permit ordinary controller disposal while a modeled unconfirmed child artifact remains. It does not assert a real profile artifact or perform cleanup of one.

**Specific fix:** after any entered agents.create rejection, conservatively latch child creation uncertainty before throwing/returning, including setup and commit failures. Reserve harmless unsupported outcomes for checks completed **before** factory entry. Propagate the uncertainty to the Node runner before any later input, policy/job/fixture/browser/lifecycle write or cleanup; retain known guards, never adopt/inspect/archive/delete an unknown child, and do not pretend that rollback deleted a log.

**Regression:** a source-faithful modeled flush plus setup throw and commit throw must stay uncertain, refuse disposal/child release and prevent later Node mutable cases. Preserve pre-create missing-capability/preset-free/flag failures as no-creation not-tested outcomes. The parent acknowledged QR05 and assigned the narrow correction independently verified below.

### QR05 frozen-fix closure

[Every entered factory rejection](<../scripts/verify-native-coordination.mjs#L90-L103>) now sets childCreationUncertain, including compose/setup/commit failures. SETUP_REJECTED_OUTCOME_UNCERTAIN is diagnostic only; it is not a no-durable receipt. Missing flags/API/preset-free capability failures remain harmless only in [pre-create validation](<../scripts/verify-native-coordination.mjs#L84-L89>). Malformed returned handles also remain uncertain. No Core/backend code, log deletion or rollback-repair fallback is added.

[Snapshot](<../scripts/verify-native-coordination.mjs#L126>), settle and drain exclude an unconfirmed child before inspecting it or looking up its current actor; known confirmed handles remain distinct from attempted IDs. [Producer/prompt admission](<../scripts/verify-native-coordination.mjs#L105-L119>), child release and disposal reject after uncertainty, preserving known A/B guards. No unconfirmed child is adopted, archived or deleted.

The [Node child-creation branch](<../scripts/verify-native-coordination.mjs#L187-L190>) latches creation uncertainty before any further mutable cases on a thrown/unknown/malformed result. It treats the legacy post-create CHILD_COMPOSITION_FAILED unsupported response as unknown, rather than harmlessly continuing. [Case audit/continuation](<../scripts/verify-native-coordination.mjs#L172-L179>) and cleanup honor that fence; already-owned resources may drain safely, but no unknown-child metadata read or later policy/job/input/archive/disposal path is authorized.

Independently read and executed the [two actual exported-controller pending-writer/global-flush regressions](<../tests/coordination-uat-helper/coordination.test.ts#L118-L123>) for compose rejection and commit rejection. The modeled materialized header remains, uncertainty stays true, no publication/input/tool/job/provider occurs, drain does not inspect the unknown ID, disposal/release refuse, and known A/B guards stay retained. The older invalid-setup cases now remain uncertain even without a modeled flush. [Runner regressions](<../tests/coordination-uat-helper/runner.test.ts#L83>) cover unknown, durable setup/commit failure, stale unsupported, malformed and thrown creation results; all later mutable calls and child/guard cleanup are fenced. Pre-create negative cases still have zero factory effects.

**QR05 closed at source/local-regression level.** This says nothing about whether a durable child actually remained in any live run, and does not identify composition inheritance as the proven cause of prior live empty-root observations.

**139 tests / 2 suites passed**, exit **0**, normal Node, **363 ms**, start **06:23:06 on October 22**. Syntax and both separate host/client TypeScript no-emit checks passed, command-chain exit **0**. All verification work was collected. This supersedes the overlapping 134-test snapshot for the fix; counts are not summed. Verified frozen hashes exactly:

| File | Verified SHA-256 |
|---|---|
| [Helper](<../scripts/verify-native-coordination.mjs>) | 8ee1706b7c05f8592c06965b9d80c39762938b0b7b613befdf683af1aa765f1b |
| [Controller tests](<../tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [Runner tests](<../tests/coordination-uat-helper/runner.test.ts>) | 67933096ae15ee2d3cfd8bfd4711b9d674ee0c889709179b368fafe16d7f50ff |

No new concrete issue was found in the frozen scoped correction. Only this report was edited; no Native/Host/auth/browser/real job/turn/model/permission/lifecycle/profile/fixture-data effect occurred. Parent authorization, human decisions and exclusive-writer scheduling still govern any one-descendant retry; this source closure neither starts it nor proves Native busy-work/journal/full acceptance.

### Other composition safeguards independently checked

- The new composition flag is paired with native-turn and owned-drive permissions before descendant fixture creation. Invalid pairs refuse before adapters; absence leaves the descendant category not-tested without creating a child.
- The helper installs zero-provider/strict tool guards before public composeFrom and checks the final public capability world before publication, then rechecks in the synchronous commit. No select/mount/register/default override, private generation, policy root grant, managed descriptor or new controller service is used to manufacture a child world.
- Pinned normal [subagent creation](<../node_modules/@deepseek-ai/dsh-subagent/lib/index.js#L346-L381>) records the parent's composed identity and calls the child's public composeFrom inside setup. The helper uses that same public pattern, not parentAgent alone as capability composition.
- Pinned [composeFrom](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/index.js#L696-L718>) obtains the exact generation retained by the parent, then [joins it](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/index.js#L668-L679>), rather than selecting the latest definition by ID. [Public inspection](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/index.js#L550-L565>) returns a detached view of the joined composition. These APIs, not a private token, underpin the source checks.
- Parent/B identities, base directories, public policy modes/roots/defaults and public retained inspection are compared before/after inheritance; child tools are checked for parent-appropriate Native Bash/reserved PTC and job_output visibility. No native work may occur during setup. Capability/policy/lineage mismatches fail without input or jobs; QR05 is the required outcome fence once factory entry has occurred.
- Known returned-handle drive keeps QR04's exact role/message/rpc/content check and canonical Native inbox/turn/ownership evidence. This review does not identify inheritance as the proven cause of an earlier real empty-root observation, and does not authorize another Native descendant attempt.

### Independent local verification and frozen identities

**134 tests / 2 suites passed**, exit **0**, normal Node, **339 ms**, start **06:09:00 on October 22**. Syntax checking and both separate TypeScript no-emit Programs also passed, final command-chain exit **0**. The exact coordination command is recorded above; this run overlaps earlier snapshots and counts are not summed. All background verification work was collected.

| File | Verified SHA-256 |
|---|---|
| [Helper](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs>) | 07fb0151890c75f88e68f6f6833c0285e4543c5ce182d1bdc5ca3816c37115d8 |
| [Controller tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/coordination.test.ts>) | aba38d4cf3a7912979ea69315ba63c64a76c7f9f6dc287da519bfb2d4675684f |
| [Runner tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts>) | 2d040b760a971eb49fb2a1339793105b08e9829ed933aeebe224093246c959ab |

The initial 134 tests did not close QR05; the corrected 139-test frozen run above now verifies its uncertainty fence. The original extra reproduction used only in-memory models. No helper/test/product/module/Core/profile file was changed by the reviewer, and no Native/Host/auth/browser/real job/turn/model/permission/lifecycle/fixture-data effect or broad peer inspection occurred. Only this review section was authored. **QR05 is independently source-closed; descendant FULL READY remains a separate parent authorization and actual evidence boundary.**

## Historical Stage A runner-direct integration — initial QR06 OPEN

Scoped frozen review: **October 22, after 07:08 local runtime time**. Reviewed the main app-gateway routing, ownership/ACK/recovery boundary and caller resource finalization, with the real serialized gate in the VM transport. This is not the separate production schedule-wake review, Stage B/C lifecycle integration or an actual Native run.

**Historical snapshot:** the QR06 finding, reproduction, OPEN decision, 305-test run and hashes in this section describe the initial review before correction. They remain preserved, not current claims against the corrected freeze. The latest independent QR06 closure follows this section.

### QR06 — P2: Main uncertainty does not fence the shared caller connection

**Location:** [main uncertainty paths](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L208-L220>), [child uncertainty](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L242-L245>) and [final gate/socket release](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L261-L272>).

Owner interruption calls appGateway.stop, and app receipt failure stops the gateway internally. In contrast, a child creation or other main/SDK path can set the main uncertain flag while every earlier app receipt was already ACKed and the gateway remains open. The finalizer unconditionally tries appGateway.close; prepared-gate-only close then succeeds correctly for its **own** metadata group. The finalizer treats that as sufficient to call host.close even though an independent controller/guards in a **different** group remain unverified.

An own metadata-group certificate cannot authorize releasing the caller-owned transport and its external controller references. The same finalization risk exists where guard/controller retention is recorded without main uncertainty, such as an unconfirmed composition installation. Physical tree/branch retention alone is not this defect: confirmed base/archive/resource/controller teardown can still permit a normal connection close.

**Independent reproduction:** actual exported runVerification, existing runner fixture and real GateInspector serialization; selected descendant case returns creationUncertain after attempted child creation. No Native service or new file fixture is used:

```json
{"failedAt":"descendant-busy","guardRetained":1,"controllerDisposals":[0],"socketClosed":1,"connectionDisposed":true,"appGate":{"phase":"closed","issued":4,"acknowledged":4,"pending":0},"recovery":null,"groupsReleased":1}
```

The old QR05 negative verifies no child release/dispose/more writes, but does not assert that the connection and external reference lifetime stay retained. All existing 305 tests can pass while this reproduction still loses the connection. No real guard disappearance or profile damage is asserted by the VM model; the unsafe caller action is directly observed.

**Required correction:** centralize every main uncertainty source into a synchronous gateway stop before propagation, including uncertain Native SDK/child/controller results. Do not close the app gate or caller connection while main uncertainty or an unverified external controller/guard lifetime remains. Keep independent group ownership distinct from gate-only metadata closure. Emit one sanitized UNVERIFIED_RETAIN_REQUIRED report with known resource counts, bridgeDisposed=false and actual observed connection state, without claiming that a server disconnect cannot later end reference lifetime. Preserve safe cleanup/close when only a physical tree/branch is retained and Native base/archive/settlement/controller disposal are actually proven.

**Regression:** all QR05 child unknown/setup/commit/stale-unsupported/malformed/thrown outcomes and relevant SDK/controller uncertainty must assert zero caller close and persistent-group release, retained managed recovery/guards, no unknown-child lookup, and no later mutable app/SDK/fixture action. Exercise the all-app-receipts-ACKed case explicitly; app uncertainty tests alone cannot cover this cross-layer failure. The parent acknowledged QR06 and assigned the narrow main/test correction. **Await frozen fix and independent re-review before Stage A/B readiness.**

### Other Stage A boundaries inspected

- Gate bootstrap precedes app preflight and fixture setup. Runner-direct board/command calls route through invoke/recover/ACK; [raw facade bypass and lifecycle mutations](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L177-L194>) reject before app service lookup. Existing native controller factories derive their own Root/group rather than obtaining a Bridge Root or binding a lifecycle controller.
- [Semantic delivery validation](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L143-L175>) unwraps one ordinary RPC value, checks Outcome/snapshot shape and command-specific creation receipt validators, rejects async validators, performs manifest claims before ACK, and skips repeat validation/claim after an ACK timeout. Snapshot shape is a delivery guard, not universal Native state/ownership attestation.
- [Creation validation](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L217-L218>) checks exact receipt kind/id, project/title/path and task/conversation membership/order before claiming returned IDs. Creation failure/malformed receipt is not an ordinary expected business denial. No unknown child is adopted by the QR05 path.
- New direct calls are serialized and barred by any unacknowledged receipt. Recovery uses the same connection/group/call ID and cached server result, not another command. Semantic uncertainty stays stopped; recovery does not reopen mutable work or repeat an already recorded claim.
- Owner interruption stops gateway admission synchronously and races pending app delivery without aborting the actual server promise. The source prints one sanitized retained report, uses no forced process exit/artificial busy-loop/extra Native job, and qualifies reference retention rather than guaranteeing it after server death or disconnect. QR06 is the missing common stop/release fence for non-app uncertainty.
- Native GUI clients remain explicitly unfenced. This is **RUNNER-DIRECT-ONLY**, not a global atomic admission barrier; future journal execution must exclude owned browsers and use an exclusive operator window. Source case counts cannot pass the still-open actual active-schedule, mandatory journal or whole-G3 gate.
- Full lifecycle controller binding/start/restore is not introduced. Raw bundle mutation remains quarantined; this integration does not invoke the reviewed transaction-window prototype or authorize Stage B/C.

### Independent local verification

**305 tests / 5 suites passed**, exit **0**, normal Node, **439 ms**, start **07:08:33 on October 22**. This includes 160 coordination/controller/runner/gateway tests plus the overlapping 58 bridge and 87 transaction tests; counts are not added to previous runs. Main syntax, both actual separate project host/client TypeScript no-emit Programs and an additional strict isolated NodeNext Program for the four owned contract files passed. Verification jobs were collected. This compiler result is not an independent review of the unrelated production wake patch.

```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/coordination-uat-helper/gate-vm.ts
```

Verified frozen hashes exactly:

| File | SHA-256 |
|---|---|
| [Main helper](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs>) | 008e0a0b27873e60c31e27a6126527b3cb5acd7d4e528776fe2b9e08d8b3c3cb |
| [Controller tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [Runner tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts>) | 712f5b301178100b7cb7eded49c1a9acb2eff93507532fbe779411dc9503c1b9 |
| [App-gate tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/app-gate.test.ts>) | f73c9f452bb4f09c4d3cee9cefcdb08e6b42e1f07f03e748eed84a5d2a0d6394 |
| [VM transport](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/gate-vm.ts>) | 468992559607dae2eaa7c41ddbf6a4561a7e8b0f19f7f5267770984f8300c12d |
| [Bridge dependency](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [Transaction dependency](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

Only this review document was edited. No Native/Host/probe/auth/browser/real job/turn/model/policy/lifecycle/profile/fixture-data effect, Core/SDK/product/main/test/bridge edit, build or activation was performed. Prior source closures/quarantine remain bounded as recorded; **QR06 is open and no Stage A/B, live, release or publication approval is issued.**

## QR06 frozen-fix independent source closure

Latest bounded review: **October 22, after 07:39 local runtime time**. **QR06 is CLOSED at the source/local-regression layer; no new material defect found.** The parent reported that reviewer9 had already completed a separate 314-test/source closure without writing its final addendum. That remains attributed background, not a substitute for the fresh source reads and independently collected checks below. The historical initial OPEN decision above is not erased.

### Corrected retention boundary

- [The central retain(kind) latch](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L207-L221>) is the only main assignment setting uncertainty true. It also permanently sets retainRequired and synchronously stops appGateway before control propagates. Native SDK observation/policy failures, creation uncertainty, and gateway uncertainty all converge here; a clean app ledger does not reset this fence.
- [Controller installation](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L220-L221>) marks nativeFactoryMayHaveEffects **before** entering the factory and retains its promise/reference state. A rejected install after guard registration, missing/malformed readiness, uncertain handle call, or thrown/malformed disposal stays unverified. Thus an undefined returned controller or compositionUnsafe does not erase possible external guards. Disposal is confirmed only after the original [remote wrapper](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L192>) validates the disposed receipt and awaits its own Native object-group release; an unknown group-release result propagates and retains the main fence.
- [Child creation](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L243-L247>) latches the QR05 unknown/setup/commit/stale-unsupported/malformed/thrown outcomes before later cases or cleanup. Only a confirmed receipt adds the child to the claimed scope. The [actual controller uncertainty regressions](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/coordination.test.ts#L112-L123>) still reject release/disposal, preserve known A/B guards, and exclude the unconfirmed child from metadata inspection/drain. No unknown child is adopted, looked up for recovery, archived or deleted by the correction.
- [Finalization](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L262-L278>) checks retained/unproven Native factory/controller resources independently of app receipt ACKs. Uncertainty or an unproven external guard lifetime prevents **both** app-gate close and caller socket close. The app gate's [NO_NATIVE_CONTROLLER_OWNED certificate](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L172-L174>) covers only its [own bridge metadata group](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/coordination-lifecycle-bridge.mjs#L471-L486>), not independent Native groups or their last caller reference.
- [The recovery report](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L195-L203>) remains sanitized and reports UNVERIFIED_RETAIN_REQUIRED, bridgeDisposed=false, closed runner admission, unverified server admission, known counts, and the **actually observed** connection-open boolean. Reference lifetime is retention-requested-not-guaranteed: server death/disconnect can still end in-memory references. The [single final report path and CLI](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs#L278-L291>) introduce no forced process exit, artificial busy loop or fabricated activity. Existing observation polling is not a new retention mechanism.
- Physical task/tree/branch retention alone does **not** force retention of a fully settled controller connection. The [positive control](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts#L91>) proves that exact base/read-only/archive cleanup plus confirmed Native controller/group disposal still permits normal gate/socket close while physical records remain.

### Actual exported-runner / same-gate local replay

The fresh run executes the actual exported runVerification with the actual serialized public app gate through [GateInspector](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/gate-vm.ts#L1-L23>), not a substituted Node lease or fake app-gate closure. Its services, Native controller fixtures, Inspector socket and groups are isolated in-memory models; no live Inspector/CDP, Host, Native service, browser, auth, profile, reminder, real job, model, or user-data operation is involved.

- [Six QR05 outcome variants](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts#L85>) now assert uncertain gateway state, **zero caller socket-close calls and zero group-release calls**, an open modeled socket, retained recovery/guards, no later host actions or question case, and no controller drain/release/dispose. The actual server ledger has inFlight=0 and unknownOutcomes=0, with no app-receipt-unverified error: this replays the original cross-layer condition rather than relying on an app-delivery failure to stop cleanup.
- [SDK policy/read failures and five external-resource variants](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts#L89-L90>) cover installation throwing after guard registration, missing readiness, disposal throwing, malformed disposal, and an unknown Native group-release result. The five external cases explicitly assert **issued=acknowledged, pending=0**, yet the gate remains uncertain, recovery retains one controller, and caller socket/app-gate-group release never occurs. In the group-release-unknown case, the already-entered Native release may itself have executed before the modeled deadline; no rollback or guaranteed continued lifetime of that already-released group is claimed.
- [A direct gateway replay after every app ACK](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/app-gate.test.ts#L27>) independently asserts that MAIN_RESOURCE_RETAINED synchronously blocks new app calls and gate close without dropping the real gate or modeled socket. [Ownership validation before ACK](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/app-gate.test.ts#L13-L22>), unknown-ACK recovery and [one sanitized interruption report](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts#L87-L88>) remain green.

These are fresh executed local assertions, not new live proof or an independently captured pre-fix Native failure. The original RED JSON above remains historical evidence from the prior snapshot.

### Fresh independent checks and freeze

**314 tests / 5 suites passed**, exit **0**, Vitest **3.2.7**, start **07:41:34 on October 22**, duration **461 ms**. Breakdown: **90 controller + 60 runner + 19 app-gate = 169 coordination**, **58 bridge**, **87 transaction**. Counts overlap earlier runs and are **not summed**. Main helper, bridge and transaction-module syntax checks passed; both actual separate host/client TypeScript no-emit Programs passed. The earlier additional isolated NodeNext check was not rerun in this narrow task. Managed jobs **bash-43b0dd813ff64bdd** and **bash-8725e2b887aa40f3** were collected with exit **0**; none remain outstanding.

~~~sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/verify-native-coordination.mjs
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/coordination-lifecycle-bridge.mjs
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/native-coordination-lifecycle.mjs
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.client.json --noEmit
~~~

All seven supplied SHA-256 values matched **before and after** the fresh checks:

| File | Verified SHA-256 |
|---|---|
| [Main helper](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/verify-native-coordination.mjs>) | 337994bfdb462b4a5495ae3e1c3d3934a1cdcd844270dddeb67c9192ee61dfd0 |
| [Runner tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/runner.test.ts>) | c206bdda0c19672a32131b601345c101ce02325baf53e1315686b9622938ee7e |
| [App-gate tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/app-gate.test.ts>) | b689b2967de0e200cc3d1955fe09e9b6165688d7c5a41948c9615402c509eb8c |
| [Controller tests](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [VM transport](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/tests/coordination-uat-helper/gate-vm.ts>) | 468992559607dae2eaa7c41ddbf6a4561a7e8b0f19f7f5267770984f8300c12d |
| [Bridge dependency](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [Transaction dependency](</Users/filipe.esch/projects/pessoal/deepseek-harness-kanban/scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

**Source/local closure only.** Stage A remains RUNNER-DIRECT-ONLY: GUI/public SDK clients are unfenced, not an all-scope barrier. No raw app-RPC, manager/Root bypass, Node lease, lifecycle binding/start/restore or Stage B/C integration is authorized by this correction. QR03 remains CLOSED–QUARANTINED; native pending-journal and actual active-schedule/task 4.3 acceptance remain OPEN, as do full G3/G5 and release decisions. This QR06 task performed no production edit, build, installation, activation, GUI refresh or new live validation; separately parent-reported runtime reconciliation is not evidence collected by this reviewer.

## Operational limits and gate status

The parent reports an unrelated corrupt/unknown cold peer in the existing profile, so physical task deletion may fail the global shared-reference guard. That condition is a **boundary to preserve**, not authority to skip a peer, repair/migrate/purge profile data, invoke CLI worktree removal, or retry under broader permissions. Retain checkout/branch/journal/guards and use only authorized, proven own-session read-only/base/archive cleanup. The independently verified QR01 fix now enforces the base portion of that rule, without promising that unknown profile activity or corruption can always be cleaned up.

No live coordination driver, Native job/turn, model/provider, browser/auth, policy/lifecycle, goal, or board operation was invoked by the reviewers recorded here. In the latest QR06 task, only this existing review document was edited; helper/test/product/SDK/Core/bridge source and other review artifacts were untouched. **QR01/QR02/QR04/QR05/QR06 remain independently source-closed; question-shape correction is source-verified. QR03 remains quarantined/unsupported and the mandatory journal and actual active-schedule gates remain OPEN. This source-only review issues no Stage B/C or Native READY, G3/full acceptance, release or publication approval; parent authorization, human decisions and single-writer scheduling remain mandatory.**
