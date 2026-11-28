# Design

## Context

See [the proposal](proposal.md) for the motivation. Focused authoring tools compose text patches and use the reviewed board writer, which can retry a composed edit against a changed Hub revision. The repository already checks an expected revision in the serialized Hub transaction. The workflow save stores the supplied YAML, checks card references, and runs the existing revision and reconciliation hooks. Exact-document reads and candidate layout metrics are separate tools.

## Goals / Non-Goals

**Goals:** One reviewed candidate tied to one coherent Hub snapshot; no intermediate workflow states; reuse the existing editors and validation rather than defining another workflow language.

**Non-Goals:** A new editor UI, a transaction across boards, a general purpose YAML patch language, changes to the existing authoring authorization model, or any proof of stage execution. No visual design applies.

## Decisions

### 1. Compose ordered operations in memory

Expose `preview_workflow_batch` and `apply_workflow_batch` through the architect's existing preset gate and ordinary-chat scope check. A new preview takes a resolved board scope, its expected Hub revision from the exact read, and a bounded, nonempty ordered list. Each operation is a discriminated object using the existing operation name and focused tool arguments, excluding board scope and persistence controls. Support `set_agent`, `remove_agent`, `set_stage_agent`, `set_stage_prompt`, `set_stage_routes`, and `set_layout`. This is a targeted batch, not a mechanism to dispatch arbitrary tools. Group editing, stage creation/removal, and script or decision authoring keep their existing surfaces; scripted exit changes via `set_stage_routes` retain their current semantics.

Extract reusable pure operations from the focused handlers. Each operation sees the result of the previous one, so add an agent before binding it and clear bindings before removing it. Retain the focused editors' structural guards; a failing operation reports its index and does not silently skip. Review the final document as a whole even when individual edits have passed. Do not perform a persistence call or publish as part of composition. Keep focused tool inputs, reports, and retry behavior unchanged. The alternative of calling the focused tools in succession risks partial saves; wholesale serialization would discard unrelated authored bytes.

Target the edited YAML spans. In particular, the current agent helper rewrites the full `agents` list; use entry-scoped editing for the batch so comments and formatting on unaffected entries survive even when another entry changes. Treat unnamed layout values as unchanged, not as values to re-emit. Preserve legacy main-agent resolution and existing preset metadata semantics; no implicit conversion of unrelated board defaults as a side effect of editing a specialist.

### 2. Review one snapshot and keep the candidate immutable

Capture the Hub revision, exact base YAML, board metadata relevant to the write, and minimal card references from the same snapshot. SHA-256 covers the exact UTF-8 candidate bytes. Return the candidate and a textual diff against the base, together with the existing semantic validation report and a card-impact projection scoped to changed stages, changed agent bindings or definitions, and affected declarations and pending targets. Distinguish a declaration made stale by the candidate from an already admitted transition whose captured behavior is governed by existing rules. Report identifiers and reasons, not card content or parameter values. Keep the report's bounds and omission counts. A structurally invalid workflow or a candidate that fails existing save guards receives no apply handle. Host roster observations are advisory; an unavailable roster is not proof of availability or absence. Validation and geometry are not runtime execution.

Keep a bounded, expiring in-memory preview tied to the creating conversation and resolved Hub/board, with the exact candidate, base revision, and digest. Return an opaque preview ID only for applicable previews. Keep exact YAML and diff reviewable for large documents with bounded retrieval (for example, continuation through the preview tool bound to the same immutable result); do not substitute the live board for a preview or use a caller-supplied file path. Layout metrics can still run against the candidate using the existing unsaved-YAML input, including a mapping of three synthetic cards per stage. No cache entry is written to the board or a publishing store. A stateless recompose-plus-hash approach avoids a cache but repeats composition on apply and does not establish that the candidate and its impacts were previewed; a persistent draft would add retention and lifecycle work without a need for it here.

### 3. Apply the retained candidate through a strict reviewed save

`apply_workflow_batch` takes the preview ID and expected candidate SHA-256, not new operations, YAML, revision, or a publishing flag. It rejects an unknown, expired, wrong-conversation, or mismatched candidate. Approval remains the existing explicit human approval boundary for board writes; a preview ID and digest are not approval. Pass the unchanged candidate and preview revision into the reviewed replacement path with publishing disabled. Check the revision at entry for diagnostics and enforce it again in the actual serialized commit. A Hub revision change rejects even if the YAML matches: card/route impact was reviewed against that revision. Never fall through to composed rebase. Require a fresh preview and approval after a stale or changed candidate.

Retain existing writer validation, orphan guards, attribution, and ordinary post-save reconciliation. Stale or mismatched requests fail before those save effects. The atomic unit is the board workflow update, not all post-commit notifications or local history storage; do not describe a committed save as an uncommitted refusal if a post-commit hook reports an error. Return the stored workflow digest and revision on success and verify against the exact committed candidate.

### 4. Teach the workflow architect when to ask and what to report

Keep a short standing rule in the preset and actionable procedure in the bundled skill/references. Inspect known facts first; before committing to a proposal, ask a short, adaptive `decision_request` batch when an unresolved answer changes the goal, ownership, or completion criteria. Do not re-ask settled choices or pad batches. Use focused tools for isolated edits, the batch for coupled edits, and scoped literal edits for gaps. Before saving a routing change, review the exact candidate and explain its impacts; distinguish the engine's rules, card settings, and guidance the agent is asked to follow. Separate inspected configuration, validation findings, and any actual exercises. Retain the existing installed-capability check and exact-document/revision checks; no new host interfaces or broader allowlists are needed by this design.

## Risks / Trade-offs

- A busy Hub can stale a preview even when the board YAML did not change. Refuse explicitly; this protects the impact snapshot rather than optimizing for fewer retries.
- Stored YAML and diffs can contain workflow instructions or script source. Limit review artifacts to the authorized caller, bound retention, and use the existing policy for authored document access; keep task content and parameter values out of impact reports.
- Text patchers may normalize a wider span than intended. Use exact byte assertions on unaffected agents, fields, comments, line endings, and stage dimensions, in addition to semantic checks.
- Host roster availability and script evidence may change separately from the Hub. Treat them as contextual observations, not a promise that a later run will succeed.

## Migration Plan

No workflow schema or Hub persistence migration. Ship additive tools, guidance, and docs with the package version bump required for an installed artifact change. Existing focused tools keep working on old documents. Rolling back removes the new tool flow but does not require rewriting saved workflows; use the existing revision restore mechanism for an authorized content rollback.
