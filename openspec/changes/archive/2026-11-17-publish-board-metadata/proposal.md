# Proposal

## Why

Two user-visible failures share one root cause. Publishing a board is refused with `SHARING_COMPATIBILITY_UNAVAILABLE` whenever the board carries an authored workflow description, a stage description, a decision gate, or a new-board default preset choice — and every board this release creates carries the implicit workflow-operator default, so `Publish board` fails even for a board whose workflow nobody edited. The same fields are treated as unpublished local changes forever, so a Hub whose only activity is moving tasks keeps announcing that there are changes to send, and moving a task never touches the workflow at all.

The previous release introduced those fields with a deliberate fail-closed placeholder: because the storage providers appeared unable to stop an older installation from overwriting new metadata, boards carrying it were kept local. That decision explicitly deferred the real representation to a separate change. This is that change. The published event vocabulary already negotiates its format per board and per event, so a peer that cannot read a new event already refuses to apply or publish over that board; refusing every board up front costs far more than it protects.

## What Changes

- Publish, apply, replay, restore, and revise a board's new-board default preset choice through that board's own log instead of keeping it local. A new board-metadata event (`board.preset-changed`, event format 6) carries the choice, and a receiving installation applies it instead of discarding it.
- Publish and apply authored workflow descriptions, stage descriptions, and decision configurations in the event formats that already represent them (formats 4 and 5). A first receive adopts the team's workflow instead of refusing to adopt a board that carries new metadata. The existing Board default agent preset requirement already demands this preservation through publication and synchronization; this change makes the implementation conform to it.
- **BREAKING** Remove the global storage-compatibility gate and its `SHARING_COMPATIBILITY_UNAVAILABLE` error. The compatible-writer boundary becomes the board's own event-format negotiation: a board whose log carries an event this installation cannot read is reported as requiring a plugin update, is neither applied nor published over, and does not block another board of the same Hub.
- Decide "this board has local changes" from one document signature covering name, project scope, position, canonical workflow, descriptions, decision configuration, and the default preset choice; a board that matches what this installation last applied is in sync.
- Make publishing a board with nothing to append a no-op that re-reads the board, instead of a refusal or an empty event.
- Report pending work truthfully: the team-changes banner names the board whose change it is and otherwise states that another board of the Hub has changes; a board that cannot be published explains why before the action is offered, and the Hub-wide pending-work count no longer nags every board for one stuck board.
- Record the board default preset in the host's own publishing state so local and applied values can be compared, without changing the stored record's layout version.
- Split the 919-line `BoardSync` into a thin facade plus focused collaborators (observer, applier, publisher, removal, connection operations, layout stamp) sharing an injected session, keeping the black-box behavior contract of the existing sharing suite.
- Update the `hub-sharing` spec, the sharing and recovery documentation, the workflow-design preset reference that names the error code, and the package version.

## Capabilities

### New Capabilities

None. This change supplies the published representation the existing capabilities already require.

### Modified Capabilities

- `hub-sharing`: replaces the blanket synchronization incompatibility for descriptions, decision gates, and new-board defaults with a published representation and per-board event-format negotiation; adds one local-change comparison and makes a publish with nothing to append a no-op; adds the board-default event to the published board content; makes the team-changes banner name whose change it reports and explain a block before the action.

No existing requirement in `kanban-board` changes: it already requires the board-owned default preset selection to be preserved through publication and synchronization and calls for an incompatible peer to fail explicitly.

## Impact

- Domain: `src/domain/journal/{event,log,derive,summary,descriptions}.ts`, a new document-signature module, `src/domain/sharing/{board-plan,projection}.ts`.
- Host: `src/host/sharing/{board-sync,service,binding,state,view}.ts` and new collaborator modules; `src/host/board-administration.ts`.
- Client: `src/client/notices/team-banner.tsx`, `src/client/sharing/{status,indicators}.tsx`, `src/client/settings/team-settings/changes-area.tsx`.
- Published format: one new event kind and event format version 6; the layout stamp stays at version 4. Installations that predate format 6 report the affected board as requiring a plugin update.
- Local publishing state: one optional field per stored board; the record layout version stays 4, and a downgrade quarantines the record as any shape change does today.
- Documentation: `docs/user/team-sharing.md`, `docs/user/hubs-and-boards.md`, `docs/operations/recovery.md`, `presets/skills/kanban-workflow-design/references/operations.md`.
- Tests: the sharing service suite keeps its black-box contract; cases that encode the gate and the permanent draft are rewritten, and the collaborator split adds focused unit tests.
