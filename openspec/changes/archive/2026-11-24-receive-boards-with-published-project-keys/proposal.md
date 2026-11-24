# Proposal

## Why

A board received from shared storage carries only project keys, never project records. When a receiving installation holds no project for one of those keys, applying the board writes the team's scope and is refused with `INVALID_PROJECT_KEY`, the transaction rolls back, and the board never lands — so the reader cannot open the team's workflow at all. Two boards of the affected team were scoped to projects the second installation did not have, which is exactly the shape of that failure.

The product already specifies that a key a received board names but the Hub does not hold becomes a published placeholder: the type, the gates that keep a placeholder from owning a task, the "Awaiting adoption" badge, and the adoption save all exist and are tested, and the user documentation describes the behavior. Nothing creates the placeholder, so the documented path is unreachable.

Reconciling an existing local project with the team's key has the same root: one key is both the local identity and the published identity, so linking the two means renaming the local project, which rewrites other board scopes and leaves received boards divergent. Separating the two identities removes that class of problem instead of managing it.

## What Changes

- Give a project a **published key** distinct from its local key. A project's published identity is its published key when it has one and its local project key otherwise. Board scopes, published logs, exported documents, and imported documents all name published identities, so publishing and receiving stay symmetrical and the published layout is unchanged.
- **Receive a board that names an unknown project key without failing.** Applying a team board creates a published placeholder for each unknown key in the same transaction that creates or updates the board, so the board applies and the reader gets the team's workflow.
- Let a placeholder be **adopted** by choosing its directory (existing save, keeps the key), **linked** to an already registered project (sets the published key; the local key and every other scope stay untouched), or **ignored** (kept in the registry, hidden from adoption, restorable).
- Keep an ignored key in the board scope. The scope names a placeholder that is hidden rather than a key that resolves to nothing, so the board never becomes a draft and no key has to leave the scope to acknowledge it.
- Prune, after each apply, a placeholder that no board of the Hub cites any more, and never record that pruning as an ignore.
- Expose both identities in the project editor and manage the whole story in **Configuration → Projects**: what awaits adoption, which boards name each key, linking, ignoring, and restoring.
- Point to that section at sync time: after a connection or a team update leaves keys awaiting adoption, Team Settings states it and offers a way to open Projects.
- Apply the **same received-scope policy to a workflow imported from a file**: a key the destination Hub does not hold becomes a placeholder instead of being dropped from the scope. **BREAKING** for the import plan: an imported scope is preserved rather than filtered, and the plan reports the keys awaiting adoption instead of dropped keys.
- Replace the per-surface scope handling with one pure domain policy that the team-apply path and the file-import path both consume.
- Remove the duplicated board projection and the three separate scope writes from the applier while extracting that policy; the applier keeps orchestration only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-contexts`: a project gains a published key distinct from its local key; a received unknown key becomes a placeholder; a placeholder is adopted, linked, or ignored and restored; an ignored key is hidden and stays in the scopes; an unused placeholder is pruned.
- `hub-sharing`: applying a team board whose scope names a key the installation does not hold creates placeholders and applies the board instead of refusing it, and an ignored key is neither re-presented nor removed from the scope.
- `workflow-transfer`: an imported project scope is preserved by receiving its unknown keys as placeholders rather than dropping them; the plan and the result report keys awaiting adoption instead of dropped keys.
- `kanban-board`: a board's project scope names projects by their published identity, so a project's local key and its published key are both shown and the scope keeps naming the identity the team uses.

## Impact

- Domain: `project-contexts` pipeline in `src/domain/project-registration.ts`, `src/domain/board-project-scope.ts`, `src/domain/hub-operations.ts`, `src/domain/hub-schema.ts`, `src/domain/schema-parts.ts`, and a new received-scope policy module under `src/domain/`.
- Sharing: `src/host/sharing/sync/applier.ts` (one identity write instead of three scope writes), a placeholder-creation step in the apply transaction, and the observation of dismissed keys.
- Workflow transfer: `src/domain/workflow-transfer/plan.ts` and `src/host/workflow-transfer/import.ts`.
- Wire and commands: `ProjectInput.publishedKey` and a `project.dismiss` command in `src/shared/types.ts` and `src/remote.ts`; `src/host/app.ts` routes it.
- Client: `src/client/projects/project-list.tsx`, `src/client/projects/project-editor-dialog.tsx`, `src/client/projects/project-draft.ts`, `src/client/projects/use-project-editor.ts`, `src/client/settings/configuration.tsx` (section switch for the Team Settings pointer), `src/client/settings/board/board-project-scope-form.tsx`, `src/client/settings/team-settings/team-settings.tsx`.
- Product tools: `list_projects` reports the published key with the project, and scope reporting keeps naming published identities.
- Specs: `project-contexts`, `hub-sharing`, `workflow-transfer`, `kanban-board`.
- Docs: `docs/user/team-sharing.md`, `docs/user/hubs-and-boards.md`, `docs/user/workflows.md`, with the project registry notes in `docs/user/agent-tools.md` if the tool output description enumerates keys.
- Tests: domain tests for the received-scope policy and the key invariants, host tests for the apply of a board with unknown keys, import tests for the preserved scope, and component tests for the Projects surface.
- No new dependency and no host API change. The published layout, its format version, and the journal event vocabulary are unchanged.
