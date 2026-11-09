# Design

See `proposal.md` for motivation and `specs/team-files/spec.md` for the behavior contract. This document covers the host architecture, the boundaries, and the decisions behind them.

## Context

The team storage boundary today is document-shaped. `SharedConfigStore` (`src/host/sharing/store.ts`) reads and writes one whole `kanban-hub.yaml` with a version token, and each `SharingProviderDescriptor` (`src/host/sharing/provider.ts`) creates one store from a binding. `HubSharingService` (`src/host/sharing/service.ts`) owns the per-Hub serialization lane, the records, and every provider-independent rule; its private `run(hubId, operation)` already FIFO-serializes work per Hub through `tails`, `lanes`, and an `AsyncLocalStorage` re-entrancy guard.

Four facts constrain the approach:

- The descriptor is the only place allowed to know how a storage is addressed, validated, and synchronized. The storage-provider boundary requirement forbids branching on the storage identifier inside a service.
- `GitSharedConfigStore.write()` fetches, resets the clone to the remote head, writes the document, commits, and pushes. That reset is safe only while the clone holds nothing worth keeping, so file writes must never leave an unpublished commit behind.
- The current specs promise that a folder-backed storage holds exactly one owned entry. This change turns that into two: the document plus one directory.
- The tools live in `src/host/tools`, are registered from `src/index.ts` through `registerProductTools`, and are built from the `KanbanApp` facade plus an optional dependency, exactly as the sharing service already is.

## Goals / Non-Goals

**Goals:**

- One provider-agnostic service that owns team file semantics (paths, limits, text, trash, search), and one small store per transport.
- The lane that already serializes publishing also serializes file writes, so neither operation observes the clone in an intermediate state.
- The document path and the file path share one Git clone collaborator instead of two independent Git command builders.
- Every failure mode is a typed error the model can act on: unbound Hub, unsupported storage, invalid path, missing file, existing file, binary file, non-unique replacement, team-side change.

**Non-Goals:**

- Team files for Google Drive Cloud. Its client has no generic file listing or content transfer, so the storage reports unsupported instead of growing an API surface this change does not justify.
- Moving, renaming, restoring from the trash, and purging the trash. The trash preserves; nothing else.
- Binary files, images, and attachments. The directory holds text; anything else is refused.
- Any client surface: no browser, listing, editor, snapshot field, or client state.
- Changing the published document, its format version, or the merge rules.
- A new storage provider or a new way to select one.

## Decisions

### 1. A second port, not a wider document port

**Decision:** add `TeamFileStore` as a sibling of `SharedConfigStore`, and make `createFileStore` an optional member of `SharingProviderDescriptor`.

**Why:** the document port carries token and whole-document semantics that mean nothing for a file. Widening it would force every provider, including Google Drive Cloud, to implement file methods or answer them with throws.

**Alternatives:**
- *Extend `SharedConfigStore` with file methods.* Rejected: it makes the document contract ambiguous and forces an unsupported storage to implement a surface it cannot serve.
- *A separate file-provider registry.* Rejected: it duplicates the address rules, settings normalization, binding preparation, and state handling that the descriptor already owns, and reintroduces storage branching in a second place.
- *A capability flag on the descriptor plus a separate factory.* Rejected: the flag and the factory can disagree. The presence of `createFileStore` is the capability.

`ProviderDescription` gains `supportsFiles: boolean`, derived from whether the descriptor has `createFileStore`. Nothing stores it, so it cannot drift.

### 2. Provider-shaped, minimal store; provider-agnostic semantics above it

**Decision:** `TeamFileStore` exposes the smallest set a transport can honestly provide:

```ts
interface TeamFileStore {
  ensure(): Promise<void>;                       // create the root on first write, verify access
  list(): Promise<TeamFileEntry[]>;              // recursive, paths relative, trash excluded
  read(path: string): Promise<TeamFileContent | null>;
  write(path: string, content: string): Promise<TeamFileWrite>;   // create or replace, atomically
  move(from: string, to: string): Promise<void>;
  head?(): string;                               // Git clone commit, for staleness disclosure
}
```

Path validation, limit enforcement, binary detection, search matching, create-versus-replace semantics, and the trash layout all live in `TeamFiles` (below), above the port.

**Why:** the same rules must hold for a folder, a Google Drive Local folder, and a Git clone. Pushing them into each store duplicates three copies of the invariant that matters most.

