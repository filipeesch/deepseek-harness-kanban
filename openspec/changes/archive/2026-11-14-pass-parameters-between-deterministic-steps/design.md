# Design

## Context

See proposal.md - Why. The current deterministic pipeline is:

- A stage definition declares parameters as names and optional descriptions; values are entry data and never part of the approved executable version.
- One execution produces a completion, saved as a result on the durable deterministic control, then delivered through the router.
- The router places the task in the captured destination with placeTask, and that placement already accepts a parameters map that establishStageEntry writes into the new entry's control.
- A handoff record carries exit, message, source stage, execution identity, and delivery identity. The handoff block is rendered as native context for an agent stage instruction and for a manual destination; a deterministic destination receives the handoff in its script input.
- The executor validates the completion in safety.ts and the supervisor validates it again in deterministic-supervisor.ts. The two validators disagree on size and error details because they grew independently.
- Task, control, result, handoff, and history shapes are strict local schemas. The shared board log and the executable approval fingerprint do not contain parameter values.
- The script parameter editor is a shared Modal rendered inside the card. In the workflow diagram the card lives inside the React Flow viewport, which applies a transform, and the stage clips overflow, so a fixed backdrop and dialog are confined and overlapped by other stages and connections.

The change is constrained by the decisions already made: dynamic values from the completion, exact-name binding, tolerant handling of divergence, model-facing context for conversation destinations, no script-readable raw map, no new authored grammar, and history as the only place the sent values are surfaced as a record.

## Goals / Non-Goals

**Goals:**

- Let one deterministic completion supply the declared parameters of the next deterministic entry by exact name, without changing the workflow grammar, the shared board log, or executable approval.
- Keep every entry path admissible: a missing declared value remains a repairable in-place configuration refusal, never a dead-end delivery failure.
- Present the sent values as bounded, redacted context to a destination that runs a conversation, and keep them out of a deterministic program's structured parameter input beyond declared names.
- Record the sent values as a settled handoff fact and present them in History only.
- Make the parameter editing surface readable in every presentation, including a card inside the workflow canvas.
- Remove the duplicated completion validator and keep the new binding rule in the domain.

**Non-Goals:**

- Authored per-exit mappings, renaming, allow-lists, defaults, optional parameters, or values stored in workflow text.
- Exposing the destination's declaration, or the raw sent map, through script input.
- Parameter passing across tasks, boards, or Hubs, or as a new tool surface.
- A general redesign of every dialog beyond portalling the shared Modal to the plugin root and giving the parameter editor its own layout.
- Reusing values across entries, retries as a new execution, or changing the approval model.

## Decisions

### 1. The completion is the value channel; no authored grammar changes

A successful program may return exit, message, and an optional params object. The field is optional so every existing script and every saved stage definition keeps working. No new deterministic field is authored, so the board-log envelope, the executable fingerprint, and the approval record do not move.

Alternatives considered: a per-exit authored send mapping (would require a new YAML shape, board-log version 4, review changes, and a stage editor, and still could not send a value the script computes at run time) and parsing the message (reintroduces the free-text coupling parameters were created to remove). Both are rejected.

### 2. One pure completion contract, two thin adapters

A new pure domain module validates a completion value once: an object with exactly exit, message, and an optional params map; a nonempty exit name; a nonempty message; safe parameter names; nonempty string values; the accepted parameter count, per-value length, and total size; and the accepted 32 KiB whole-document completion size. The params map is rejected as a whole when malformed, never partially accepted. It returns a typed failure with a code and message instead of throwing a host-specific error.

The executor adapter maps that failure to its existing INVALID_COMPLETION runtime failure. The supervisor adapter maps it to the existing KanbanError contract failure. Redaction stays outside the pure contract: the executor applies its SecretRedactor before returning, and the supervisor applies the known secret values before persisting.

Alternatives considered: keeping the two validators and adding the field to both (the exact duplication this change removes, with a known divergence in size bounds) and validating only in the executor (the supervisor still needs a contract check for a changed runtime provider). Both are rejected.

