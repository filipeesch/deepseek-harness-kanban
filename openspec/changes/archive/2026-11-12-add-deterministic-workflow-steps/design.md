# Design

## Context

See [the proposal](./proposal.md#why) for motivation and scope. This is a planning change only; no implementation or dependency update is performed by these artifacts.

Observed integration points:

- [Stage entry](../../../src/domain/stage-entry.ts) currently means an unresolved agent instruction. [Automatic advance](../../../src/domain/auto-advance.ts#L52-L83) traverses stages without instructions, so an empty prompt cannot implement a wait.
- [Transition routing](../../../src/domain/transition-route.ts) and [turn admission](../../../src/host/advance-admission.ts) separate a pure route from a revalidated, durable decision. The new trigger must reuse that separation, not manufacture a completed agent turn.
- [Pending transition dispatch](../../../src/host/app.ts#L825-L845) places tasks and delivers instructions. [Plugin message delivery](../../../src/host/plugin-message-delivery.ts#L60-L99) deduplicates a request identity against the live inbox and durable session events.
- [Schedules](../../../src/host/schedule-coordinator.ts) demonstrate injected clocks and lifecycle boundaries, but their successful outcome is prompt admission, not script completion. Their missed-occurrence and interrupted-run policies are not suitable for this feature.
- Workflow definitions are duplicated deliberately across [YAML parsing](../../../src/domain/workflow.ts), [persisted schemas](../../../src/domain/schema-parts.ts), and [journal event](../../../src/domain/journal/event.ts), [derivation](../../../src/domain/journal/derive.ts), and [materialization](../../../src/domain/journal/materialize.ts) contracts. Extending only the parser would lose shared configuration.
- [Stage editing](../../../src/client/stage/stage-editor-dialog.tsx) already composes independent sections. [Stage updates](../../../src/domain/stage-update.ts) preserve authored YAML instead of serializing a replacement document.
- [The native credential adapter](../../../src/host/sharing/credentials.ts) is an existing precedent for depending on a small credential port rather than a plugin-owned secret file.

The user selected scripts with their own loops and sleep, not a host timer for every query. A process can wait for hours, and its JavaScript/Bash memory is not durable. The inspected DSH checkout is 0.2.2-rc.1; this change deliberately moves away from the old 0.2.1-rc.2 baseline.

## Goals / Non-Goals

**Goals:**

- Isolate the program, supervision policy, persistence, trust, credentials, routing, and presentation behind narrow boundaries.
- Make every side effect attributable to a current stage entry, logical execution, and process attempt.
- Commit terminal results before downstream execution, so recovery never repeats a completed external check merely to recreate a message.
- Keep interactive board commands independent of program lifetime and preserve existing prompt-stage behavior.
- Use public, nondeprecated DSH execution capabilities without the chat tool transport or a model turn.

**Non-Goals:**

- General durable-language continuations, serialized program stacks, a generic workflow framework, or a per-poll host scheduler.
- Built-in provider integrations, model/MCP tool catalogs in scripts, a custom credential vault, unrestricted environment inheritance, or new automatic sandbox escalation.
- Freezing imported modules and called executables, proving arbitrary code read-only, or guaranteeing exactly-once operations in external systems.
- Broad rewrites of the application coordinator or cleanup unrelated to the new execution boundary.

## Decisions

### 1. Add a single behavioral definition, separate from presentation

Add an optional deterministic definition to a stage. Keep legacy prompt and manual stages as they are; reject a deterministic definition combined with a nonempty prompt or an allowed-transition list. Empty legacy prompt values remain absence. The deterministic exit mapping is its sole routing declaration; graph and transition-access helpers derive deduplicated destinations from it rather than storing a second target set.

The planned YAML contract is:

~~~yaml
columns:
  - id: wait_ci
    label: Wait for CI
    deterministic:
      language: typescript
      directory: task
      file: scripts/wait-ci.ts
      env: [CI_TOKEN]
      exits:
        passed: review
        rejected: fix
        error: fix_wait
  - id: review
    label: Review
    on_enter_prompt: Review the implementation using the incoming CI result.
  - id: fix
    label: Fix implementation
    on_enter_prompt: Fix the failure described by the incoming result.
  - id: fix_wait
    label: Repair wait step
~~~

Exactly one of code or file is accepted. The directory selector accepts task and project, defaulting to task. Relative file paths resolve from that selected execution directory. Absolute file paths are admitted only through the same native path policy; the trust review shows their canonical source. Files are primary program bodies, not an implicit export-default module ABI. Both source forms use the same language contract.

Extract a small deterministic-definition codec for validation, normalization, equality, journal conversion, and execution capture. Do not turn the entire workflow parser into a registry framework. Keep presentation/layout fields separate. Existing documentary transition conditions retain their meaning; named exits do not evaluate when text.

**Alternative rejected:** another optional command field alongside the prompt and unrestricted transitions. It creates ambiguous dual execution and two sources of routing truth. Interpreting existing when strings as expressions would also change legacy workflows.

### 2. Scripts own the wait; the host owns one supervised run

A Bash script is one long-lived shell execution. TypeScript is one fresh async function-body evaluation with top-level await/return and access to tools.bash. Scripts use Bash sleep or a TypeScript timer inside their own loop. No host polling interval, missed-tick queue, cron expression, or synthetic prompt is introduced.

The completion protocol is deliberately small:

~~~typescript
interface StepCompletion {
  exit: string;
  message: string;
}
~~~

TypeScript returns this object. Standalone Bash returns it as the sole stdout JSON document and exits with status zero; diagnostics use stderr. A nonzero standalone Bash exit is an executor failure even if stdout resembles a completion. A nested Bash command returns structured command facts to TypeScript, which may handle a nonzero status and continue checking. Reject truncated, oversized, malformed, unknown-field, or nonconforming completion data; never parse a final log line heuristically.

An unknown/unmapped exit is an invalid completion. Convert it to a synthetic error outcome, using the captured error route when present. A result whose captured destination was removed is instead a routing failure; do not recursively follow error or select a newer route. Explicit Stop, supersession, and ungranted trust do not synthesize error outcomes.

No short chat-call timeout applies to the outer wait. Request native no-deadline execution with an abort signal. Individual tools.bash calls can use explicit command deadlines with kill semantics, not chat-job promotion; those deadlines do not replace the script's total business deadline. Retain bounded memory/output and per-task ownership safeguards. A script that exits without a completion fails visibly; there is no hidden automatic loop around a broken script.

**Alternative rejected:** returning a next-check delay to the host. That would simplify durable timers, but the user explicitly chose a program-owned loop and sleep.

### 3. Introduce small ports instead of a new god class

Proposed responsibilities, with names indicating boundaries rather than a required file layout:

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Definition/capture service | Validation, primary-file read, canonical directory, immutable source and fingerprint | Process lifetime or task movement |
| Execution policy | Pure decisions for entry/run/attempt currency, Stop, recovery and result acceptance | Native services or UI |
| Execution supervisor | Per-task ownership, spawn/cancel/drain, restart attempts, stale-result rejection | Provider-specific CI/CD logic or model turns |
| Program executor port | Language-specific run and cancellation, JSON completion, bounded diagnostics | Routing or task persistence |
| Local trust/variable ports | Approval lookup, reviewed capability scope, credential references per project/stage | Shared workflow publishing |
| Transition admission/dispatcher | Existing guards, atomic placement intent and handoff delivery | Sleeping or querying remote systems |
| Runtime projection | Safe summary for cards/drawers and activity aggregation | Raw secret values or unbounded logs |

Compose these in [the host composition root](../../../src/index.ts#L190-L233). Depend on injected repositories, runtime/shell adapters, clock, id allocation, report function, and cancellation. Keep long waits out of the global application command tail and the repository Git-operation lane. Programs for unrelated tasks can make progress concurrently; one task does not launch a replacement before its owned predecessor is confirmed stopped.

Extract the existing pending-transition drain from the application coordinator only as needed to share its placement/delivery path through narrow ports. Keep agent turn observation separate from deterministic completion observation. Do not grow the attention coordinator into a script scheduler or reuse the Git-specific command wrapper as a generic language runtime.

### 4. Use public DSH 0.2.2 execution seams, not run_code transport

Use the public PTC runtime resolve/run seam for TypeScript and shell resolve/execute seam for Bash. These services can operate without sessions or LLM turns. Bind only tools.bash from the tool namespace. Input-context and authorized-environment access are plugin-owned data bindings, not additional DSH tools.

The adapter verifies language, evaluation format, isolation, no-deadline execution, output handling, policy support, and cancellation/child cleanup. Do not assume a configured persistent REPL or Script backend accepts the function-body contract. Use a fresh compatible provider; when the mounted provider cannot satisfy the contract, report the capability gap rather than rewriting return semantics silently or evaluating code in the plugin process.

Cancellation is a tree of ownership: run lifetime -> TypeScript evaluation -> outstanding Bash bindings -> native process groups. Stop invalidates durable authority first, then aborts and awaits all owned work. Returning or throwing from TypeScript also cancels/drains unawaited Bash bindings. Ordinary shutdown cancels processes but leaves a recoverable active intent; explicit Stop changes that intent to stopped. The native process lifecycle must terminate descendants when the host control channel disappears, or recovery must confirm/reclaim that ownership before launching a replacement. Stop also waits for witnesses that register while it is already draining, so a nested execution started at the boundary is still cleaned before the host aborts its processes. Test host-loss behavior rather than assuming that a separate process alone guarantees cleanup.

**Containment through an inherited ownership token:** the macOS provider has no persistent process-range owner, and a `detached: true` descendant leaves both the process group and the parent tree, so group signalling and parent-IPC watch alone cannot prove quiescence. Each execution therefore generates a random `DSH_DETERMINISTIC_RUN` token, sets it in the environment of the code it launches, and treats every process carrying that token as owned. Before reporting clean, the guard signals the recorded group, then sweeps the process table for the token. It confirms a candidate's own environment before touching it, freezes it only then, and resumes only a process it froze itself. A pid plus a separately-read timestamp is never ownership proof. The sweep confirms membership before touching a candidate, refuses to resume a process it did not stop, and treats a same-user unreadable environment as uncertain. Two residuals remain inherent to POSIX signalling without a native handle: an external kill plus kernel pid reuse between confirmation and the signal, and a descendant that changes credentials and so can no longer be inspected; Linux native scopes remain authoritative where the provider selected one, and the product does not claim hard exclusion on hosts without an OS ownership primitive. The guard re-scans until no owned process remains. If the guard itself is force-killed, the host applies the same predicate to the persisted marker before releasing the record. The requirement that a predecessor never acts on the same active execution is enforced independently of process liveness: the durable lease excludes a second owner, and a result is accepted only for the current entry, execution, and attempt, so a surviving process cannot move the task or deliver a result. The sweep governs external side effects, where the documented POSIX limits apply. Because the token is inherited, a detached child is drained on Stop and after host loss in the ordinary case described by these tests. A process table that cannot be read raises uncertain ownership rather than a clean result, and a program that deliberately rewrites its children's environment is outside the tracked set; both limits are documented. This mirrors the containment-by-membership model that native backends use, where ownership is decided by cgroup or Job membership rather than by ancestry.

Concrete macOS 0.2.2-rc.1 provider tests demonstrate that raw Bash and PTC timer/busy workers can outlive a SIGKILL of their host. Native execution therefore includes trusted lifetime infrastructure inside the execution world: authenticated challenge/HMAC loopback witnesses, a live self-terminating Bash process-group leader, and a PTC watchdog tied to its live parent/IPC edge. Recovery authenticates witness responses before releasing records or launching replacement work; endpoint or PID reuse is not authority. Authentication is not sufficient alone: the witness also proves an empty owned set by sweeping the inherited token before it answers, so its positive answer covers descendants that left the group. Profile-private ownership/witness records are auxiliary lifecycle evidence, never run/result/transition authority; the task transaction remains authoritative. Bash requires Node in the native execution world. Windows fails closed until a supported ownership adapter exists.

Resolve the execution directory and native policy from task/project scope, including applicable restrictions, without creating a session just to obtain a policy. Local trust is consent to code, not permission to bypass the native policy. A denied operation cannot auto-escalate. Missing runtime/credential capabilities leave normal non-script boards usable and produce explicit diagnostics for the requested deterministic execution.

**Alternatives rejected:** invoking run_code through the ordinary tool registry, which is not its public contract; driving the full PTC chat transport, which exposes more tool/pipeline behavior than required; direct eval/new Function in the plugin; or copying a complete sandbox implementation into the plugin.

### 5. Persist control state with task transitions; keep source blobs and logs private

Use the task's local durable aggregate for execution authority and transition/handoff receipts. The user selected an in-script loop, so there are no per-poll control writes requiring a separate high-frequency run database. Store captured primary source as an immutable, host-private blob referenced by the task record; store only safe summaries in ordinary runtime projections. Source blobs contain no resolved environment values. Write and verify the blob before admitting its execution reference; missing/corrupt blobs fail closed on recovery.

Keep these identities distinct:

- entryId: a genuine stage entry, changed by moving away and entering again, not by a same-stage reorder or Play;
- executionId and startedAt: a logical run, replaced by explicit Play;
- attemptId and restartCount: a native process incarnation, replaced during automatic recovery;
- resultId/deliveryId: one accepted terminal result and its downstream delivery, reused after a crash.

The task control record holds the stable local stage association, those identities, phase, captured source reference/fingerprint, exact routes and directory, authorized variable names, incoming handoff, and optional terminal result. Capture each route with its target stable identity as well as the reviewed authored identifier: a later identifier rename can still resolve the same destination, while reuse of that identifier by a different stage cannot redirect the result. It does not hold resolved secrets. Preserve existing prompt-entry markers for their purpose rather than repurposing an instructionPending marker as a script state machine.

Suggested persisted phases are capture-pending, awaiting-trust, active, stopping, stopped, result-ready, delivering, and failed. Active includes sleeping; the supervisor cannot infer a remote system's current state from the fact that the program is alive. Configuration awaiting explicit Play is a projection comparing the captured and saved versions, not an automatic new run.

Critical ordering:

0. In the same transaction that creates or places a task into a genuine deterministic entry, persist its entry identity and a capture-pending activation with the authored definition requested for that entry. This distinguishes an unprocessed real entry from a historical occupied stage and survives a crash before file I/O or trust review. Configuration edits do not rewrite that activation.
1. Resume that durable activation to capture primary code/configuration and durably save its source blob. An external file not yet captured has no previously approved bytes; read its selected primary source and review those bytes before launch, rather than claiming a recovered approved version existed.
2. Review/authorize the exact fingerprint, then transact the execution intent for the current entry before spawning.
3. Accept completion only if entry, execution, attempt, and active authority still match; redact known secrets and persist the result and delivery identity.
4. Admit the named destination using a short task transaction and current context/user-work guards. Persist transition/handoff intent before downstream effects.
5. Atomically place the card, establish the destination entry/handoff, and record that the source result was consumed. Delivery retries reuse the same identity; they never reexecute the source script.

Guard checks occur again inside the final transaction, not only before awaited reads. Stop/movement that wins the transaction invalidates a late result. A completion already admitted before a stale Stop cannot be undone by that Stop. A workflow edit does not rewrite the captured route. Authorize deterministic output against the trusted captured mapping, not against the latest saved exit list or legacy canTransition result: editing B to C must not block the still-approved run from choosing B. Resolve B by its captured stable target identity and apply current entry/context/user-work guards. Do not set a generic transitionOverride flag to bypass these checks.

Because control state and consumption receipts share the task transaction, a crash cannot create the cross-store gap of marking a result delivered in one database while forgetting its movement in another. Private blob/log writes are ancillary and referenced before use; orphaned blobs are cleaned only when no durable execution references them. Task deletion removes only its associated local execution records after owned processes stop.

**Alternative rejected:** copying schedule run storage and treating sent as completed, or putting control authority in a new database with an uncoordinated transition write. Those patterns would require a more complex recovery saga without a high-frequency-write benefit here.

### 6. Define replay precisely and separate it from Play

Automatic recovery of active authority restarts the same captured program from its beginning with the same executionId, startedAt, entryId, and incoming handoff, but a new attemptId/restartCount. No JavaScript heap, shell variables, timer remainder, or instruction pointer is restored. Scripts calculate total elapsed business time from the preserved start timestamp. Queries may repeat; the documented script contract requires this to be safe.

Stop revokes the run durably and does not generate error. It stays stopped after restart. Play captures the current saved configuration and primary file, creates a new executionId and startedAt, and retains the same stage entry and incoming handoff. If the old program has not finished cleanup, new launch waits per task, not globally.

A saved result-ready record resumes result admission/delivery instead of restarting code. An interrupted delivering record reconciles durable native admission using the same delivery identity, resuming only the interrupted attempt when no recorded failure or acceptance exists. A delivery explicitly recorded as failed remains failed across restart and requires an explicit delivery-only retry, exposed as a task command and a distinct control beside Play: it reuses the saved result, execution, and delivery identities, while Play stays a separate rerun that allocates a new result. The retry command is bound to the exact entry and execution the user saw, so a replaced entry is rejected rather than delivering an older result; a native acceptance found in the durable log is never sent again. A stopped, failed, superseded, or historical entry does not auto-start on reload. Capture-pending and awaiting-trust activations are reconciled as pending requests; the latter still cannot execute without approval. Loading cards, saving a script onto an occupied stage, and same-stage reordering are not new entries.

Manual movement invalidates/cancels the previous run. Native worktree removal, task deletion, or project relocation must not remove/change a directory underneath a live owned script: cancel/drain the affected execution before irreversible context changes, or defer that context operation with a visible diagnostic. Do not stop unrelated conversations to force these operations. A changed or invalid task binding cannot silently redirect recovery to a different directory.

### 7. Route named outputs and hand off data without impersonating an agent

Deterministic admission has its own origin and does not require autoMode.enabled or recordedTransition.reason. It still shares current-entry, pending-operation, conversation-idleness, pending-user-work, and destination-validity guards with other automatic movement. A saved result waits for these guards without rechecking the external system. An unrelated turn/end cannot route a task through its deterministic entry, even if auto mode is enabled.

The durable entry/control record, not the latest saved YAML execution mode, owns an already-requested deterministic entry. Saving an agent/manual mode over it does not hide Stop, arm an agent countdown, or let an incidental turn bypass the owned execution. Play is available only when the saved stage again has valid deterministic configuration; otherwise retain the stopped status and explain that the user must configure a script or make a genuine stage change.

Prompt-driven default advance stops at any executable stage (agent or deterministic). Legacy empty/manual crossing behavior remains unchanged elsewhere. Deterministic results stop exactly at their named destination, including a manual stage; they never fall back to workflow order or the first exit.

Keep a deterministic handoff distinct from an agent-declared reason. Its source is the completed run, not the destination's agent and not a modified recordedTransition. Agent-facing composition is: destination instruction, declared-agent reason if one actually applies, identified deterministic handoff (exit/message/provenance), then existing transition briefing when applicable. Use the native collapsed context row and stable request identity, not an ordinary user prompt masquerading as human input. At final native inbox/context admission, validate destination entryId and deliveryId after every awaited session resume, directory check, and log read; checking columnId alone is insufficient after moving away and back. Keep asynchronous preparation outside a short per-task admission reservation, then serialize the final entry check and native enqueue against placement for that task. If a native API cannot enqueue synchronously, retain a cancellable/bounded per-task reservation through native admission rather than holding the global command tail or allowing a stale enqueue. A move after a completed native admission does not retroactively undo that message.

A script destination receives the same handoff in structured input and requests its own entry execution without a conversation. A manual destination retains the handoff for its next explicit native execution in that same entry. Extend the pre-step context-injection pattern used by the task context: prepend one identified plugin context message to an already admitted user/preset execution without sending another prompt, creating another turn, mutating the composer, or creating a conversation merely for the handoff. Give this standalone notice its own producer/delivery identity and native Chat Definition; reconcile its durable acceptance before marking the entry-bound handoff consumed. An instructed destination keeps the combined stage-instruction path instead, so it does not also inject a standalone duplicate. Handoffs belong to destination entry identity; they are not an accumulating task-global message bag. Preserve a manual entry's handoff when Play starts execution in that same entry, but do not attach it to an unrelated later visit. Agent destination delivery failure uses the existing recoverable transition path, not the source script's error exit.

### 8. Freeze the reviewed capability set, not secret values

A trust fingerprint includes primary source bytes, language/program format, canonical source provenance, selected directory scope, captured routes, and authorized environment names. Scope approvals to the local board, project, and stable stage identity; different boards can reuse an authored stage key and must never share authority. Explicitly review a new fingerprint; team publication, YAML tools, or accepting a merge cannot grant trust. Review and launch use the same captured bytes, avoiding an external-file time-of-check/time-of-use substitution.

Imported modules and called executables are not frozen. Explain that boundary in the trust UI; approving the primary script is not a promise that transitive code cannot change. Do not claim arbitrary Bash/Node code is restricted to repeatable effects merely because its tool namespace is small.

Local variable values and their native credential references are scoped to (local Hub/project identity, stable stage identity), not inherited from another stage or project. YAML declares authorized variable names only; the local settings bind each name to its own credential reference/value. Use an owner-scoped native credential record/reference scheme and a small adapter, following the existing credential boundary rather than introducing plaintext plugin configuration or a bespoke vault. A write or removal carries the reviewed project and stable stage identity, and the host rejects it when either no longer matches the current scope, so a dialog that outlives a move, stage replacement, or project change can never install or delete another scope's value.

Resolve only authorized names for the operation. TypeScript receives a read-only accessor for authorized values, separate from the task-context metadata; Bash receives an explicitly constructed environment for the same authorized names, following native credential scrubbing and managed-variable rules. Do not weaken the PTC environment scrub by copying process.env wholesale. Accessors and nested Bash resolve current values through the credential service; process recovery resolves them again. This allows rotation without persisting values in a captured run. The browser sees configured/missing status and write-only replacement controls, never a read-back API for stored values.

Redact known resolved values before diagnostic/result persistence and client display, including synthetic error messages and outgoing handoffs. Bound output even during hours-long loops; avoid a task-history event for every print/check. Redaction cannot prevent a trusted script from transforming a secret or sending it to a remote service, so policy and code review remain the boundary. Scripts must not embed secrets in published code literals.

### 9. Preserve executable configuration through versioned sharing

Add deterministic configuration to normalized schemas, canonical equality, stage definitions, event derivation, patch application, both YAML materializers, stage-id rewrite logic, and publication previews. A stable local stage association preserves trust/variable scope across an identifier rename. For an unpublished stage without an authored key, allocate that association in local metadata; do not fabricate a published identity or edit the shared YAML merely to configure credentials. Preserve its mapping across local rename and attach it to the authored key when publication assigns one. Exit destinations migrate with other authored references. Local identifier editing follows the existing in-flight guard, extended to script control state; applying a team rename still resolves the same stable stage and does not rewrite captured program bytes. Resolve captured route targets by stable identity at delivery so a team rename does not silently substitute another stage. Stage removal and context changes remain subject to safe execution/result guards. Editing code/routes remains possible without changing the active capture.

Introduce a board-log v2 capability envelope for new executable definitions, with v1/v2 readers and an explicit update-required failure for unsupported formats. Keep the Hub manifest version unchanged unless its actual shape changes. Compatibility must survive an initial script-bearing snapshot with no tail, event append, and compaction that folds away the tail. A new event kind/version alone is insufficient: [board log decoding](../../../src/domain/journal/log.ts#L139-L165) accepts snapshot text, and [compaction](../../../src/domain/journal/log.ts#L106-L114) removes events.

Do not change historical event stamps by changing a constant and reencoding old events. Preserve legacy event versions and canonical head tokens during read/migration; [head tokens](../../../src/domain/journal/log.ts#L45-L52) currently pass through the event encoder. Test v1 fixtures, head stability, append conflict checks, v2 genesis, and v2 compaction. Do not downgrade a v2 envelope merely because a later edit removes the last deterministic stage.

Only authored deterministic configuration is shared: primary file references remain references, not uploaded file contents. Runtime captures, trust, handoffs/results, logs, variable bindings/values, and task records remain local. An unsupported client must retain its last usable local configuration and offer the existing update-required recovery, not drop executable fields or run them.

### 10. Extend existing surfaces without duplicating semantics

Add a deterministic section to the composed stage editor with language, source mode/code or file, directory, authorized variable names, and named exit routes. Switching execution modes creates one coherent patch and validates mutually exclusive fields. Preserve comments, quoting, order, layout, and unrelated YAML as existing stage editing does. Reuse the domain validator in YAML diagnostics and the form.

Cards/drawers expose safe runtime summaries, Stop/Play, trust review, diagnostics, and captured-versus-saved version status. Expose local variable configuration for the selected project/stage pair with masked, write-only values and configured state. Updating the workflow is not an implicit Play or approval. Keep action progress in the initiating control and do not add a global saving bar. Neither browser visibility nor board selection owns the script lifetime.

Fold script activity into task/board counts without fabricating an agent turn. Sleeping counts as an active script; stopped/failed/awaiting-trust states are distinct. Record only terminal execution outcomes (stop/cancellation, failure, or completion) and settled logical handoff facts in task history with identities needed for dedupe, not execution-start, pending trust, recovery progress, or each polling iteration. Keep lifecycle timestamps separate from existing stage-duration calculations. Browser tests use host theme fixtures and cover both appearances, keyboard access, and reduced motion.

### 11. Align the dependency baseline and verify public contracts before coding adapters

Move DSH SDK dependencies off the exact 0.2.1-rc.2 versions. Start from the inspected 0.2.2-rc.1 line using bounded compatible dependency ranges, update peer/host engine ranges accordingly, and commit a lockfile with exact resolved versions for reproducible development. Do not use unbounded latest or infer all future prereleases are compatible. Align the Node engine with the tested host baseline (the inspected host requires Node >=24.9.0). Add the public runtime/shell capability packages actually consumed by adapters, not the internal chat transport as a dependency.

Before each host API use, inspect the selected 0.2.2 source for deprecations and test the concrete resolve/run, shell, credential, storage, and native message contracts. The observed runtime/shell seams were not marked deprecated in the available checkout, but this does not certify every 0.2.2 package release or provider composition. Unsupported provider capabilities are explicit execution diagnostics, not a compatibility fallback to old APIs.

Bump the installed plugin artifact version during implementation. Keep installation at the repository Git URL with its required prepare-build approval and an immutable commit pin option. Updating a dependency or successfully installing does not prove bundle activation; verify the built plugin in the isolated host composition lane.

## Risks / Trade-offs

- Restart repeats external reads -> document repeatable scripts and preserve logical execution identity/start; never promise exactly-once remote actions or stack restoration.
- A long-lived loop can hang or flood logs -> Stop owns hard cancellation, process/heap/output bounds remain enforced, and bounded diagnostics never become unbounded task history.
- Host death can leave subprocesses alive -> prove native owner/channel cleanup and exclusive recovery with killed-host tests; fail closed when ownership cannot be confirmed.
- Primary source capture does not freeze imports or the world -> display the trust boundary and preserve native filesystem/execution policy.
- Secret access creates an exfiltration surface -> explicit project/stage allowlists, native credential storage, no ambient credential copying, masked UI, bounded/redacted diagnostics, and code-version approval.
- A UI click can race script completion -> compare entry/execution/attempt authority inside the same short durable transaction, and reject stale Stop/Play/movement results.
- Two local stores could disagree about delivery -> keep authoritative run/result/transition receipts in the task transaction; private source blobs are immutable prerequisites, not a second control authority.
- New fields can disappear in sharing -> extend all codecs and use versioned log compatibility that survives genesis and compaction.
- SDK baseline changes can break existing hosts -> declare the new floor, update fixtures and compatibility documentation, and verify actual activation instead of only package installation.

## Migration Plan

1. During implementation, align the SDK/engine baseline and add public-capability adapter contract tests before wiring execution.
2. Add optional local stage-entry/control fields and private versioned source storage. Legacy records load without synthesizing executable runs. Allocate stable local stage associations where a variable/trust scope first needs them, mapping to authored stage keys when available; never use a mutable stage id alone as a credential key or publish a new key merely to store local settings.
3. Introduce the definition codec and new stage editing/sharing support, including board-log v1 reads and guarded v2 writes. Configuration save remains nonexecuting.
4. Wire entry activation, durable supervision, cancellation/recovery, result routing, and message delivery. Every launch follows capture and local approval.
5. Add visual configuration and runtime controls, then perform the isolated verification lanes. Release only after the installed-artifact version and compatibility evidence match.
6. Rollback: explicitly stop active scripts, retain/back up local records and credentials, and use an older compatible plugin only with workflows that no longer require deterministic fields and a deliberately reviewed compatible shared-log backup. Never erase active captures, silently downgrade v2 journals, or execute a newer script with an old client. The proposal does not introduce an automatic downgrade writer.

## Verification Strategy

- Domain: definition/source exclusivity, default directory, named routes and duplicates, no self-route, exact-stop semantics, legacy manual crossing, pure run/entry/attempt currency, and canonical equality.
- Native adapter contracts: function-body TS, sole tools.bash namespace, standalone Bash stdin/stdout protocol, no outer short-call expiry, nested command deadlines, bounded output, partial/missing policy failures, abort plus child drain, and current authorized credential access. No real CI/CD or model calls.
- Host: entry from UI/tools/create/default and declared advances; Stop versus completion; Play versus edit/file changes; movement away-and-back; user-work/context-operation holds; recovery before launch, during sleep/Bash, after saved result, during move, and after native handoff admission. Use injected ids/clock and controllable executors, not sleeps or network services.
- Persistence/sharing: task-control migration, orphan/missing source blobs, local credential scope, event-version/head preservation, v1 reads, v2 genesis/append/compaction, stale-client update-required behavior, and nonpublication of runtime/secrets/trust.
- Client: editor parity and YAML preservation, runtime states, trust diff, local variable scope, corrected-version Play, Stop/Play races, script-aware task counts, accessible action states, and native context row provenance.
- Gates: pnpm check; pnpm test:browser; then the repository-owned real-composition runner against an installed/built DSH 0.2.2 checkout using throwaway DSH_HOME/profile/workspace, replay-only model fixtures, and deterministic local scripts. Extend that runner with a deterministic-step scenario and store sanitized light/dark evidence under .verification/. Never use the running personal GUI/profile.
