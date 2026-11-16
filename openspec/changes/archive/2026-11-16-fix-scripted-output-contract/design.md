# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- The plugin runs inside a host it does not control and reads one host service (`ptcRuntime`). Its compiled JavaScript is what executes; the host provides whatever result shape its build publishes.
- The plugin compiles against a locked released SDK graph (`0.2.2-rc.1`) whose `PtcRunResult` still carries `logs: string[]`. The running host build publishes `output: PtcOutput[]` instead and no longer publishes `logs`. No published SDK version carries the newer type, so the newer type cannot be imported: importing it fails the typecheck against the locked graph.
- `engines.dsh` declares `>=0.2.2-rc.1 <0.3.0-0`, which admits every released host build and the running one equally. The version string cannot distinguish a release from a build that is hundreds of commits ahead of it, so the declared range must stay truthful by behavior, not by number.
- Two suites under `vitest run` instantiate the real `@deepseek-ai/dsh-ptc-runtime-node` from devDependencies, so they exercise the released contract, not the running one.
- Precedent in this repository for a host contract that moved: `src/client/session-status.ts` defines a plugin-owned port that accepts every host vintage it can recognize and degrades to an empty table otherwise. This change follows the same shape on the host side, with the difference that an unrecognized vintage is reported instead of silently ignored.

Current seam (`src/host/scripted`):

```
runtime.run(spec) ──► host result ──► executor.ts (execution)  ──► diagnostics
                                  └──► index.ts   (isolated test) ──► test result
ports.ts: NativePtcPort = Pick<PtcRuntime, …>   (host SDK types the result)
```

## Goals / Non-Goals

**Goals**

- A program that returns settles as completed on every host the declared range supports.
- One seam owns the program-output contract for both the execution and the isolated test path.
- An unreadable or unknown host contract is diagnosed truthfully, stays in place, and never masquerades as a provider failure.
- Every settled failure message names an owner and tells the reader to escalate when the work cannot fix it.
- The packaged plugin builds from the locked, reproducible dependency graph with no new dependency and no git pin.

**Non-Goals**

- Raising the SDK pin or `engines.dsh`; that is the recorded follow-up, and it is what retires the earlier-contract branch.
- A pre-flight probe of the host contract; the refusal happens when a result is read.
- Persisting a completed execution's diagnostics (still unused downstream).
- Changing how an unmapped exit is classified or routed.
- Editing a board, adding a playbook, or changing the client surface.

## Decisions

### D1. A plugin-owned result type and one reader module

`src/host/scripted/runtime-result.ts` declares `NativePtcOutput` (`{ type: 'text'; text }` or `{ type: 'image'; attachment }`), `NativePtcRunResult` (`value?`, `error?`, `output?`, `logs?`) and `programOutput(result)`, which returns the bounded text plus image markers or raises the named refusal. `NativePtcPort` keeps the host `Pick` for everything except `run`, whose result becomes `NativePtcRunResult`; `ports.ts` re-exports it so existing imports keep working.

Both shapes are optional, so the module compiles against the locked released SDK and accepts the newer result structurally at runtime. This is the only way to have one typed seam today: the newer type does not exist in the graph the plugin builds against.

*Alternatives considered*: importing `PtcOutput` and pinning devDependencies to a git commit of the host monorepo (the install would build host packages, need repository credentials on every machine, and turn the compatibility test into a proof of a private commit); keeping `Pick<PtcRuntime, …>` and casting at the read site (hides the contract in a cast instead of one typed seam).

### D2. Two contracts, ordered entries preferred

The reader prefers `output` when it is an array, otherwise accepts `logs` when it is an array. The join differs by contract on purpose: ordered entries are fragments that retain their own line breaks, so they are concatenated with no separator; the earlier list was one string per call, so it keeps one line per entry. An inspected image becomes one marker appended after the text with a count, not an inline position marker: the plugin never surfaced older `images[]` entries with their `afterLog` positions either, so inline placement would add fidelity the product does not use.

*Alternatives considered*: ordered entries only (breaks the promise `engines.dsh` makes and would refuse the released hosts it declares, while the floor cannot be raised today); reading the older `images[]` list for parity (no behavior existed before, so there is no regression to preserve); inline image markers (more faithful, more text for a surface that only carries diagnostics).

### D3. The refusal code and its origin

A host that publishes neither contract, or whose entries cannot be read, raises `TYPESCRIPT_RESULT_UNSUPPORTED` with origin `configuration`, a message naming the shape and entry types observed, and no destination. Being `configuration`, it inherits the existing rule that such failures never follow `error` or `infrastructure`, which is exactly the behavior the incident needed: the entry stays with Play.

