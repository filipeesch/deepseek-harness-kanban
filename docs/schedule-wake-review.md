# Independent CR09 Schedule-Wake Review

Review date: October 22, 2026. Reviewer: independent of implementation author A6663.

## Result

**No material defect found in the frozen CR09 production change or its new regression. Accept at the source/local-regression layer only.** This is not live/Native acceptance, build/activation authority, full G3/G5 acceptance, or release approval. No fix is proposed or implemented.

Only this new report was written. No source, test, existing review, SDK/core, configuration, canonical Native history, or live/user data was changed. No live app, Host, Native, CDP/browser, authentication, GUI, schedule API, model, profile, or activation operation was executed. Shipped SDK files were read only through the read tool; no ASAR extraction or replacement runtime/server was used.

## Frozen inputs

All four SHA-256 values matched the requested freeze before review and again after the independent checks. The repository has no tracked baseline for these files, so this is a hash-bound review of the supplied change, not a Git-diff attestation against an unavailable earlier revision.

| Input | SHA-256 |
|---|---|
| [Host entrypoint](<../src/index.ts>) | ff855138a30892e3a6d22f028854c875888b244ea10c2fa267ca81ba36133dcb |
| [New regression](<../tests/host/schedule-wake-race.test.ts>) | 47ed90ec823fc029a157529bb8cb55cd41b8cda4a4dec92775aa9882b22998e1 |
| [Existing review, read only](<code-review.md>) | b344e00334335ebd738bfe46b3d67ec997cbcb03a22ca6f0e1d8ba0bc6b90c7b |
| [Unchanged application](<../src/host/app.ts>) | 513da8b2ef652f297a5fce7f564fda203d67a8bfd4c53f7914b6a0b039df0360 |

## Production correctness and public contract

