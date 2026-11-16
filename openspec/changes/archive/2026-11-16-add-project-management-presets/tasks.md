# Tasks

## 1. The board MCP field

- [x] 1.1 Add the optional root `mcp` list to the parsed workflow type and parser: each entry is nonempty text with one segment (a server) or two segments separated by `/` (a `server/tool` entry), and a blank entry, an empty entry, or three or more segments rejects the document. Verify with unit tests covering a server entry, a single-tool entry, an absent field, an empty list, a blank entry, and a three-segment entry.
- [x] 1.2 Add `src/domain/board-mcp-field.ts` in the pattern of `src/domain/board-agent-preset-field.ts`: it writes or clears only the root `mcp` field by text range, preserves every other authored character, and parses its own result before returning it. Verify with unit tests that assert comment and key-order preservation, clearing, an authored empty list, and rejection of a document the parser refuses.
- [x] 1.3 Count the field as workflow meaning rather than layout, so a version that differs only in `mcp` is a meaning change for publishing conflict detection. Verify by extending the existing workflow-meaning test with an `mcp`-only difference.
- [x] 1.4 Expose the stored value on the board summary read as `mcp`, returning the authored list and `null` when the board names no field, so an absent field and an empty list stay distinguishable to a caller. Verify with a tool-level test on a board with the field absent, one with entries, and one with an empty list, plus a malformed entry refused at creation.

## 2. Enforcing the board allowlist on an agent

- [x] 2.1 Add a narrow policy lookup that maps a session to its task's board and that board's allowlist, resolving a session that owns no task to "no policy". Verify with unit tests for a task session, an ordinary chat, and a session whose board cannot be found.
- [x] 2.2 Apply the policy to an agent on creation: compute the denied set as the registered `mcp__`-prefixed tool names minus the allowed entries (a bare server entry allows every tool of that server), apply it in that agent's own scope, and release it when the agent is disposed. Verify with unit tests against a fake registry: an allowed server, a single allowed tool, an absent field applying no mask, an empty list denying every MCP tool, and an ordinary chat left untouched.
- [x] 2.3 Reapply the mask when the tool registry changes, so a server that connects after the agent started is masked to the same allowlist, and a name the registry has never seen is skipped instead of failing. Verify with a unit test that registers a new server tool after the first application and asserts it is denied, and one that asserts the replacement mask releases the previous one.
- [x] 2.4 Wire the policy into `src/index.ts`: track every created agent, forget a disposed one, refresh on `tools/change`, apply it after a new conversation is bound to its task, and release every mask in the plugin's disposal effect. Verify with `pnpm typecheck` and the plugin lifecycle tests that load the module.

## 3. The preset-side policy plugin and the read-only pin

- [x] 3.1 Add `src/preset-tools.ts`: a plugin whose config is `{ allow: string[], denyMcp: boolean }`, which computes the denied set as the registered product tool names minus that allowlist (plus every MCP tool when `denyMcp` is set) and applies it in its own agent scope, tolerating a name that is not registered. Verify with unit tests for the planner list, the manager list, a tool outside the list being denied, and the mask replaced after a catalog change.
- [x] 3.2 Add `src/host/preset-readonly.ts`: a host-side pin that reads the session's preset from the registry and records the sandbox's `read-only` mode on every start of a read-only role's agent, skipping a session that is already read-only. Verify with unit tests over a fake pin: planner pinned, another role and an unreported preset ignored, an already read-only session not recorded twice, a widened session pinned again, and a failure reported instead of thrown. (A preset-scoped pin plugin cannot resolve its own agent before publication; see design D4.)
- [x] 3.3 Export `./preset-tools` from `package.json`, add it to the build entry list and both host tsconfigs, and verify the built package resolves it by importing the built file.

## 4. The two presets

- [x] 4.1 Declare `kanban-project-planner` and `kanban-project-manager` in `cordis.patch.yml` with order 21 and 22, the display names from the spec, and each role's composition: the planner mounts read-only file tools and file search, the bash tool, the web tool, spawn and fork delegation with its control tool, the bundled skills, and `preset-tools` with its allowlist; the manager mounts only the compaction group, the bundled skills, its skill tool, and `preset-tools` with its allowlist and `denyMcp`. Neither mounts the Kanban host plugin nor the host's native question tool.
- [x] 4.2 Write both personas under the bundle's persona size ceiling, stating the role, the tool boundary, and the prohibition on substituting a rule for a missing tool. Verify each persona length and the required statements in the bundle test.
- [x] 4.3 Validate that the bundle test reads each preset row's `preset-tools` allowlist and that every allowlisted name is a registered product tool.

## 5. The two role skills

- [x] 5.1 Write `presets/skills/kanban-project-planning/SKILL.md` with frontmatter, covering the role, the tools it holds and lacks, how it investigates a repository read-only, when it asks the person, and its conventions for cards, notes, and cross-task messages.
- [x] 5.2 Write `presets/skills/kanban-project-orchestration/SKILL.md` with the same shape for the manager: board as source of truth, observation discipline, note and message conventions, and the rule that any change of scope or requirements goes to the planner instead of editing a card.
- [x] 5.3 Verify each skill stays under the bundle's skill size ceiling, and that every relative link stays inside the package.

## 6. The Defaults control

- [x] 6.1 Add the allowlist control to the board Defaults sub-section: keeping every server removes the field, an explicit selection authors the list and may be empty, the selection offers the servers the host reports, a free entry accepts a server or a `server/tool` the list does not offer, and a stored entry the host does not report stays presented as unavailable. Save it in the same guarded workflow write as the model and preset, and expose the host's server list through a new `mcpServers` client API.
- [x] 6.2 Verify the control and its payload with a client test that asserts keeping every server writes no field, an explicit empty selection writes an empty list, a selected server and a typed entry write their entries, the stored-but-unreported entry is kept, an unreadable list is reported with a retry, and a rejected save keeps the draft.

## 7. Documentation

- [x] 7.1 Add the role rules to `AGENTS.md`, the presets and `mcp` field to `docs/operations.md`, and the role presets to `README.md`, keeping each fact in one place and linking instead of copying tool schemas.
- [x] 7.2 Document the root `mcp` field in `presets/skills/kanban-workflow-design/references/workflow-yaml.md` and verify the file's existing link and example checks still pass.

## 8. Verification

- [x] 8.1 Rework the shipped-preset test into a table covering all three presets, asserting each preset's required rows, persona ceiling, skill files, links, and example validity, and verify it passes.
- [x] 8.2 Run `pnpm check` (typecheck, 5,733 vitest tests, build) and `openspec validate add-project-management-presets --strict` and confirm both pass; `npx playwright test tests/browser/mcp-allowlist.spec.ts` also passes and writes light/dark screenshots to the gitignored `.verification/`. The isolated real-composition lane is out of scope by the owner's decision.
