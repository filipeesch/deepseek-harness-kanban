# Design

## Context

See `proposal.md` for motivation. The current implementation is described below only where it constrains the approach.

A deterministic entry captures an immutable record before execution (`src/host/deterministic/capture.ts`): exact primary bytes, language and format, directory choice, **resolved execution directory**, routes with stable destination identities, authorized variable names, and declared parameter names. The SHA-256 fingerprint of that record is the approval key. `createDeterministicTrust` writes one file per `approvalScopeKey + fingerprint`, where `approvalScopeKey` hashes hub, board, and stable stage identity. Local variables and process ownership keep the project-scoped `scopeKey` (`src/host/deterministic/variables.ts`).

The supervisor (`src/host/deterministic-supervisor.ts`) captures on entry, checks the trust file, and persists the entry as `awaiting-trust` when it is missing. Approval is addressed by board, stable stage identity, and executable fingerprint. It is reachable from a waiting card, the board approval queue, and the stage editor before the first entry; every surface opens the same review dialog.

The workflow write report (`src/host/deterministic-impact.ts`) reports one authorization per deterministic stage for the board, planning once with a representative project directory. A directory-dependent source is reported as a limitation of that one version, not as a per-card verdict.

## Goals / Non-Goals

**Goals:**

- Make one local approval cover one executable version of a board stage across all its projects and cards, without weakening review of executable code.
- Separate the approved version from the per-execution context that is not part of a code review.
- Give approval a discoverable home: the waiting card, a board queue, and the stage editor.
- Keep local variables isolated by project and stage while removing their values from the approval review.
- Change the trust scope and report shape without a persisted task-schema migration.

**Non-Goals:**

- Replacing native filesystem or execution policy with approval.
- Freezing imported modules, called executables, or transitive dependencies.
- Approving executable code automatically when a workflow is saved, published, accepted from the team, or written by an agent.
- A revocation action; editing the reviewed inputs is the supported way to force a new review.
- Reworking the deterministic executor, guard, lifetime, or ownership machinery.
- A per-project approval model.

## Decisions

### 1. Split the executable version from the execution capture

A new pure value, the **executable version**, is the unit of review. It contains:

- exact primary program bytes;
- language and program format;
- source form and the authored source reference (inline, or the authored file path);
- directory choice (`task` or `project`);
- named exits with stable destination identities;
- authorized variable names;
- declared parameter names.

The fingerprint hashes that canonical value plus the bytes. It excludes the resolved execution directory, parameter values, and any entry-local data.

The **capture** keeps the version plus the resolved execution directory, the immutable source reference, and the incoming handoff. Admission still requires the task's current directory to equal the captured directory, and the runtime still re-resolves it before launching.

Rationale: a worktree path is execution context, not reviewed code. Excluding it is what lets one board-stage approval cover every card that resolves the same authored version. The directory choice stays in the version because "run in the task" versus "run in the base project" changes what relative paths touch. The captured directory remains validated at admission, so a shared approval can never redirect bytes to an unexpected directory.

Alternatives rejected: (a) keeping the directory in the version and only improving the UI — does not remove the repetition; (b) dropping the admission directory check — would let a capture run in a different directory than the one shown when it was captured.

### 2. Scope approval to the board and stable stage

Add `DeterministicApprovalScope { hubId, boardId, stageIdentity }` for approval. Keep the existing project-scoped type for variables and ownership, and split the key helpers:

- `approvalScopeKey` → approval file names;
- `scopeKey` (existing) → variable credential keys and ownership records.

`ExecuteRequest` carries both the approval scope and the ownership scope. `createNativeSupervisorPorts` builds each from the located board, project, and entry. The supervisor's trust calls use the approval scope; ownership and variable calls keep the project scope.

Rationale: the board owns the workflow, the stable stage identity survives renames, and a stage's executable version is the same code wherever the board applies. Projects remain the scope for local values because those are per repository, and for process ownership because cleanup is per project directory.

Alternatives rejected: (a) board-wide approval without the stage identity — a rename or a reused key could inherit authority; (b) keeping project in the approval scope — that is today's behavior and the reported problem.

### 3. One approval request per executable version

The approval record is keyed by `approvalScopeKey + fingerprint`. The supervisor checks it after capture and before launch. A missing record puts the entry in the existing `awaiting-trust` phase, now presented as **awaiting approval**.

Approval is addressed by the version, not by an execution:

