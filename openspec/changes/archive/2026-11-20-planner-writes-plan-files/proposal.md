# Proposal

## Why

The planner can investigate a project and agree a plan, but the plan only ever exists in the
conversation. A plan is a durable artifact: a person wants to read it later, a separate agent has to
review and correct it, and it should be diffable next to the code it describes. Today the planner
cannot produce one, because its file tools mount without write or edit and its session is pinned to
the sandbox's `read-only` mode, so neither a file tool nor a shell command can create the document.

Relaxing that boundary globally would trade the guarantee the role exists for - a planner that never
touches a repository, against the single capability it actually needs: writing the plan it just
agreed. The change adds that one capability and keeps every other write denied.

## What Changes

- Two product tools, `write_plan` and `patch_plan`, write and correct a Markdown plan under
  `plans/<segment>/<file>.md` inside the calling conversation's workspace.
- Both tools are declared only for an agent on the planner preset, and only the planner preset's
  allowlist carries their names.
- The plan directory is confined twice: the plugin canonicalizes the target and refuses one outside
  `plans/<segment>/`, and the write passes a per-call sandbox policy whose writable root is that
directory. No escalation argument exists on either tool.
- The planner session keeps its `read-only` pin, its file tools keep `write: false` and
  `edit: false`, and its shell keeps failing a file change. The two new tools are the only writes
  the role has.
- The segment is the slug of the owning card's title in a task conversation, and a name the model
  declares, normalized by the same slug rule, in an ordinary chat.
- `write_plan` creates or replaces; `patch_plan` requires an existing file and each searched text
  must occur exactly once. Neither tool deletes a plan, and neither stages, commits, or otherwise
  touches Git.
- Reading stays with the host's own `read`, `glob`, and `grep`, which already work under the
  read-only pin.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-role-presets`: the requirement that the planner works without writing becomes a
  requirement that the planner writes plan files and nothing else, with the two confined tools, the
  unchanged read-only pin, and the delegated-child boundary preserved.
- `product-tools`: a new requirement states what the two plan tools write, where, and what
  they refuse, and the per-role declaration requirement states that they are declared only for the
  planner preset and are absent for every other agent.

## Impact

**Affected code**

- [`cordis.patch.yml`](../../../cordis.patch.yml): the planner row's `preset-tools` allowlist gains
  the two names. Its `tool-fs`, sandbox configuration, shell rows, and delegation rows are unchanged.
- [`src/host/tools/names.ts`](../../../src/host/tools/names.ts): two new entries.
- New module under `src/host/tools/` for the plan tools and the segment resolver.
- [`src/host/tools/index.ts`](../../../src/host/tools/index.ts): the step-time gate becomes a factory
  parameterized by preset, so the plan tools reuse it instead of duplicating the lookup.
- [`src/host/preset-readonly.ts`](../../../src/host/preset-readonly.ts): behavior unchanged; its name
  and doc comment no longer describe the role accurately and are updated in place.
- Planner persona in `cordis.patch.yml` and
  [`presets/skills/kanban-project-planning/SKILL.md`](../../../presets/skills/kanban-project-planning/SKILL.md):
  the "you cannot write" statement becomes the plan-file boundary.
- Documentation: [`docs/user/presets.md`](../../../docs/user/presets.md) and
  [`docs/development/presets.md`](../../../docs/development/presets.md).

**Affected tests**

- `tests/host/workflow-architect-preset.test.ts` gains the planner's new allowlist entries; its
  `write: false, edit: false` and read-only-pin assertions stay valid.
- `tests/host/product-tool-names.test.ts` follows the name list.
- New unit tests for confinement, segment resolution, overwrite, and patch matching, and for the
  preset gate.

**Not affected**

- The manager preset, the workflow architect preset, the host default preset, the board workflow
  format, team files, worktree handling, and the sandbox pin's own behavior.
- No new dependency, no change to `engines`, and no user-visible control in the board or drawer UI.
