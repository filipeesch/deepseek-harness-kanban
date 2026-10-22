# Independent Lifecycle Transaction Module Safety Review

Date: **October 22, 2026**. Scope: [isolated lifecycle module](<../scripts/native-coordination-lifecycle.mjs>) and [its local tests](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts>). Initial frozen snapshot independently tested at **04:28:12 local runtime time**. Corrected frozen snapshot independently re-reviewed/tested at **04:57:30 local runtime time**.

## Result

**LT01–LT03 are independently verified fixed at the source/local-regression layer. No new concrete issue was found in their frozen targeted re-review.** These were module-contract findings, not live Native failures or alleged SDK defects. The main coordination runner remains separately quarantined for lifecycle; source closure does not integrate this module, verify its Host bridge, or pass the mandatory native journal gate.

| ID | Priority | Finding | Status |
|---|---|---|---|
| LT01 | P2 | Cancellation during the final awaited preflight initiated a new OFF | Closed — post-await cancellation fence independently verified |
| LT02 | P2 | Transaction reported ok despite missing required native settled-event proof | Closed — exact awaited proof required for every job |
| LT03 | P2 | Own task effectiveCwd was not validated before OFF | Closed — complete base/pristine waiting-context checks independently verified |

All three findings were sent immediately to the parent. No production source, helper source, tests, integration, profile, Native/API/auth/browser/job/model/policy/lifecycle operation, or fixture data was changed or invoked by this reviewer. Only this report is authored. **No module integration or live lifecycle approval is given.**

## Historical findings and original reproductions

The following findings and outputs describe the initial snapshot before correction. Current source closure and new regression evidence appear below; historical line links may have shifted as the module expanded.

### LT01 — P2: Pre-effect cancellation could still disable the bundle