- `deterministicApprove` accepts a board, stage identity or stage id, and the reviewed fingerprint; a task id is optional context.
- The host recomputes or re-reads the version at approval time and rejects a fingerprint that no longer matches the stage's current version or the entry's captured version (`STALE_VERSION`).
- After the trust write, the supervisor reconciles every task of the board whose current entry is in that stage, whose capture fingerprint matches, and whose phase is `awaiting-trust`. The existing per-task reconcile loop, serialized transactions, and ownership checks are reused; the new operation only fans out the same reconcile.
- Approving resumes the waiting execution with its existing `executionId`; Play keeps creating a new execution identity.

The internal persisted phase name stays `awaiting-trust`; only user-facing labels change. Renaming the persisted token would require a task-schema migration for no behavioral gain.

Alternatives rejected: (a) approving by task and applying the grant to the stage as a side effect — keeps the hidden-overlay problem and makes the result depend on which card was opened; (b) a new execution identity on approval — would lose the captured start time and attempt identity.

### 4. Review the version, not the execution

Replace `deterministicReview(taskId)` with one review projection addressed by stage, with an optional task context:

```ts
interface DeterministicVersionReview {
  stage: { boardId: string; stageId: string; stageIdentity: string; name: string };
  version: { fingerprint: string; stageGeneration: string; captured: boolean; directoryDependent: boolean; representative?: { projectId: string; projectName: string; directory: string } };
  code: string;
  language: 'bash' | 'typescript';
  source: { kind: 'inline' | 'file'; reference?: string };
  directory: 'task' | 'project';
  exits: Record<string, string>;
  env: string[];
  params: DeterministicParameter[];
  captured?: { taskId: string; entryId: string; executionDirectory: string };
  approval: 'approved' | 'required';
  directoryDependent: boolean;
}
```

- The review opens from a waiting card (captured context), the board queue (first waiting task), or the stage editor (authored context). The host resolves the authored version by planning the stage definition with a representative project directory — the first project the board allows — and labels the result as not captured. Because approval is content-addressed, approving that version covers any other project that resolves identical bytes.
- The host never returns stored variable values, and the review no longer returns their configured state. Variable names stay in the review because they are part of the reviewed authority.
- The program is rendered read-only with syntax highlighting. Reuse the existing CodeMirror theme and token colors from `src/client/code-editor.tsx` by extracting a read-only `CodeView` with a language compartment; add `@codemirror/lang-javascript` and the shell mode from `@codemirror/legacy-modes` (or an equivalent shell language package) as dependencies.
- Directory-dependent sources: an external file resolved relative to a task directory cannot be resolved before a card exists. The editor review uses the base project directory, marks the version `directoryDependent`, and states that cards resolving different bytes will need their own approval. The same flag is reported by the write report.

Alternatives rejected: (a) keeping variables inside the review and only hiding them in the stage editor — two review behaviors and a coupling of consent with credential entry; (b) a separate review component per surface — four places to keep consistent.

### 5. Local variables get their own surface

Extract `ScriptVariables` from the review into a `LocalVariablesDialog` opened by a dedicated action in the script panel and by the missing-variable diagnostic. It keeps the existing project-and-stage scope, write-only inputs, and stale-scope validation. A small host query (`deterministicVariables(taskId)`) returns the authorized names and configured state for the task's project and stable stage; it returns no values. The review no longer needs variable status, so it can be served without the credential provider.

Rationale: consent to code and configuration of project secrets are different concerns with different lifecycles. Keeping them together made the stage-level review impossible without a project.

### 6. Card attention reuses the existing presence pipeline

The approval state is task-local, not conversation-local. The card derives it from the owned deterministic summary (`phase === 'awaiting-trust'`) and extends `CardPresenceFacts` with an `approval` flag. `projectCardDominance` ranks it after failure and before awaiting reply, so it wins the surface when the card has no error. The existing tint token and mix are reused; no new color token is introduced. For a parameterized entry, the existing status region also carries the read-only parameter values and an inline edit action, so the fixed card regions and the single-line activity strip stay intact.

`AttentionDots` gains a fourth optional state rendered as an attention-colored dot whose accessible name is "Awaiting approval". The mark order becomes approval, unread, awaiting reply, failure, keeping the actionable state first. The mark is derived on the client, so conversation attention stays host-derived and unchanged.

The status strip gets a pending `Awaiting approval` entry, and the activity region's script control becomes `Approve and run` while the entry awaits approval. Stop and Play are not presented in that phase. This keeps one control slot and the reserved one-line height.

Alternatives rejected: (a) adding an approval kind to conversation `PendingUserWork` — would mark a conversation that may not exist; (b) a dedicated card region — breaks the fixed card layout.

### 7. The board queue is a non-dismissible notice

