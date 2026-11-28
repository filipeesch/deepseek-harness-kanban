# Workflow Authoring Spec Delta

## ADDED Requirements

### Requirement: Preview an ordered structured workflow batch

The workflow architect SHALL be able to preview a nonempty, bounded batch for one existing board at an explicitly expected Hub revision. The batch SHALL accept structured operations for setting and removing agents, setting or clearing stage bindings and instructions, editing stage routes, and editing layout. Operations SHALL compose in the supplied order and use the same authoring semantics as their focused counterparts. The focused tools, exact YAML read and search, and scoped literal edits SHALL remain available. Preview and apply SHALL be gated to the workflow architect and SHALL refuse task-owned conversations and their descendants.

The preview SHALL return the exact candidate YAML, the textual diff from its exact base, the SHA-256 of the candidate UTF-8 bytes, the resolved Hub and board, the base revision, and the validation and impact report. When the candidate or diff does not fit in one response, the complete content SHALL be retrievable in order from the same preview without reading live data in its place. Preview SHALL save no workflow, board revision, task changes, or publication. A malformed operation or failed edit SHALL name the operation index when applicable and SHALL not issue an apply handle. The candidate SHALL preserve unrelated authored text, including unaffected entries in an edited agent list, and preserve unnamed layout values and authored dimensions. The candidate SHALL remain usable by the existing layout measurement with synthetic card counts.

#### Scenario: Preview a coordinated specialist change

- **WHEN** the architect adds a triage agent, binds an existing triage stage to it, and edits the instructions and routes in one ordered batch
- **THEN** the preview shows the exact document with all changes, its diff and digest, and the reviewed Hub revision
- **AND** the live board, tasks, revision history, and publication are unchanged
- **AND** unrelated comments, agent entries, and stage dimensions are unchanged in the candidate

#### Scenario: Reject an invalid operation without a partial result

- **WHEN** a later operation names an agent or route target that is not defined at that point in the batch
- **THEN** the preview reports the failing operation and offers no apply handle
- **AND** none of the earlier operations are stored

#### Scenario: Reconstruct and measure a large candidate

- **WHEN** a preview's candidate YAML or textual diff exceeds one response
- **THEN** successive reads reproduce the original candidate and diff exactly
- **AND** the candidate can be measured with three synthetic cards per stage without changing the saved board

### Requirement: Review final configuration and card impact

The batch preview SHALL validate the complete composed workflow with the existing board-write semantics and report errors separately from warnings. Invalid references or configurations and violations of existing save guards SHALL make the preview inapplicable. Presets and models reported unavailable by the running host SHALL be advisory warnings; a roster that cannot be inspected SHALL not imply that a configured choice is available or unavailable. The preview SHALL NOT claim that it verified session-dependent callable tools or ran stages.

The preview SHALL report identifiable impacts on cards at changed stages, cards affected by changed agent definitions or bindings, and declared and pending routes affected by the candidate, against the preview revision. It SHALL distinguish a declaration made stale from an admitted advance whose destination and instruction already follow the engine's existing capture rules. Reports SHALL carry identifiers, findings and counts, not private card text, conversation content, or parameter values. Bounded report lists SHALL indicate omissions.

#### Scenario: Distinguish configuration findings from execution

- **WHEN** a valid candidate assigns an agent with a preset or model the inspected host roster does not offer
- **THEN** the preview contains an advisory warning and is still applicable if no error exists
- **AND** it does not claim to verify future tool access or successful execution

#### Scenario: Separate declarations from captured advances

- **WHEN** a batch removes an allowed route that one card declared and another card already has as an admitted turn advance
- **THEN** the preview identifies both by identifier and distinguishes stale declared intent from the existing captured advance
- **AND** it does not alter either card or display its private content

### Requirement: Apply the exact preview or refuse without saving

The batch apply SHALL require a valid, unexpired preview handle bound to its creating conversation and resolved Hub and board, and the expected candidate digest. Apply SHALL accept no replacement operations or document. The architect SHALL obtain explicit human approval for the reviewed candidate before invoking apply; a preview handle is not approval. The tool SHALL commit the exact previewed document in one local workflow write, return its stored digest and resulting revision, and keep publication separate. The tool SHALL preserve the existing save and revision attribution rules.

The tool SHALL reject an unknown, expired, unauthorized or mismatched preview, an invalid candidate, or a stale base revision, without persisting any part of that batch. The revision SHALL still match at commit, even when another change left the board YAML identical. The batch SHALL NOT rebase. A stale or changed candidate SHALL require a new preview and approval.

#### Scenario: Store the exact reviewed bytes

- **WHEN** the architect applies the approved preview with its matching digest and unchanged base revision
- **THEN** the stored document exactly matches the previewed bytes, including unrelated comments and dimensions
- **AND** the tool returns its digest and revision without publishing the board

#### Scenario: Refuse a change concurrent with apply

- **WHEN** another write changes the Hub revision after preview but before the batch commits, even if the board's YAML is unchanged
- **THEN** the batch reports a stale preview and saves nothing
- **AND** it preserves the concurrent change rather than rebasing or asking to retry the same handle

#### Scenario: Refuse a mismatched digest or preview owner

- **WHEN** apply names the wrong digest or a preview created by another conversation
- **THEN** the apply is refused without any workflow, revision, task, or publishing changes from the batch

### Requirement: Clarify material choices and review before workflow writes

The bundled workflow architect guidance SHALL direct the architect to reuse known facts and ask short, adaptive `decision_request` questions before proposing when unresolved choices change the objective, stage ownership, or completion criteria. It SHALL NOT require a fixed questionnaire or repeat answered questions, and SHALL distinguish discovery answers from explicit approval to write. For coupled edits it SHALL prefer the structured batch, and before requesting approval to save a change that affects routing it SHALL review the exact candidate and explain its validation and identifiable impacts. It SHALL distinguish engine-enforced rules, card configuration, and agent instructions, and report separately what was inspected, validated, or actually exercised. Validation, layout metrics, and unavailable capability checks SHALL NOT be presented as proof of runtime behavior. The guidance SHALL preserve the existing exact-document, revision, scope, and approval boundaries and SHALL NOT instruct the architect to widen a preset's tools to compensate for a missing capability.

#### Scenario: Clarify an ambiguous workflow goal

- **WHEN** two materially different stage responsibilities or completion criteria remain possible after inspection
- **THEN** the guidance directs the architect to ask about that choice before proposing a concrete edit
- **AND** the answer is not treated as permission to save

#### Scenario: Review a routing change without claiming execution

- **WHEN** the architect reviews the exact candidate and impact report for a routing change without running the workflow
- **THEN** the guidance calls for presenting the candidate change and impacts before asking for approval
- **AND** it distinguishes runtime rules from card settings and prose instructions and labels execution as not exercised