### 3. Binding is exact-name and happens at routing against the live declaration

The router resolves the captured destination and reads that stage's current declared parameter names. A pure domain function selects the sent values whose names are declared and returns them for placement; sent names that are not declared are not placed in the entry. The same function is the only place the rule lives, so routing, tests, and any future entry path agree.

The destination's declaration is read live rather than frozen into the source capture. Freezing it into the source fingerprint would make an unrelated destination edit invalidate the source stage's approval and force a re-review of code that did not change. A later declaration edit is absorbed by tolerant binding and the existing repair flow.

Alternatives considered: failing delivery when a sent name is unknown (a dead-end: the result is already saved and a retry would fail again) and matching by position or renaming (both violate the exact-name decision). Both are rejected.

### 4. Tolerant divergence: extras do not bind, missing names stay repairable

A sent name the destination does not declare is ignored for entry binding. It remains on the handoff for context and history. A declared name the result did not send is simply absent, so the destination's existing admission refusal names it and offers Play and the parameter editor. Delivery still succeeds; the route does not follow the error exit. This preserves the established rule that every entry is admissible and the supervisor owns the refusal.

### 5. The sent map persists on the result and the handoff, but not in script input

The saved result gains the sent map so a delivery retry or restart recovery reuses exactly the values the program returned without executing it again. The handoff gains the same bounded map for context rendering and history. The script input builder strips the map from the handoff object it exposes: the destination program reads declared names only through input.params, and the handoff keeps its existing exit and message fields. This is the agreed boundary between the parameter channel and model context.

The map is redacted before it is saved or rendered and is bounded by the parameter limits and the 32 KiB completion size bound. Because redaction can only grow a value, the host rechecks the redacted set against the durable value bounds and drops the sent values when the map would no longer parse; the destination then repairs as if the result had sent nothing. Parameter values remain task data, not credentials; redaction is exact-value protection, not a data-loss-prevention boundary.

### 6. Conversation destinations receive a bounded context block

The existing handoff block is the single renderer used by an agent stage instruction and by the manual pre-step injection. It gains a bounded "Sent parameters" section listing the names and values the result carried. This is the same delivery position as a declared transition reason: one native context message, no second prompt, no new conversation. For a manual destination the block is retained and rendered on its next explicit execution, exactly as the message already is.

The block is capped by a small presentation bound in addition to the parameter limits, so a large parameter set cannot crowd out the instruction. A deterministic destination reads no block; it receives declared parameters as input, and any extra values remain history-only.

