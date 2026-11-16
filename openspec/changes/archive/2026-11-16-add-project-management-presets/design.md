# Design

## Context

A preset is an agent's own plugin composition (`@deepseek-ai/dsh-agent-preset`), selected per board
through the workflow's root `agent_preset` and applied to a conversation before its first turn.
After that turn the host refuses a different selection. A conversation therefore cannot change role
mid-card, which is why the two roles need two presets and two boards.

Two facts about tool visibility shape the whole approach:

- The Kanban plugin registers its product tools and the MCP manager registers each server's tools in
  the application scope. Every preset inherits both, so a preset that names nothing still sees the
  whole product surface and every connected MCP server.
- `ctx.tools.restrict({allow, deny})` masks inherited tools for one agent scope. It accepts exact
  names only, throws on a name that is not registered at that moment, and leaves a scope's own
  registrations exempt. Restrictions from several scopes intersect. `tools/change` fires when the
  registry changes, and `agent.ctx` is agent-scoped, so root code can restrict one specific agent.

Sandbox policy is per session: `setSandboxMode(session, mode)` appends a `sandbox/mode` event, a
confined executor denies a write under `read-only`, and the mode survives replay. The plugin's bash
executor is confined in the shipped composition, so `read-only` is enforceable.

The existing workflow architect gate is the precedent for a preset-scoped tool policy: it registers
its tools with a `when` condition that reads `agentPresets.presetForSession`. It can only gate the
plugin's own registrations, which is exactly why it cannot express an MCP policy.

## Goals / Non-Goals

**Goals:**

- Two independently composed role presets whose boundaries are enforced by composition, the sandbox,
  and tool masking — not by instructions alone.
- One policy per namespace, so the preset's product-tool policy and the board's MCP policy cannot
  intersect into an empty tool set.
- A board-authored MCP allowlist that behaves like the other root workflow fields (parsed, authored
  by range, counted as meaning, edited in the guarded Defaults save).

**Non-Goals:**

- Designing the two boards, their stages, or the handoff and scope-change protocol. Those live in
  authored stage instructions, per the decision that presets do not dictate workflow.
- Unifying the workflow architect gate with the new policy plugin. It is recorded as follow-up work
  and is not part of this change.
- Any new product tool, per-stage preset support, or a different conversation model for roles.

## Decisions

### D1. Two presets instead of one preset with a role switch

One preset with a mode would have to hand both roles the union of their surfaces and rely on the
persona to keep them apart. Composition is the only boundary the model cannot argue with, and the two
roles differ in repositories, shell, web, delegation, and card writes. Separate presets also let a
board select its role with the field it already has.

*Alternative rejected:* one preset plus two skills, selected by instruction.

### D2. One policy per namespace

The preset carries the product-tool allowlist; the board carries the MCP allowlist. Each is applied as
a computed **deny** mask over the names registered in its own namespace:

- the preset's policy plugin computes `deny = registered product tool names − role allowlist`;
- the board's policy computes `deny = registered mcp__* names − board allowlist`.

Two `allow` masks would intersect, and the board's MCP-only allow list would then hide the product
tools as well. Deny masks over disjoint namespaces compose safely, and neither mechanism has to know
the other's list.

*Alternatives considered:* a board-authored allowlist over the full surface (forces the board to
enumerate product tools and breaks as tools are added); extending the `when` gate to MCP tools (the
plugin does not own those registrations); one plugin reading both lists (needs a new cross-scope
service just to avoid reading one config file twice).

### D3. The role allowlist is shipped as a preset-scoped plugin from this package

`dsh-kanban` gains a `./preset-tools` export whose plugin takes `{ allow: string[], denyMcp: boolean }`,
resolves it against the registered product tool names, and applies the deny mask in its own agent
scope. The allowlist therefore lives in the preset row that mounts it, which is where the role is
defined, and a profile can override that row through the editor without forking the package.
Registration happens before any agent exists, so the mask is applied once per agent and does not need
re-application.