**Locations:** [final preflight and OFF admission](<../scripts/native-coordination-lifecycle.mjs#L266-L276>) and [operational cancellation](<../scripts/native-coordination-lifecycle.mjs#L369-L371>).

The cancellation check precedes an awaited listBundles call. If requestCancel arrives during that final prelude, the run resumes, marks OFF attempted, and calls setBundleEnabled(false) without another cancellation check. It later notices cancellation and restores ON, but the cancelled transaction has unnecessarily interrupted the shared bundle even though OFF had not begun when cancellation was requested.

**Independent reproduction:** actual exported module, author fixture transpiled in memory, minimal in-memory vi/expect stand-ins. Hold the second bundle-list prelude, request cancellation, release the list, and await the result. No real services are used.

```json
{"mutations":[false,true],"offAttempted":true,"errors":["LIFECYCLE_CANCELLED"]}
```

**Specific fix:** check cancellation immediately after the last awaited pre-effect validation and before marking/calling OFF. Keep the existing rule that a manager OFF already in flight is never aborted and its same-function finally still restores ON.

**Regression:** cancel while each final prelude is held; release it and assert zero manager mutations if OFF never began. Retain delayed-OFF and delayed-work cancellation tests proving ON cannot overtake an already-started predecessor.

### LT02 — P2: Missing settled-event proof was compatible with ok=true

**Locations:** [event observation](<../scripts/native-coordination-lifecycle.mjs#L237-L252>), [canonical wait/status checks](<../scripts/native-coordination-lifecycle.mjs#L300-L308>), and [success condition](<../scripts/native-coordination-lifecycle.mjs#L345-L348>).

The module records settledEventObserved in its receipt, but success only requires completed canonical status and a wait result. It never requires that a matching awaited native settled event was observed. The resulting receipt can simultaneously say ok=true and settledEventObserved=false, contrary to the module's required settlement-proof contract.

**Independent fault injection:** suppress only delivery to the module's event subscription while the in-memory canonical get/wait records really transition to completed. The actual exported transaction reports:

```json
{"ok":true,"nativeStatus":"completed","waitObserved":true,"settledEventObserved":false,"errors":[]}
```

This does **not** allege that the pinned SDK normally omits events, nor does it claim a full journal gate was passed. It demonstrates that this module's own successful-window receipt lacks its advertised proof condition. The receipt correctly labels nativeJournalGate:not-verified, but that narrower scope still requires its declared native resource proof.

**Specific fix:** require a matching awaited settled event for each selected job before success. Validate the event's scoped identity, kind/label/startedAt/status against the canonical selected execution, not just its owner. Record a sanitized missing/mismatched proof error and keep ok=false. Continue using public canonical get/list/wait; do not trust a successful outside callback return or invent native status/events.

**Regression:** canonical terminal wait/get with no event; wrong owner/kind/label/generation/status; unawaited event; valid event. The valid branch must still restore ON and distinguish transaction-window success from native journal acceptance.

### LT03 — P2: Own task effective context was unchecked

**Locations:** [own task preflight](<../scripts/native-coordination-lifecycle.mjs#L210-L220>) and [positive test DTO](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts#L33>).

Preflight verifies the project path, task membership and native session cwd, but never verifies each own task effectiveCwd. The positive test board omits this field entirely. A task that still records another active context is therefore accepted for the supposedly base-consistent waiting-journal transaction.

**Independent reproduction:** set the author fixture task effectiveCwd to /wrong/context while leaving its project and canonical native sessions at the owned base. The actual transaction reports ok=true and performs synthetic OFF/ON with no errors. This is a false precondition acceptance, not evidence of a live wrong-directory execution.

**Specific fix:** require every selected task's recorded effectiveCwd to equal the canonical owned base before any OFF. Validate the relevant waiting-journal context consistently rather than treating only projectPath/native cwd as sufficient. Do not repair or substitute a root.

**Regression:** missing and mismatched effectiveCwd reject before manager writes, matching base succeeds, and partial/drifted context fails without turning the bundle off. Update positive test DTOs to include the real public field so omission cannot hide the check.

## Frozen-fix independent closure

### LT01 — Closed

The [final awaited bundle observation is followed immediately by cancellation revalidation](<../scripts/native-coordination-lifecycle.mjs#L313-L325>) before the OFF-attempt marker or manager mutation. Cancellation during that prelude therefore causes zero OFF/ON calls. Existing [same-function restoration](<../scripts/native-coordination-lifecycle.mjs#L366-L400>) still awaits an already-started OFF and restores ON, without transport abort or a competing client restore.

Independently inspected/executed [held-final-list cancellation](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts#L198-L201>) alongside the retained delayed-OFF/delayed-work/client-timeout cases. The negative now reports offAttempted=false/onAttempted=false and manager mutation count zero.

### LT02 — Closed

The [settled observer](<../scripts/native-coordination-lifecycle.mjs#L275-L300>) requires exact selected execution identity and awaited===true, rejects nonterminal/mismatched tuples and duplicate observations, and preserves immutable proof per job. [Post-wait canonical comparison](<../scripts/native-coordination-lifecycle.mjs#L348-L360>) requires that proof for every selected job and checks consistent terminal status. [Receipt and success](<../scripts/native-coordination-lifecycle.mjs#L216-L222>) now derive the proof flag from the exact tuple, and [ok explicitly requires it](<../scripts/native-coordination-lifecycle.mjs#L397-L400>).

Independently inspected/executed [suppressed event, wrong id/owner/kind/label/startedAt/status, nonawaited, one-of-two missing proof and duplicate-event regressions](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts#L202-L226>). Missing proof can no longer yield ok=true, even when wait/get show completed. Valid completed proof still succeeds at transaction-window scope only; failed/killed executions remain truthful failures with restoration.

### LT03 — Closed

[Task context preflight](<../scripts/native-coordination-lifecycle.mjs#L246-L258>) requires the selected task effective cwd at the owned canonical base, active/unarchived task and coherent participants/retained checkout. [Pristine request/journal validation](<../scripts/native-coordination-lifecycle.mjs#L157-L186>) requires target binding inside the owned fixture, gitCompleted=false, empty switched/archived/prior-directory data, no prior error/create-recovery/targetDirectory, and coherent waiting operation/transition data. It deliberately rejects partial recovery; this is not a general repair path.

The positive fixture now contains complete real public project/task/operation fields and [passes BoardStateSchema](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts#L228-L234>). Independently inspected/executed [missing/wrong effectiveCwd, malformed/non-pristine journal, bound-create inconsistency and transition negatives](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts#L235-L261>). They reject before OFF/native waits; valid base and pristine waiting cases still pass.

### Frozen verification identity and independent run

Verified the supplied SHA-256 values exactly, without changing or executing Native services:

| File | SHA-256 |
|---|---|
| [Module](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |
| [Tests](<../tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts>) | 69f77fda4fd9c5f89629036cc40fbc2c6f1b5040312a9af890e09dd4c03467c6 |

**87 tests / 1 suite passed**, exit **0**, normal Node, **315 ms**, start **04:57:30 on October 22**. This is the corrected snapshot, superseding the overlapping 53-test baseline; counts are not summed. The exact command is recorded below. The prior server-promise ledger/receipt fence, root-bound opaque gate, independent guard lifetime, single server OFF/work/ON ordering, unknown-ON admission retention, privacy and explicit operational/native separation remain unchanged and were covered by the run.

No helper/test/product/integration code was edited by this reviewer; only this report was updated. No Native, Host, auth, browser, real job, prompt/turn, model, permission, lifecycle or fixture-data effect occurred. The parent's exclusive native work was neither observed nor controlled by this review.

## Independently inspected positive boundaries

- [Gate construction](<../scripts/native-coordination-lifecycle.mjs#L40-L76>) rejects caller invokers, synchronously enters each admission into a ledger, and later calls the freshly resolved public controller. Draining tracks actual server promises, not a Node/CDP deadline promise. [Delivery receipts](<../scripts/native-coordination-lifecycle.mjs#L78-L99>) fence unacknowledged results before lifecycle quiescence.
- The non-serializable symbol brand is bound to the exact Host root, with [wrong-root/by-value checks](<../scripts/native-coordination-lifecycle.mjs#L152-L156>). It is explicitly **not universal realm attestation**. Same-server construction and opaque Host reference transport remain future integration assumptions to verify, not guarantees established by Node mocks.
- [Pause, drain, snapshot and seal](<../scripts/native-coordination-lifecycle.mjs#L92-L125>) prevent runner-owned commands/snapshots while OFF. They do not atomically fence external user clients; the exclusive operator window is a stated environmental precondition.
- Foreign pending operations/transitions are aggregated over the public snapshot, and canonical fixture paths/native origin/current cwd/registered owner-root job identity are checked before effects. LT03 was the missing task effective-context part of this boundary; the verified closure above now enforces it.
- [OFF, work and finally ON](<../scripts/native-coordination-lifecycle.mjs#L269-L330>) reside in one persistent server async function. There is no competing client restore or transport-abort parameter. Client timeout does not order ON ahead of a held server OFF prelude. Non-applied/unknown/rejected OFF still reaches the same-function restoration; unconfirmed ON retains admission closed and blocks disposal. LT01 was the pre-effect cancellation gap; the verified post-await fence above closes it.
- Canonical public jobs are inspected with owner fencing and finite 120000-ms waits without abort. Outside work cannot manufacture terminal status merely by returning a successful-looking value. Native job status is separate from operational phase. LT02 was the incomplete event-proof success condition; the verified exact per-job event requirement above closes it.
- The state receipt excludes public RPC payloads and raw exception text; errors are allowlisted, with scoped job IDs/status only. Gate result/recovery values remain private ordinary RPC data and must not be logged by future integration.
- Single-use/idempotent start and cancellation intent do not assign native status. The module has no provider/model or filesystem mutation route. An independent native controller must outlive actual work and plugin OFF; server death, integration mistakes and external clients are outside this in-memory guarantee.
- Even a correct transaction-window receipt is explicitly **not** native journal acceptance. Same native IDs/history, persisted journal and canonical post-ON cwd proof remain required in separately reviewed integration. This isolated module is not wired into the quarantined main coordination helper, and this review inspects no separate integration prototype.

## Verification and limits

Independently ran **53 tests / 1 suite**, exit **0**, **210 ms**, start **04:28:12 on October 22**, using normal Node:

```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/lifecycle-uat-helper/native-coordination-lifecycle.test.ts --reporter=dot
```

The three additional fault reproductions used actual exported module functions plus the existing synthetic fixture transpiled in memory with small assertion/spy stand-ins; no test files were added or source files edited. Their outputs are separate evidence, not additional native gates. The original 53-test baseline did not cover LT01/LT02/LT03. The corrected frozen 87-test run now includes the exact regressions and independently verifies their closure.

Pinned public job registration/wait/settlement and manager serialization semantics were independently read in the preceding [coordination runner review](<coordination-runner-review.md>). The new single-server ordering avoids the earlier helper's split-prelude ON/OFF race at this source-protocol level, but no real manager lifecycle or native job settlement was executed here.

**LT01–LT03 are independently source-closed. Keep the main lifecycle quarantine and native journal/full acceptance gates open: this review does not approve integration, the same-Host object-reference bridge, real OFF/work/ON execution, or post-ON IDs/history/cwd/journal proof. Those require separately reviewed integration and actual authorized evidence. No live-run, release, sync/archive or publication approval follows.**
