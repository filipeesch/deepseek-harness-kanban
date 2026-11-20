# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design are the existing deletion machinery and the existing tool-module conventions.

A confirmed deletion already runs as one durable operation. The command lane validates the confirmed target and the script context, then hands the work to the worktree coordinator, which records a journaled context operation and executes it in the background on a queue with one lane per repository. The execution resolves the checkout disposition, waits for conversation idleness, returns conversations to the base project, removes the checkout, archives the native conversations while keeping their histories, and finally removes the task record. The client only ever calls the command; it never performs cleanup itself.

Product tools live in small modules under `src/host/tools/`, each exporting a factory that returns tool definitions built through the `normal` helper. Where a module needs only a slice of the application it declares a narrow port interface and the app satisfies it structurally, which is how the pause and transition tools stay independent of the board, worktree, and conversation code. Tools that write are declared non-concurrency-safe and tools that only read declare themselves safe.

Tool visibility is delegated: `PRODUCT_TOOL_NAMES` is the catalog, and a preset that declares an allowlist mounts `preset-tools`, which denies every registered product tool outside that allowlist. The planner and the manager are the only roles with an allowlist today; the workflow operator and the workflow architect carry no mask and inherit the whole product surface.

Two cascade implementations exist. The domain delete helper removes the task, its notes, and its incident relations. The background destructive execution removes the task and its notes directly inside its final transaction and leaves relations behind, while the Hub schema rejects any stored relation whose endpoint task is absent. Deleting a card that has a relation therefore fails validation in the final transaction today.


## Goals / Non-Goals

**Goals:**

- One deletion implementation: the agent path admits the same operation as the interface, with no parallel cleanup and no stronger capability.

- A tool that is thin by construction: scope resolution, a consequence read, and one command.

- One task-removal cascade in the domain, used by every path that removes a task.

- Tool visibility that follows the existing catalog and allowlist mechanism, with no new gate.


**Non-Goals:**

- Moving, restoring, or archiving a card. Deletion stays the only lifecycle action.

- Batch deletion through a tool. The board bulk selection remains the only multi-card path.

- Worktree-only removal through a tool.

- Granting discard or force consent to an agent.

- Any change to the client confirmation flow, the drawer, or the board notice.


## Decisions

### The tool is a thin adapter over the confirmed deletion command

The tool resolves the target and the scope, reads the consequences, and then issues the `task.delete` command with the confirmation flag and the binding it just read. It does not touch the worktree coordinator, the journal, the archiver, or the Hub directly.

Alternative rejected: calling the worktree coordinator from the tool. It would skip `assertDestructiveTarget`, the pending-transition cleanup, and the script-context assertion that the command lane performs before admission, so the agent path would be able to admit a deletion the interface refuses.

Alternative rejected: a separate agent-only deletion service. It would duplicate the journal, the lane ordering, the resume behavior, and the archiving contract, and the two paths would drift.


### The expected worktree target is read by the host, never supplied by the model

The command requires the confirmed worktree path, and the interface takes it from the card the confirmation displayed. The tool reads `task.worktree?.path ?? null` immediately before issuing the command, so a stale path cannot reach admission, and a model cannot point the confirmation at a different checkout.

Alternative rejected: exposing `expected_worktree_path` as a parameter. It would let a model confirm one target and delete another, and it would force a second read for a value the host already has.


### One cascade lives in the domain

The cascade is extracted into the domain as a single function that removes a task together with its notes and its incident relations, and both the existing domain delete helper and the destructive execution final transaction call it. The background path keeps its operation-identity check in the surrounding transaction, so the cascade itself stays free of journal concerns.

Alternative rejected: adding the relation filter inline where the background path removes tasks. It would leave two cascades that must be kept in step, which is the defect this change exists to fix.

Alternative rejected: making the background path call the repository delete helper. That helper opens its own transaction, and the destructive path needs its read and its write in one transaction guarded by the operation identity.


### The consequence read is composed, not reimplemented

The preview reads the checkout disposition through the existing deletion-target resolution and the local-change fact through the Git port, and it counts conversations, notes, and relations from the stored task and Hub. It performs no mutation and never decides whether the deletion may proceed; the queued preflight remains the only authority.