The same plugin also accepts `denyMcp`. MCP tools are registered in the application scope, so a preset
cannot exclude them by composition; the manager's "no MCP server" boundary therefore needs a mask, and
it belongs with the role rather than with the board. A deny mask on the MCP namespace composes safely
with the board's own MCP deny mask: deny sets union, so the manager keeps none whether or not its board
authors an allowlist.

*Alternative rejected:* a preset-id map inside the host plugin. It would put role policy in code
that every board shares, and a board could not adjust its surface.

### D4. The read-only boundary is applied by the host, keyed by preset identity

The pin runs in the host plugin on each agent start: it asks the preset registry which preset the
session runs on, and when that preset is a read-only role it records the sandbox mode on the session.
A child started without an explicit preset joins the parent's preset revision, so the same lookup pins
the child.

The first attempt mounted the pin as a second preset-scoped plugin, and that does not work: a composed
plugin cannot reliably address its own agent at mount time, because the agent is still unpublished
when its composition loads. The host already sees every agent start and already reads the preset
registry for its workflow-architect gate, so the pin reuses that public face instead of adding a scope
lookup. The repository still preloads the policy that decides it, and D3 remains one plugin with one
reason to change: the allowlist answers "which tools", the pin answers "how much may a tool write".

*Alternatives rejected:* mount a different shell executor per preset (no such configuration exists);
rely on the persona (the requested guarantee is a sandbox denial, not obedience); a preset-scoped pin
plugin (it cannot resolve its own agent before publication).

### D5. The board allowlist is a root workflow field enforced on agent creation

The field is parsed with the existing workflow keys check, written by a range-based writer in the
pattern of `board-agent-preset-field`, counted as workflow meaning, and edited in the guarded
Defaults save. Enforcement reads the session's task, then that task's board, then the allowlist, and
applies the deny mask to the live agent, re-applying when `tools/change` fires so a server that
connects later is masked the same way. Applying it on agent creation rather than conversation
creation covers resume and fork, and an absent field produces no mask at all.

*Alternative considered:* apply only when the conversation is created. It would miss every resumed
agent, which is the common case for a long-running card.

### D6. Two independent skills, no workflow in either

Each preset ships its own skill directory. The skill states the role, the tool boundary, the
investigation or observation discipline, when to ask the person, and the conventions for messages and
notes. Handoff, frozen stages, approval gates, and the scope-change cycle stay in stage instructions,
so a board can change its process without a preset release. Persona stays under the bundle's ceiling
and each skill file under the skill ceiling.

### D7. The bundle test states presets as a table

The shipped-preset test currently asserts a fixed row list and one preset id. It becomes a table of
expected presets and their required rows, validated for all three presets, so a further role is a
table entry rather than an edit to assertions.

## Risks / Trade-offs

- **A deny mask over names the registry has not seen** → compute the deny set from the live registry
  on each application, never from a hard-coded list, so an absent server is a no-op instead of a load
  failure.
- **A server connecting after the agent started** → re-apply on `tools/change`, bounded to the
  agent's own scope.
- **A person can widen the sandbox mode of a planner session** → documented as a person-owned action;
  the pin is restored on the next agent start, and the agent has no tool that changes the mode.
- **The pin depends on the preset registry at agent start** → a host without `agentPresets` reports no
  preset, so the pin does nothing; the planner's file tools still mount without write or edit, and a
  board's default preset cannot be applied on that host either.
- **Restricting a tool the preset itself registers is impossible** → the manager's wall is its
  composition; the spec states this so a future role does not assume masking covers its own mounts.
- **Three carriers of tool policy** (architect gate, role allowlist, MCP allowlist) → recorded as
  follow-up refactor work; this change does not add a fourth and does not silently merge them.
- **No real-composition lane in this change** (explicit owner decision) → the pins and masks are
  proven by unit tests over the ports and by the bundle test; runtime behavior in a live composition
  is not proven by this change, and that residual risk is accepted.

## Migration Plan

No data migration. The presets and the field are additive; a board with no `mcp` field keeps every
server visible and every board keeps its current default preset. Rollback is removing the two preset
rows and the two exports; boards that named a removed preset fall back to the host default with the
existing unavailable-preset notice.

## Open Questions

None that change the specs or the task breakdown. The exact persona wording and skill prose are
authoring detail resolved while writing those files.
