# Workflow YAML: authoring and preservation

Load for one board's stages, instructions, routes, and presentation, not a job engine, multi-board graph, or Cordis composition. Verify against the installed parser.

## Accepted structure

- Root: nonempty `columns` sequence; optional `id`, `name`, `initial_column`, `default_view`, `groups`, `model`, `connections`. Name defaults to `Workflow`; initial stage defaults to the first column. Root `id` is metadata, not a board selector.
- Column: required `id` and `label` (alias `name`); optional `key`, `description`, `allowed_transitions`, `on_enter_prompt`, `position`, `size`. Both display aliases must agree if present. `description` is text, not an instruction; preserve it in exact YAML even though the parsed column payload omits it.
- Group: `label` (alias `name`), nonempty `columns` IDs, optional `id` (otherwise `group-1`, etc.). Groups are presentation, not destinations. Each column belongs to at most one group; group IDs are unique and cannot equal column IDs.
- `model`: nonempty `provider`, `model`, optional nonempty `reasoning_effort`. It sets the board default for **new conversations**, not a stage model, installation default, or existing conversations. Omission means DSH default. Check host routes: the parser validates shape, not availability; an unavailable route can fall back with a notice.

IDs: 1–256 characters, ASCII letter/digit first, then letters/digits/`.`/`_`/`:`/`-`; `__proto__`, `prototype`, `constructor` are reserved. Prefer descriptive IDs; quote numeric/boolean-like scalars. Column IDs and authored keys are separately unique. `key` is stable stage identity for sharing: preserve across edits/renames; do not add keys merely to reformat unpublished workflows.

Unknown fields are rejected: no WIP limits, stage `auto_mode`, agent/preset/engine settings, dependencies, parent/child fields, retry/schedule settings, or arbitrary `metadata`. Use `on_enter_prompt`, not `prompt`; use `columns`, not `stages`. Criteria belong in instructions; coordination belongs in prose protocols.

## Routes and conditions

`allowed_transitions` mixes bare column IDs and `{to, when}` mappings. `to` is required; `when` is optional text (null/blank means no condition). Targets must exist in this document and cannot repeat. Conditions guide models; the runtime does not evaluate their truth.

- **Omitted:** human moves allow any other stage; default progression uses workflow order. The diagram draws only a dashed next-stage arrow. `set_next_transition` has no configured targets to choose.
- **Nonempty:** configured destinations in authored order; the first is default when no route is declared, regardless of conditions. Avoid self-targets: accepted as same-stage reorders, they are not routing targets and stop default progression when first.
- **`[]`:** no permitted destinations/default advance; humans can still confirm restricted moves. This is terminal policy, not “wait until dependency.”

A deterministic stage may declare required `params` (name + optional description). The declaring transition must supply every value; a missing, unknown, or empty value is rejected with accepted names. A value-less entry fails in place; the user repairs it in the script panel. Reserved exits: `error` takes a script or completion failure, `infrastructure` takes a guard or runtime failure and falls back to `error`, and a configuration refusal follows none; neither may target its own stage.

No cross-board YAML transitions exist. Handoffs create separate tasks using an authorized [coordination protocol](coordination.md), not a cross-board move.

## Entry instructions and gates

`on_enter_prompt` accepts multiline text; null/empty/whitespace means no instruction. Use `|`. Each executing stage needs objective/scope, required inputs, bounded actions, output/validation/acceptance evidence, failure/missing-input escalation, and routing responsibility. Explicitly state whether it requests transition discovery/declaration and what evidence justifies each route. Coordination obligations remain conditional on actual user authorization/tool scope.

Do not tell every stage to declare a route automatically: this arms a completed-turn move even with auto mode off. No instruction can be intentional manual intake, but it is not inherently a gate; see [execution mechanics](operations.md#automation-and-human-gates).

## Presentation fields

Preserve these during business-rule edits:

- `default_view`: `board` or `workflow`; omission defaults to board until a local user choice.
- Column `position`: `{x, y}`, finite, absolute values at most 1,000,000.
- Column `size`: `{width, height}`, finite minimums; width 264–10,000, height 140–10,000.
- `connections`: unique `{from, to}` pairs; optional `source`/`target` anchors `{side, at}` (`top`/`right`/`bottom`/`left`, integer 0–4); optional `segments` entries `{axis, offset}` (`x`/`y`, finite absolute offset at most 1,000,000).

Connection layout adjusts drawn arrows; it permits no transitions. Undrawn pairs are kept/ignored, not converted into edges. Do not regenerate layout for an instruction edit.

## Complete review example

Manual intake, one executing review, terminal result. Assume auto mode off for manual intake; this example itself authorizes no creation/message. Review explicitly selects its route after evidence checks.

```yaml
name: Evidence Review
initial_column: intake
default_view: board
columns:
  - id: intake
    label: Intake
    description: Collect the work and its acceptance criteria.
    allowed_transitions: [review]
  - id: review
    label: Review
    allowed_transitions:
      - to: intake
        when: Required inputs are missing or changes are needed.
      - to: done
        when: Every acceptance criterion has supporting evidence.
    on_enter_prompt: |
      Review the deliverable against the task's stated acceptance criteria.
      Do not change the deliverable; read it and its referenced evidence.
      Check each criterion and report pass, fail, or unknown with its evidence.
      If an input is missing, ask the human; pause_task only for a deliberate hold.
      Otherwise summarize findings, then read list_allowed_transitions and declare
      intake when changes are needed, or done only when all criteria pass, with a reason.
  - id: done
    label: Done
    allowed_transitions: []
groups:
  - id: assessment
    label: Assessment
    columns: [intake, review]
```

Display-label edits are not ID migrations. Literal/whole-document writes do not migrate tasks: removing/renaming an occupied ID or an admitted pending transition's reference is rejected. A declared but unadmitted route can instead become stale and block progression; inspect it rather than relying on orphan checks. Preserve IDs unless an approved supported migration is verified; do not promise UI stage-editor migration from text replacement.
