# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- A project today carries one `projectKey` (`src/shared/types.ts`, `src/domain/project-registration.ts`), and a board records `allowedProjectKeys` as a list of those keys (`src/domain/hub-schema.ts`). The invariant that every scope key names a project of the Hub is enforced twice: by `assertKnownProjectKeys` in `src/domain/board-project-scope.ts` and by the Hub schema's cross-check.
- `BoardApplier.applyKey` (`src/host/sharing/sync/applier.ts`) creates a received board and writes its scope inside one transaction through `setBoardProjectScope`, so a refused scope rolls back the board itself. The same call appears in the apply of an already bound board and in `resolve(…, 'team')`.
- A published board log carries project keys only (`openspec/specs/hub-sharing/spec.md`, `docs/user/team-sharing.md`). The layout stamp, the log format, and the journal event vocabulary therefore cannot be used to carry a mapping.
- The placeholder concept is half-built: the `PublishedProject` type, the gates that keep it from owning a task or a worktree, the Hub schema's placeholder rules, the "Awaiting adoption" badge, the adoption save, and the tests all exist; no code creates one.
- Two reception paths exist and must agree: team synchronization and the workflow import file. Today they disagree — synchronization refuses, the import filters.
- Project convention (AGENTS.md): source, specs, and docs in US English; thin orchestration over pure domain modules; no god classes; dependency injection over singletons.

## Goals / Non-Goals

**Goals:**

- One notion of a project's public identity that holds for a board scope, a published log, an exported document, and an imported document, without a translation layer in the write paths.
- One pure domain policy for "a received scope meets this Hub", consumed by both reception paths.
- A received board always lands; the projects it needs are visible and actionable without ever blocking the board.
- The orchestration in `BoardApplier` gets smaller, not bigger, while gaining the new rule.

**Non-Goals:**

- No change to the published layout version, the log format, or the journal event vocabulary.
- No second mapping layer: a project carries at most one published key, because a Hub binds to exactly one team storage.
- No automatic adoption, no guessed directory, no inferred binding from a project name.
- No change to worktree policy, relocation, task creation rules, or the Google Drive reading path (no defect was found there).
- No repair of an existing installation's wrong bindings beyond what the new actions offer.

## Decisions

### D1. A project's public identity is a separate, optional field

A project gains `publishedKey?: string`. Its **published identity** is `publishedKey ?? projectKey`. Board scopes, published logs, exported documents, and imported documents all name published identities; a project without a `publishedKey` behaves exactly as today.

- **Why**: linking an existing project to the team's key becomes an attribute write on that project. No rename, no scope rewrite, no divergence, and the published layout stays byte-compatible.
- **Alternative rejected — rename the local key on merge**: it rewrites other board scopes, leaves received boards naming an identity no project carries, and a later team update recreates the old key as a new placeholder, taking the project off that board.
- **Alternative rejected — translate local keys to published keys at the publish/apply boundary**: every scope comparison (draft detection, applied mirror, board plan) would then operate on two key spaces, and the applied mirror could no longer be compared with the board without a projection. The extra surface buys nothing over a stored attribute.
- **Alternative rejected — a Hub-level `publishedKey → projectId` map**: it admits dangling references, needs its own lifecycle on project delete, and duplicates state that the project can simply carry.

Local and published identities are validated as one namespace: published identities are unique within the Hub, so two projects can never resolve the same board scope entry. Editing a local key migrates scopes only when it changes the published identity — an unbound project keeps today's behavior, a linked project stops touching any scope.

### D2. Reception ensures projects, then writes the scope

A new domain module owns the rule: given the published identities a received board names, the Hub's projects, and the ignored set, it returns the identities to write and the placeholders to create. Both reception paths call it, and both call one `ensurePublishedProjects` operation before writing the scope, inside the same transaction.

A local key and a published identity are different namespaces: a registered project may hold the local key `api` while answering the team's `team-api`. A later reception of the identity `api` therefore cannot reuse it as the placeholder's local key, because local keys are unique. The placeholder takes a scripted distinct local key and carries `api` as its published key, so the scope keeps naming the received identity and adopting the placeholder keeps it. In the ordinary case the two coincide and the placeholder carries no separate published key.

`assertKnownProjectKeys` and the Hub schema invariant are untouched: reception adapts to the invariant by materializing the projects it needs instead of the invariant relaxing for received data. User-authored scopes therefore keep the actionable refusal that protects them from typos.

- **Why**: the invariant is the product's protection against a scope that resolves nothing; weakening it for one path would weaken it everywhere. Materializing is also what the existing specs and docs already promise.
- **Alternative rejected — allow a scope to name an unresolved key**: it makes an invalid scope reachable by every write path, and turns "the board allows a project" into a maybe.
- **Alternative rejected — create placeholders lazily when the Projects surface opens**: the scope would be invalid between the apply and the visit, and a check would re-run the refusal it is supposed to fix.

### D3. Ignoring is a mark on the placeholder, not an edit of the scope

An ignored identity keeps its placeholder, flagged as ignored and hidden from the adoption list. The scope keeps naming it, so the board is never a draft and no publish ever tells the team that the project left the board.

- **Why**: the earlier candidate — removing the key from every scope — makes the board differ from the applied version, so acknowledging "I do not have this project" would silently push a scope change to the team on the next publish.
- **Alternative rejected — a Hub-level ignored-keys list with no placeholder**: it leaves the scope naming nothing unless the invariant is relaxed (D2), and it needs a second lifecycle for restore.
- **Consequence**: removing a placeholder from the registry is the ignore action, which is why the spec's legacy "delete a placeholder" behavior is replaced rather than extended.

