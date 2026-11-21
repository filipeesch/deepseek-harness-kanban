# Design

## Context

See proposal.md for the motivation. The current state that shapes the approach:

- The first-turn context (`src/host/task-context.ts`) renders the workflow snapshot as indented JSON through the summary paginator under a 6 KiB budget, then the attachment listing under its own 8 KiB budget. Its message source carries no stage entry identity.
- A stage instruction is composed by `src/host/stage-message.ts` as instruction, declared reason, scripted handoff, then the briefing of `src/host/stage-briefing.ts`, which exists only for two or more targets. The admission path knows the entry identity (`admitStageInstruction`) but the message source does not record it.
- Nothing is injected when a stage changes without an instruction delivery: a manual move, a stage without an entry instruction, a decision gate, a scripted stage.
- A stage is classified in two places that must agree: `type` and `routePolicy` in `src/host/workflow-summary.ts` and `routingOwner` in `src/host/tools/transitions.ts`. `list_allowed_transitions` reports stage identifiers and names only.
- `src/domain/transition-reason.ts` has one ceiling (1,000) that the decision gate also depends on: its option title (200), the two prefixes (24), and the person's observation (776) compose a destination reason that must never be cut.
- The operator persona is one line and its skill states the stage types and the declaration rule. `docs/development/presets.md` caps the persona at 4,000 characters and a skill or reference at 7,000.
- The write report warnings are computed in `src/domain/workflow-warnings.ts` and never block a write.

## Goals / Non-Goals

**Goals:**

- Separate facts from behavior: the host states what the workflow says, the operator preset decides what to do with it.
- One derivation of stage kind, routing policy, and exits, shared by every surface that reports them.
- A first-contact map that is complete for realistic workflows, and a live stage that every conversation can trust.
- A navigation protocol in the operator that needs no new tool, no wider allowlist, and no workflow-specific text.
- Additive compatibility, no growth of the application class, and deterministic tests with injected ports.

**Non-Goals:**

- No YAML field, schema change, or stored-data migration, and no change to team sharing.
- No enforcement that blocks a tool because of the current stage; ownership is guidance plus facts.
- No new product tool, and no change to the operator's tool allowlist or to any other role.
- No change to automatic mode, scripted exits, decision gates, or the exceptional-transition contract.
- No real-model acceptance and no per-stage prohibition text.

## Decisions

### 1. Facts in the host, behavior in the preset