*Alternatives considered*: `infrastructure` (routes the card to a fix stage with nothing to fix); `EXECUTOR_FAILED` with a better sentence (keeps an unclassified exception on the same path that produced the incident); treating an unreadable entry as an empty output (silently loses the program's text).

### D4. The reader never lets a raw exception escape

`programOutput` converts any failure it raises while inspecting the result into the same named refusal, carrying the observed shape and entry types as detail. `verifyProgramRuntime` is unchanged: no probe runs before execution.

*Alternatives considered*: a probe inside `verifyProgramRuntime` (one extra trivial execution on every verify and every isolated test, to discover a condition the refusal already reports); a plugin-wide policy for untyped exceptions (would replace the controlled provider sentences that the destination stage relies on).

### D5. One-time reports through the existing channel

The runtime instance keeps an in-memory flag per observed contract vintage. The first execution on a host that publishes only the earlier list reports, through the existing supervisor report channel, that the contract in use is the earlier one and that its support ends with the floor. The first refusal of an unknown contract reports the observed shape. A restart may report once more; that is accepted, and it keeps the change free of persisted host state.

*Alternatives considered*: persisting the flag per host build (new durable state for a diagnostic that only needs to appear once per process); no report (the incident would again be discoverable only from a card).

### D6. Message ownership and escalation

`failureMessage` keeps composing one bounded sentence per origin and gains an owner. `script` and `contract` failures keep the program's words and add that the user must correct the program and that the reader must escalate. `infrastructure` failures say the defect belongs to the DeepSeek Harness or the Kanban plugin, that it is not a problem with the work, and that it must be escalated. The new code keeps the reader's product-owned sentence, which already names the observed shape, so the provider-message map is bypassed for it instead of replacing that text; its own configuration suffix names the host build rather than offering the generic repair. Other `configuration` failures keep repair-and-Play.

A parameter refusal additionally names the step that owed the value, derived from the latest stage-history row for the entry: `agent`, `auto`, `script:<exit>`, or `manual`. When that row is absent (records written before origins were stored) the message keeps the existing generic repair text.

*Alternatives considered*: adding an origin field to `TaskStageEntry` (a schema change for a fact the history already records); reading the origin from the entry (not stored there); one generic sentence for every origin (loses who can act).

### D7. The undeclared parameter becomes a write-validation observation

The workflow warning assembler that already derives `destination-parameter-unmentioned` from authored text gains a sibling: a TypeScript scripted stage whose captured program reads a parameter its declaration does not list, detected from a direct `params.<name>` read and from a simple destructuring of the input parameters. It is an observation, stays out of routing defects, and publishing remains allowed. A Bash body and a computed accessor are outside the observation, which the function's own limitations state.

*Alternatives considered*: instrumenting the runtime so an undeclared read throws (changes program semantics for scripts that probe for `undefined`); an editor-only hint (misses scripts written outside the editor); no detection (the silent `undefined` that motivated the decision).

### D8. Tests that can run today

The reader gets a pure unit test (ordered text, earlier list, image marker, bound, unreadable shape, refusal detail). Host fixtures move to the ordered shape, except `tests/host/scripted-test-execution.test.ts`, which deliberately keeps an earlier-contract fake so the isolated test path exercises that branch too. The suites that run the released SDK keep proving the earlier contract on the same code path a released host uses, so nothing is skipped by default. A separate lane gated on `DSH_CHECKOUT` resolves the whole provider graph from an installed checkout, the way `scripts/e2e-dsh.mjs --checkout` already does, and proves the ordered contract end to end: a real program that logs and returns settles completed with its text, the one-time earlier-contract report does not fire, and the isolated test path reports the same output. Without a checkout the lane skips with an explicit message.

*Alternatives considered*: converting the released-SDK suites to require a checkout (their premise — that the released graph cannot exercise the ordered branch — disappeared once the reader accepts both contracts, and it would leave CI without real-runtime proof of the earlier branch); git-pinned devDependencies (see D1); a test-only shim translating `logs` into `output` (the shape reaching the reader would be synthetic, so line-break, image, and preference semantics would not be exercised).

## Risks / Trade-offs

- The earlier-contract branch can outlive its purpose → the removal is a task tied to the floor bump, the branch has its own unit test, and the host reports the vintage in use.
- Heuristic detection for an undeclared parameter can miss dynamic access → the observation is worded as an observation, never a routing defect, and publishing still succeeds.
- Debtor attribution needs a history row that older records may lack → the message falls back to the existing repair text instead of guessing.
- A restart may repeat the one-time report → accepted; it is a diagnostic, not state.
- Until a published release carries the ordered contract, the ordered branch is proven against a developer's checkout only → the `DSH_CHECKOUT` lane states the requirement, and the follow-up that raises the pin also makes the released graph publish ordered output, so the lane's gate can go.
- Reading the result still happens after the program returns, so a future host change can fail the same way → this time it fails with named evidence and no destination instead of an unclassified exception.

## Migration Plan

- No durable data changes: cards, entries, history, captures, and workflow documents are untouched.
- A host that publishes the earlier list keeps working and reports the contract once; a host that publishes ordered entries uses them; a host that publishes neither stops in its stage with a named diagnosis.
- Rollback is a plugin version rollback; nothing in the host or the workflow document changed.
- The packaged version moves to `0.36.5`, and the compatibility test's version assertion moves with it. The SDK pin and `engines.dsh` stay as they are.

## Open Questions

None that change the specs, the approach, or the task breakdown. Whether the earlier-contract report should later become a visible compatibility indicator in the plugin settings is deferred until a release makes the floor expressible.
