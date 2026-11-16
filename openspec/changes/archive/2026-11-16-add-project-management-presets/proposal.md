# Proposal

## Why

A board workflow today carries both project planning and project orchestration, and one agent
preset has to serve both. Planning needs investigation, an interview with the person, and card
creation; orchestration needs none of that and only has to read the board, talk to cards, and
record status. A single preset either gives the planner tools it must not use or gives the
orchestrator a surface far wider than its job. The same workflow cannot express that the two roles
must also reach different external systems, so a board has no way to say which MCP servers its
conversations may use.

## What Changes

- Ship two agent presets, `kanban-project-planner` and `kanban-project-manager`, with their own
  composition, persona, and bundled skill.
- The planner investigates without writing: read-only file tools, a bash tool whose session is
  pinned to the read-only sandbox mode, web access, and spawn/fork delegation. The manager has no
  file, shell, web, or delegation tools at all.
- Product tools are declared per preset from each role's allowlist. A product tool outside the
  role's allowlist SHALL be absent from that preset's declared tool set, not merely refused at call
  time. Only the planner receives card writes; the manager reads cards and writes notes, messages,
  and its own transition.
- The planner's session sandbox mode is pinned to `read-only` when its agent starts and again when
  it resumes, and a delegated child inherits the parent's preset revision, so the same pin applies
  to the child.
- Each board's workflow accepts an optional root `mcp` allowlist. An entry is a server name (every
  tool of that server) or `server/tool` (one tool). An absent field keeps every server visible; an
  empty list hides them all. The board's Defaults sub-section gains a control for it, fed by the
  live server list, saved in the same guarded write as the board's model and preset.
- Every agent of a task conversation on such a board has its MCP tools masked to that allowlist,
  including an agent created later by resume or fork, and the mask is refreshed when the tool
  catalog changes.
- The shipped-preset bundle test states its expectations as a preset table instead of a single
  hard-coded row count.
- Documentation covers the three presets, the role boundary, and the new board field.

No breaking change: a board that authors no `mcp` field keeps every MCP server visible, and every
existing board keeps its current default preset or host default.

## Capabilities

### New Capabilities

- `project-role-presets`: the two shipped project-role presets — their composition, read-only
  boundary, delegated children, role tool allowlists, and bundled skills.

### Modified Capabilities

- `kanban-board`: a board's workflow accepts the root `mcp` allowlist and the Defaults
  sub-section configures it.
- `product-tools`: product tools are declared per agent preset from a role allowlist, and a tool
  outside the role's allowlist is absent for that agent.
- `harness-navigation`: the Defaults sub-section also presents the board's MCP allowlist.

## Impact

- `cordis.patch.yml`: two new agent-preset declarations, each mounting the plugins its role needs.
- `presets/skills/kanban-project-planning/` and `presets/skills/kanban-project-orchestration/`:
  one bundled skill per role.
- `src/preset-tools.ts` and `src/preset-readonly.ts`: new package exports a preset mounts; the
  build entry list and `package.json` exports grow with them.
- `src/domain/`: workflow parsing accepts the root `mcp` field, and a new board field writer keeps
  the surrounding authored text.
- `src/host/`: the board's allowlist is applied to a conversation agent's inherited MCP tools, and
  the board summary and authored-document read paths expose the field.
- `src/client/`: the Defaults sub-section gains the allowlist control and its save.
- `tests/`: unit coverage for the role allowlist, the pin, and the board field, plus the shipped
  preset bundle test.
- Documentation: `AGENTS.md`, `docs/operations.md`, `README.md`, and the workflow reference of the
  shipped workflow-design skill.
- No dependency changes. The presets reuse packages the bundle already declares.
