# Proposal

## Why

Workflow architects can preview and save focused edits, but a change that combines an agent definition, a stage binding, instructions, and routes requires separate saves or hand-authored YAML replacements. The architect needs to clarify material ambiguities first, then show exactly what a coordinated change will save and what it can affect before requesting approval.

## What Changes

- Add an architect-only preview and apply flow for an ordered batch of existing structured operations covering agents, stage bindings, instructions, routes, and layout. Keep focused tools, exact YAML reads and search, and scoped literal edits available.
- Show the exact candidate YAML, its textual diff and SHA-256, validation findings, and identifiable card and route impacts. Keep existing measurable layout previews usable with the candidate, including synthetic card counts.
- Save exactly the previewed bytes in one local workflow write after explicit approval; reject an invalid or mismatched candidate or stale Hub revision without a partial write or silent rebase. Preserve unrelated authored text and dimensions, and keep publishing separate.
- Clarify the architect's use of short, adaptive `decision_request` questions on material uncertainties. Separate discovery from approval, and distinguish engine rules, card configuration, and agent instructions when reporting what was inspected, validated, or exercised.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-authoring`: Structured batch preview and exact apply, final configuration validation and impact reporting, and architect guidance for discovery and review.

## Impact

- Affects the workflow authoring tools, byte-preserving YAML editors, board administration, validation and impact reporting, the architect preset and skill, and their tests and documentation.
- No client UI change or approved visual design. No change to live boards, stage execution or routing rules, approval gates on cards, runtime tool inspection, simulators, or same-card handoffs.