This keeps the preview honest: it can say the checkout will be retained for a plain folder, or that local changes will require consent later, without pretending to have taken that decision already.

Alternative rejected: reporting the preflight verdict from the tool. It would run Git work inside the interactive path, and the verdict could be stale by the time the queued operation runs.


### An unavailable consequence is reported, not fatal

Each preview fact is read defensively. A Git read that fails, or a project path that no longer resolves, produces an unavailable value rather than a failed call, because the deletion tolerates the same conditions later: it retains a checkout it cannot verify instead of failing.

Consequence: the tool result is a report, not a guarantee. The card operation remains the record of what actually happened.


### Scope is stated, not inferred from the identifier

The tool resolves the caller once and uses it for both the fallback target and the boundary. Inside a task conversation the Hub of that conversation is the boundary, and naming another Hub is refused rather than obeyed: a conversation sees one board, so a Hub parameter could only widen what it may reach. Outside a task conversation the Hub is required, so a deletion never happens through a globally resolved card identifier alone.

A card of another Hub is reported as a scope mismatch, not as a missing task, because the two situations call for different replies from the agent: one asks the user to name the right Hub, the other asks whether the card still exists.

Card listings keep their own precedence, where a named Hub owns the scope and a board identifier alone resolves across Hubs. The two rules stay distinct because they answer different questions; sharing them would make one tool inherit a rule it does not want.


### Explicit user intent is stricter than the neighbouring writes

Relations and transitions accept a stage-instruction direction or a peer message as authorization. Deletion does not, and the tool description, the planner skill, and the spec all say so. The design reason is that a stage instruction is authored once and then runs unattended many times: a permission to delete would turn a board into something that can erode itself without any person asking.

The `confirmed` flag is not a consent detector. It is the agent assertion that the user asked, paired with a description that states the rule; the same pattern the board and team-file deletion tools already use.

The flag is optional in the schema on purpose. A schema-required flag is rejected by argument validation before the tool runs, which reports a different problem than the interface reports; the product refusal is the one both surfaces owe the caller, and it is checked before the target is resolved.


### Recovery stays an interface decision

A failed deletion journal can carry `force` or `discardChanges` the person granted in the interface. The coordinator reuses that journal on a same-kind request and keeps those flags, so a second admission from any surface could remove files the second caller never authorized. The rule therefore lives in the domain, beside the existing `replaceableByDeletion` predicate: a failed destructive journal is refused, and nothing about it changes.

The predicate is applied twice. The command lane checks it before script or transition side effects, which is what a caller can reason about, and the coordinator re-checks it inside the per-task lane that would retry or replace the journal. The second check is the one that matters: a failure can land while the first caller waits for the lane, and only the lane sees the journal it is about to act on. A host-only option carries the policy; it is a separate argument to `command`, so a wire request cannot claim it.

Alternative rejected: refusing only in the tool. The window between the tool reading the journal and the coordinator using it is exactly where an interface operation fails, so a tool-level check would leave the race open.

### The receipt is captured at admission, not read later

The command returns once the journal is queued, and the repository lane may already be running; reading the card again would report a phase the call never observed, and could fail outright once the card is gone. The receipt is therefore the admission phase itself, which the journal is persisted in before the lane receives the job.

For the same reason the tool returns the card it resolved rather than re-reading it, and the contract says the tool returns without waiting for the cleanup rather than promising that the cleanup has not started. Holding the lane until the tool answered was considered and rejected: the tool result is assembled after the command returns, so the queue cannot be gated on it honestly, and an unhonest gate is worse than an accurate contract.

### Cancellation is honored at the admission boundary

The consequence read can be slow, and the deletion command itself waits for the shared command lane, for the per-task lane, and then for the repository write queue. The call cancellation therefore travels with the admission as a host-only option, beside the fresh-journal policy, and is honored at every wait: immediately before the command is issued, before the command side effects run, inside the per-task lane, inside the transaction that writes the journal, and finally in the commit hook the repository runs immediately before handing the write to storage.

The handoff to storage is the point of no return, not the completion of the commit. The pinned host storage API takes a promise and queues the backend write, so a signal cannot call it back; promising cancellation until the commit would be a promise the storage layer cannot keep. Racing the write promise against the signal would not cancel the write either, only hide it. So the contract stops exactly where the code can: once the bytes are handed over, the deletion belongs to its recovery surfaces.