Pruning is separate and never records an ignore: once no board of the Hub names an identity, its placeholder carries no meaning and is removed, so a later reception of the same identity creates a fresh placeholder. A batch of board writes prunes once, after its last board, because one board's new scope may drop an identity a later board of the same update names; pruning per board would make the result depend on the order the boards are enumerated. A single board's write, the import file's last entry, or a manual scope save prunes immediately.

### D4. One write authority for the binding: `project.save`

`ProjectInput` gains `publishedKey`. The project editor exposes it, the guided link action submits it, and a save whose requested identity is carried by a placeholder absorbs that placeholder. `project.dismiss` is a narrow command that only toggles the mark on a placeholder.

- **Why**: one field, one command, one set of guards. A separate `project.bind` command would duplicate the conflict and lifecycle rules the save already owns.
- **Alternative rejected — a link dialog that writes a bespoke command**: it cannot reuse the relocation guard, the association guard, or the key-conflict refusal, and it would drift from the editor.
- **Consequence**: linking an existing project submits its current values (name, path, Git root, local key) plus the published key, so a save never looks like a location change. A relocation carries a location and never an identity: the host refuses a relocation that changes either key, exactly as the surface already refused a local-key edit, so a key change is never reported as applied when the journal cannot carry it.

### D5. The file import adopts the same policy

The transfer document keeps carrying published identities. The plan replaces `droppedProjectKeys`/`scopeOpened` with the identities awaiting adoption, and the apply creates the placeholders. The removal of the old filtering requirement is recorded as a removed requirement with its migration note.

- **Why**: a workflow imported from a file and one received from a team are the same event to the person. Two policies for one problem would be a permanent source of surprise, and the current filtering opens a restricted board to every project as a side effect.
- **Alternative rejected — keep filtering, warn harder**: the exported choice is still lost, and the board guesses a scope the exporter never chose.

### D6. One surface for the state, plus a pointer at sync time

The whole story lives in **Configuration → Projects**: an awaiting-adoption summary, each placeholder with the boards that name it, adopt / link / ignore, and an ignored group with restore. Team Settings carries a notice while identities await adoption, with a button that switches the configuration dialog to Projects.

- **Why**: the projects are what are missing; a per-board banner would report a board the person cannot fix from there. The pointer exists because the moment the person learns about the need is when they connect or receive.
- **Alternative rejected — a per-board warning plus a Hub summary**: two more surfaces naming the same state, and the number of boards in the same situation is what makes it noise.

### D7. The applier loses work while gaining the rule

`BoardApplier` keeps sequencing and the three apply paths, and gains a single identity write helper (`applyBoardIdentity`) used by the create path, the existing-board path, and `resolve`. The received-scope policy, the placeholder creation, and the pruning leave it. The duplicated local-board projection (`localBoardOf` and the inline literal in `refusal`) becomes one helper.

- **Why**: adding a fourth scope concern to a class that already owns creation, preset adoption, orphan resolution, removal, and the orphan-column check is how the god class appears. Extraction is also what makes the rule testable without a service fixture.

## Risks / Trade-offs

- [A published identity collides with a local key of another project] → published identities are validated as one namespace, and the conflict is refused with the same actionable shape as today's key conflict.
- [A save absorbs a placeholder the person meant to keep] → absorption happens only when the requested identity is currently carried by a placeholder and the save does not target that placeholder; the operation reports the absorbed identity.
- [An ignored identity accumulates a hidden registry entry forever] → it is pruned as soon as no board names it, and the ignored group presents it with its boards so it is never invisible.
- [The import creates registry entries as a side effect] → they are placeholders, they are pruned when uncited, and the plan names them before the person applies.
- [Strict Hub schemas make the new fields a one-way door for older releases] → `publishedKey` and the ignore mark are local-only and optional; the migration note states that a rollback requires removing them from the stored records or restoring a backup, matching how the Hub record already evolves.
- [Pruning races a scope write in another board's apply] → pruning only removes placeholders no board of the Hub names, and every placeholder is created in the same transaction that writes the scope naming it, so a cited placeholder is never a pruning candidate.
- [The board scope form could present a hidden placeholder as an ordinary project] → it marks the ignored state beside the identity, so a checked hidden identity is explained rather than surprising.
- [A linked project's local key and published key diverge in reporting] → the product-tools scope projection keeps reporting published identities, and `list_projects` carries the published key with the project.

## Migration Plan

1. Land the domain fields and validation first: `publishedKey` and the ignore mark are optional, so an existing Hub opens unchanged and every behavior stays identical while nothing sets them.
2. Land the reception rule and the import rule: from then on a received board creates placeholders instead of failing, and a project marked ignored stays out of the adoption list.
3. Land the client surfaces last: until they exist, placeholders are still visible through the existing adoption badge in the project list.
4. No data backfill is required. Existing projects carry no published key and keep their local key as their published identity; the placeholder concept never produced entries in practice.
5. Rollback: the stored Hub must be restored from a backup taken before the upgrade, or every board scope that names a published identity must be moved back to a local key before the new fields are dropped. Deleting the fields alone does not bring the previous shape back: a project that is linked answers the team's key, so dropping `publishedKey` would leave its board scopes naming an identity no project carries, and an older release refuses that record.

## Open Questions

None that would change the specs, the approach, or the task breakdown. The placeholder naming of an unseen identity is a presentation detail: the registry shows the identity it carries, derived readably, with the exact identity beside it.
