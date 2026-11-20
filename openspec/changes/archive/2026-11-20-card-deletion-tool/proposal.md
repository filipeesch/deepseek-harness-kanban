# Proposal

## Why

An agent can create, edit, and relate cards, but it cannot delete one: deletion exists only in the task drawer and in the board bulk selection. A board therefore accumulates cards nobody can remove without leaving the conversation that knows why they are obsolete, and an agent asked to clean up a board has to hand the work back to the person.

While tracing the deletion path for this change, one defect surfaced: the background destructive execution removes a task and its notes but leaves the Hub relations untouched, and the Hub schema rejects a stored relation whose endpoint task is absent. Deleting a card that takes part in any relation therefore fails validation with `INVALID_STATE`, from the interface today. Adding a tool on top of that path would make the defect far more reachable.

## What Changes

- Add `delete_card`: one card per call, admitted through the same confirmed deletion command the interface uses. It requires `confirmed: true` as the agent assertion that the user explicitly requested the deletion, and it reads the task current worktree binding itself instead of accepting a path from the model.
- Restrict `delete_card` to cards of the calling conversation Hub scope, rejecting a `task_id` that belongs to another Hub.
- Return immediately with the card identity, the recorded operation phase, and a consequence summary read before admission: conversation counts, notes, relations, worktree path and branch, whether the checkout is a plain folder, and whether local changes are pending consent. Do not expose discard or force, so a worktree with local changes fails the queued preflight and is reported on the card rather than discarded silently.
- Hold deletion to an explicit user request in that conversation. Neither a stage instruction nor a cross-card message authorizes it, unlike relations and transitions.
- Extract the task-removal cascade (task, notes, relations) into the domain so the background destructive execution and every other deletion path share one implementation, fixing `INVALID_STATE` on a card that has relations.
- Remove `HubRepository.deleteTask`, which no production path calls.
- Grant `delete_card` to the planner role allowlist only. The workflow operator and the workflow architect hold no role mask, so they inherit it the way they inherit `create_card`; the project manager stays without any card write.
- Document the new surface in the agent-tools reference and the role boundaries in the preset documentation.

## Capabilities

### New Capabilities

None. The tool belongs to the existing product tool surface, and its deletion semantics belong to the existing task lifecycle.

### Modified Capabilities

- `product-tools`: the restricted board tool surface gains `delete_card`; the explicit-user-intent requirement covers card deletion with the stricter rule that a stage instruction and a cross-card message never authorize it; a new requirement states the tool parameters, Hub-scope rule, consequence payload, and the absence of discard and force.
- `task-lifecycle`: deletion admitted by an agent is the same operation as deletion admitted by the interface, with no second product confirmation and no discard or force path; the confirmation contract is the agent assertion combined with the binding the tool reads at call time.
- `task-relations`: every path that removes a task removes its incident relations in the same mutation, not only the domain-level delete helper.
- `project-role-presets`: the planner allowlist includes the card deletion tool; the manager still excludes every card write.

## Impact

- New files: `src/host/tools/deletion.ts` (the tool, depending on a narrow port) and `src/host/deletion-preview.ts` (the consequence read, composed from the existing deletion-target resolution and the Git local-change read).
- Changed: `src/host/tools/index.ts` registers the tool; `src/host/tools/names.ts` gains the name; `src/host/tools/scope.ts` gains a Hub-scope helper shared with card listing; `src/domain/hub-operations.ts` exports the cascade; `src/host/destructive-operation.ts` calls it; `src/host/hub-repository.ts` drops the unused method.
- Presets: one line in `cordis.patch.yml` for the planner allowlist.
- Docs: `docs/user/agent-tools.md`, `docs/development/presets.md`, `docs/user/presets.md`, and the planner skill card-writing rule.
- No client change: the board and the drawer keep their own confirmation flow and their own recovery surfaces, and they read the same recorded operation.
- Compatibility: no stored shape changes. A Hub holding a relation whose endpoint is missing remains invalid, and this change prevents new ones instead of relaxing the rule.