**Alternatives:**
- *A rich store per transport (`search`, `edit`, `delete` on the port).* Rejected: three implementations of the same search and edit logic, and a Google Drive Cloud implementation would need the same shape for a different transport later.
- *A generic remote filesystem abstraction.* Rejected: it is a larger concept than this change needs and would invite operations the product cannot yet guarantee.

### 3. One rooted directory, two stores by composition

```
                 tools/team-files.ts            src/host/tools/team-files.ts
                          |
                          v
             TeamFiles  (src/host/team-files/service.ts)
             path safety | limits | text | search | trash | error mapping
                          |
                          v  fileStoreFor(hubId)
             HubSharingService.fileStoreFor(hubId)     (existing service, +1 small method)
             record lookup | descriptor | lane | unsupported/unbound errors
                          |
                          v  descriptor.createFileStore(hubId, binding, state)
        +-----------------+------------------+
        v                                    v
  DirectoryTeamFileStore               GitTeamFileStore
  local-folder, google-drive-local     clone + commit + push
        \                                    /
         +-------- TeamFileDirectory --------+
                   rooted fs operations, path containment, atomic replace
                          |
                   GitClone (extracted from GitSharedConfigStore)
```

**Decision:** `TeamFileDirectory` holds the filesystem mechanics against an already-validated root and is used by both `DirectoryTeamFileStore` and `GitTeamFileStore`. `GitTeamFileStore` adds `ensure`, git publication around `write`/`move`, and `head`. A provider-specific availability rule wraps a store instead of entering it: `GuardedTeamFileStore` runs the Google Drive mount guard before every operation, the same guard the document store uses.

**Why:** a Google Drive Local folder and a local folder are the same thing below the descriptor; a Git clone is the same thing plus a commit protocol. Composition keeps the difference to exactly the commit protocol.

**Alternatives:**
- *Two independent filesystem implementations.* Rejected: two places to get atomic replace, containment, and trash moves right.
- *Inheritance from a base store class.* Rejected: the Git store would inherit behavior it must override, which is the usual base-class trap; the repository style is composition with explicit collaborators.

### 4. Path safety is a value object with one construction gate

**Decision:** `TeamFileRoot` is constructed from the resolved absolute root. It exposes `resolve(relative): { absolute, relative }` and throws typed errors. It rejects absolute paths, backslashes, NUL, control characters, empty segments, `.` and `..`; resolves the target with `realpath` and requires the result to stay inside the root; and reserves `.trash`.

**Why:** the only safe place to check containment is where the root is known and after symbolic links are resolved. A caller that can build a path without going through the gate is a caller that can escape.

**Alternatives:**
- *`path.resolve` plus a prefix check.* Rejected: it does not resolve symbolic links, so a link created inside the directory escapes it.
- *Rely on the host file sandbox.* Rejected: the sandbox governs where this plugin runs, not which entries of a team's folder the product promises not to touch, and the guarantee must hold even when the sandbox is wide open.

**Trade-off:** checking and then opening leaves a small window in which a link can be replaced. Closing it fully needs `O_NOFOLLOW`-style opens per platform. The window is accepted and recorded; a changed link fails the containment check on the next call.

### 5. Limits follow the host, and the port does not guess

**Decision:** `TeamFileLimits` holds 2000 lines, 50 KiB of rendered output, 2000 characters per line, 100 path matches, 250 content matches, the native 30-second search deadline, and an 8 MiB cap on any file a tool loads. Read rendering budgets the serialized line objects, not the bare text. A content search also budgets its emitted matches and searches every path-matching file instead of a page of them.

**Why:** the model already calibrates against the native `read`, `glob`, and `grep` limits. A team file surface that returns more than the host's own reader is a surprise, not a feature. The deadline replaces a file-count cap the host does not have, and the input cap exists because a deadline cannot interrupt a decode already in progress.

### 6. Text-only through a fatal decoder

**Decision:** read decodes with a fatal UTF-8 decoder that preserves a byte order mark, and treats a decode failure, a NUL byte in the first window, or a known binary extension as a binary file. Content supplied for a write passes the same classification, and content that does not survive a UTF-8 round trip is refused. There is no lossy fallback.

**Why:** replacement characters silently corrupt content that a later `edit_team_file` would write back, and a decoder that consumes the BOM makes an unrelated edit delete bytes. Failing loudly is the only safe behavior for a file that can be edited.

### 7. Trash by move, with a timestamped relative path

