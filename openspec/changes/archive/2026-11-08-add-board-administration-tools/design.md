# Design

## Context

See [proposal.md](proposal.md) for motivation and the capability deltas under `specs/` for the behavior contract.

The current host already owns every board mutation behind `KanbanApp.command`, with the domain rules in `src/domain/hub-operations.ts` and the persisted `HubState` as the single writer in `HubRepository`. Product tools live in one flat `src/host/tools.ts` module and reach the app through `app.command`, `app.createTask`, and direct repository reads. Board workflows are authored as YAML; `parseWorkflow` validates the supported subset, `saveBoardWorkflow` rejects workflows that orphan an existing task stage, and `HubStateSchema` requires the stored YAML and the parsed workflow to stay canonical.

Three constraints shape the approach:

- The Hub revision is the only concurrency unit; a board has no revision of its own.
- Publishing is Hub-wide and lives behind `HubSharingService`, with explicit Git publishing and continuous synchronization for Drive and local folders. The UI marks local changes as drafts and publishes only through its own actions.
- The workflow YAML is user-authored text. The Configuration editor preserves comments and formatting, and a whole-document rewrite by an agent can silently drop them.

## Goals / Non-Goals

**Goals:**

- Add four focused board administration tools plus one extended read tool, without changing the existing task, card, or note behavior.
- Make every board write reuse the domain rules, workflow validation, revision checks, and sharing comparison that the UI already uses.
- Keep the new tool surface small and explicit: one tool per intent, at most four new tools.
- Make board writes unreachable from task-owned sessions, including subagent descendants.
- Preserve the Kanban UI's publishing behavior while letting an explicitly requested tool write publish automatically when the Hub is bound.
- Remove the deprecated `workflow.save` command instead of adding another caller.

**Non-Goals:**

- Hub creation, rename, or deletion through tools.
- Structured workflow operations (set prompt, set transitions, add column) as separate tools or arguments. The whole YAML remains the authoring format.
- A per-board revision, a workflow content hash, or a new persisted field.
- Changing the board lifecycle, workflow parser, sharing comparison, or snapshot shape beyond the documented additions.
- A UI redesign. The only client behavior change is the command identity emitted by the workflow editor.

## Decisions

### Four focused tools instead of one upsert tool

