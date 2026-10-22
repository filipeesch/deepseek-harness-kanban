# Independent Case 10 Active-Schedule Runner Source Review

Date: **October 22, 2026**, after **08:30 local runtime time**. Scope: the frozen Case 10 helper/controller, Node orchestration, and new local regressions. Independent of the implementation author.

## Decision

**No material finding established. Accept the frozen Case 10 candidate at the source/local-regression layer only.** No source or test correction is proposed. This review does **not** authorize a timer, reminder, Native run, build, installation, activation, browser/GUI action, cleanup, policy change, model request, or release. Parent must separately scope and authorize any actual single-case run.

Only this new report was written after verifying that its path did not exist. No source/test, production, SDK/Core, bridge, lifecycle, configuration, existing review, canonical Native history, or user data was edited. Verification used only local synthetic unit tests, syntax/type checks, hashes, and read-only primary-source inspection. No live Host/Inspector/CDP/browser/auth, Native actor/service/job, schedule API, profile, model, or filesystem fixture operation was executed.

## Frozen identities

All nine supplied SHA-256 values matched before and after independent local verification:

| Input | Verified SHA-256 |
|---|---|
| [Main helper](<../scripts/verify-native-coordination.mjs>) | f597b623ae3915638041ae68974031eaf290ef675665defe9e06a6e872fafb8b |
| [Runner tests](<../tests/coordination-uat-helper/runner.test.ts>) | c3d109217b1921fb842a86791899bef811414d204a0162848ddf3a00a568e9e1 |
| [New kernel model](<../tests/schedule-uat-helper/kernel.ts>) | 3bf2ab18a189cbdcb7f49d690c53ead205ad26213c42b65bbe41ba9bfafa0a2e |
| [New schedule tests](<../tests/schedule-uat-helper/schedule.test.ts>) | f5c6562a9c8ac7910f8a40501b20a1e68f36dbe6b1a6cb17c139d57b913d3cf6 |
| [Unchanged controller tests](<../tests/coordination-uat-helper/coordination.test.ts>) | 7cc4d754bf35c0ca82f706e40df49d4233a80ee6654d8a5634b42c6da3df097e |
| [Unchanged app-gate tests](<../tests/coordination-uat-helper/app-gate.test.ts>) | b689b2967de0e200cc3d1955fe09e9b6165688d7c5a41948c9615402c509eb8c |
| [Unchanged VM transport](<../tests/coordination-uat-helper/gate-vm.ts>) | 468992559607dae2eaa7c41ddbf6a4561a7e8b0f19f7f5267770984f8300c12d |
| [Unchanged bridge](<../scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [Unchanged transaction module](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

## Authoritative public SDK contract

Primary shipped sources were read directly, without extraction, patching, execution, or a private-API fallback:

- The [public schedule service methods](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L624-L664>) define singular schedule.create(sessionId, request, signal), list({sessionId}), and history({sessionId,id,limit}). The [AfterScheduleRecord](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L669-L670>) has exactly the six fields validated by the helper. [History and receipt declarations](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L754-L790>) distinguish ScheduleId from the delivered Native message UUID. Create anchors its clock **before** its serialized FIFO wait; an already-due receipt is not permission to re-arm.
- The [fixed origin line and five-line framing](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L1386-L1400>) match the helper's whole-string comparison, including JSON-escaped own schedule ID/prompt and exact scheduledAt. The [natural delivery](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L1566-L1609>) resolves the original root, creates a UserMessage with **source:{kind:'schedule'} only**, follows up, awaits sessions.flush, then commits one-shot inactivity/history with that message ID. No human rpcId or schedule ID is minted as the message identity by the helper. The [public UUID/freeze factory](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js#L37-L63>) confirms the exact user-role message shape.
- [Followup](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L800-L807>) inserts through the kernel. The [canonical inbox splice](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L180-L207>) is a real Session event. By contrast, [agent/inbox/claimed](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L103-L110>) is a public Agent hook emitted after non-canceling consumption, not a canonical Session event. The public [event dispatcher injects the actual agent](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js#L242-L259>). Exact message/claim identity plus one canonical removal ties consumption to the owning turn rather than treating an arbitrary discard as acceptance.
- [Pre-step rejection](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L902-L962>) yields a blocked turn; [turn/end](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L1027-L1035>) is committed before [driver retirement to idle](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L887-L899>). [Canonical user/message publication](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L1043-L1073>) belongs to the later request path, so it is correctly **not required** for this rejected QA turn. Public [whenIdle](<../node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts#L158-L164>) means whole-agent quiescence, not a per-message receipt; the candidate separately checks the message/turn evidence.
- Active future reminders contribute the [public schedule activity row](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2043-L2055>) because [list filters by active owner](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2120-L2122>), not by due time. The [inactive commit callback](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2023-L2027>) awaits durable storage before the exact [payloadless schedule/changed notification](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L845-L857>).

## Candidate control flow and safety

### Admission and exact zero-provider permit

The [CLI authorization boundary](<../scripts/verify-native-coordination.mjs#L28-L38>) requires the original four owner/fixture/policy/producer permissions plus all three canonical schedule opt-ins, and **exactly --cases active-schedule**. Model, preset-selection, child-drive/inheritance and lifecycle combinations reject before adapters/effects. Missing schedule opt-in returns not-tested before creating a schedule cohort. Missing public schedule capability creates no reminder and is reported unsupported, not emulated.

[Independent guards and listeners](<../scripts/verify-native-coordination.mjs#L60-L96>) precede create. Only fresh owned root A may use singular public create/list/history; no B, child, coding-root schedule, global catalog, delete/update/stop or synthetic user prompt is used. The native schedule pre-step route requires one whole native-framed user message, a real UUID, exactly four message keys, source containing only kind:schedule, the own returned record, actual retained Agent/registry/base identity, the captured insertion, and the public claim's exact turn. It rejects before model admission. The existing QR04 human/rpc permit remains a separate unchanged route; the new schedule branch does not weaken its identity matcher.

### Schedule-only waiting and natural wake

The [Node case](<../scripts/verify-native-coordination.mjs#L290-L300>) requires exact active list membership, owned schedule activity, idle A, empty queues, no turn/jobs/producer roots, and unchanged A/B base facts. At least **5 seconds** must remain before the one gated worktree-create command. It then requires persisted WAITING, no Git completion, base effective cwd, both native cwds at base, and the schedule still future/active. An elapsed or missed window is not-reproduced, with **no re-arm**.

The [natural resource proof](<../scripts/verify-native-coordination.mjs#L76-L85>) joins the owned public history receipt to the inserted Native UUID, occurrence time, deliveredAt at/after due, public claim, one canonical removal, the same blocked terminal turn, exact pre-step permit, idle actor and empty queues. Active-list absence **plus** history demonstrates natural inactivity, not deletion. The Node case requires one delivery and zero accepted human prompts, then observes ready at the same task/session order/history prefix/target through normal product behavior. It makes no private activityChanged, retry, Agent drive, fake job/status/event, or polling wake call. Its read-only observation loops do not establish a global admission fence.

This is explicitly a **QA-blocked Native turn**, not LLM completion. Source/local execution here does not prove the installed product's natural wake.

### Contamination and retention

The [window observers](<../scripts/verify-native-coordination.mjs#L156>) count foreign Session events after due without reporting foreign IDs or bodies, and count global payloadless schedule changes. Own create and inactive transitions require exactly **one then two** notifications. Extra activity makes attribution unverified, not a causal pass. An exclusive quiet operator window remains an environmental assumption: GUI/public SDK users are unfenced, and a payloadless count is not universal schedule-origin attestation.

The helper [marks schedule creation entered before the mutator](<../scripts/verify-native-coordination.mjs#L68-L75>); Node [marks possible effects before the controller call](<../scripts/verify-native-coordination.mjs#L293-L294>). Unknown/thrown/malformed creation latches uncertainty, never set-diffs/adopts an identity, and triggers the QR06 gateway/resource fence. No later schedule inspection/drain/mutation, mutable app/fixture cleanup, controller disposal, group or socket release is authorized by an unknown result.

For a **known** active schedule, bounded cleanup may only wait for its natural resource proof; it cannot cancel/delete/update/re-arm. An unresolved natural wait throws and retains guards. Successful failure-cleanup cannot convert a failed/not-reproduced case into passed. [Final cleanup and socket retention](<../scripts/verify-native-coordination.mjs#L305-L321>) preserve the already-reviewed QR06 lifetime fence and truthfully report retained resources rather than guaranteeing reference survival after disconnect/server death. No emergency cleanup authority is supplied here.

## Fresh independent local evidence

**349 tests / 6 files passed**, Vitest **3.2.7**, start **08:34:30 on October 22**, duration **552 ms**, exit **0**:

| Scope | Tests |
|---|---:|
| Existing controller | 90 |
| Runner, including six schedule orchestration cases | 66 |
| App gate | 19 |
| New schedule controller/kernel cases | 29 |
| Bridge | 58 |
| Transaction | 87 |
| **Total** | **349** |

Thus 175 coordination plus 29 schedule = 204, plus 58 bridge and 87 transaction = 349. These overlap prior runs; counts must not be summed with implementation-owned or earlier review totals.

The [29 schedule cases](<../tests/schedule-uat-helper/schedule.test.ts#L23-L35>) execute the actual exported controller, including isolated-VM serialization. They cover native-framed delivery/UUID/history/claim/removal/blocked-turn proof; 19 wrong-message, wrong-owner/role/body/time/history/claim, missing-event, foreign-activity, still-running or still-active variants; unknown/malformed create; absent service; request-time FIFO expiry; an active-forever bounded wait; and strict authorization. They assert zero provider, real executor/tool/job/root-prompt, schedule deletion/update/catalog effects in their models.

The [six Node cases](<../tests/coordination-uat-helper/runner.test.ts#L97-L102>) execute actual runVerification and the serialized app gate through the VM transport. They cover missing opt-in, positive natural-wake orchestration, early expiry/no re-arm, unknown creation/retention, missing service, and contamination/retention. Unknown creation asserts no follow-up schedule-state read, drain/dispose, group release or socket close.

**Fidelity limit:** the public-service/kernel traces and timers are in-memory models. The Node schedule harness models completion with its existing fixture state transition; it does not run the real scheduler or production worktree coordinator. Model events are not appended to any canonical Native log and are never live proof. The meaningful source contracts were checked against the primary SDK above rather than inferred solely from those fakes.

Main helper syntax, both actual separate host/client no-emit TypeScript Programs, and the strict isolated six-file NodeNext Program all passed. The standalone JavaScript helper is syntax-checked and manually contract-reviewed; these TypeScript commands do not turn it into a fully typed production program. Managed jobs **bash-75f5bd1b27fd4c72** and **bash-14ea1dd21f4d4d22** were collected with exit **0**. No review job remains outstanding.

~~~sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/schedule-uat-helper/schedule.test.ts tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/verify-native-coordination.mjs
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.client.json --noEmit
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node tests/coordination-uat-helper/coordination.test.ts tests/coordination-uat-helper/runner.test.ts tests/coordination-uat-helper/app-gate.test.ts tests/coordination-uat-helper/gate-vm.ts tests/schedule-uat-helper/kernel.ts tests/schedule-uat-helper/schedule.test.ts
~~~

## Outstanding actual gates

The ten mandatory categories still include quarantined pending-journal reload. [Report classification](<../scripts/verify-native-coordination.mjs#L224-L234>) cannot qualify a synthetic schedule case as a Native schedule gate or make case counts a full pass. QR01-QR06 source conclusions retain their historical/local scope; no prior Native case is re-certified here.

**Actual Native active-schedule verification remains UNTESTED; task 4.3 remains unchecked. Full G3/G5 and release approval remain OPEN.** The eight historical Native cases belong to host 39bf, not a fresh certification of host 0e5. Parent-reported CR09 build/reconciliation and GUI zero-error observations are not this reviewer's evidence and do not prove real schedule behavior. No Stage B/C, manager/window toggle, lifecycle mutation, broad diagnosis, profile repair, or unanswered human choice is authorized by this source acceptance. Any next live Case 10 requires a new explicit bounded parent authorization; it is not automatic.
