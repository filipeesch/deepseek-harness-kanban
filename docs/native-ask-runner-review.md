# Native Ask Complement Runner: Independent Safety Review and P2 Closure

## Current status

**QA-NATIVE-ASK-01 and QA-NATIVE-ASK-02 are CLOSED for the final frozen absence-only v2 revision reviewed below.** Independent source review, 185 local tests, syntax, strict scoped TypeScript, original-case presence replays, formatter negatives, and mode-flag checks passed. No remaining material finding was established in this scoped closure review.

The source-review decision remains distinct from runtime evidence. After the explicit conditional authorization and role change, the single v2 invocation completed with exit 0, all 20 runtime checks true, and successful cleanup: one additional human prompt and exactly two provider admissions. Its [complete sanitized complement report](<../.verification/native-fixtures/g4/run-1140aaffeaac/evidence/native-ask-complement-v2.json>) is separate from the still-failed original G4. The source-review phase itself made no Host/Native/authentication/browser/model calls; the later authorized execution is recorded separately at the end of this document.

## Original v2 receipt-gate decision (historical)

**The frozen v2 review requires changes: QA-NATIVE-ASK-02 is OPEN.** The previous retained-base cleanup finding QA-NATIVE-ASK-01 remains closed; the new finding concerns acceptance of contradictory prior-attempt evidence, not a demonstrated live provider-cap bypass. Parent has assigned removal of the receipt-acceptance branch: v2 must require actual v1 absence and reject any v1 presence. A new frozen correction and scoped re-review are required before the parent readiness decision.

The v2 source hashes matched and 178 local tests, syntax, and strict scoped TypeScript passed, but the independent synthetic counterexample below demonstrates the uncovered receipt gate. No Host, Native, authentication, browser, model, or real fixture effects were performed by the reviewer.

## Previous scoped P2 closure summary (historical)

**QA-NATIVE-ASK-01 is CLOSED for the frozen source revision and local evidence reviewed below.** The independent closure review passed 154 local tests, syntax, strict scoped TypeScript, and the original negative formatter replay. No remaining material finding was established in this scoped closure review.

This is not a live Native pass or an execution authorization. Parent still owns the FULLREADY decision and the exact one-prompt/two-admission run boundary. The pre-fix finding and failed reproduction are preserved below as historical evidence; the final section records the separately reviewed correction.

## Original pre-fix status (historical)

**Changes required before Parent FULLREADY.** This is the independent review of the frozen, pre-fix runner on October 22, 2026. It does not authorize a live run, establish a Native runtime pass, or close any later source revision. The parent acknowledged the finding below and assigned its correction to the runner author; that correction needs a separate frozen-source re-review.

Scope: the [target runner](<../scripts/verify-native-ask.mjs>), [target unit tests](<../tests/question-uat-helper/verify-native-ask.test.ts>), and relevant selector, source-lease, composer, and guard imports from the [common helper](<../scripts/verify-native-questions.mjs>) and [common tests](<../tests/question-uat-helper/verify-native-questions.test.ts>). No product source, helper, or test file was edited by this reviewer. This new report is the only review output file.

## Finding QA-NATIVE-ASK-01 — P2: Retained-base cleanup proof is asserted, not established

The required cleanup condition is stronger than an archived actor with unchanged log prefixes: the exact owned base must remain valid, and the Native effective directory must be consistent with that base before cleanup is considered safe and guards are disposed.

The pre-fix code does not establish that condition:

1. [Controller cleanup:61](<../scripts/verify-native-ask.mjs#L61>) checks ownership/prefixes, cancels if necessary, waits for idle, and rearchives the known actor. It then returns workspaceRetained and baseRetained as literal true values. The retained workspace is indirectly checked by the prefix/registry helper, but the physical base and current effective directory are not revalidated here. A stored header path is not evidence that the current directory remains canonical and available.
2. [Runner disposal:95](<../scripts/verify-native-ask.mjs#L95>) permits guard disposal on archived, idle, and prefixUnchanged alone. It does not require an independently verified baseRetained/workspaceRetained result.
3. [Final report:72](<../scripts/verify-native-ask.mjs#L72>) copies those two cleanup flags into the report but omits them from the success predicate. A report can therefore say ok:true while explicitly saying the base and workspace were not retained.

### Local reproduction

A pure, synthetic invocation of safeTargetReport supplied otherwise-valid required checks, exactly two admissions/attempts, one confirmed native ask, one human prompt, completed cleanup, and these two negative cleanup facts:

~~~json
{"workspaceRetained":false,"baseRetained":false}
~~~

The actual formatter returned:

~~~json
{"ok":true,"workspaceRetained":false,"baseRetained":false}
~~~

This reproduction imported the helper as a module and called only its formatter. It did not invoke its CLI, orchestrator, Inspector, browser, authentication, host controller, Native API, or model. It is evidence of an acceptance-predicate gap, not a claim that the real fixture was damaged or that the provider budget was bypassed.

### Impact

If the base or effective Native directory becomes unavailable or inconsistent while the stored header, registry identity, and existing history prefixes remain unchanged, the current cleanup proof can still be labeled successful and guard disposal can proceed without satisfying the requested valid-base condition. The report also fails to reject explicit negative cleanup proof.

### Required closure

- Revalidate only the exact owned actor/base and workspace using canonical filesystem facts and the actual current effective Native directory, before the relevant archive/disposal decision. Do not substitute the original header for a missing/current-invalid directory.
- Do not resolve or resume a cold actor merely to read cleanup state. Use the authorized read-only public/cached/projection surface; uncertainty must fail closed.
- Do not repair the condition by recreating paths, changing roots, broadening policy, changing presets, or silently falling back to another directory.
- Require verified workspaceRetained and baseRetained values in both guard-disposal readiness and the final success predicate. Unknown cleanup must retain containment guards and produce a failed report, not a false pass.
- Add negative tests for missing/wrong base, canonical/symlink changes, workspace drift, and formatter inputs where either retained flag is false. Assert no successful report and no guard disposal on uncertain proof.
- Re-run the local suite and obtain a new independent frozen-source closure review before Parent FULLREADY. This review does not approve the unreviewed fix.

No other concrete material finding was established in this review. In particular, this finding does not assert that tool guards, the two-admission cap, or terminal retry suppression failed.

## Positive source observations

- The target is fixed to the known historical run and owned actor constants. Historical receipt validation keeps the original failed G4 outcome separate from the prospective complement and requires the prior rich-flow/deletion/archive facts.
- Explicit owner/model/fixture authorization plus the two additional resumption/unarchive consents precede capability acquisition. Unknown identity, pending state, lineage, workspace membership, and source ambiguity fail closed in the inspected paths.
- Tool admission is restricted to the one exact builtin question payload on the owned actor. Unrelated actors pass through the temporary hooks rather than receiving test restrictions.
- Provider front guards are installed before unarchive/resolve, reinserted after resolve, and de-duplicate the same payload across the two hook layers. The local tests exercise the actual public Cordis/Agent dispatcher and show the third synthetic admission denied before the provider callback. Owned request errors terminate retry handling without calling the downstream retry callback.
- The fresh-client flow uses an owned page/source-generation lease and one-shot reload proof rather than falling back to an arbitrary existing Client. Source preflight occurs before arming the additional prompt.
- HTTP/WebSocket fences restrict the browser to the known GUI and exact Inspector ingest destination while preserving allowed opaque transport protocols.
- The native-question selector uses a page-relative inner locator for the question heading, beneath the scoped native conversation root, and rejects ambiguous panels. The composer path validates the exact session root and normal actionability and does not retry an uncertain actual Send click.
- Canonical result collection checks an actual builtin call/result, the answer, two assistant attempts, and a post-answer assistant acknowledgement via the public derivation surface. Exported evidence is sanitized; it is not a transcript or credential dump.
- The complement report is exclusively created at its fixed new path and does not overwrite the earlier failed report. Cleanup uncertainty already has a containment-retention branch; QA-NATIVE-ASK-01 concerns the missing retained-base proof feeding that branch.

These are source and synthetic-test observations, not a live capability or billing guarantee.

## Local verification performed

Using the bundled Node/pnpm environment, the reviewer ran only:

~~~sh
node --check scripts/verify-native-ask.mjs
node --check scripts/verify-native-questions.mjs
pnpm exec vitest run tests/question-uat-helper/verify-native-questions.test.ts tests/question-uat-helper/verify-native-ask.test.ts
~~~

Result: **126/126 tests passed**: 101 common-helper tests and 25 target-runner tests. Syntax checks passed. The separate synthetic formatter reproduction above demonstrated the uncovered negative case.

No live or authenticated browser was opened. No Inspector/host/probe connection, current board snapshot, private user-state query, Native/model request, fixture unarchive, policy/preset change, or cleanup operation was performed. The optional offline Playwright locator script was inspected but not executed in this review. No existing evidence artifact was modified or presented as newly passed.

## Reviewed pre-fix fingerprints

The fingerprints below were collected while the pre-fix literal cleanup/report predicates were still present. Line links can move when the author corrects the files; these hashes identify this review's source revision, not a later correction.

| Source | SHA-256 |
|---|---|
| [Target runner](<../scripts/verify-native-ask.mjs>) | 63ce400652b4d9efb02b4276103f878ad55001bbe634497cf79201a850c1ef8d |
| [Common helper](<../scripts/verify-native-questions.mjs>) | e00d0935ecfe0fde644598547f5af0a7ee7234f5c94163c793b2cd594740e787 |
| [Target tests](<../tests/question-uat-helper/verify-native-ask.test.ts>) | 164c2db83d1d0eb192d82a2ebe069f437039ce6d2cf64064a6a523bb6fa3cf79 |
| [Common tests](<../tests/question-uat-helper/verify-native-questions.test.ts>) | 1fe32aafd1c175bfc6bf0fab8e7367db7097a73edc20ddb16f859af6e34e1e31 |

## Boundary of this review

This document reviews the helper's safety and evidence predicates only. It is not a revalidation of all product CR01–CR08 fixes, an approval of the eventual Native run, or a replacement for its canonical runtime evidence. The original failed run remains failed. A later successful complement must identify itself as a complement and preserve that historical result.


## Scoped closure review — final frozen correction

### Decision and revision boundary

**Closed:** QA-NATIVE-ASK-01. This conclusion applies only to the exact frozen source fingerprints below. They matched the author's handoff before inspection and were checked again after the independent local verification. No production/helper/test source was edited by this reviewer.

| Source | Independently verified SHA-256 |
|---|---|
| [Corrected target runner](<../scripts/verify-native-ask.mjs>) | 20d71dba0acabd4aba63782c1743f9a726226e915dd1c5d6e5f6c2f43f4e925d |
| [Corrected target tests](<../tests/question-uat-helper/verify-native-ask.test.ts>) | 0129c8c63d49a65fa57faf7da79721683990702825a1f996abd5bb234c910c67 |
| [Unchanged common helper](<../scripts/verify-native-questions.mjs>) | e00d0935ecfe0fde644598547f5af0a7ee7234f5c94163c793b2cd594740e787 |
| [Unchanged common tests](<../tests/question-uat-helper/verify-native-questions.test.ts>) | 1fe32aafd1c175bfc6bf0fab8e7367db7097a73edc20ddb16f859af6e34e1e31 |

### Actual corrected source checked

1. [Same-Host physical ownership proof:37–43](<../scripts/verify-native-ask.mjs#L37-L43>) uses Host-side Node filesystem metadata in the real serialized path. It checks the exact run directory, base, Git directory, and evidence directory with lstat, realpath, and directory stat. Missing paths, symbolic links, non-directories, or noncanonical results fail; it never recreates or repairs a path.
2. [Current Native cwd proof:40](<../scripts/verify-native-ask.mjs#L40>) requires an explicit committed string projection before consulting the public getter for a cached Session. The getter must match that projection and the exact owned base. For a cold Session, it reads only the exact owned actor's public projections with an AbortSignal timeout and accepts only an exact sequenced string. It does not resolve an Agent merely to inspect cwd, accept migration/cached uncertainty, use a header/default substitution, or invoke ensure/recovery.
3. [Repeated ownership proof:42](<../scripts/verify-native-ask.mjs#L42>) combines fresh physical/current-cwd facts with the exact initial workspace identity and membership. It repeats reads to detect changes across asynchronous metadata validation. The code explicitly does not pretend that this is an atomic filesystem lease.
4. [Cleanup:69](<../scripts/verify-native-ask.mjs#L69>) disarms admission and stops only the known owned actor if necessary. It requires the fresh proof near archive and again after archive, and returns positive facts only after archived, idle, and unchanged-prefix checks succeed.
5. [Asynchronous independent disposal:71](<../scripts/verify-native-ask.mjs#L71>) does not trust prior cleanup booleans alone. It independently rechecks stopped/archived/prefix state, repeats physical/cwd/workspace proof, rechecks terminal state, and only then releases the registered guards. Uncertain proof throws before guard release.
6. [Orchestrator:103](<../scripts/verify-native-ask.mjs#L103>) requires baseRetained, workspaceRetained, and currentCwdMatches along with archived/idle/prefix facts before disposal. It verifies the actual disposal result and retains/fails containment on uncertainty.
7. [Final report:80](<../scripts/verify-native-ask.mjs#L80>) now requires attempted cleanup, all retained-base/workspace/current-cwd facts, confirmed disposal, no retained guards, closed resources, and the existing exact tool/provider/canonical evidence. False or missing cleanup facts cannot be converted into a successful report.

The provider admission, terminal owned retry suppression, exact one-question tool guard, fixed actor identity, and separate complement evidence rules remained in scope. The source review found no new material regression in those paths, and their existing synthetic guard tests still passed.

### Pinned public contract checked without Host execution

The reviewer independently read the pinned [working-directory registration](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L30-L35>) and [getter/recovery implementation](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-working-directory/lib/index.js#L76-L101>). The initial projection records the header's cwd; subsequent cwd events update it. The public getter can use a deployment default if the projection is absent, and ensure can recover a missing directory. The correction avoids both behaviors by demanding the explicit string projection and never calling ensure.

The pinned [public cold projection reader](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L3281-L3318>) requires a cancellation signal, returns an exact sequenced observation or a separate migration-required result, and does not resolve an Agent in the inspected read path. The correction supplies the signal and rejects the uncertain/migration branch. These were source-file reads, not calls to either runtime service.

### Independent local results

- Syntax checks passed for the [target runner](<../scripts/verify-native-ask.mjs>) and [common helper](<../scripts/verify-native-questions.mjs>).
- **154/154 local synthetic tests passed:** 101 [common tests](<../tests/question-uat-helper/verify-native-questions.test.ts>) and 53 [target tests](<../tests/question-uat-helper/verify-native-ask.test.ts>).
- Strict scoped TypeScript passed for those two test modules with the project's ES2022 target and ES2023/DOM/Decorators libraries.
- The added [negative cleanup/disposal tests:73–103](<../tests/question-uat-helper/verify-native-ask.test.ts#L73-L103>) cover missing, symlinked, noncanonical and non-directory bases; runtime/projection divergence; missing or migration-required cold state; bounded cold reads; workspace removal/membership drift; changes during asynchronous proof; and drift after archive. They assert failure without archive/disposal as appropriate and retained containment.
- Negative formatter tests reject false or missing retained/current-cwd/disposal facts. Negative orchestrator tests assert disposal is not called when any required cleanup proof is false.
- The original formatter failure was independently replayed with otherwise-valid synthetic proof. The corrected output was:

~~~json
{"allProofsValid":true,"baseRetainedFalse":false,"workspaceRetainedFalse":false,"currentCwdMatchesFalse":false,"missingBase":false}
~~~

### Effect and authorization boundary

The reviewer made no Host/Inspector connection, authenticated request, browser action, current board/private-user-state query, Native/model call, fixture unarchive/archive/cancel, policy/preset change, or real fixture cleanup. Public SDK implementations were read as files; runtime behavior was exercised only by local synthetic fixtures. The optional offline Playwright script was not run.

This closes the scoped source finding; it does not turn the old failed G4 run into a pass and does not claim that the prospective Native complement has executed. Parent may use this closure in its own FULLREADY decision, but any subsequent target execution remains subject to the separately authorized exact actor/prompt, two-admission budget, containment, cleanup, and new complement-artifact requirements. Any source change after these hashes requires an appropriately scoped re-review.


## v2 independent review — QA-NATIVE-ASK-02 open at the original v2 revision (historical)

### Frozen scope and evidence

The author supplied the following v2 revision. Both target hashes matched before review and remained unchanged after the local checks and reproductions. The common-helper fingerprints remained unchanged from the preceding review.

| Source | Independently verified SHA-256 |
|---|---|
| [v2 target runner](<../scripts/verify-native-ask.mjs>) | c5994d10054518313b3ea3e4680f02ec950e92a637ca12d9ff3f0527ef8f6b39 |
| [v2 target tests](<../tests/question-uat-helper/verify-native-ask.test.ts>) | 57590e54d3c064f1ae31a32caa87fd8940d6a58ed558adb82d269540329903fe |

Independent local result: **178/178 tests passed**: 101 common and 77 target tests. Syntax and strict scoped TypeScript also passed. This does not supersede the new counterexample below or authorize Native execution.

### Finding QA-NATIVE-ASK-02 — P2: A contradictory prior receipt is accepted as zero work

The [prior-attempt validator:22](<../scripts/verify-native-ask.mjs#L22>) requires zero summary prompt/provider/ask admissions, the fixed actors/run, guard-stage failure, and no attempted cleanup. It does not reject contradictory positive canonical work or a positive cancellation count. The [loader:23](<../scripts/verify-native-ask.mjs#L23>) then labels the existing artifact zero-work-receipt and permits v2 preflight to continue.

A direct, in-memory reproduction used the formatter's otherwise accepted zero-work shape. The same result was reproduced after removing v2-only metadata to match the legacy v1 shape. Each mutation below was applied separately while leaving the validator's required summary fields at zero:

- canonical.humanPromptCount = 1;
- canonical.providerAttemptCount = 2;
- providerStats.cancelCount = 1.

Actual output:

~~~json
{"legacyBaselineAccepted":true,"contradictoryFactsAccepted":{"canonicalHuman":true,"canonicalProvider":true,"cancel":true}}
~~~

The [existing receipt negatives:124](<../tests/question-uat-helper/verify-native-ask.test.ts#L124>) mutate the already-checked summary fields and do not cover these contradictions. The passing 178-test suite therefore does not establish the requested reject-any-non-zero/unknown prior-work condition.

**Impact boundary:** this is fail-closed parsing and evidence integrity, not evidence that any real artifact contained these values or that the live two-admission cap was bypassed. Initial canonical actor/history validation remains a separate defense. The reviewer did not inspect a live v1 artifact or query current user/fixture state; the parent supplied the historical observation that the v1 file was absent. That observation must not become a fabricated zero-work receipt.

### Parent-selected correction and closure requirements

The parent acknowledged this finding and selected the simpler, stricter disposition rather than adding more receipt-schema combinations:

1. v2 must require actual absence of the fixed v1 artifact. **Any v1 presence**—valid-looking, contradictory, unknown, or symlinked—must refuse preflight before target effects.
2. Remove the acceptance/parser path and zero-work-receipt classification. Preserve the old original G4 artifact and any appearing v1 artifact; never delete, repair, or overwrite them to make the precondition true.
3. Keep truthful absence provenance and fixed, exclusive-create v2 output. No arbitrary actor/path/version override is authorized.
4. Where practical, refresh the absence check near owned unarchive/arm admission. This is best-effort repeated validation, not an atomic filesystem lease or a reason to weaken the existing containment/cleanup rules.
5. Add regression proof that any present v1 shape refuses before the relevant capabilities/effects, and that the absent case records absence rather than an invented receipt. Preserve the existing retained-base/current-cwd/workspace proof, provider/tool caps, failure-artifact privacy, and unknown-cleanup guard retention.
6. Supply a new frozen revision for independent source/test re-review. QA-NATIVE-ASK-02 remains open until that proof is reviewed; the current hashes are not approved as v2 source-ready.

### Other v2 source observations

- The [workspace predicate:37](<../scripts/verify-native-ask.mjs#L37>) now accepts valid opaque additional members without treating them as owned actors. It still requires the exact workspace ID/path/title, C membership, valid unique Native IDs, and preserves the whole ordered membership.
- The [private digests:56](<../scripts/verify-native-ask.mjs#L56>) and [prefix checks:65](<../scripts/verify-native-ask.mjs#L65>) retain both the full workspace and non-C membership baseline. Source operations inspect only C/A and resolve/unarchive/archive/control only C. The [opaque-member tests:129–134](<../tests/question-uat-helper/verify-native-ask.test.ts#L129-L134>) verify extra-member preservation, no extra-actor inspection/control, and refusal of invalid, duplicate, removed-C, or changed/reordered membership.
- The [serialized installer:26–86](<../scripts/verify-native-ask.mjs#L26-L86>) uses explicit Node builtin hashing and self-contained declarations. The [isolated VM tests:108–115](<../tests/question-uat-helper/verify-native-ask.test.ts#L108-L115>) execute the serialized function without ambient WebCrypto/TextEncoder, validate enum-only diagnostics, and exercise partial-hook rollback and unknown by-reference transport retention. This is independently tested hardening, not a claim that ambient crypto caused the historical v1 refusal; the parent identified the earlier exclusive-membership predicate as that observed cause.
- [Failure publication:121–122](<../scripts/verify-native-ask.mjs#L121-L122>) now writes sanitized, exclusive v2 evidence when fixture validation succeeded even if controller construction returns no controller. Unknown installation retention is marked failed rather than called a clean guard exit. [Targeted tests:125–126](<../tests/question-uat-helper/verify-native-ask.test.ts#L125-L126>) cover those paths with fake dependencies, not a real browser or host.
- The previously closed physical-base/current-cwd/workspace cleanup and independent disposal checks remain in the inspected source. The exact tool guard, two-admission guard, terminal owned request-error path, existing UI/source lease, and privacy boundaries were not replaced by the opaque-member disposition.

No other material finding was established in this v2 source review. Only this review document was edited. No source/helper/test edits, Host/Inspector calls, live state reads, authentication, browser actions, Native/model calls, or real fixture mutations were made by the reviewer. The parent FULLREADY decision remains pending the selected correction and its frozen closure review.


## QA-NATIVE-ASK-02 closure — absence-only frozen v2

### Decision and fingerprints

**Closed:** QA-NATIVE-ASK-02. The vulnerable receipt-adoption branch was removed rather than extended. The original finding and its c5994d10 source fingerprint remain recorded above; the following distinct revision was independently reviewed and fingerprinted before and after verification.

| Source | Independently verified SHA-256 |
|---|---|
| [Final absence-only runner](<../scripts/verify-native-ask.mjs>) | b05df5ffd4b478408caf1c49fae9ef9b91df5c09fd487e42b4cef374e6ddf94c |
| [Final target tests](<../tests/question-uat-helper/verify-native-ask.test.ts>) | b46cba44c6344281b425bd2bdc7c2797bdf46886560ffe77c5379565bc5ceb42 |
| [Unchanged common helper](<../scripts/verify-native-questions.mjs>) | e00d0935ecfe0fde644598547f5af0a7ee7234f5c94163c793b2cd594740e787 |
| [Unchanged common tests](<../tests/question-uat-helper/verify-native-questions.test.ts>) | 1fe32aafd1c175bfc6bf0fab8e7367db7097a73edc20ddb16f859af6e34e1e31 |

### Corrected source and regression proof

- The [loader:22](<../scripts/verify-native-ask.mjs#L22>) now accepts the predecessor only by its absence: only ENOENT from lstat permits continuation. Any entry causes refusal. It reads neither predecessor content nor a predecessor hash and no longer calls or exports a zero-work receipt parser. The exclusive fixed v2 output and immutable original G4 path remain separate.
- [Same-Host metadata:42–43](<../scripts/verify-native-ask.mjs#L42-L43>) checks the fixed predecessor path again before guard registration. [Unarchive:71](<../scripts/verify-native-ask.mjs#L71>) and [arm:73](<../scripts/verify-native-ask.mjs#L73>) repeat that absence check immediately after fresh base/current-cwd/workspace proof and before the corresponding admission. These are repeated best-effort checks, not an atomic filesystem lease.
- [Cleanup:75](<../scripts/verify-native-ask.mjs#L75>) and [disposal:77](<../scripts/verify-native-ask.mjs#L77>) keep their independent ownership/physical/current-cwd/prefix/idle proof. They do not parse or adopt an appearing predecessor and do not make its absence a prerequisite for safely stopping/rearchiving the exact already-owned valid actor after a later appearance.
- [Final evidence:96](<../scripts/verify-native-ask.mjs#L96>) requires absence provenance for success. The old receipt label is not accepted or exported. False base/workspace/current-cwd facts and unknown predecessor provenance still fail the success predicate.
- The [new presence tests:124–130](<../tests/question-uat-helper/verify-native-ask.test.ts#L124-L130>) refuse valid-looking, contradictory, incomplete, symlinked, directory and dangling-symlink predecessors before dependency/browser/host/auth/model adapters. They assert no predecessor-content reads. They also cover appearance before initial guard registration, before unarchive, and before arm, including safe subsequent cleanup of only the owned actor.
- The [mandatory mode-flag tests:122](<../tests/question-uat-helper/verify-native-ask.test.ts#L122>) retain explicit complement-v2 consent and reject arbitrary attempt/path/actor options.

An independent fake-filesystem replay confirmed that all predecessor-presence cases corresponding to the original human/provider/cancel contradictions are refused with zero predecessor-content reads. It also confirmed the removed parser export, truthful absence provenance, absence of a predecessor hash, acceptance of the explicit v2 flag, and rejection when it is missing.

An additional pure formatter replay returned:

~~~json
{"absenceWithAllProofs":true,"legacyReceiptLabel":false,"unknownPredecessor":false,"baseRetainedFalse":false,"workspaceRetainedFalse":false,"currentCwdMatchesFalse":false}
~~~

### Independent local verification

**185/185 local tests passed:** 101 common-helper tests and 84 target tests. Both helper syntax checks and strict scoped TypeScript passed. Target hashes remained unchanged after the checks. Existing retained-base/current-cwd/workspace tests, opaque ordered-roster preservation, isolated serialized Node-builtin hashing, enum-only diagnostics, failure-artifact behavior, actual Cordis two-admission cap, terminal owned retry suppression, and exact one-question guard remained covered and passed.

No new material source finding was established. The reviewer edited only this review document. All review and regression checks used source files or synthetic fixtures; no actual predecessor/board/private-user-state read, Host/Inspector connection, authentication, browser action, Native/model call, or real fixture mutation was performed during closure verification.

This closes the scoped source blocker to Parent's readiness decision only. It neither changes the original G4 outcome nor asserts a live v2 result. Parent's later conditional permission is restricted to one exact invocation, the fixed owned actor and prompt, at most two provider admissions, the existing containment/cleanup rules, and a new exclusive complement artifact. A failed invocation must not be repaired or retried under this closure. Any later runtime outcome must be reported as a separate complement, never a rewrite of the old failed run.


## Separately authorized single v2 execution — completed successfully

After the independent absence-only closure above, Parent explicitly authorized one invocation of the exact frozen runner, with the fixed actors, one additional human prompt, at most two provider admissions, one exact builtin question, and no retry or manual repair. The frozen target/test fingerprints were rechecked immediately before launch and matched.

The executor announced before launch and started managed job bash-d252023cac344fc2 with the authorized command:

~~~sh
node scripts/verify-native-ask.mjs --allow-owner-test --allow-fixture-data --allow-model-requests --resume-owned-fixture --allow-fixture-unarchive --complement-v2 --model-timeout-ms 90000
~~~

Managed job bash-d252023cac344fc2 was collected after completion with **exit 0**. The [exclusive v2 evidence artifact](<../.verification/native-fixtures/g4/run-1140aaffeaac/evidence/native-ask-complement-v2.json>) was read and checked against the successful sanitized result. The result is **ok:true, stage:evidence**, all 20 required checks true, complement attempt 2, and predecessor provenance ABSENT.

| Actual collected evidence | Result |
|---|---|
| Additional normal human prompts | 1; six historical prompts remain separate, combined total 7 |
| Provider admissions / attempts / canonical assistant attempts | 2 / 2 / 2 |
| Exact builtin ask admissions / canonical tool calls | 1 / 1 |
| Provider rejected attempts / failures / tool denials / cancellations | 0 / 0 / 0 / 0 |
| Native UI panel / radio / submit counts | 1 / 1 / 1; normal radio and Submit clicks recorded |
| Native result matched and succeeded / answer confirmed / post-answer ACK | All true |
| Owned source reload generation/document proof and WebSocket fence | Passed |
| Same C rearchived and idle / history prefixes unchanged | All true |
| Workspace / base / current Native cwd retained | All true |
| Guards disposed / guards retained / resources closed / cleanup failed | true / false / true / false |

The source and target-test hashes remained b05df5ffd4b478408caf1c49fae9ef9b91df5c09fd487e42b4cef374e6ddf94c and b46cba44c6344281b425bd2bdc7c2797bdf46886560ffe77c5379565bc5ceb42 after execution. The SHA-256 of the [original G4 evidence](<../.verification/native-fixtures/g4/run-1140aaffeaac/evidence/g4.json>) remained 9c9bbbfefc9f02e0c8ca7289e97495f3cea343f531744dfa544681efac66dc93, matching the complement's captured priorReportHash.

No second invocation, manual repair, extra Host/browser probe, or additional Native/model request was performed. The process exited and the artifact reports all owned resources closed and temporary guards disposed after successful cleanup. The exact authorized execution slot is consumed and complete. This is a successful separate Native builtin complement, **not a retrospective whole-G4 pass**: priorRunOverallOk remains false, and the original failed artifact was not rewritten.