The orientation block and the stage notice state facts and never direct an agent. The rules (do not do another stage's work, move to the owner, offer the path and the jump) live only in the operator persona and skill. Every preset receives the same deliveries, and the role presets are documented as independent of any board, so an imperative host text would leak operator behavior into the planner, the manager, and the architect. Alternative considered: a scope fence in every delivery. Rejected for that reason.

### 2. One pure stage classification and one orientation projection

Two domain modules with no I/O: `src/domain/stage-kind.ts` (kind and routing policy of a column) and `src/domain/stage-orientation.ts` (the orientation of a column in a workflow: identity, kind, responsibility, routing policy, exits with destination identity, kind, responsibility, and condition, script exit name, or decision option). The summary projection, the transition tools, the orientation block, the stage notice, and the workflow map all consume them, and the inline derivations in the summary and the transition tool are deleted. Alternative considered: keep each surface's derivation. Rejected: the two existing copies already have to agree by hand.

### 3. The orientation block replaces the briefing's target list

A text renderer builds the block from the projection: stage name and identifier, kind, responsibility or a statement that none is authored, then each exit with its condition and, within a 4 KiB block budget, the destination's responsibility. Over budget it keeps name, identifier, and condition for every exit, drops destination responsibilities, and says so and where to read them. `buildStageInstructionDelivery` puts the block first. The briefing keeps the recorded transition, the applicable default, the tool, its reason and the reason's maximum length, and the end-of-turn timing, but no target list, and still exists only for two or more targets. The stage-instruction delivery carries a `refresh` that composes the block and the briefing again from the live workflow and task, and the plugin delivery calls it synchronously right after its final authority check, so an edit that kept the entry still reaches the message and no await separates the composition from the enqueue. Alternatives considered: the block after the instruction (rejected: the instruction can be long and the block frames it) and the list in both places (rejected: duplication that can drift).

### 4. Entry identity on message sources, additively

The sources of the first-turn context, the stage instruction, and the new stage notice record `entryId` and `columnId` when the task has a stage entry. The delivery type gains an optional entry identity filled from the admission path, which already validates it. Messages without it are legacy; nothing reads a missing value as a mismatch.

### 5. The stage notice is injected at the pre-step, from memory

A new injector registers on the same pre-step hook as the first-contact context and runs after the existing decision so every execution guard keeps its answer. Per live agent it keeps the set of stage entries the conversation is known to have been told about, seeded once from the durable history (every entry named by a first-contact context, stage instruction, or stage notice message that the log appended, in any order). It reads appended messages and not inbox insertions: delivery admission counts an insertion, because it must not steer twice, but a cancel can leave an insertion behind without the message ever reaching the conversation, and the notice decides what the conversation has seen. On a pre-step with user input it resolves the task again after any read, because a read can outlive a move, and compares the current entry with that set: a known entry injects nothing; a batch that carries any message naming the current entry (an older instruction beside it changes nothing) injects nothing; an empty set (a legacy conversation) injects nothing; otherwise it adds one notice with the orientation block and one status line (no entry instruction, decision gate, scripted stage, or instruction not sent yet). An announcement goes before the step's messages, or after the last stage message when that message names an earlier entry, with a sentence that this message is out of date, so the last stage statement the conversation reads is the current one. When the last stage message is stale although the conversation was already told about the current entry, or the batch carries its instruction earlier, the notice is a correction instead: no status line, placed after the stale message, not counted against the once-per-entry rule, which applies only to announcements. A queued instruction for an earlier entry is kept: the host cannot say whether dropping it from a pre-step decision loses it, and the persona already tells the agent to trust the latest orientation or notice. The shared injection helper takes either a message or a message placed after a number of the step's own messages.

What a step carries is tentative: the host can abort after this decision and before the messages are appended. A notice, or a batch that carries any message naming an entry, is therefore recorded as unconfirmed whichever entry the batch names and checked against the log once before the next decision; a message the log never recorded is announced again. A batch whose messages name only an older entry, because the task moved after they were composed, does not suppress the notice for the current one. That confirmation is the only read after the seed, so the log, which can be tens of megabytes, is not read per step. The memory resets when the agent is recreated by a clear. The notice carries no instruction text and starts no turn. Alternatives considered: enqueue the notice from every move path (rejected: many paths and cold sessions), rely on the summary tool (rejected: it is the behavior being fixed), and track only the latest entry told (rejected: an older message recorded later would make the conversation look untold about the current entry).

Deprecation check against the pinned DSH (0.2.2-rc.1, the installed SDK declarations): `agent/pre-step` and `agent/created` (dsh-agent), `observeSession` (dsh-session-query), and `createUserMessage` and `MessageSourceMap` (dsh-llm) carry no `@deprecated` tag, so the injector uses all five. The one deprecated hook declared beside `agent/pre-step` is the call-configuration hook, which this change does not use.

### 6. A shared pre-step injection helper

The first-turn context and the notice share the same skeleton: run after the decision, skip when the decision is not an entry, has no messages, or is aborted, keep per-agent state, reset it on a clear, prepend a message. It moves into `src/host/pre-step-injection.ts` with the per-agent state and the message builder injected, and the attachment section moves into `src/host/task-attachment-section.ts`. `task-context.ts` keeps the envelope, the map assembly, and its registration. The new injector is registered in `src/index.ts` beside the existing one; the application class does not change.

### 7. The first-contact workflow map

A pure renderer takes the projection, the task state, and a budget (16 KiB) and returns text, replacing the paginated JSON in the first-turn context only. One entry per stage in workflow order, the current stage marked, exits and conditions inline; the header carries workflow, board, Hub, initial stage, project scope, sharing, and automatic-mode state. A sketch of the shape:

```text
Workflow: <name> - <description>
Board: <name> (<id>) | Hub: <name> | Initial stage: <id>
Scope: all projects | Sharing: not-published | Auto mode: disabled

* <id> | <Name> | agent-instruction | configured
    <responsibility>
    -> <id> [when: <condition>]; -> <id>
  <id> | <Name> | scripted | scripted
    <responsibility>
    exits: <exit> -> <id>; <exit> -> <id>
```

When the complete map exceeds the budget it keeps the header and the current stage, then the stages the current stage leads to, then the rest in workflow order, each added only if it fits; a stage that does not fit is omitted whole (never truncated), and the closing line states the exact count, names the leading omitted stages whose labels fit whole in a 1 KiB name allowance (at most 40), says how many more there are, and points to the summary tool. The renderer reserves the most that line can take before it keeps a stage, so the budget holds for long and multibyte names. The header, the current stage, and the shortest closing line (count and pointer) are mandatory and written whole, so only they can take the map past its budget, and the names the closing line lists shrink to the room the kept stages leave; the orientation block follows the same rule, where the 4 KiB budget governs the destinations' responsibilities and the current stage's own text is never cut. On a 22-stage board the compact form is about 6.6 KB today and is expected near 10 KB with descriptions at the 300-character ceiling, against 13.9 KB of indented JSON; 16 KiB holds roughly 35 such stages. The attachment listing keeps its separate 8 KiB. Alternatives considered: raise the JSON budget (rejected: the indentation and the separate route records roughly double the size), truncate descriptions (rejected: the description is now the stage's contract), and require the agent to read every summary page at the start (rejected: it reverses the no-startup-call rule and costs three calls per conversation on that board).

### 8. Richer reads without new tools

`list_allowed_transitions` adds kind and responsibility to its stage, its targets, and the explicitly requested destination. `get_workflow_summary` marks the calling task's stage with `current: true` on its stage record and keeps its JSON pages and 6 KiB budget. Both are additive. Path discovery needs no tool: the operator walks the exits of the map and of the discovery result. Alternative considered: a path-finding tool. Rejected: it widens the product surface and the operator allowlist for something the map already contains.

### 9. A separate agent-declared reason limit

`transition-reason.ts` keeps the stored ceiling (1,000) and gains an agent limit (200). `normalizeTransitionReason` takes the limit as a parameter that defaults to the ceiling. The `set_next_transition` handler validates with the agent limit before it calls the port, for both the ordinary and the exceptional declaration, so the board command path, host-composed reasons, and stored data keep the ceiling. The tool description and the reason parameter description are built from the constant. A unit test pins the relation between the decision limits and the ceiling so lowering the ceiling by mistake fails. Alternative considered: lower the shared constant. Rejected: the gate's observation limit of 776 characters would no longer fit and a person's observation would be refused.

### 10. The operator's guidance

The persona (under 4,000 characters) keeps the role, the skill to load, and the standing rule: the current stage is the scope, and work another stage is responsible for is not done here. The skill (under 7,000) carries the protocol:

| Situation | Behavior |
| --- | --- |
| The current stage owns the work, or no stage does | Do the work here |
| The owner is a direct destination | Declare it with a handoff reason of at most 200 characters, finish the stage's own part, end the turn |
| The owner is farther away or unconfigured | Present the configured path (each stage's effect on entry) and the forced jump, wait, then declare the choice |
| Ownership is ambiguous | Ask the person |
| The stage's own work is done | Wait for a manual move |

Ownership comes from the stated responsibilities in the map, the orientation block, and `list_allowed_transitions`; the live stage comes from the latest orientation block, notice, or summary. An authored stage instruction prevails. Examples in the skill are abstract (Stage A, Stage B). The existing rules for stage types, decision gates, and unconfigured routes stay. Behavior is verified only textually; see the risks.

### 11. The architect's guidance and lints

The design skill drops the 150-character rule, states the 300 ceiling, defines the description as responsibility and the transition condition as the exit, and links a new stage-contract reference (under 7,000 characters, neutral examples, short reasons, nothing the orientation block already supplies). Three observations join the write report as new warning kinds computed beside the existing ones: a description over the ceiling, a stage with two or more authored destinations where one has no condition, and a scripted or instructed stage without a description. Decision stages, stages with neither script nor instruction, and scripted exits are excluded. A single ceiling constant serves the lint, and a test ties the skill's stated number to it.

## Risks / Trade-offs

- [The first-contact message grows to 16 KiB] → It is injected once per conversation, compact, bounded, and explicit about omissions.
- [Notice noise or duplicates] → At most one per stage entry per conversation, from in-memory state seeded from history, none for legacy conversations.
- [Whether a model follows the protocol cannot be verified deterministically] → The host facts reduce reliance on compliance, the guidance is checked textually and by composition tests, and a tuning pass with a real model is left out of acceptance. The residual risk is accepted.
- [Vague descriptions make ownership guesses wrong] → The architect guidance and the lints push responsibility into descriptions, and the operator asks when ownership is ambiguous.
- [A 200-character reason can collide with stage instructions that ask for detailed reasons] → The error states the limit so the agent shortens and retries, and the architect reference tells authors to ask for short reasons.
- [Moving by initiative could abandon the current stage's own work] → The protocol finishes what belongs to the current stage first and hands off in the reason; an authored instruction prevails.
- [The forced jump relies on a model-supplied flag] → Unchanged contract. The operator supplies the flag only after the person's explicit confirmation, and no stronger claim is made.
- [The persona ceiling is tight] → The persona states only the standing rule; the protocol lives in the skill, and tests enforce both ceilings.

- [A stage that authors no restriction cannot be declared as an ordinary route] → The existing contract stays: only a configured target is an ordinary declaration, and every other destination, including each stage reached from an unrestricted stage, uses the exceptional path after the person's explicit confirmation. The operator therefore offers the forced jump from such a stage. Extending ordinary declarations to unrestricted stages would widen what an agent may route without a person's confirmation and is left to a separate change.
- [No native replay lane proves the notice row in the drawer and in ordinary chat] → The seeded replay session is updated to the new source shape, the rendering is covered by client and browser tests with the host renderer stood in, and the verification checklist asks the manual lane to confirm the row in both surfaces.

## Migration Plan

1. Ship the host change and the presets together. No data is migrated: message-source fields are additive, a conversation without an entry identity gets no notice, stored reasons and decision-gate reasons are untouched, and the summary and discovery results only gain fields.
2. Boards on the host default preset keep their behavior apart from the orientation facts every preset now receives. The operator rules apply only to conversations that use the operator.
3. Rollback is a revert of the change. Messages that carry the extra source fields stay readable because unknown fields are ignored, and no stored data depends on the new behavior.
