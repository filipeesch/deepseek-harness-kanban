# Design

## Context

See [proposal.md](proposal.md) — Why. The constraints that shape this approach:

- The interactive path already leaves the destructive work to the background: `WorktreeCoordinator.request()` records the journal, `DestructiveAdmission` decides from persisted state only, and `OperationQueue` runs one job per repository lane ([src/host/worktrees.ts](../../../src/host/worktrees.ts), [src/host/destructive-admission.ts](../../../src/host/destructive-admission.ts), [src/host/operation-queue.ts](../../../src/host/operation-queue.ts)). Everything this change removes is inside that lane.
- The lane re-derives the same facts many times. `GitAdapter.inspect()` and `GitAdapter.remove()` each resolve the repository layout again ([src/host/git.ts](../../../src/host/git.ts)), the destructive execution runs the whole removal preflight twice and the sharing guard a third time ([src/host/destructive-operation.ts](../../../src/host/destructive-operation.ts)), and every one of those checks re-reads the checkout.
- Binding and sharing scans read `HubRepository.allTasks()`, which clones the owning Hub once per task ([src/host/hub-repository.ts:322](../../../src/host/hub-repository.ts#L322)). The lightweight summary projection already exists beside it but is not used by these paths.
- Every idleness answer costs a native activity read, a projections read, and a full conversation-log read ([src/host/native.ts:224](../../../src/host/native.ts#L224)), and `setDirectory` and `archive` re-check idleness themselves before they commit.
- Every journal write is a full Hub transaction: clone, schema parse, cross-Hub ownership scan, storage write, and a publication ([src/host/operation-journal.ts](../../../src/host/operation-journal.ts), [src/host/hub-repository.ts:418](../../../src/host/hub-repository.ts#L418)).
- Worktree creation resolves the layout for each Git call, derives the title defaults in a separate host call before the create, and verifies the checkout it just created with a full inspection ([src/host/app.ts:354](../../../src/host/app.ts#L354), [src/host/first-execution.ts](../../../src/host/first-execution.ts), [src/host/git.ts](../../../src/host/git.ts)).
- Constraints: pinned DSH public surfaces only, no DSH change, no persisted record or storage-schema migration, no change to error codes, operation phases, recovery actions, or confirmations, and the sandbox policy stays the sole authority for what Git may touch. The plugin artifact changes, so `version` in `package.json` is bumped in the same pull request.

Decisions already settled with the maintainer and treated as fixed here: one change covering both paths, verification by behavior only, memoization restricted to a single operation pass, journal progress separated from recovery, creation defaults derived on the host, the hot-path extractions included, checkout removal overlapped with archiving, and local-change detection skipped once discard consent is recorded.

## Goals / Non-Goals

**Goals:**

- Resolve every repository fact once per operation and every checkout fact once per execution, instead of once per Git call and once per preflight step.
- Answer binding, sharing, and active-operation questions from a purpose-built projection instead of cloning Hubs.
- Ask the native ports for conversation idleness once per execution pass, without weakening the ports' own pre-removal authority.
- Write journal state that recovery depends on immediately, and coalesce per-conversation progress at phase boundaries.
- Run checkout removal and native archiving concurrently after the directory return, with per-step failure attribution.
- Derive title defaults inside worktree creation when the request does not supply them.
- Leave every hot-path collaborator single-purpose, injected, and independently testable.

**Non-Goals:**

- Changing error codes, operation phases, confirmation flows, recovery actions, or persisted records.
- Caching sandbox policy or native conversation facts outside one operation pass.
- A benchmark, a latency budget, or a spawn-count assertion — the maintainer declined a metric contract, so verification stays behavioral.
- Running two destructive operations in one repository lane at once. Only the two independent teardown steps overlap.
- Redesigning the client surface. The Git form, the notice, and the preparation keep showing derived defaults before creating.

## Decisions

### D1. One repository context per operation

`GitAdapter` currently re-derives the repository layout inside every call: `roots()` resolves the Git root and project path with two `rev-parse` spawns, `commonDirectory()` adds a third, and `registered()` lists the worktrees again. Inspection, creation, and removal each pay that cost separately, and removal pays it three times.

Introduce `RepositoryContext` — the resolved Git root, project path, common directory, and registered worktrees for one repository — produced by a `RepositoryProbe` and passed explicitly to the read and write operations. The adapter checks the project path containment and the target safety rules against the context it was given instead of re-resolving it.

Split `GitAdapter` along the same seam: `RepositoryLayout` (pure path math and target rules), `WorktreeReader` (`inspect`, `branches`, registered listing), and `WorktreeWriter` (`create`, `remove`, `repair`). The writer refreshes the registered list only when it changes it.

**Why:** the layout is a property of the operation, not of each Git call. Nothing about it can change mid-operation without the Git commands themselves failing.

**Alternatives rejected:** a process-wide cache keyed by project (a moved or re-created repository would serve stale facts, and no event reliably invalidates it); threading raw strings through every call (the safety rules would be re-implemented per call site, which is how the duplication appeared).

### D2. One authoritative checkout preflight per execution

`DestructiveExecution.drive()` runs `assertPreRemoval()` before the directory return and again inside the removal branch, then `assertRemovalTarget()` repeats the sharing scan a third time. Each pass re-reads the checkout.

Extract `CheckoutPreflight`, which evaluates once per execution and returns a `DeletionPlan`:

```
DeletionPlan = {
  directoryTarget?      // where conversations return, absent when none is needed
  authorized            // removal may proceed
  blockers[]            // shared checkout, active foreign operation, dirty tree
}
```

The plan carries the decision; `CheckoutRemoval` executes it, and re-evaluates the sharing refusal immediately before the Git command because the host can report a new user of the checkout at any moment. The preflight covers, in one pass: the persisted binding against the confirmed target, conversation idleness, checkout sharing, whether the checkout still exists, and — only when the request does not already carry discard consent — whether the tree is dirty. The dirty check is the single `git status` run that changes a decision; with consent recorded the decision is already made, so the scan is skipped.

Immediately before `git worktree remove`, the removal re-validates the persisted binding and that the target is still a registered worktree of the same repository, using the plan and the repository context. Worktree changes that appear after the preflight are still refused by Git itself: `git worktree remove` without `--force` fails on a modified or untracked working tree, so the second full inspection was never the safety net.

**Why:** the second inspection repeated a decision that had already been made, and its only unique contribution — detecting changes that appeared in between — is enforced by the removal command.

**Alternatives rejected:** keeping the second inspection and only removing the third sharing scan (leaves the dominant duplication); replacing the preflight with the removal's own checks (loses the sharing and idleness refusals that must produce a recorded failure before anything is touched).

### D3. Binding questions answered without cloning Hubs

`HubRepository` gains a `worktreeBindings()` projection beside `taskSummaries()`, cached per repository change and built without cloning: task id and title, bound worktree path and branch, conversation ids, unclaimed and attempted paths, and the recorded operation's kind, phase, target path, and requested path.

`TaskBindingIndex` answers the three questions the destructive path asks — which other task binds this checkout, which foreign native sessions use it, and which task holds an active operation under it — from that projection plus one native topology read per pass. `WorktreeSharingGuard` and the force-removal check depend on the index instead of `allTasks()`.

**Why:** the current read is quadratic in tasks and runs three times per deletion; the projection the repository already keeps for the board is exactly the shape these questions need.

**Alternatives rejected:** widening `TaskSummary` with operation fields (it is the board's read shape, and growing it for a destructive-only question couples two consumers); returning stored Hub objects from `allTasks()` without cloning (removes the cost but silently drops the immutability contract).

### D4. One idleness probe per execution pass

`ConversationProbe` answers `allIdle(sessionIds)` with one concurrent read for the whole participant set, and every decision asks it again: no verdict is reused across a mutation, because any `await` can let a conversation start new work. What the probe removes is the fan-out cost — a set is read in parallel and a repeated id is read once — and the directory switch re-decides the whole set immediately before its first move, then one conversation at a time afterwards. The native ports keep enforcing idleness themselves: `setDirectory` and `archive` both refuse an active conversation, so the coordinator's per-participant re-reads before those calls were defensive duplication, not the authority.

**Why:** the same verdict was requested for every conversation at every checkpoint of one execution, and each request re-read a conversation log.

**Alternatives rejected:** a TTL cache inside the native adapter (outlives the pass, needs invalidation, and crosses a documented decision to keep native answers authoritative); removing the checks entirely and relying on the ports (a busy conversation must produce `waiting`, not a failed operation).

### D5. Recovery state writes immediately, progress coalesces

The journal splits into two writers. `RecoveryWriter` writes what a restart needs to avoid repeating or skipping work: the phase, the archived conversation ids, the completed-checkout flag, and any recorded failure. `ProgressWriter` accumulates the returned-conversation ids and previous directories in memory — they only feed the drawer's progress and a schema rule — and flushes them at phase boundaries and on failure.

**Why:** most of the per-deletion transactions rewrote the whole Hub to publish a progress counter. Recovery cannot resume from partial progress anyway: it re-reads the world.

**Alternatives rejected:** a journal record outside the Hub (removes the rewrite entirely but adds a second source of truth and a migration); keeping every write (the cost is proportional to Hub size, which is the worst scaling).

### D6. Teardown overlaps removal and archiving

After the directory return, `TaskTeardown` runs two independent steps and waits for both: `CheckoutRemoval` (Git) and `SessionArchiver` (native). The failure attribution is explicit, because the phase enum is a single value:

```
both pending        -> phase 'removing'   (or 'archiving' once removal finished)
removal finished    -> phase 'archiving'
archiving finished  -> phase unchanged, archivedSessionIds grows
both finished       -> finalize (remove task, notes, workspace)
both failed         -> record the archiving failure
```

The recorded failure names the step that produced it. When both fail, archiving wins, because archived native conversations cannot be restored and the recovery guidance must not suggest abandoning them. The existing recovery surface already reacts to `archivedSessionIds.length > 0` and to a recorded `archiving` failure, so the return action stays withheld when a partial archive exists.

**Why:** the two steps touch different subsystems — Git metadata and filesystem on one side, native session archiving and workspace cleanup on the other — and neither can observe the other's intermediate state.

**Alternatives rejected:** archiving each conversation in parallel but still after the removal (a smaller win that keeps the whole archiving block on the critical path); a second phase field on the journal (persisted shape change for a display detail).

### D7. Creation derives its own defaults

`CreateWorktree` keeps its explicit values authoritative. When a new-branch request omits the branch and destination, worktree creation derives the collision-free title defaults itself — the same derivation, collision rule, and destination rule the Git section uses — from the repository context it already holds. The client surfaces that display defaults (missing-worktree notice, Git form, interactive preparation) keep asking for and sending them.

`FirstExecutionPorts.worktreeDefaults` is removed: the automatic first execution requested copies of values that creation now derives, and `planFirstExecution` already decides `create-default` from persisted state without knowing the destination. A derivation failure surfaces from the create command with the problem it already reports.

**Why:** the duplicate derivation existed only to satisfy a port whose consumer never needed the values.

**Alternatives rejected:** keeping the port and deriving twice (leaves two sources for the same decision); moving derivation into the domain planner (it would have to reach Git for branch occupancy, which the planner deliberately does not do).

### D8. Single-purpose collaborators, injected

| Collaborator | Single responsibility | Replaces |
|---|---|---|
| `RepositoryProbe` / `RepositoryContext` | Resolve repository layout for one operation | `GitAdapter.roots()`, `commonDirectory()`, repeated `registered()` |
| `RepositoryLayout` | Pure target and path-containment rules | `assertTarget`, `containsPath` call sites |
| `WorktreeReader` / `WorktreeWriter` | Git reads / Git writes | `GitAdapter` reader and writer duties |
| `TaskBindingIndex` | Answer binding, sharing, and active-operation questions | `allTasks()` scans in the guard and the destructive execution |
| `CheckoutPreflight` | Decide one execution's removal plan | `assertPreRemoval`, `assertRemovalTarget` |
| `CheckoutRemoval` | Execute an authorized removal | Git removal branch of `DestructiveExecution` |
| `SessionArchiver` | Archive a task's conversations with per-conversation recovery state | Archiving loop of `DestructiveExecution` |
| `TaskTeardown` | Run removal and archiving to completion with attributed failures | Tail of `DestructiveExecution.drive()` |
| `ConversationProbe` | One idleness verdict per pass | Repeated `idle()` calls |
| `RecoveryWriter` / `ProgressWriter` | Journal durability vs. journal progress | `OperationJournal.update()` call sites |

`DestructiveExecution` becomes an orchestrator over those collaborators, and `WorktreeCoordinator` keeps command sequencing, journal ownership, and failure recording. Ports stay injected, so each collaborator is tested with the existing fake store, session port, and recording Git executor ([tests/worktrees/helpers.ts](../../../tests/worktrees/helpers.ts)).

**Alternatives rejected:** keeping the current classes and optimizing inside them (the duplication is structural — the same decision is made in three places, so it can only be deleted by owning it once); extracting the whole `WorktreeCoordinator` in this change (larger surface, no additional runtime win).

### D9. Verification stays behavioral

No latency measurement and no spawn-count assertion is added, by explicit decision. Equivalence is proven by the existing suites for deletion, background deletion, worktree creation, sharing, and recovery, plus new tests for the paths this change restructures: overlap of removal and archiving, per-step failure attribution, the omitted-defaults creation, and the skipped dirty scan under recorded consent.

**Trade-off accepted:** nothing objectively blocks a future change from reintroducing redundant repository or checkout reads. D10 and the collaborator boundaries in D8 are the mitigation.

**Alternative rejected:** an assertion over Git executor call counts on the hot paths — deterministic and cheap, but the maintainer declined any performance assertion.

### D10. Lane, ordering, and resume invariants are preserved

One lane per repository, at most one destructive execution per lane, admission from persisted state only, event-driven resume, and startup re-enqueue all stay as they are. The overlapped teardown runs inside a single lane job, so no second destructive operation can enter the repository while it runs. Git stays confined and policy-checked per command; the change removes redundant commands, never the policy check around them.

## Risks / Trade-offs

- **A worktree changed between the preflight and the removal is no longer detected by a second inspection** → the removal re-validates the persisted binding and the registered-worktree entry, and `git worktree remove` without `--force` refuses a working tree with modified or untracked files. A test forces a change after the preflight and asserts the removal still refuses.
- **Overlapped teardown complicates failure reporting** → each step records its own phase, archiving wins when both fail, and the existing `archivedSessionIds`/`failedPhase` surfaces already withhold an unsafe return.
- **A crash during the overlap leaves a half-removed checkout and a partial archive** → both steps are idempotent: an absent checkout counts as removed, and the archiver skips conversations already recorded as archived. A restart test covers it.
- **Coalesced progress can lag the drawer's counter** → progress flushes at every phase boundary and on failure, so the counter is never stale at a decision point, only within a running phase.
- **No objective regression barrier for performance** → accepted by decision; the collaborator split confines each future redundant read to one small class.
- **Omitting defaults can create a different branch than the one last displayed** → a supplied value always wins, and a caller that needs the displayed value (notice, Git form) keeps sending it. Creation-time derivation is documented as the behavior in the delta spec.
- **Removing `FirstExecutionPorts.worktreeDefaults` changes an internal seam** → the automatic start and the preparation command both go through the create command, and the derivation failure keeps the same problem code.

## Migration Plan

1. Host and client ship in one bundle; the plugin keeps the same persisted records and native Session identity.
2. Journals recorded by an older build resume unchanged: no phase, flag, or field is added or removed.
3. `worktree.create` accepts requests with the branch and destination present or absent, so an older client keeps working against the new host.
4. Rollback is a code revert; no stored value becomes unreadable and no cleanup is required.
5. Bump `version` in `package.json` in the same pull request, per the project's release rule, and update `README.md` and `docs/operations.md` where they describe the destructive lane's sequence.

## Open Questions

- Whether the native adapter's per-command sandbox-policy resolution should later be cached per operation. It is the remaining repeated native read on the hot path, but caching policy crosses the security boundary this change deliberately leaves alone, and the answer does not alter the specs, the approach, or the task breakdown.