The surface is `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, plus the extended `get_board_summary`. An earlier option merged create and update into one `save_board` tool. Splitting them keeps each argument set honest: creation requires a Hub and a name, an update requires a board identity and at least one change, and a partial edit requires literal spans. It also avoids a tool whose behavior switches between insert and update based on argument presence.

Alternatives considered:

- One `save_board` upsert: fewer tools, but a mixed contract and ambiguous errors when an identifier is mistyped.
- Separate `create_board`, `update_board`, `delete_board`, and a new `get_board_workflow`: four new tools plus an extended summary. Rejected because extending the existing board read keeps the surface smaller and avoids a near-duplicate read tool.

### Extend `get_board_summary` with an optional workflow payload

`get_board_summary` gains `include_workflow`. Without it, the existing summary shape is preserved except for the added `hubRevision`; with it, the tool returns the exact stored YAML, the parsed workflow, the revision, and the board's publishing state.

Alternatives considered:

- Always return the YAML: simpler tool description, but every summary call would carry a potentially large document into the model context.
- Return only the parsed workflow: smaller, but the agent must author the whole YAML for a replacement and cannot round-trip comments.
- A separate read tool: clearer naming, but it would consume one of the four new tool slots for a read that the existing summary can serve.

### Whole-document replacement plus literal partial edits

`update_board` accepts a complete workflow YAML as the escape hatch for restructuring, and `edit_board_yaml` applies literal `old`/`new` pairs for targeted changes. The partial path mirrors the host's file `edit` semantics and preserves comments and formatting outside the replaced spans.

Alternatives considered:

- Whole YAML only: simplest, but the agent can drop comments and unrelated formatting when it rewrites the document.
- Partial edits only: no clean way to replace a large structural block.
- Structured operations on the parsed workflow: safest semantically, but rejected during exploration because it introduces a second authoring model and does not preserve comments when re-emitted.

### Apply partial edits inside the Hub transaction

`edit_board_yaml` does not patch a copy the agent read earlier. The board administration service runs the edit inside `HubRepository.transact`, so `applyWorkflowEdits` matches against the currently stored YAML. Each `old` must occur exactly once at its turn; the pairs are applied in order to an in-memory string. The resulting document then goes through the existing `saveBoardWorkflow` validation and the transaction's schema check. Any mismatch, ambiguous match, parse error, or orphaned stage fails the transaction and persists nothing.

`applyWorkflowEdits` is a pure domain function with its own tests. It reports distinct problems for a missing match and for a repeated match, and it leaves the caller to translate those into tool errors.

A content hash for optimistic concurrency was considered and rejected. The literal match already fails when the edited span changed, the optional Hub revision covers callers that want stricter checks, and a hash would add a new concept to the tool contract without changing the safe outcome.

### Extract a board administration service

A new host service owns board creation, rename, deletion, whole-workflow save, partial workflow edit, and the publishing decision. It receives a narrow set of collaborators:

- the Hub repository, for transactions and reads;
- a board sharing port, exposing the Hub sharing view, the board binding check, local-change notification, board removal, and publish;
- no dependency on `KanbanApp`.

The service serializes its own mutations with a small tail so tool calls and UI commands cannot interleave two board administration operations. The app's `board.*` command cases delegate to the service and keep their command receipts and snapshot behavior. Tools receive the service by injection.

Alternatives considered:

- Tools call `app.command` directly: no new service, but the tool path could not request automatic publishing without changing UI behavior, and the tool module would keep depending on the whole app.
- Keep the logic in `KanbanApp`: fewer files, but grows the app class and leaves two write paths once tools need results richer than a snapshot.
- Put the logic in the tools module: duplicates domain and sharing rules across the UI and agent surfaces.

### Publishing is a call policy, not a service default

The service accepts a publishing policy per call. The command path keeps the current UI behavior: local save, draft marking, continuous auto-sync, explicit publish only through the UI. The tool path requests automatic publishing. This keeps the UI contract intact while honoring the approved tool behavior.

When a tool write asks for automatic publishing, the service:

1. saves the local change and notifies the sharing layer, preserving the existing draft and continuous-sync bookkeeping;
2. if the Hub is not bound or is awaiting connection review, stops and reports that no publishing occurred;
3. for continuous storage, reports that the change is left to automatic synchronization;
4. for explicit storage, publishes through the existing sharing command and reports success, a blocker, or a failure.

A publish failure never rolls back the local write. The tool result carries the local board data plus a publishing outcome so the agent can report a partial success instead of retrying a write that already landed.

A local-only board removal never publishes. The service treats the `local` scope as an explicit instruction not to send the removal to the team.

### Restrict board writes to ordinary DSH chats

The write tools run a guard before resolving or mutating anything. A call is rejected when the calling session is one of a task's conversations or a subagent descendant of one. The guard reuses the task locator for direct ownership and the existing session lineage rule for descendants. A lineage read failure fails closed so a broken topology cannot silently grant board writes. Read tools do not run this guard.

Alternatives considered:

- Only the direct task session: simpler, but a subagent of a task could edit the board its parent conversation is working on.
- A UI-only capability flag: does not describe the actual rule and would not cover ordinary chat.

### Split the tool module and remove the deprecated command

`src/host/tools.ts` becomes `src/host/tools/` with a shared support module, a scope module, and one module per tool family (discovery, cards, notes, boards, questions). The existing helper signatures are preserved; this change is a move-and-compose refactor, not a helper redesign.

The workflow editor sends `board.workflow.save` with explicit Hub and board identities. The deprecated `workflow.save` member leaves the `Command` union, the remote request schema, the command dispatcher, and the client command rewrite. `HubStore.setWorkflow` stays because domain tests use it as a single-board convenience and it is not part of the client protocol.

## Risks / Trade-offs

- **Literal edits are brittle when the model copies whitespace imperfectly** → uniqueness is required, the error reports missing versus repeated matches, the board is unchanged on failure, and the tool description tells the agent to copy text from the read result.
- **A model can still lose comments through whole-document replacement** → the partial tool is the documented default for targeted changes, and the whole-document path is described as a restructuring escape hatch.
- **Automatic publishing could surprise a user who expected a local draft** → only the tool path publishes; the tool result reports the publishing outcome, and a local-only removal never publishes.
- **Publishing is Hub-wide, so a tool write can publish other pending local drafts** → this is the existing publish semantic; the result reports the Hub-level outcome, and the design does not attempt a per-board publish.
- **A publish can fail after the local write succeeded** → the local change is authoritative and the result exposes the failure; automatic retry is deliberately avoided to prevent duplicate boards.
- **Continuous synchronization is asynchronous** → the tool reports that the change is scheduled rather than published; the agent must not claim the team already received it.
- **The lineage read adds work to every board write** → board administration writes are rare; the guard reads only when a write is already authorized by the user, and it fails closed rather than guessing.
- **Removing `workflow.save` is breaking for an external caller** → every in-repo caller and test is migrated in the same change, and the release notes the removal through the version bump.
- **The service's serialization tail can couple unrelated board operations** → board administration is low-frequency; the tail keeps two writes to the same Hub predictable and does not cover unrelated task or conversation commands.

## Migration Plan

No persisted data changes, so there is no data migration. Deploy the service, tools, and client command identity together; the Hub schema, revisions, storage adapters, and sharing records are untouched. The workflow editor starts sending `board.workflow.save` immediately, so an older client and the newer host remain compatible while the deprecated command is removed. Rollback is a code revert: no stored board, workflow, draft, or sharing state depends on the new tools. Bump the package version in the release pull request.

## Open Questions

None.
