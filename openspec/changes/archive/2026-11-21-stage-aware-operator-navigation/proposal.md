# Proposal

## Why

The workflow operator carries out work in a stage that does not own it, and it cannot navigate the workflow to the stage that does. Reading the code and a real long-running conversation on a 22-stage board shows the causes, none of which is a model-quality problem:

- The first-contact workflow snapshot is rendered as indented JSON under a 6 KiB budget. On that board it carried 11 of 22 stages (35 records omitted), and the operator guidance forbids a startup summary call, so the agent worked with half of the map.
- A delivered stage instruction is the bare authored text. It does not say which stage it belongs to, what the stage is responsible for, or where the task may go next unless the stage has two or more targets.
- A move that delivers no instruction (a manual move, a stage without an entry instruction, an answered decision gate) tells the conversation nothing, so the agent keeps acting on the stage it was in.
- `list_allowed_transitions` reports stage identifiers and names only, so routing decisions are made without knowing what any stage does.
- The operator may declare a route only when asked, so even when it knows another stage owns the work it can only stop and wait.
- Stage descriptions are guidance of 150 characters for the architect and carry no stated responsibility, and the exit condition of a stage has no agreed home.
- Agent-declared transition reasons of up to 1,000 characters were rejected repeatedly because the limit appears only in the error.

## What Changes

- The workflow operator treats each stage's description as the responsibility of that stage. It knows its live stage, performs only the work its stage owns, moves the task by its own initiative to a directly configured stage that owns other work, presents the configured path and the forced jump when the owner is not a direct destination, and executes in the current stage when no stage owns the work. Completing its own work still does not move the task. The standing rule lives in the persona; the protocol lives in the operator skill.
- Every stage-instruction delivery opens with a host-generated orientation block of facts: the stage, its kind, its responsibility, and its exits with their conditions. The briefing stops listing targets and keeps the recorded transition, default target, and declaration mechanics.
- A stage change that delivers no instruction is announced once per conversation by a short stage notice before the next user input, carrying the same orientation block and never the entry instruction.
- The first-contact snapshot becomes a compact workflow map with its own 16 KiB budget that marks the task's stage and names any stage it had to omit. `get_workflow_summary` keeps its paged JSON form and marks the calling task's current stage.
- `list_allowed_transitions` reports the kind and responsibility of the current stage and of every target.
- **BREAKING** Reasons declared through `set_next_transition` are limited to 200 characters, and the tool and parameter descriptions state the limit. The stored ceiling for host-composed reasons, such as a decision gate's, is unchanged.
- The workflow architect writes each description as the stage's responsibility (at most 300 characters, up from 150), writes the exit condition as the `when` of the transition, and keeps rules about other stages' work out of stage text because the operator owns them. A new stage-contract reference ships with the design skill, and the write report gains three observations: a description above 300 characters, a stage with two or more destinations in which a destination has no `when`, and an executable stage without a description.
- Refactors that the change needs: one shared stage classification, one shared stage-orientation projection, and the attachment section and the once-per-agent pre-step injection extracted from the task-context module.

## Capabilities

### New Capabilities

- `stage-orientation`: the neutral stage facts delivered to every agent: the shared projection, the orientation block on each stage-instruction delivery, the stage-change notice, and the compact first-contact workflow map.

### Modified Capabilities

- `workflow-operator-preset`: stage ownership, live-stage awareness, ownership-based routing, the configured-path and forced-jump offer, and the revised route-declaration rule.
- `task-conversations`: the first-turn context carries the workflow map and its entry identity; stage-instruction deliveries open with the orientation block and carry the entry identity.
- `kanban-board`: the transition briefing no longer lists targets; descriptions are guided to 300 characters.
- `product-tools`: transition discovery reports stage kind and responsibility; the workflow summary marks the current stage; declared reasons are limited to 200 characters and the contract states it.
- `workflow-authoring`: descriptions carry responsibility, exit conditions live in `when`, the stage-contract reference ships, and the write report carries the three contract observations.

## Impact

- **Domain:** a stage classification module, a pure stage-orientation projection, a separate agent-declared reason limit, and three new write-report observations.
- **Host:** the stage-message and briefing builders, the first-contact context, a workflow-map renderer, the workflow summary and transition tools, a new stage-notice injector and a shared pre-step injection helper, and the message-source identities of the first-contact context and stage instruction. Wiring stays in the plugin entry point; the application class does not grow.
- **Client:** one context-row claim for the stage-notice source.
- **Presets and skills:** the operator persona and skill, the architect design skill, and a new stage-contract reference, within the persona (4,000 characters) and skill (7,000 characters) ceilings.
- **Docs and specs:** the execution, agent-tools, workflows, and presets guides, and the preset maintenance rules.
- **Compatibility:** no YAML field, schema, or stored data changes, and team sharing is unaffected. New message-source fields are additive, and conversations without an entry identity receive no stage notice. The 200-character reason limit is the only breaking contract; stored reasons and decision-gate reasons are not affected.
- **Verification:** deterministic tests with injected ports only. Whether a model follows the protocol is not verified by acceptance; the host facts are what reduce the reliance on compliance.
