# Independent Lifecycle Bridge Safety Review

Date: **October 22, 2026**. Scope: [isolated bridge](<../scripts/coordination-lifecycle-bridge.mjs>) and [same-Host VM tests](<../tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts>), using the already reviewed frozen [transaction module](<../scripts/native-coordination-lifecycle.mjs>). No main runner integration is in scope.

## Result

**No reproducible blocking defect was found in the initial bridge review or the later prepared-gate-only close review under their stated construction, exclusive-group/window and external-lifetime assumptions.** The latest narrow close path was independently verified with 58 VM tests, syntax, both TypeScript Programs and matching frozen hashes. No new open bridge finding was established.

This is **not** integration or live lifecycle approval. The main coordination lifecycle quarantine remains unchanged. A bridge or transaction-window receipt still says nativeJournalGate:not-verified; actual same-ID/history/cwd/journal reconstruction after ON is mandatory future evidence. The parent must separately review the independent controller factory, all runner routing and ownership validation, cleanup/reference lifetime, and any integration before Native effects.

Only this new report was written by the reviewer. No bridge/module/test/product/integration source, Core property, profile, server, auth, browser, actual Native job/turn/model, policy, lifecycle, board or fixture-data operation was changed or invoked. Exact public source was read; no Host connection or probe was made.

The original 37-test overview below describes the previously reviewed full-lifecycle path. Some original line anchors shifted when the gate-only close was added; its current authoritative source/test references are recorded in the dedicated section below. It is not an alternative Native-resource disposal path.

## Independently inspected construction and routing