The queue is derived on the client from the snapshot: group owned scripts in `awaiting-trust` by stable stage identity and fingerprint, then render one non-dismissible approval bar per waiting version above the board columns, with the waiting card count, project names when more than one project waits, and a review action. It uses the card's review data and adds no second board-level style.

Alternatives rejected: (a) a host-provided queue projection — would require planning every stage's version on each snapshot; (b) a modal on entry — interrupts unrelated work.

### 8. The write report becomes stage-scoped

`ScriptImpact` drops `projectId` and reports once per deterministic stage for the board: `verdict`, `reasons`, and `detail`. `deterministic-impact.describe` reconciles stage identities once, resolves a representative project for a directory-dependent source, plans the version, checks the new approval scope, and reports `holds` or `changed` with reasons: source, exits, environment, directory, parameters, unapproved, directory-dependent. The per-project loop and the `execution-directory` verdict disappear.

The human editor does not receive the write report today. After a successful save, the editor requests the stage review and keeps itself open when the saved version is unapproved. This keeps the write command unchanged and puts the approval query on the surface that needs it.

Alternatives rejected: (a) extending the save response with the impact — couples every save to executable planning; (b) reporting per project — contradicts the new scope.

### 9. Migration is a clean start

No approval record is migrated. The new file name and fingerprint scheme simply miss every old record, so each stage requests one approval after the upgrade. Old records authorize nothing; a best-effort startup cleanup MAY delete approval files that do not match the new record shape. No task schema changes: entries keep their phase and execution identity. A legacy capture is normalized to a new content-addressed blob with the same verified bytes and execution directory before approval, and the task adopts the new reference in its transaction.

### 10. No revocation action

The product exposes no revoke command. The dead `reject` port method is removed. Editing the reviewed inputs creates a new version and therefore a new request; Stop remains available only while an execution is active.

## Risks / Trade-offs

- **Broader approval scope.** One approval covers every project the board allows, so the same reviewed code can run against another repository's files. Mitigation: the review shows the directory choice and the projects the board allows; local variables stay project-scoped and a missing value refuses execution before code; native policy still applies per directory.
- **Directory-dependent sources stay per version.** A task-relative or project-relative external file can resolve different bytes. Mitigation: the review, the editor, and the report name the limitation instead of claiming a stage-wide approval; inline and absolute sources get the full benefit.
- **Approving from one card starts other cards.** Mitigation: the review and the queue state how many cards wait for that version; the queue count is the visible source of truth.
- **Stale approval race.** The stage can change while the review is open. Mitigation: approval revalidates the fingerprint and rejects with an actionable message; the review must be reopened.
- **Trust files accumulate.** Old records and superseded versions remain. Mitigation: best-effort cleanup of unreferenced, pre-scheme records; the content-addressed source store already has a collection path.
- **CodeMirror weight.** Adding two language packages grows the client bundle. Mitigation: load the review component lazily; if that is insufficient, fall back to a read-only highlighted `pre` for Bash only.
- **Approval fan-out races.** Approving resumes several tasks at once. Mitigation: reuse the serialized supervisor reconcile and per-task transactions; ownership checks still gate each launch.

## Migration Plan

1. Ship the new scope, version, and command with no data migration. Existing installs see one approval request per stage on first use after the upgrade.
2. Old approval files authorize nothing; leave them or purge them best-effort. Rollback: restore the previous build; new approval files are ignored by the old scope key, and each stage requests approval again.
3. Bump the installed plugin version in the same change.

## Verification

- Domain/host unit tests: version fingerprint stability across execution directories; change detection for each reviewed input; stage scope key; clean-start trust lookup; stale approval rejection; approval fan-out across waiting tasks; migration ignores old records.
- Report tests: one authorization entry per stage; reasons; directory-dependent source; no per-card verdict.
- Client tests: card presence priority and approval mark; status line; approval action; queue grouping and counts; review absent variables; read-only highlighting renders the exact bytes.
- Browser tests: light and dark tint and contrast, card and queue layout, review and editor flows, reduced motion.
- Isolated real-composition lane: approve from a card resumes a second waiting card; approve from the editor before the first card; team update requires a new approval; directory-dependent source reports the limitation.
- Gates: `pnpm check`, `pnpm test:browser`, and the `deterministic` e2e lane.

## Open Questions

- Whether to lazily split the CodeMirror language packages or keep them in the main client chunk. This is a bundle-size decision that does not change behavior.
- Whether to purge obsolete approval files at startup or leave them until an explicit maintenance action. Either satisfies the clean-start requirement.
- Exact ordering of several queued stage versions (board column order or waiting count). The queue requirement only fixes grouping and count.
