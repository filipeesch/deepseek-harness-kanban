# Preset Maintenance

The bundle ships four presets: the default `kanban-workflow-operator`, `kanban-workflow-architect`, `kanban-project-planner`, and `kanban-project-manager`. This document states the maintenance rules for all four.

## Bundle declaration and structure

Keep the architect preset's stable role, interview, approval, language, and safety rules in `cordis.patch.yml`; put task-specific guidance in `presets/skills/kanban-workflow-design/` and load technical references only when needed. Do not turn the persona into a manual.

Review the preset and its references whenever a change affects workflow YAML, product tools or their scopes, stage execution, automatic advance, task communication, board sharing, or preset composition. Check newly enabled capabilities and removed or changed behavior against the implementation and installed DSH contracts; a source-only feature is not a deployed capability.

Update the smallest relevant section in the same change. Replace obsolete guidance instead of appending exceptions or a change history. Keep each fact in one authoritative place; link to a reference instead of copying tool schemas, API signatures, project setup instructions, or general repository documentation. Explain actionable semantics and limits, not implementation trivia.

Keep each fact out of two places: the persona states the role and the standing rules, the skill states how the role works, and a reference states one technical contract.

## Validation

Validate the bundle declaration, the packaged skill paths and links, YAML examples against the current parser, and preset mounting in an isolated DSH composition. Keep the persona under 4,000 characters and each skill or reference under 7,000 characters, leaving room for tool-result wrappers below the 8,192-character pruning threshold. These are ceilings, not targets; remove repetition before adding text. Never use real-model traffic or the owner's profile for acceptance checks.

## The workflow operator

The operator is the default for a new board that authors no preset. Keep its PTC capabilities under the host's ordinary permissions, keep workflow-architect tools out of its declaration, and keep its skill concise: current-stage scope, the three stage types, no startup summary call, and a route declaration only when the stage instruction or the user asks. Its skill is [workflow operation](<../../presets/skills/kanban-workflow-operation/SKILL.md>); the architect's persona and interview rules do not apply to it.

An explicit board preset wins, and a host that does not offer the operator falls back to the host default without blocking conversation creation. New-board preset provenance and authored descriptions are not publishable while the providers cannot exclude older writers; [Team sharing](../user/team-sharing.md) states the refusal.

## Boundaries between the roles

Preserve the architect, planner, and manager boundaries and the existing tool authorization rules. Parent-child and cross-board protocols are agent conventions, not native dependency scheduling, permission grants, or a cross-board transaction.

Ship the planner and manager presets as one role each, and keep their boundaries enforced by composition, the sandbox, and tool masks rather than by persona wording. A role's product-tool allowlist lives in its own preset row through the preset-tools service in [the preset tools](<../../src/preset-tools.ts>); a board's MCP allowlist lives in the root `mcp` field of its workflow. The two policies own different namespaces, so a deny mask on one never intersects the other into an empty tool set. Never widen a role's allowlist to make an instruction work: change the instruction, or explain that the role cannot do it.

Card deletion follows the same boundary: the planner holds it, because the role that agrees a card breakdown also retires a card the person dropped, and the manager does not, because the manager writes nothing on cards. The operator and the architect declare no role mask, so they inherit the tool the same way they inherit card creation.

Keep a role preset independent of any board: no stage, handoff sequence, approval gate, or scope-change cycle belongs in its persona or skill. Those are authored in the stage instructions of the board that selects the preset. A role skill states the role, its tools and their absence, how it investigates or observes, when it asks the person, and how it writes notes, cards, and messages.

## The read-only guarantee

Keep the read-only guarantee real. The planner mounts file tools without write or edit, and its session is pinned to the sandbox's read-only mode at every agent start, including a resumed conversation and an inherited delegated child. A pin the host records is a person-owned setting: the guarantee is that the agent starts confined and cannot widen it, never that a person cannot.

## The manager

Treat the manager as a coordinator: it reads the board and writes notes, messages, its own transition, and its own pause state, and nothing else. Any change of a card, of scope, or of requirements is the planner's work.

## Product-facing description

[Presets](../user/presets.md) describes what each role is for and how a board selects one. This document does not repeat it.