**Decision:** delete resolves the target, computes `.trash/<original relative path>.<ISO timestamp with colons replaced>`, creates the parent inside the trash, and moves. The destination is allocated with a hard link, which fails when the name is taken instead of replacing it, and a suffix is tried a bounded number of times; exhaustion is a typed failure rather than a replacement. The store returns where the file actually landed, and that is what the tool reports. The trash is outside every tool's reachable namespace — by path or by an alias that resolves into it — and is never purged.

**Why:** a shared folder has no guaranteed history, so a reversible operation is worth the disk. The timestamp removes the collision case that a plan relative path alone would have.

**Alternatives:**
- *Recursive remove.* Rejected by the product decision that deletion is recoverable.
- *Flat trash with a timestamp.* Rejected: two files named `notes.md` in different directories become indistinguishable.

### 8. Git: reads never fetch, writes fetch and compare

**Decision:**
- `read`, `list`, and search use the clone as it stands. Results carry `head`.
- `write` and `move` call `fetch`; then compare the target path's content at the fetched head with the working tree copy. A difference fails the write with `TEAM_FILE_CHANGED` before anything is mutated, and the clone is still brought to the fetched head so the next read is current.
- Otherwise the clone is reset to the fetched head before the write, adopting unrelated team changes; that keeps the push a fast-forward.
- On success: write the file, `git add` the path, commit with a fixed message, push to the default branch.
- A refused push resets the clone to the fetched head and reports whether that rollback succeeded, so the clone and the remote stay identical and `GitSharedConfigStore.write()` keeps its unconditional reset.
- The automatic check resets the clone to the fetched head when no tracked file is modified, which is what makes a read at most one interval behind.

**Why:** the clone is the only copy the read tools see, and the automatic publishing check is what refreshes it. Writing against a stale copy is the one way to lose a teammate's document. Comparing after the fetch turns that into a clear, retryable error.

**Alternatives:**
- *Fetch on every read.* Rejected: it makes every tool call pay the network for a freshness the check already provides.
- *No comparison; rely on the push being rejected.* Rejected: the rejection arrives after the clone was mutated, and the message would be a generic non-fast-forward rather than the path that changed.
- *Rebase and reapply the edit.* Rejected: it silently resolves a conflict the product resolves nowhere else.

**Consequence to accept:** a read can be one check interval behind. `head` is reported so the caller can tell, and a write always compares against the fresh remote.

### 9. Serialization reuses the publishing lane

**Decision:** `HubSharingService` exposes `exclusive(hubId, operation)` — the existing lane, made re-entrant for the same Hub — and `fileStoreFor` returns the store wrapped in it. `TeamFiles` holds that seam for a whole create, edit, or delete, so the read-modify-write is one acquisition, and resolves the binding inside the lane so a queued write cannot use a disconnected location. Document publishing already goes through the lane; file writes then queue behind it and vice versa.

**Why:** the lane already exists with the right key, FIFO ordering, re-entrancy guard, and busy state for the interface. A second mutex would be a second source of truth about whether a Hub is busy.

**Alternatives:**
- *Reuse `OperationQueue`.* Rejected: it is job-shaped, deduplicates by owner and operation id, and returns no promise to the caller; its lane key is a repository, not a Hub.
- *Let the stores lock themselves.* Rejected: two stores, one clone, and no shared key.

**Consequence:** while a file write is in flight, the Hub reports `busy` and the interface shows a syncing state, which is truthful.

### 10. `TeamFiles` is the only place that knows team file semantics

**Decision:** `TeamFiles` depends on a narrow port, not on `HubSharingService`:

```ts
interface TeamFileStoreSource {
  store(hubId: string): TeamFileStoreResolution;
  exclusive<T>(hubId: string, operation: () => Promise<T>): Promise<T>;
}
```

The Hub resolves from the conversation through the existing tool scope helper (`resolveHub`), and `KanbanApp` gains an optional `teamFiles` dependency the same way it has an optional `sharing`.

**Why:** tool tests can then drive `TeamFiles` with an in-memory store, and `TeamFiles` can be tested for paths, limits, search, and trash without any transport.

### 11. Tool module shape follows the existing tool modules

**Decision:** `src/host/tools/team-files.ts` registers five tools through `normal(...)`, uses `resolveHub` for the Hub, marks search and read concurrency-safe, leaves the three writes non-concurrent, and writes "`explicitly`" into the description of every write, matching the existing rule that model-facing guidance states intent requirements.

