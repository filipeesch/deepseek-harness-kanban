# Independent QR07 Schedule-Quiescence Source Review

Date: **October 22, 2026**, after **09:25 local runtime time**. Scope: frozen QR07 helper/controller, Node orchestration, schedule model/tests, and unchanged safety dependencies. No implementation authority. Narrow QR07-R1 frozen-fix re-review: **after 09:40 local runtime time**.

## Decision

**QR07-R1 is CLOSED at the source/local-regression layer on the corrected f1ed freeze. No new material finding was established in this narrow correction.** The original 83f8 P2, its unsafe local reproduction and OPEN decision remain preserved below as historical evidence. Fresh independent execution passed **371 local tests**, syntax, both host/client TypeScript Programs and the strict six-file check; the original adversarial probe now refuses disposal even at base. This is source-only closure, not Native READY, approval to retry/recover/release the retained process, or G3/G5/release acceptance. No source/test correction was made by this reviewer.

The phase-aware separation of non-waking next-step notices from Native operational quiescence remains supported by the public SDK. The original defect concerned notice-to-transition provenance, now independently verified corrected below. Neither the original finding, the modeled RED, nor the corrected local checks establishes what was in the old Native run’s queue or its actual failure cause.

Initially only this new report was written after checking its path did not exist; the narrow correction re-review updates only this same owned report. No helper/test/production/Core/SDK/bridge/lifecycle/configuration/other-review/JSON edit occurred. No live Native/public-service/Host/CDP/browser/auth/profile/user-data/read/recovery/cleanup/cancel/reconnect/archive/model operation was performed. The parent’s old retained process, connection, controller and guards were not queried, collected, killed, disposed or otherwise touched.

## Historical QR07-R1 — P2 OPEN on 83f8: One cwd change authenticates multiple notices

The following finding, recommendation, reproduction, original 365-test run and hashes describe the original broken freeze, not the corrected implementation. The latest independently verified closure is appended below.

