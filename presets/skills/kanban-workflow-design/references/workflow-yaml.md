# Workflow YAML: authoring and preservation

Load for authoring one board; verify against the installed parser.

## Accepted structure

- Root: nonempty `columns`; optional `id`, `name`, `description`, `initial_column`, `default_view`, `groups`, `model`, `agent_preset`, `mcp`, `connections`. Name defaults to `Workflow`; the first column is initial by default.
- Column: required `id` and `label` (alias `name`); optional `key`, `description`, `allowed_transitions`, `on_enter_prompt`, `scripted`, `decision`, `position`, `size`. Both display aliases must agree if present. `description` is optional context, not an instruction.
- Group: `label` (alias `name`), nonempty `columns` IDs, optional `id` (otherwise `group-1`, etc.). Groups are presentation, not destinations. Each column belongs to at most one group; group IDs are unique and cannot equal column IDs.
- `model`: nonempty `provider`, `model`, optional nonempty `reasoning_effort`. It sets the board default for **new conversations**, not a stage model, installation default, or existing conversations. Omission means DSH default. Check host routes: the parser validates shape, not availability; an unavailable route can fall back with a notice.
- `agent_preset`: nonempty roster identity for **new conversations**. An authored preset wins; for absent YAML inspect the effective choice and origin. New-board metadata may select the operator; legacy absence keeps the host default. Shape only; a missing preset can fall back with a notice.
- `mcp`: optional server allowlist; an entry is a server or `server/tool`. Omission keeps every server, `[]` none; shape only.

IDs: 1–256 characters, ASCII letter/digit first, then letters/digits/`.`/`_`/`:`/`-`; `__proto__`, `prototype`, `constructor` are reserved. `key` is stable stage identity for sharing: preserve across edits/renames; do not add keys merely to reformat unpublished workflows.

Unknown fields are rejected: no WIP limits, stage `auto_mode`, per-stage agents or presets, dependencies, or `metadata`. Use `on_enter_prompt`, not `prompt`; `columns`, not `stages`. Criteria belong in instructions; coordination in prose protocols.

## Routes and conditions

`allowed_transitions` mixes bare column IDs and `{to, when}` mappings. `to` is required; `when` is optional text (null/blank means no condition). Targets must exist in this document and cannot repeat. Conditions guide models; the runtime does not evaluate their truth.

- **Omitted:** any other stage is movable and default progression uses workflow order; the diagram draws one dashed next-stage arrow.
- **Nonempty:** authored destinations in order; the first is default without a declaration. Self-targets are reorders, not routing targets.
- **`[]`:** no destination and no default advance; humans can still confirm a restricted move. This is terminal policy, not “wait for a dependency.”

A scripted version is approved once per board and stable stage. An author's inline save authorizes it; a file source, tool write, shared update, publish, or restore needs review.

A scripted stage may declare required `params`, valued from the transition, the preceding script, or the panel. Exact names bind; extras do not; a missing name repairs in place. Conversation destinations see the values as context; script destinations only declared names. Reserved exits: `error` (script/completion), `infrastructure` (guard/runtime, falls back to `error`); configuration refusals follow none, and no exit may self-target.

No cross-board YAML transitions; handoffs create separate tasks through the [coordination protocol](coordination.md).

## Entry instructions and gates

`on_enter_prompt` accepts multiline text; blank means none. Use `|`. Each executing stage needs objective, inputs, bounded actions, output/acceptance evidence, escalation, and routing responsibility. State whether it requests transition discovery/declaration and what evidence justifies a route; coordination obligations stay conditional on authorization and scope.

Do not tell every stage to declare a route automatically: it arms a completed-turn move even with auto mode off. No instruction is inherently a gate; see [execution mechanics](operations.md#automation-and-human-gates).

## Decision steps

A `decision` step stops the flow for one authored choice. It starts no agent turn or program and is exclusive with `on_enter_prompt`, `allowed_transitions`, and `scripted`. `question` is required; `context` and option `description` are optional Markdown. One to twelve options: `id` (safe, unique, the recorded identity), `title`, optional `description`, and `to` (another existing stage; several may share one). One option is an explicit confirmation. The person answers in the drawer and the card keeps the attention tint; a cancelable five-second window precedes the host route, which carries the option and observation as the destination reason and records the choice in history. The stage owns its routing: no automatic or declared advance crosses it, and every manual move out needs the restricted confirmation. Create it with `set_stage_decision`; other stage writers refuse it until cleared or replaced.

Shape: `decision: {question, context?, options: [{id, title, description?, to}]}`.

## Presentation fields

Preserve:

- `default_view`: `board` or `workflow`; omission defaults to board until a local user choice.
- Column `position`: `{x, y}`, finite, absolute values at most 1,000,000.
- Column `size`: `{width, height}`; width 264–10,000, height 140–10,000.
- `connections`: unique `{from, to}`; optional `source`/`target` anchors `{side, at}` (`top`/`right`/`bottom`/`left`, 0–4); optional `segments` `{axis, offset}` (`x`/`y`, finite, |offset| ≤ 1,000,000).

Connection layout adjusts drawn arrows only; undrawn pairs are ignored. Do not regenerate layout for an instruction edit.

## Complete review example

One review, terminal result; this example authorizes no creation or message.

```yaml
name: Evidence Review
initial_column: intake
default_view: board
columns:
  - id: intake
    label: Intake
    allowed_transitions: [review]
  - id: review
    label: Review
    allowed_transitions:
      - to: intake
        when: Required inputs are missing or changes are needed.
      - to: done
        when: Every acceptance criterion has supporting evidence.
    on_enter_prompt: |
      Review the deliverable against the task's acceptance criteria and evidence.
      Report pass, fail, or unknown per criterion. Missing input: ask the human.
      Otherwise summarize, read list_allowed_transitions, and declare intake for
      changes or done when all criteria pass, with a reason.
  - id: done
    label: Done
    allowed_transitions: []
```

YAML writes do not migrate tasks: removing or renaming occupied IDs or admitted-transition references is rejected. A declared but unadmitted route can become stale and block progression; inspect it. Preserve IDs unless an approved migration is verified.