**Why:** consistent registration, conflict detection, and JSON rendering come for free, and the existing test that asserts mutation guidance uses the word `explicitly` can cover the new writes.

### 12. Errors are typed and actionable

`TEAM_FILES_UNAVAILABLE` (no binding), `TEAM_FILES_UNSUPPORTED` (storage without file support, naming it), `TEAM_FILE_PATH_INVALID`, `TEAM_FILE_TRASH_RESERVED`, `TEAM_FILE_NOT_FOUND`, `TEAM_FILE_EXISTS`, `TEAM_FILE_BINARY`, `TEAM_FILE_EDIT_CONFLICT` (which replacement failed), `TEAM_FILE_CHANGED` (team side changed; read again), `TEAM_FILE_WRITE_FAILED` (transport failure, with the storage's own code in the details).

### 13. Corrections after the review

Reviewing the first implementation exposed places where the design was right but the code was not, and two where the design itself was too weak. They are folded into the decisions above and into the spec:

- **Owned root identity.** The bound location, not the directory's own `realpath`, is the boundary: the directory must be a direct child of its bound location, so a pre-existing `team-files` symlink cannot redirect every tool.
- **Trash identity.** The trash is compared by its canonical path, and a `.trash` entry that is itself a symlink is refused as a deletion destination instead of being followed.
- **Creation cannot replace.** The existence check moved out of the service and into the transport: creation links the temporary file into place, which fails on an occupied name. A listing is an observation, never a guarantee.
- **Rendered output, not raw text.** Both byte budgets measure what the tool actually serializes, because the pretty-printed result is roughly twice the size of the compact objects.
- **Deadline during the scan.** A long file checks the deadline while scanning, and the listing is documented as the one non-interruptible step; the input cap is what bounds a single decode.
- **Edit validates its result.** The content a write produces is classified exactly like content read from disk, so an edit cannot leave a file the next read refuses.
- **Delete does not read.** The move is the existence check, so a deletion never loads a file and cannot be blocked by the input cap.
- **Transport failures are mapped.** Every Git step of the protocol — ensure, fetch, show, commit, push — reports in the team-file shape, and a rollback that fails is a failure, not a retryable refusal.
- **Classes stay inside a segment.** A `[...]` class never matches `/`, and a malformed class is a typed pattern error.

## Risks / Trade-offs

- **The trash grows forever in a synchronized folder** → Accepted by the product decision. It is visible to the team, the plugin never deletes it, and a client with version history may reclaim it. Documented in the README.
- **An existing `team-files` directory is adopted, so the agent reads content the plugin did not create** → The alternative is refusing the directory and making the feature unusable exactly where a team already keeps documents. The tools still cannot leave the directory, and deletion preserves rather than removes.
- **Git commits now mix board configuration and team documents** → One commit per file write, with a message naming the operation and the path, so the history can be filtered. A repository that only ever held `kanban-hub.yaml` will now hold documents too; that is the consequence of immediate publication.
- **Reads on a Git binding can be one check interval behind** → Reported `head`, plus a write that always compares against the freshly fetched remote. The stale read cannot cause a lost update, only a retry.
- **A conflict between a document publish and a file write would corrupt the clone** → Both go through the existing per-Hub lane. This is the main reason the lane is reused instead of duplicated.
- **A refused push resets the clone** → The reset discards only the commit this write created, because the write fetched first and nothing else may hold the lane. The document writer's own reset keeps working for the same reason.
- **No write-size limit** → The host's own `write` has none either, and a team document can legitimately be large. The tool description states the surface is for text documents, not data transfer.
- **TOCTOU between containment check and open** → Accepted; the next call re-validates, and a link that escapes is refused the moment it is observed.

## Migration Plan

- Additive and lazy. No stored record changes shape, so no data migration runs; `team-files` appears in a bound location only when the first team file is written.
- Rollback removes the tools and the descriptor capability. The directory, its files, and its trash stay behind, because the plugin never deletes a team's entries.
- `package.json` version is bumped in the same pull request that ships this change, per the repository release rule.
- The spec deltas for the two location requirements and the restricted tool surface archive into `hub-sharing` and `product-tools`; `team-files` becomes a new capability.

## Open Questions

- Whether the commit author identity should be configurable per Hub; it currently reuses the constant identity the document commits already use.
- Whether a restore tool should exist later. The trash keeps the content, so a restore capability can be added without another deletion design.