- The [narrow Cordis augmentation](<../src/index.ts#L15-L16>) exactly matches the authoritative shipped [public event declaration](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/typert.host.js#L845-L857>): **'schedule/changed'(): void**. It is an emit-mode, payloadless notification, not a service request. The public declaration is available and authoritative; no missing-types or private-API workaround is needed.
- The only wake registration is [plugin-owned ctx.on calling app.activityChanged](<../src/index.ts#L42-L55>). The [injection list](<../src/index.ts#L41>) does not require schedule. No new dependency, schedule query/catalog access, status hook, polling interval, timer policy, native execution policy, or model behavior was introduced.
- The [natural scheduler path](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L1586-L1609>) calls followup, awaits sessions.flush, and then awaits the one-shot inactive commit. Its [commit callback](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2023-L2027>) awaits tasks.put before emitChanged. This is a genuine asynchronous commit boundary after Session delivery, unlike the same-stack/microtask rejected-turn turn/end-to-idle transition. Mere event order is not a reason to add an Agent-status hook.
- The scheduler's [public activity contribution](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2043-L2055>) and [active-owner list](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-schedule/lib/index.js#L2120-L2122>) include active future one-shots, not only due reminders. The actual [NativePorts idle gate](<../src/host/native.ts#L211-L224>) rejects any owned activity before considering Agent and projection state.
- The unchanged [observation and activity methods](<../src/host/app.ts#L46-L51>) share one activityTimer. A pending timer is not replaced or multiplied; its callback clears the slot and performs one 50 ms rescan. This is coalescing, not periodic polling. Therefore, a Session-only rescan that still sees an active schedule can otherwise wait indefinitely after a later inactive commit. The new event supplies exactly the missing wake and clears cached attention before the rescan.
- Optional-service absence is safe: the actual regression starts the host without providing a schedule service, and [NativePorts defaults an unhandled activity waterfall to an empty array](<../src/host/native.ts#L116-L122>). The synthetic schedule activity contributor is a public bus fixture, not a schedule service injection.
- [Coordinator resumption](<../src/host/worktrees.ts#L178-L193>) remains serialized and rechecks [all retained sessions' idle state](<../src/host/worktrees.ts#L219-L227>). The wake does not bypass existing guards or directly perform Git/cwd/prompt effects.

## Independent regression inspection and execution

The frozen [fixture](<../tests/host/schedule-wake-race.test.ts#L34-L148>) executes actual production apply, createNativePorts, BoardStore, KanbanApp, and WorktreeCoordinator on real Cordis. Storage and public services are in-memory fakes. Only the external Git boundary is replaced with [TestGit](<../tests/host/helpers.ts#L26-L34>); child-process spawn is forbidden, and sandbox execution-policy resolution throws if reached. Temporary directory cleanup checks the canonical parent and fixture prefix before removal.

| Frozen case | Independent result and significance |
|---|---|
| [Late inactivity, no later Session notification](<../tests/host/schedule-wake-race.test.ts#L151-L166>) | GREEN. The first 51 ms rescan sees active schedule activity and leaves the operation waiting. After inactivity, only payloadless schedule/changed is emitted; the operation reaches ready with exactly one Git create and one total synthetic Session notification. No manual retry is used. |
| [Actual host-fiber disposal](<../tests/host/schedule-wake-race.test.ts#L168-L189>) | GREEN. Public event delivery calls the actual app method, creates one timer, and host disposal clears it. A later event calls no method, creates no timer, resumes no operation, and changes no stored state. |
| [Later Session-notification control](<../tests/host/schedule-wake-race.test.ts#L191-L206>) | GREEN. The unchanged Session subscription still completes the operation once an extra notification arrives after inactivity. |

All three assert no prompt, archive, or child-process spawn. The single-timer/coalescing control flow was independently inspected in production source; the frozen tests check one pending timer and one observed rescan but do not separately stress a multi-event burst. This is a coverage qualification, not a reproduced defect.

The public turn/end object is **only a synthetic test-bus notification**. The fake inspection history is empty; nothing is appended to a canonical Native log. These tests do not instantiate the real scheduler or prove live natural delivery. The author's historical one-RED/one-GREEN pre-fix run was not independently rerun by removing the fix; no frozen source/test was modified for review.

### Collected local checks

- Frozen focused regression: **3/3 tests, 1 file passed**, Vitest 3.2.7; start **07:18:17**, total **432 ms**, test execution **39 ms**, exit **0**. Managed job **bash-0be0a4d2c2114780** was collected.
- Node syntax checks for both frozen changed files: **PASS**.
- Full host TypeScript Program, no emit: **PASS**.
- Full client TypeScript Program, no emit: **PASS**.
- Syntax/typecheck managed job **bash-38c4fba3cf764b5d** was collected with exit **0**. No review jobs remain outstanding.

The focused run and syntax checks used the nvm Node executable; TypeScript used the bundled Node/pnpm launcher. Both Node executables reported v24.21.0.

~~~sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/host/schedule-wake-race.test.ts
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check src/index.ts
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check tests/host/schedule-wake-race.test.ts
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node /Users/filipe.esch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs exec tsc -p tsconfig.client.json --noEmit
~~~

The author's [1147-test/39-file full-suite result](<code-review.md#L198-L208>) remains implementation-owned evidence, not an independently rerun full suite. It overlaps these three tests and must not be added to their count. Concurrent QA-helper Stage A/QR06 work and unrelated scripts/tests are outside this review; no ownership or approval of them is implied.

## Acceptance limits

CR01-CR08 are not reopened or re-certified. The inspected production addition preserves their execution guards and existing app/coordinator behavior; the supplied unchanged app hash remained exact. Their earlier independent source/local findings and historical Native results retain their existing qualifications, not fresh live verification from this review.

**Actual Native active-schedule gating remains UNTESTED, and [task 4.3](<../openspec/changes/archive/2026-10-22-define-kanban-product/tasks.md#L33>) remains unchecked.** Full G3/G5 gates and release approval remain open. The eight other actual Native cases and qualified G4 pass belong to historical host 39bf; they do not validate the new host. No new host build, installation, activation, refresh, reconciliation, or Native validation was performed. This report authorizes none of those operations.
