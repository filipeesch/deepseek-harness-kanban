# Design

## Context

See `proposal.md` — Why. The current state that shapes the approach:

- The board write path is already one funnel. `edit_board_yaml`, `update_board`, and every stage-authoring tool compose a document from the stored one, then call `BoardAdministration.saveWorkflowReviewed`, which composes, reviews, and saves behind a single queue. The review produces `WorkflowWriteReport` through `composeWorkflowReport`, and the tool result is that report serialized with `JSON.stringify(value, null, 2)`.
- The literal edit engine matches `old` against the raw text, applies edits in order, and knows the first offset and the occurrence count at failure, but records neither the edit index nor any line number. The refusal projection returns only `code`, `message`, and the report, so the detail the engine does compute never reaches a caller.
- The Hub revision is a single counter on the Hub record, advanced by every Hub mutation, including a task move on another board. Each board keeps its own revision log whose revision numbers are journal event sequences; folding the oldest revisions renumbers the retained ones.
- The board's publishing outcome is decided by `BoardAdministration.publishOutcome`, and the tool path passes the "publish when bound" policy while the interface command path never publishes.
- A scripted stage's durable state already carries the phase, the captured executable version, the entry parameters, the saved result with its delivery status, and — since the last change in this area — the hold record with its code and bounded facts. A pure hold evaluator exists. Nothing projects any of it to an agent, and the card projections deliberately drop the whole deterministic ledger.
- Script execution runs a TypeScript function body or a Bash program through an isolated runtime with a single `tools.bash` binding, and admits an execution only after native capability verification, an immutable capture, and an executable-version approval.
- The workflow-architect preset owns its tool set through a step-time gate, and its skill references sit at the 7,000-character ceiling the project enforces.

## Goals / Non-Goals

**Goals:**

- Keep one write funnel. Every new control and every new report shape is a parameter of that funnel, not a parallel write path.
- Make a write verifiable without reading the document back: one digest computed from the exact bytes about to be stored, reported on success and on refusal, comparable before the call.
- Make an anchor failure actionable from the tool result alone: which edit, which lines, and what the text actually looks like around the closest match.
- Keep the report's cost proportional to what changed, not to the size of the document.
- Give the revision log a truthful origin and a stable identity, without losing the history that installations already hold.
- Keep the agent unable to publish and unable to drive a real scripted execution.
- Reuse the durable hold record and the pure hold evaluator instead of inventing a second reason model.

**Non-Goals:**

- No new scripted-execution control. There is no retry-delivery, play, stop, approve, or parameter-write tool, and this change does not add one.
- No reusable instruction fragments. The workflow format is unchanged; only size is reported.
- No per-board revision counter. The Hub revision keeps its current meaning and is not re-scoped.
- No change to how the product publishes from the interface, and no change to how team updates are applied.
- No real-model verification. Every acceptance check runs in the isolated lanes with deterministic traffic.

## Decisions

### One write funnel with three new controls

`ComposeBoardWorkflowInput` grows `expectDigest`, `dryRun`, and `detail`. The funnel computes the composed text, validates it, computes the digest of those exact bytes, compares the expectation, reviews, and only then persists. `dryRun` short-circuits before persistence and returns the same report.

Alternative considered: a separate `validate_workflow` code path built on the parser. Rejected, because a second review implementation would drift from the one the write enforces. `validate_workflow` becomes a thin call into the same review with an unsaved text, exactly like `layout_metrics` already previews an unsaved document.

Alternative considered: comparing a digest of the parsed semantics. Rejected, because the guarantee the caller wants is about the bytes that were stored, comments included.

### The report is projected, not serialized whole

`composeWorkflowReport` keeps building the complete report, and a new pure projection turns it into the summary shape: stages changed, field names, counts, grouped warnings, authorization impact, affected cards, and sizes. The tool result carries the summary by default and the complete report on request.

Alternatives considered: capping field text by length (lossy and arbitrary), and omitting the difference entirely (the caller cannot confirm the edit landed where it intended). Field names plus the digest plus the existing partial reads give verification without the text.

The digest must be computed before review and reused after, so the digest a caller compares with is the digest of the stored bytes even when publishing later rewrites stage identities. Publishing is out of the tool path after this change, which removes that hazard entirely.

### Anchor failures are structured facts

The edit engine returns a structured failure instead of throwing immediately: edit index, kind, the offsets of every occurrence, the line of each occurrence, the stage each occurrence falls inside when it can tell, and for a missing match the closest authored line with its line number and the first differing character. The refusal projection stops discarding `details`, and the report carries the same facts as bounded problem text so a model that only reads the summary still sees them.

Scope resolution is a separate pure step: a scoped edit narrows the searched text to one stage block, and optionally to one authored field inside it, using the existing authored-text range helpers rather than a new parser.

Alternatives considered: a dedicated stage-scoped edit tool. Rejected as a second API for the same write; the scope is a property of an edit, not of a tool.

### Write one stage's script as a partial write

`set_stage_script` is a stage patch over the deterministic configuration, following `set_stage_routes`: each named part is written, each unnamed part keeps its authored value, and the write goes through the same funnel. A part-level patch avoids sending a 128 KiB source to change one line and avoids literal anchors inside code.

Alternatives considered: one tool per part. Rejected as a larger tool surface for the same behavior.

### Rebase composed writes, refuse replacements