Alternatives considered: a separate native context row (more UI surface for no additional information), exposing the map on input.handoff (rejected: it would create a second program channel and contradict the declared-names-only input), and omitting the context entirely (rejected: the user explicitly wants the previous step's values visible to the model when a conversation follows).

### 7. History records the sent values on the handoff entry

The logical deterministic handoff entry gains an optional bounded parameters field, written when the handoff acceptance or failure settles. The destination execution entry keeps recording only the values that execution received and used; the handoff entry records what the source sent. This keeps the two facts separate and answers "what crossed the script boundary?" without reading conversations. The History row appends the sent values to its Detail. There is no drawer provenance line: history is the agreed surface.

Alternatives considered: recording the values on the destination execution (it would conflate what was sent with what was used), adding a new row kind (unnecessary: the handoff row is already a settled fact), and omitting them from history (rejected: history is the only agreed audit surface).

### 8. Placement reuses the existing parameters path

The router calls the existing placeTask with the bound map; establishStageEntry already writes it to the new control. No new placement API is introduced. Because establishment clears the previous handoff, the router assigns the new handoff with its sent map after placement, in the same task transaction. A missing handoff or a changed destination identity still follows the existing stale-route handling.

### 9. The shared Modal portals to the plugin root; the parameter editor gets its own layout

The shared Modal renders its backdrop and dialog through a portal into the plugin root element, not document.body and not the card. The plugin root is outside the React Flow viewport transform and the stage overflow, and it still carries the plugin scope and theme variables, so the dialog keeps its styling and above-canvas layering. The existing focus trap, Escape handling, outside-click close, and busy state remain unchanged; portalling changes only the mounting container. A fallback to the nearest plugin root (or the document body with the plugin scope class) covers a harness that does not mount the usual root.

The parameter editor uses a dedicated wide and tall dialog variant with a scrollable value list. Each declared name shows its description and a value field that can hold a large value; the save and cancel actions stay reachable while the list scrolls. The editor remains a draft: opening it reads the current entry values, closing it without saving sends nothing, and saving keeps the existing command semantics.

Alternatives considered: portalling only the parameter dialog (other dialogs share the same clipping defect and the shared fix is smaller than a one-off), portalling to document.body (loses the plugin scope and theme variables), and an inline editor in the card (a larger UX rewrite that does not fix other dialogs). All are rejected.

### 10. Compatibility is additive and explicit

Existing completions without params remain valid; existing workflows, approvals, and board logs are unchanged. New completions with params require the new plugin: the previous release's completion parser requires exactly two keys and will reject a three-key completion, which is expected for a script that adopts the new ABI. New local task records carry optional fields; the previous release's strict local schemas cannot read a record that has them, so a rollback after such a record is written requires the documented local-record backup and restore. No shared log is rewritten on rollback.

### 11. Verification is layered

Pure domain tests cover the completion contract and the exact-name binding. Executor and supervisor tests cover save, delivery, retry, recovery, and the malformed-map contract failure. Router and handoff tests cover binding, extras, missing names, context rendering, and history. Client tests cover the portal and the wide parameter editor, and the browser lane checks both themes and both presentations. The isolated real-composition lane extends the deterministic fixture with a chained script destination so a run proves value passing, conversation context, and the repair path, using only the deterministic replay adapter and a throwaway profile.

## Risks / Trade-offs

- [A previous plugin cannot read a local task record that carries the new optional fields] -> Keep the fields optional, document the required local-record backup before a rollback, and never rewrite the shared board log. The new plugin reads old records unchanged.
- [A script that returns a three-key completion cannot run on the previous plugin] -> Document the ABI addition and bump the installed package version in the same change; existing scripts without params remain valid.
- [The context block can crowd the conversation with large values] -> Apply a small presentation cap and the parameter limits, and render the block only where a conversation consumes the handoff.
- [Parameter values can accidentally contain a secret] -> Redact known exact secret values before persistence and rendering, bound both, and document that redaction is not a complete DLP boundary.
- [A destination declaration changes after the source was approved] -> Bind by exact live name, ignore extras, and leave missing names to the existing repair flow instead of failing the saved result.
- [Portalling every dialog can regress stacking or focus behavior] -> Mount inside the plugin root, keep the existing focus trap and escape handling, and cover the shared dialog in both presentations and both themes.
- [A very large parameter map plus a message can exceed the completion bound] -> Keep the whole-document completion bound authoritative and reject it as one contract failure; the accepted parameter limits still apply inside it.
- [Approval does not cover which values a script sends] -> The destination's declaration is the gate, values are data, and the approved executable version still covers the code that sends them. The product documentation states that a trusted program can send any bounded value for a declared name.

## Migration Plan

- Existing workflows, saved stages, approvals, and board logs need no migration: the grammar and the executable fingerprint do not change.
- Existing task records parse unchanged because every new field is optional; no backfill is performed.
- New local records may carry the sent values on results, handoffs, and history. Before reverting the plugin, stop active scripts and back up local records and credentials as the deterministic guide already requires; an older plugin cannot read those optional fields.
- The package version is bumped in the pull request that changes the installed artifact.
- Verification runs the fast gates, the plugin browser harness, and the isolated real-composition lane with a chained deterministic fixture; no personal profile, real model, or real credential is used.

## Open Questions

None.
