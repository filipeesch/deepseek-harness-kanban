# Proposal

## Why

A workflow stage today can run an agent instruction or a scripted program, or wait for a person to move the card. There is no authored stage that *stops deterministically and asks the person to choose the path*: human gates are improvised with a structured question or an approval, which do not route the card, do not hold the automatic advance by construction, and leave the outcome in conversation text. Boards need a first-class decision stage for explicit confirmations and flow decisions, authored with the workflow, needing no model turn, and routing the card exactly like a host transition.

## What Changes

- A stage MAY author a `decision` configuration: a question, optional Markdown context, and one to twelve options. Each option carries a stable identifier, a title, an optional Markdown description, and a destination stage. It is mutually exclusive with an entry instruction, an allowed-transition list, and a scripted configuration. One option is a valid explicit confirmation.
- A task that enters a decision stage stops: the question is presented in the task drawer through the same presentation as the structured-question surface, and the card is painted with the attention tint and flagged as needing a decision. No agent turn and no program start.
- The person selects one option and confirms, optionally with a bounded observation. A client-side five-second window shows a countdown on the card and in the panel and can be canceled; canceling or reloading applies nothing and leaves the gate unanswered.
- When the window closes, the host applies the choice durably in one transition: the card moves to the option's destination, history records the chosen option and the observation, and an instructed destination receives that choice as its transition reason. A scripted destination starts its own authorized execution instead.
- The decision stage owns its routing: no automatic advance crosses it, no agent tool declares its route (including the exceptional declaration), the card exposes no advance action, and every manual move out of the stage asks for the existing restricted-transition confirmation.
- The stage editor gains a Decision mode and tab; the workflow architect gains `set_stage_decision`; the workflow summary and first-contact context expose the gate's question and option destinations; revisions, diffs, and published boards carry the block under a new event format version.
- Clean-ups in the same change: one routing-owner rule replaces the scripted-only checks (also covering the exceptional-turn admission), one authored-targets helper replaces three duplicated expressions, and stage identity moves beside stage target capture so decision and scripted stages share it.

## Capabilities

### New Capabilities

- `decision-steps`: the authored decision stage, its panel and card surface, the five-second undo window, the deterministic routing of a choice, and the stage's ownership of the routing.

### Modified Capabilities

- `kanban-board`: the card attention priority and the card advance action account for a stage that owns its routing.
- `workflow-authoring`: a decision authoring tool, mutual exclusion with the other stage modes, and decision changes in the write report and authored stage references.
- `stage-editing`: the editor presents a decision mode and tab instead of Execution and Routing, and the instruction and transition fields do not apply to it.
- `task-history`: a decision stage entry records the chosen option and the observation.
- `product-tools`: the workflow summary projects the gate, the transition tools report the routing owner and refuse declarations, and the decision authoring tool stays behind the workflow architect gate.
- `workflow-revisions`: revision comparison and summaries cover the decision block.
- `hub-sharing`: the published event vocabulary carries the decision block under a new event format version.
- `workflow-insights`: route statistics distinguish decision uses and configured options with no use.
- `workflow-operator-preset`: the operator distinguishes the decision gate and never answers it or routes around it.

## Impact

- Domain: workflow parsing and validation, transition access and default destinations, stage placement, stable stage identity and captured targets, task history, journal derivation and materialization, event versions, workflow difference, and the workflow summary projection.
- Host: a new `task.decide` command, the pending-transition drain, the scripted and exceptional admission guards, the transition tools, the workflow summary tool, and sharing board synchronization.
- Client: a decision panel and window controller, card presence and status, the drawer, the stage editor draft and tabs, history presentation, and the diagram's derived connections.
- Presets and docs: the workflow design skill and its YAML reference, the workflow operator skill and spec, and product documentation for the new stage type.
- Compatibility: a board with a decision stage publishes events in format version 5; a peer that understands an earlier format reports that board as requiring a plugin update instead of applying part of it. Existing workflows remain valid.
- Package version bump so the plugin manager and profile report the build.