- [Connection/group/reference binding](<../scripts/coordination-lifecycle-bridge.mjs#L64-L85>) keeps Node references in private WeakMaps, requires the same connection/socket/object group, and checks the independent controller's same-root brand and required interface. Plain JSON/Node callback substitutes and wrong-root references are rejected. This is a **construction guard, not universal realm attestation**; the caller already owns the underlying Inspector connection and must honestly preserve the reviewed reference/lifetime protocol.
- [Public DOM/Runtime preparation](<../scripts/coordination-lifecycle-bridge.mjs#L266-L290>) locates one Host context, resolves it in the existing group, normalizes the same actual root and serializes the real gate factory there. The [existing Inspector adapter](<../scripts/dsh-inspect.mjs#L165-L191>) uses the same public semantic Host/context nodes and Runtime transport. The pinned public [reference argument codec](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/index.js#L485-L542>) supports object-handle arguments. No replacement connection/auth flow, server, private SDK import or Core service is added.
- [Outside construction and installation](<../scripts/coordination-lifecycle-bridge.mjs#L292-L303>) preserve the actual controller receiver and pass gate/controller/outside/transaction values by Host object reference, not JSON callbacks. The VM tests execute both frozen factories inside a separate realm with their module globals absent; they are not stubs returning invented transaction outcomes.
- [App invocation/recovery/ACK](<../scripts/coordination-lifecycle-bridge.mjs#L233-L252>) and [ledger admission](<../scripts/coordination-lifecycle-bridge.mjs#L305-L343>) retain opaque receipt identity and delivery tokens. A deadline on a client result/ACK does not mean the actual server command ended or can be replayed. Recovery queries the same server call; unacknowledged/uncertain receipts keep admissions closed. Native business Outcome and exact fixture ownership/creation validation must still happen in the future runner before ACK; this bridge does not replace that semantic authorization.
- [Manual leases](<../scripts/coordination-lifecycle-bridge.mjs#L345-L383>) are metadata quiescence, not Native activity evidence. A missing lease-reference result or unknown release poisons the bridge rather than pretending the lease is held or constructing another one. The manual lease must be released before the transaction takes its own lease.

## OFF/work/ON ordering and unknown outcomes

The [start-send fence](<../scripts/coordination-lifecycle-bridge.mjs#L396-L420>) closes app admission synchronously before awaiting the client transport. All real OFF/work/finally-ON work remains in the already-reviewed server transaction. The bridge exposes no client restore or reconnect method, never supplies a transport-abort signal to the server run, and does not let a delayed earlier start receipt rewind a terminal server receipt.

[Server receipt validation](<../scripts/coordination-lifecycle-bridge.mjs#L200-L230>) requires the frozen protocol shape, allowed fields/errors, transaction/bundle identity and exact scoped job set; terminal receipts are immutable except semantic JSON key order. [Restoration admission](<../scripts/coordination-lifecycle-bridge.mjs#L184-L199>) requires actual server terminal/restored applied ON, released lease, work settlement and terminal canonical wait/event job proof. A failed no-OFF cancellation does not invent an ON certificate to permit cleanup.

While OFF, [presence](<../scripts/coordination-lifecycle-bridge.mjs#L421-L430>) uses only public service existence, not a Kanban method. No invoke/recover/ACK/cleanup app call is allowed while the transaction remains unresolved. After confirmation, mutations are limited to the installed own task/session cleanup/recovery allowlist and bounded destructive targets; no new task/project/conversation or foreign cleanup mutation is admitted by that post-ON path. Public snapshots remain ordinary private owner RPC data, not Native peer-repair authority.

[Connection and protocol uncertainty](<../scripts/coordination-lifecycle-bridge.mjs#L112-L181>) permanently marks the instance UNVERIFIED. A closed/swapped socket, changed call identity, invalid object/receipt, lost reference result or unknown group release does not trigger reconnect, competing ON, new app work, speculative cleanup or guard disposal. The original server continuation can still finish after Node deadlines or reference release, but **server-process death has no in-memory-finally guarantee**.

## Disposal and external controller lifetime

[Final disposal proof](<../scripts/coordination-lifecycle-bridge.mjs#L87-L98>) is invoked on the actual independent Host controller and cannot be replaced by a Node JSON ready flag. The [full-lifecycle disposal sequence](<../scripts/coordination-lifecycle-bridge.mjs#L493-L523>) first requires all app receipts ACKed plus terminal confirmed restoration, then the public resource/base/history proof, then transaction disposal and finally group release. A false/missing proof or uncertain release retains the unsafe state and forbids more app operations.

The bridge intentionally **does not** call the independent controller's dispose or close the caller-owned connection. The external owner must tear down that controller only after safety, or retain a separately owned reference before releasing its last group reference. Its assertDisposalReady implementation must remain callable after safe teardown if that ordering is used. The test suite covers both retention and owner-initiated safe teardown, but this module cannot universally attest what an arbitrary privileged Host factory does.

Future integration must prove that assertRetained/settleOwnedWhileOff/assertDisposalReady are implemented through actual retained guards, Native owner-fenced job wait/read/resource convergence, canonical actor base cwd and history-prefix observation. A brand, callback fulfillment or a private JSON assertion alone is not that proof. Existing global unknown/corrupt-peer protections must not be bypassed for cleanup; no broader profile repair, permission fallback or manual worktree removal is authorized here.

## Narrow prepared-gate-only close review

Date: **October 22, after 06:51 local runtime time**. Scope: only the added preparedGate-only closure and tests. The transaction module is unchanged. No Stage A runner/controller integration or Native action is approved by this review.

### Eligibility and exclusion

[prepare](<../scripts/coordination-lifecycle-bridge.mjs#L291-L312>) now returns frozen metadata only, not a hidden Root handle. [Root/target access](<../scripts/coordination-lifecycle-bridge.mjs#L307-L318>) records an irreversible exposure hazard. [Gate-only eligibility](<../scripts/coordination-lifecycle-bridge.mjs#L275-L287>) refuses current or ever binding, installation, transaction start, manual lease, exposed Root/factory targets, pending preparation/request, protocol/socket uncertainty, unacknowledged or uncertain calls, and existing disposal.

Those are deliberately sticky exclusions: an attempted resource-bearing path cannot later be relabeled a harmless metadata-only close merely because it failed or a local field was cleared. The [bind/install/start/lease entries](<../scripts/coordination-lifecycle-bridge.mjs#L319-L438>) record their hazard before awaiting work. **Any independent Native controller for a gate-only Stage A must derive its own Root independently and own a different object group**; it must not be created from an exposed Bridge Root or stored in this exclusively bridge-owned group. The caller owns the underlying Inspector connection, so exclusive group ownership remains an integration precondition, not universal attestation against arbitrary privileged raw calls.

### Actual server pause/drain/seal before group release

[closePreparedGateOnly](<../scripts/coordination-lifecycle-bridge.mjs#L452-L491>) closes local admission synchronously before its first await, acquires a fresh **actual server** gate lease, and [asserts/seals both public gate/lease states](<../scripts/coordination-lifecycle-bridge.mjs#L100-L105>). It requires paused runner admission, zero actual in-flight server promises, zero unknown outcomes and all delivery receipts ACKed. It does not infer drain from Node client deadlines or an ACK-shaped fake client response.

The method then drops only its own object group/listeners, checking eligibility before and after release. It deliberately does not call snapshotBeforeOff, release/reopen the sealed lease, an independent disposal assertion, any Native manager/job/policy service, controller.dispose or connection.close. The frozen same-object completion receipt states scope=prepared-bridge-group-only, lifecycle=NOT_CREATED, nativeJournalGate=NOT_TESTED and nativeResources=NO_NATIVE_CONTROLLER_OWNED; it does not claim Native actors/resources were cleaned up.

Loss/deadline/unknown acquisition, sealing, late resource race or group release permanently marks UNVERIFIED and retainRequired rather than reporting success or retrying/reconnecting. A group may already have been released when its response is lost; retainRequired is a recovery obligation, **not** proof that an unknown release did not happen. No Native guard disposal or false completed receipt follows. An already confirmed close returns the same immutable historical receipt without reopening anything.

### External lifetime and integration boundary

This close is only for the normal prepared app gate. It does **not** prove that Native tasks/agents/jobs caused by earlier acknowledged app commands are idle or disposed. Their receipts/business ownership must be validated separately, and any independent controller/resources must remain under their external owner in the separate group. No Native-profile cleanup, peer skip or permission fallback is introduced. The existing full-lifecycle dispose continues to require its different confirmed-ON/resource/base/history proof and is not replaced by this path.

### Independent local verification

**58 tests / 1 suite passed**, exit **0**, normal Node, **244 ms**, start **06:51:01 on October 22**. Syntax and both separate host/client TypeScript no-emit checks passed, final command-chain exit **0**; verification job collected. The original 37 full-lifecycle tests are included, not added to the 58.

Independently read and executed [21 added gate-only regressions](<../tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts#L220-L290>): actual serialized factories, metadata-only preparation, Root/target exposure refusal, current/ever resource paths, Node admission races, raw server in-flight/unknown ledger unseen by the client, ACK/client-deadline handling, synthetic fake ACK, held acquisition and direct late server begin, separation from an independent controller group, same immutable receipt, no service/manager/snapshot/resource-disposal calls, uncertain group loss/release and post-close refusal. These are VM in-memory protocols, not a live Host attempt.

Verified supplied SHA-256 hashes exactly:

| File | SHA-256 |
|---|---|
| [Bridge](<../scripts/coordination-lifecycle-bridge.mjs>) | 1424f431029961db2fb9648951b287f247b9f0529b6f63e5bcd27746bc8759b7 |
| [VM tests](<../tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts>) | 0c7c2f2521a364b0ab4ad6c5e6aab22f68f320ee9e5185fae45ce267a69857db |
| [Unchanged transaction module](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

**No new concrete defect found in this narrow source correction.** Only this review document was updated. No bridge/test/module/main/product/Core/profile source edit, Host connection, auth, browser, Native job/turn/model, policy/lifecycle or fixture-data effect was made. Stage A's actual routing/controller/reference ownership still needs its own integration review; lifecycle B/C and the Native journal gate remain separate and open.

## Privacy

Public summaries expose bounded state/counters and scoped transaction/job identifiers, not app snapshot contents, raw exceptions or auth URLs. Transaction protocol fields are allowlisted and unknown private extras fail closed. App call result values are explicitly **private ordinary RPC data**; future callers must validate them without logging entire payloads. The review found no automatic auth retrieval, network connection, screenshot, trace or token output route in this isolated bridge.

## Initial 37-test bridge verification

**37 tests / 1 suite passed**, exit **0**, **240 ms**, start **05:54:33 on October 22**, normal Node. The same command chain also passed syntax checking and separate host/client TypeScript no-emit checks; final exit code **0**. All background work started for this review was collected.

```sh
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/vitest/vitest.mjs run tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts --reporter=dot
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node --check scripts/coordination-lifecycle-bridge.mjs
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/typescript/bin/tsc -p tsconfig.host.json --noEmit
/Users/filipe.esch/.nvm/versions/node/v24.21.0/bin/node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit
shasum -a 256 scripts/coordination-lifecycle-bridge.mjs tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts scripts/native-coordination-lifecycle.mjs
```

The VM suite verifies actual serialized factory execution without module globals; by-reference groups/root/receiver checks; server-promise versus client deadline; result/ACK recovery without replay; delayed OFF/finally ON; OFF presence-only access; applied-ON canonical-job cleanup restriction; cancellation; failed/unknown ON; connection/socket/protocol/group uncertainty; no implicit reconnect/restore; Native resource/read/base/prefix disposal gates; external owner lifetime; manual lease uncertainty; no callback/by-value injection; and a terminal receipt resistant to older observations. All Native services/resources in that suite are **in-memory VM models**, not live Native gate evidence.

Verified all supplied hashes exactly:

| File | SHA-256 |
|---|---|
| [Bridge](<../scripts/coordination-lifecycle-bridge.mjs>) | 65b1563c76fa74ababce9332c8a44f4682c78036a6af4ca196b037c6071bee78 |
| [VM tests](<../tests/lifecycle-bridge-helper/coordination-lifecycle-bridge.test.ts>) | 85b24d7ab27695e036165c8c76ba299c9af233f3da4ed092900b09406bcb4798 |
| [Frozen transaction dependency](<../scripts/native-coordination-lifecycle.mjs>) | e371e38f0462d15c22d68f41ea621637af46d71f68a4b4ee78497c4d3af37957 |

The dependency's LT01–LT03 source closures are documented in [its independent review](<lifecycle-transaction-review.md>); its earlier 87 tests are not added to the bridge's 37. Main runner source closures/quarantine are separately documented in [the coordination review](<coordination-runner-review.md>).

## Required next boundaries

1. Review the actual same-Host independent-controller factory and opaque-reference integration; do not stamp arbitrary objects or register a production/Core hook.
2. Route **every** future runner setup/main/preflight/post-ON/cleanup command and snapshot through the server gate and exact delivery ACK, preserving current own-fixture validation. No untracked side channel may reintroduce client-promise drain or unknown-write races.
3. Prove real resources and external controller/reference lifetime through public APIs; preserve retain-required behavior on unknown activity/transport.
4. Review post-ON same task/session IDs, canonical history prefixes, exact cwd and persisted journal recovery before claiming Native journal acceptance.
5. Preserve the exclusive operator window, human authorization and single-writer schedule; this bridge is not an atomic fence on other user clients.

**No integration READY, live execution, lifecycle unquarantine, Native journal/full acceptance, release, sync/archive or publication approval is issued by this source-only report.**