`saveWorkflowReviewed` re-reads the board inside the write lane when the stored document changed since composition, and re-runs `compose` on the fresh text. The retry pins the revision of the read that composed the document, never the stale one the caller supplied or the one read before the conflict, so a change landing between the review and the save is rebased too. Success is the proof that every anchor still matched. A failure returns `REVISION_CONFLICT` with the current Hub revision, the stale revision, and the target board's changed stages and fields, from one shared builder so the compose-time and save-time paths cannot drift. Whole-document replacement keeps a hard pin, because there is nothing to rebase.

Alternatives considered: a per-board revision counter. Rejected for this change: it would add a second revision axis to the stored board schema, the client's write queue, and six sharing call sites, while the rebase solves the reported failure with no migration.

### Revision identity is a counter stored beside the log

The revision log gains a monotonic counter and a baseline record naming `created` or `recovered` and the moment. Existing logs migrate on read: their counter starts at the highest sequence they still list, their baseline is recorded as `created` with the earliest moment the log can prove, and nothing is renumbered. A missing record for a board that already holds a document creates a `recovered` baseline. Each startup compares the log head with the stored document and appends a recovery revision when they differ.

The storage declaration gains the compatible versions it accepts and explicit failure when a record's version is not readable, instead of silently treating it as absent.

Alternatives considered: keeping sequences and stamping them with a generation. Rejected as harder to reason about than one counter.

### Publishing leaves the tool path

The tool path passes the never-publish policy. A new publishing outcome value states that the change is local and no publishing was attempted, so a model never reads an ambiguous value as "maybe published". A removal is the one case where a scope choice *is* the publishing decision, so a tool refuses a team-bound removal and points at the interface instead of creating a team-side orphan nobody can see. The interface keeps its explicit publish action unchanged.

Alternatives considered: a `publish` parameter defaulting to false. Rejected because a default that can be flipped by a model call is exactly the surprise this change removes.

### Diagnostics read durable state; test execution never reaches the host

`get_script_execution` is a pure projection over the task's durable scripted state, the existing hold record, and the task history. It reuses the hold codes the drawer already explains and maps each code to the action that clears it, so the tool and the drawer cannot disagree.

`test_script` reuses the isolated runtime contract for the program body but replaces the shell binding with a simulated one and skips capture, trust, approval, entry, and routing. It does not call the native capability verification a real execution performs, because no real shell is involved, but it does verify the program-runtime half of that contract — a fresh isolated function-body provider that retains no state — since no approval gate stands in front of agent-authored code here. Every text it reports is bounded, and the recorded shell calls are capped with a count of what it left out.

Alternatives considered: a real sandboxed shell. Rejected because a debug run must not have side effects, and because the sandbox policy would become part of the tool's contract.

### Cross-stage lint is pure domain work

Two new observation kinds are computed from the parsed workflow and the card references the report already receives. The reference carries the parameter names a card holds, never a value. Grouping and de-duplication key on the warning kind, the stage, and the reference.

### Extract the deterministic surface from the application root

`app.ts` holds the summary projection, the handoff reservation and acceptance, and the handoff dispatch. These move into a host module with the ports the root already supplies. The extraction is mechanical and precedes the new projection so the new tool has one place to live.

## Risks / Trade-offs

- **A team stops receiving agent edits automatically** → Intended. The board stays a draft, the interface already presents drafts, and the tool result says the change is local. The preset reference and the README are updated in the same change so the operator is told to publish.
- **Rebase hides a concurrent change** → The rebase only proceeds when the composition still applies to the fresh document, and the report describes the text that was actually saved. A composed write that no longer applies fails with the current revision and the target board's changes.
- **A digest expectation computed from a stale read refuses a good write** → The refusal reports both digests and saves nothing, which is the safe direction; the caller can re-read and retry.
- **Existing revision logs migrate** → The migration is read-time and additive: a log without a counter derives one from its retained sequences and is never renumbered. A record that cannot be decoded is reported instead of being replaced.
- **Test execution could be mistaken for a real run** → The result names the simulated responses, every shell call, and the fact that nothing was captured or approved; the tool is declared only for the architect preset.
- **The preset references are at their size ceiling** → Guidance is rewritten by replacing text, and the change must verify the persona and each reference stay under their bounds.
- **The report summary removes text a caller used to compare** → The digest, the partial document reads, and `get_stage` cover the same need; the complete report stays available on request.
- **A Bash program cannot be tested in isolation** → Stated in the tool description, the spec, and the deterministic-steps document: a Bash program is the shell script itself, so the tool refuses it with an actionable problem instead of pretending a simulated shell ran it.

## Migration Plan

1. Land the read-only tools first (`get_script_execution`, `validate_workflow`, `diff_published_board`) — no stored state changes.
2. Land the write controls and the report projection; adjust the tool-publishing tests in the same step.
3. Land the scoped edits and the anchor failure facts; the error codes stay the same, so an existing caller keeps working with richer results.
4. Land the rebase; a stale revision stops being a frequent failure, and the conflict keeps its code.
5. Land the revision store changes with read-time migration and a startup reconciliation; a rolled-back build reads the previous record shape, so the new fields are additive and the previous shape stays decodable.
6. Land the test execution last, behind the architect gate.

Rollback: each step is independently revertible. The revision changes are the only persisted-format change, and they are additive; a build without the new fields ignores them.

## Open Questions

None that would change the specs, the approach, or the task breakdown.