Each check is the last one before a different wait, so none of them subsumes another: the read, the command lane, the coordinator lane, and the repository write queue. The transaction check is the one that matters most, because it is the only place that runs after every queue and sees the journal it is about to commit.

The same transaction also removes the card pending transition. That removal used to be a separate write before the command, which meant a cancellation could leave a card without its transition and without a journal; making it part of the journal write makes the two atomic in both directions, on the fresh-admission path and on the reconfirmation path alike.

The scripted-context preparation is skipped on a cancellable admission, because it can stop and reclaim a running execution, and a caller that may still be cancelled must not change the card before it knows the write will happen. Skipping it cannot become a bypass: read-only checks replace it.

Those checks are two authorities because either alone can be blind, and each answers only its own question. The supervisor answers for this process: an in-memory execution and the current scripted control, with no timer changes and no file reads. The filesystem reader, `NativeExecutionOwnership.assertNoTaskLease`, answers for the file: a present lease is refused and an unreadable record fails closed, both without ever reclaiming. Neither subsumes the other, and neither re-reads the other's evidence: a lease can outlive the host that wrote it, a replaced stage entry can leave a task with no current control, and the execution runtime is mounted and detached through optional provider injection. Wiring the reader into the runtime would make an absent provider a silent pass, which is exactly what a destructive operation must not do, so `createScriptedLease` builds it from the private directory alone and `src/index.ts` passes it as an app option outside the optional fiber. `attachScriptedRuntime` then refuses composition when that reader is missing, so mounting execution can never leave the reader behind.

After the journal exists the deletion is never interrupted. A half-admitted destructive operation would leave the card in a state no surface could resume, and the queue already owns an honest record of what happened.
### Visibility follows the existing allowlist mechanism

The name enters `PRODUCT_TOOL_NAMES`, so the preset mask denies it wherever a role allowlist omits it, and the catalog test keeps the list exact. The planner allowlist gains the name. The manager keeps its current allowlist and therefore keeps its no-card-write guarantee without any new rule. The operator and the architect inherit the tool the same way they inherit card creation, because they declare no mask.

Alternative rejected: a new gate that declares the tool only in task conversations. It would hide a board-cleanup capability from the planner, which is the role that most needs it, and it would add a second visibility mechanism beside the allowlist.


### The tool module depends on a narrow port

Following the pause and transition modules, the new module declares the port it needs: the task lookup, the Hub scope resolution, the consequence preview, and the one command. The app satisfies it structurally at registration. The module stays testable against the port alone, and it cannot reach the snapshot, the client bridge, or the worktree coordinator.


## Risks / Trade-offs

- The agent reports a deletion that has not finished. Mitigation: the result carries the operation phase and the tool description states that the card operation is the record; the card, the board notice, and the drawer keep publishing the real outcome.

- A deletion the agent admits can archive the conversation that issued it, once that conversation is idle. Mitigation: the turn itself completes normally, the archive waits for idleness, and the behaviour matches a user deleting their own card from the drawer while it runs.

- The consequence read costs one Git local-change query per call. Mitigation: it runs once, on an explicit confirmed request, and a failure degrades to an unavailable value instead of an error.

- Removing `HubRepository.deleteTask` touches a published repository method. Mitigation: no production path calls it; the only caller is a domain test that exercises the cascade directly, and that test moves to the domain function.

- A card with relations deleted through the old background path failed with `INVALID_STATE`. Mitigation: the shared cascade removes relations in the same mutation, and a test asserts a deletion succeeds for a card that takes part in an epic relation and a symmetric relation.

- The tool inherits into the operator and the architect, widening those roles. Mitigation: this was decided deliberately; both roles already hold card creation and editing, and the tool adds no capability the interface lacks.


## Migration Plan

No stored shape changes and no data migration is needed. A Hub that already holds a relation whose endpoint task is missing remains invalid state and is not silently repaired; this change prevents new occurrences rather than relaxing the validation.

Rollout is the normal plugin release: the tool appears once the bundle is updated, and existing boards and conversations keep working unchanged. Rollback is reverting the release; a deletion already recorded in a journal keeps its journal and resumes on the next start, as with any deletion.