**Location:** [directoryNoticeEvidence](<../scripts/verify-native-coordination.mjs#L70-L75>), particularly the latest-change lookup and per-message UUID set on line 73.

The validator stores the latest canonical working-directory/change and accepts each later next-step insertion whose body matches that transition and whose UUID has not appeared before. It never consumes the change or otherwise limits it to one optional native notice. A second message with a **fresh** UUID but the same exact native-shaped source/body therefore receives the same provenance proof, despite having no second own working-directory commit.

This is a helper validation defect, not a public SDK defect. This is not merely allowing optional best-effort injection. The [pinned SDK commit](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L134-L151>) appends one change, constructs one identified notice, and attempts one inject. Failure may legitimately leave **zero** notices. It does not produce two separately identified notices from that one transition. The proposed exception is specifically for proven own SDK notices, not any correctly shaped message inserted after a matching change.

### Independent local reproduction

The actual exported installCoordinationController was executed with the frozen new [kernel model](<../tests/schedule-uat-helper/kernel.ts>), compiled in memory without writing or altering it. A small recording/assertion shim supplied only the model's vi.fn/expect surface. A deterministic in-process clock controlled both Date construction and timers. No real SDK service, native actor, filesystem fixture, process executor, provider or model was used.

1. Create and naturally settle the modeled one-shot; establish the ordinary safe baseline with the actual controller.
2. Call the model's SDK-faithful workingDirectory.set(A, target): one canonical change and one native-shaped non-waking notice are produced.
3. Call the model actor's inject with a clone of that notice and a different valid v4 UUID. **Do not emit a second cwd change.** This creates an extra modeled canonical next-step insertion, without an own working-directory commit.
4. Read the actual controller's nativeScheduleState. It reports two proven own notices and resourceSafe=true.
5. Model return to base and call the actual controller's dispose. Disposal succeeds with all three notices still queued and unchanged.

Observed output, probe exit **0**:

~~~json
{"probe":"actual-exported-controller/unpaired-fresh-UUID-notice","wdChanges":1,"queuedNoticesAtTarget":2,"ownDirectoryNoticeCount":2,"nextStepEvidenceVerified":true,"resourceSafe":true,"disposed":true,"queuedAfterDispose":3,"queueUnchanged":true,"providers":0,"jobs":0,"tools":0}
~~~

The additional injection is an adversarial **local model operation**, not a real Native injection or canonical history append. It demonstrates the validator accepting evidence that the pinned SDK's own cwd-commit path did not produce. It does not claim that such a message existed in run 2b35284a93a8 or that a live guard was released there.

The first probe attempt advanced Date.now without advancing zero-argument Date construction; that inconsistent clock correctly failed the initial receipt baseline and is **not** defect evidence. The corrected complete clock produced the result above. No probe source was persisted, and no frozen file was patched.

### Required correction and regression boundary

Pair each accepted notice with **one unused matching canonical own transition**, preserving the allowed zero-notice case. A second insertion cannot reuse that transition merely by changing the UUID. An extra unpaired notice must remain next-step-unverified, with QR06 retention and no guard/group/socket release. This is a source-review recommendation, not an implemented fix or authorization to modify code.

Add a focused regression with one real-modeled cwd commit followed by a second exact-body/source message using a fresh UUID. Require nextStepEvidenceVerified=false and resourceSafe=false, and assert no dispose/guard release or queue mutation. Retain the normal zero-or-one-notice target/return controls and existing malformed/unknown/order/removal cases. A new frozen fix requires independent re-review.

## Initial QR07 boundaries inspected on 83f8

- [Public working-directory set/commit](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L113-L151>) commits canonical cwd first and then attempts the notice best-effort. [AgentLoop inject](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L800-L813>) targets next-step with wakeup=false. A queued notice alone is not a new running Native turn; no status hook, queue purge, forced drive or fabricated busy state is justified.
- The [new state calculation](<../scripts/verify-native-coordination.mjs#L86-L98>) separately checks both retained Agent identities/statuses, waking next-turn queues, actual public activity, immutable delivery identity/turn/occurrence, and strict next-step evidence. Actual job/question/approval/descendant/schedule activity and waking work remain unsafe. The existing exact two-pulse/zero-foreign-event attribution rule is not relaxed.
- [Notice validation](<../scripts/verify-native-coordination.mjs#L60-L75>) checks canonical owned base/target scope, exact native source/role/four-key shape/content, v4 identity, order, removal, current cwd and A's post-blocked-turn change ordering. The existing tests reject malformed and unknown evidence without relabeling it Native busy or consuming it. QR07-R1 shows why those checks still need per-transition pairing.
- The [sequence watermark](<../scripts/verify-native-coordination.mjs#L93-L95>) detects observed canonical history advancing beyond a read. The settled read loop can retry inconsistent observations within the existing budget. This remains read-only observation, not a global lease or an atomic snapshot of all Native state.
- [Diagnostic capture](<../scripts/verify-native-coordination.mjs#L239-L255>) is restricted to four phases, fixed booleans/counts/status and mismatch enums, valid timestamps, and the known public-create identity. Values and lists are copied/frozen; raw messages, unknown IDs, bodies, private errors and arbitrary schema fields are not exported. [Capture before the latch](<../scripts/verify-native-coordination.mjs#L314-L320>) preserves already-returned observations without a post-uncertainty audit/read. Record, attribution, next-step and resource failures remain distinct.
- [The integrated Node/controller/gate regressions](<../tests/coordination-uat-helper/runner.test.ts#L104-L106>) cover valid target/return notices, unknown next-step and real waking-work rejection, immutable cached diagnostics after later modeled events, and skipped/unchanged/changed defaults observation. Legacy defaultsUnchanged=false is not a positive observation or gate pass when the read was skipped. These positive boundaries do not close QR07-R1.

## Initial independent local checks — historical 365-test snapshot

The frozen supplied suite passed **365 tests / 6 files**, Vitest **3.2.7**, start **09:29:29**, duration **642 ms**, exit **0**:

- Controller 90 + runner 71 + app gate 19 = **180 coordination**.
- New schedule/controller/model cases: **40**.
- Bridge **58**, transaction **87**.
- Total **365**, overlapping prior runs rather than additional Native evidence.

Main helper syntax, both actual separate host/client no-emit TypeScript Programs, and the strict six-file NodeNext Program passed. The standalone JavaScript helper remains manually contract-reviewed/syntax-checked, not transformed into a fully typed production Program by those commands. Managed jobs **bash-3562c969bb4b42be** and **bash-fd3dd28cd4c34da7** were collected with exit **0**. No review job remains outstanding. The parent's intentionally retained Native job was not collected or affected.

The extra successful in-memory probe above is independent adversarial evidence **outside** those 365 assertions; it is not a new committed regression or a live test. A green existing suite does not override the reproduced failure of the strict provenance requirement.

~~~sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/schedule-uat-helper/schedule.test.ts tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/verify-native-coordination.mjs
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.client.json --noEmit
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/coordination-uat-helper/gate-vm.ts tests/schedule-uat-helper/kernel.ts tests/schedule-uat-helper/schedule.test.ts
~~~

## Initial reviewed freeze — historical 83f8

All nine supplied hashes matched initially and after the tests and successful reproduction:

| Input | SHA-256 |
|---|---|
| [Main helper](<../scripts/verify-native-coordination.mjs>) | 83f845412db72c5c2ef05a004263bd54c05f8b31bd8d662a1ba5963f7f8350a2 |
| [Runner tests](<../tests/coordination-uat-helper/runner.test.ts>) | d7363beda52ec06b061093913180f702905579afd41d7a501999826c0742b87a |
| [Kernel model](<../tests/schedule-uat-helper/kernel.ts>) | 51d45af3cd98b0c0f0e7ec12ccccc4fca5a5749f4f92c5f21c1473b479b11397 |
| [Schedule tests](<../tests/schedule-uat-helper/schedule.test.ts>) | e8181c42078a294d89239458b83cb4f0ec7595e534844c549463c332d7cd6683 |
| [Unchanged controller tests](<../tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [Unchanged app-gate tests](<../tests/coordination-uat-helper/app-gate.test.ts>) | b689b2967de0e200cc3d1955fe09e9b6165688d7c5a41948c9615402c509eb8c |
| [Unchanged VM transport](<../tests/coordination-uat-helper/gate-vm.ts>) | 468992559607dae2eaa7c41ddbf6a4561a7e8b0f19f7f5267770984f8300c12d |
| [Unchanged bridge](<../scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [Unchanged transaction module](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

## Historical and operational qualifications

The earlier [Case 10 source/local review](<active-schedule-runner-review.md>) remains historically honest for f597 and its 349-test snapshot; it was not edited or retroactively labeled Native acceptance. The old unqualified Native artifact and original retained process were not modified. This new source cannot patch that already-running process, establish its missing queue/counter facts, prove a past failure cause, or authorize its recovery/release. The unanswered HOLD/ABORT choice remains unanswered.

No new Native READY, retry, timer, reminder mutation, return/archive/disposal, broad diagnosis, old-queue classification, lifecycle Stage B/C, full G3/G5, task 4.3 completion or release approval was issued. **The original 83f8 decision was QR07-R1 OPEN; the correction closure below does not retcon that finding.**

## QR07-R1 narrow frozen-fix independent closure

Latest review: **October 22, after 09:40 local runtime time**. **CLOSED at the source/local-regression layer on f1ed; no new material finding in the scoped correction.** This is an independent fresh review, not adoption of the author's reported RED/GREEN runs.

### Correction and public contract

The [corrected validator](<../scripts/verify-native-coordination.mjs#L69-L75>) creates a new transition record for each exact canonical working-directory/change event, including its sequence and an initially unused optional notice budget. A valid insertion requires that current event's budget and consumes it immediately. Another distinct-UUID notice cannot reuse it. A later repeated path pair gets its own new event budget, not a global path-string exemption. Omitted earlier notices do not transfer unused permission forward, and the accumulated invalid count remains sticky across later transitions.

A [cohort-wide notice-ID set](<../scripts/verify-native-coordination.mjs#L94>) is shared by the A/B validations for each observation, preventing an A notice's identity from being reused by B. The existing exact role/source/body/UUID/path/order/removal checks remain, with no queue or canonical mutation. This matches the freshly reread [public SDK commit](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L134-L151>): one canonical change followed synchronously by **at most one** best-effort notice injection. Zero remains legitimate.

The new [six pairing regression cases](<../tests/schedule-uat-helper/schedule.test.ts#L18-L22>) cover clones after target and after return, four legitimate repeated transitions, an extra clone after the third transition, an omitted first notice with no carryover budget, and cross-actor identity reuse. The unchanged kernel and Node integration mean the correction is not obtained by weakening the fixture, Native activity, diagnostics, attribution, human/child permit, or QR06 socket rules.

### Fresh original-probe replay, including disposal at base

The previous in-memory probe was rerun against the actual corrected exported controller and **unchanged** kernel, using the same complete deterministic wall clock and recording/assertion shim. No source or test was patched or written. It separately injected the exact native-shaped fresh-UUID clone after target and after return. Both variants were then checked **at the exact base cwd**, eliminating a false refusal caused merely by still being at target.

Observed exit **0**, with assertions on all outcomes:

| Independent probe | Canonical changes / queued notices | Public idle / terminal proof | Next-step evidence / resourceSafe | Disposal and queue |
|---|---|---|---|---|
| Clone after target, then legitimate return | 2 / 3 | true / true | false / false | Refused at base; both guards retained; queue unchanged |
| Clone after return | 2 / 3 | true / true | false / false | Refused at base; both guards retained; queue unchanged |
| Legitimate target/base/target/base | 4 / 4 | true / true | true / true | Succeeds at base; all four messages remain queued unchanged |
| Zero optional notices on target/base | 2 / 0 | true / true | true / true | Succeeds at base; empty queue unchanged |

Both rejected variants report only two proven own notices, not three. Thus the invalid extra is not relabeled Native busy, but it cannot authorize resource release or positive case evidence. All four probes recorded **zero provider, job and tool calls**. These are local model observations, not Native disposal or an inspection of the old retained run.

### Fresh collected checks

**371 tests / 6 files passed**, Vitest **3.2.7**, start **09:41:32 on October 22**, duration **680 ms**, exit **0**. Breakdown: controller 90 + runner 71 + app gate 19 = **180 coordination**; schedule **46**; bridge **58**; transaction **87**. Counts overlap the historical 365-test run and must not be added to it.

Main helper syntax, both actual separate host/client TypeScript no-emit Programs, and the strict six-file NodeNext Program passed using the same command shapes recorded above. Managed jobs **bash-18105d77459343aa** and **bash-23efc9bbf6234e02** were collected with exit **0**. No local review job remains outstanding. The parent's original intentionally retained Native process was not collected or controlled.

All nine supplied corrected identities matched before and after the fresh suite and independent replay:

| Input | Corrected verified SHA-256 |
|---|---|
| [Main helper](<../scripts/verify-native-coordination.mjs>) | f1ed04c1e9fecef156a47c06e7b162a1e47d43126e3def0cf43f0b5e84d2887f |
| [Schedule tests](<../tests/schedule-uat-helper/schedule.test.ts>) | c5fb393a6e59aba70da4aa6a785008e268cd79c8b16d31a3b993834d03316492 |
| [Unchanged kernel](<../tests/schedule-uat-helper/kernel.ts>) | 51d45af3cd98b0c0f0e7ec12ccccc4fca5a5749f4f92c5f21c1473b479b11397 |
| [Unchanged runner tests](<../tests/coordination-uat-helper/runner.test.ts>) | d7363beda52ec06b061093913180f702905579afd41d7a501999826c0742b87a |
| [Unchanged controller tests](<../tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [Unchanged app-gate tests](<../tests/coordination-uat-helper/app-gate.test.ts>) | b689b2967de0e200cc3d1955fe09e9b6165688d7c5a41948c9615402c509eb8c |
| [Unchanged VM](<../tests/coordination-uat-helper/gate-vm.ts>) | 468992559607dae2eaa7c41ddbf6a4561a7e8b0f19f7f5267770984f8300c12d |
| [Unchanged bridge](<../scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [Unchanged transaction module](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

**Final boundary:** only QR07-R1's frozen source/local correction is closed. No actual queue, Native cause, pending schedule state, old resource lifetime or safe recovery has been newly observed. The old f597 process and unqualified artifact are not patched or reclassified by these files; the earlier 83f8 P2 remains a true historical finding. Native Case 10, task 4.3, G3/G5, lifecycle Stage B/C and release approval remain open or quarantined as previously recorded. The unanswered human HOLD/ABORT decision remains unanswered. No live retry, connection release, cleanup, return/archive/dispose, reconnect or new timer is authorized by this closure.
