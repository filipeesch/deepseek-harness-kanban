# Design

## Context

See `proposal.md` for motivation and the `hub-sharing` spec deltas for behavior. The constraints that shape this design come from the existing implementation:

- The transport boundary already exists in `src/host/sharing/store.ts`: `SharedConfigStore` reads one whole document with an opaque token and writes it with an expected token. `HubSharingService` owns the per-Hub lane, the durable record, the three-way plan, and the publish/apply flow, and never inspects transport mechanics.
- Storage selection is a registry concern since the Google Drive integration: `SharingProviderDescriptor` declares the id, label, sync mode, default interval, settings normalization, address description, store factory, and provider-state normalization; `SharingProviderRegistry` is composed in `src/index.ts`.
- The published artifact is the same for every storage: `kanban-hub.yaml` with `version: 1`, one entry per board carrying a stable key, the name, the order, and the authored workflow text. The token is a SHA-256 of the canonical content, so it identifies content rather than a file or a revision.
- `syncMode: 'continuous'` already drives everything the local folder needs: the debounced synchronization on a local save, automatic application of team-only changes, the Sync now action, the absence of Publish and Get updates, and `canShareFromEditor` returning false so the editor offers no share action.
- Three places currently branch on the provider id: `HubSharingService.connectNow` applies Google Drive authorization and address-uniqueness rules, `HubSharingService.viewOf` and `buildSharingView` attach an authorization state, and `TeamSettings` chooses a panel with a ternary.
- The identifier set is declared in four places: `SharingProviderId` and `isSharingProviderId` in `provider.ts`, a `z.enum` in `state.ts`, `SharingStorage` in `shared/types.ts`, and a `z.enum` in `remote.ts`.
- A directory picker already exists as a client port (`src/client/directory-picker.ts`) and is used by General Settings and the project editor, with manual path entry as the designed fallback when the host provides none.

## Goals / Non-Goals

**Goals:**

- Add the third storage without adding a branch to the publishing service, the view projection, or the settings component.
- Make the write guarantee honest: no atomic conditional write, no partial-file read, and a review path when a synchronization client introduces a competing version.
- Keep every existing Git and Google Drive behavior, record, and spec state unchanged.
- Keep the storage surface small: one store, one descriptor, one panel, and no new dependency.
- Remove the duplicated remote-read, verified-write, and panel code that a third storage would otherwise triplicate.

**Non-Goals:**

- A file watcher, a sync engine, or any interaction with the desktop client's protocol.
- Any managed workspace, credential, network call, or background service for this storage.
- A second configurable directory per Hub, a per-Hub document name, or several Hubs in one folder.
- A GUI-drawn folder picker: the host's picker is reused as-is, with typed paths as the fallback.

## Decisions

### D1. The local folder is a provider behind the registry, not a second service

Add `local-folder` to the storage identifiers and implement `LocalFolderSharedConfigStore` plus `createLocalFolderProviderDescriptor`. `HubSharingService` keeps depending only on `SharedConfigStore`.

**Why:** the boundary already isolates transport, and the alternative duplicates the lane, the record, and the merge logic per storage. It also means the local folder inherits continuous synchronization, offline retention, restart recovery, and the review flow without new coordination code.

**Alternative rejected:** a separate `LocalFolderSharingService` (duplicates 600 lines of orchestration) and a discriminated union in the binding (forces every provider addition to edit the central type and every call site).

### D2. The address is a directory path and the document keeps its name

The binding stores `{ path }` in `settings`. The document is the existing `kanban-hub.yaml` in that directory, with the same format, keys, and merge rules.

**Why:** the document format is what makes the three storages interchangeable, and a fixed name keeps the first-connection semantics identical (an empty directory publishes, a directory with a document previews). A configurable file name would add naming states, collision rules, and a second identity to explain.

**Alternative rejected:** a per-Hub file name (turns the directory back into a container and reintroduces name collisions) and a per-Hub subdirectory chosen by Hub name (renaming a Hub would either strand the binding or require a move).

### D3. Path validation resolves identity, and a folder belongs to one Hub

The descriptor normalizes the setting by expanding a leading `~`, resolving the path, and refusing: a missing directory, a path that resolves to a file, a directory the process cannot write, a directory inside the plugin's managed publishing workspace, and a directory already bound to another Hub. Directory identity is the resolved path, compared case-insensitively on a case-insensitive filesystem.

**Why:** the resolved path is the only stable identity across `~`, relative spellings, symlinks, and case differences, and the same directory bound twice would silently interleave two Hubs' documents.

**Alternative rejected:** comparing the raw strings (misses symlinks and case) and deferring uniqueness to the caller (the service would need per-storage knowledge, which D8 removes).

### D4. The default folder is suggested, and only the suggestion is created

Team Settings pre-fills `~/.dsh-kanban/<hubId>`. `connect` creates that directory when, and only when, the received path resolves to exactly the suggested path for that Hub. Any other path must already exist.

**Why:** it removes the empty-field friction without letting a typo create an unintended directory tree, and it keeps the rule from D3 intact for every path the plugin did not propose.

**Alternative rejected:** creating any missing path (an accidental deep tree or a directory inside someone else's synced folder) and requiring the user to create the default folder by hand (contradicts the suggestion's purpose).

The suggested root resolves from the operating-system home directory and is injected at composition, so unit tests and isolated instances never read or write the owner's home.

### D5. The write is a verified replacement, and the plugin says so

`write` reads the current token, refuses on mismatch, writes a dot-prefixed temporary sibling in the same directory, renames it over the document, re-reads the document, and reports `SHARING_CONCURRENT_WRITE` when the verified token differs. The provider never claims an atomic conditional write.

**Why:** `rename` within one directory gives readers an all-or-nothing view of the document, which is strictly better than an in-place truncate-and-write, but the filesystem still cannot make "compare and replace" atomic against another process. This matches the guarantee Google Drive already documents, so the storage boundary stays truthful and uniform.

**Alternative rejected:** writing in place (a reader, including the sync client, can observe a partial file), and `O_EXCL` lock files (a crashed process leaves a lock that a sync client happily replicates to other machines, producing a deadlock the user cannot diagnose).

A rename that fails with `EBUSY` or `EPERM` — the Windows antivirus and indexer case — retries a few times with a short backoff before surfacing a typed failure. The temporary file is always complete before the rename, so an interruption leaves the previous document readable.

### D6. Change detection uses the file's observation, with an explicit fallback

A check compares last-modified time and size with the previous observation and reads and parses the document only when either differs, when there is no observation, or when the observation cannot be read. The observation is persisted in the record's provider state, because a store instance is created per operation and an in-memory hint would never survive to the next check.

**Why:** reading and parsing a small YAML on every minute is cheap, but comparing the observation first keeps the storage boundary's "read content only when it changed" behavior consistent with Google Drive and avoids re-running the comparison unnecessarily.

**Trade-off:** a rewrite that preserves both size and modification time would not be observed until the next content-changing write. The observation uses nanosecond timestamps where the platform provides them, and a failed or missing observation always forces a full read.

### D7. Conflict copies become a document-level review

A check lists the bound directory and reports entries whose name begins with the document's base name but is not the document, excluding the plugin's own dot-prefixed temporary files. A reported entry is projected as a storage-level blocker in the existing `HubSharingView.blockers` list, latches the Hub out of automatic apply and publish, and clears on the next successful check after those entries are gone.

**Why:** the current view can express "needs review" only through per-board comparison results or "unavailable" through the last error. A conflict copy is a fact about the document, not about one board, and inventing a new client state would touch the RPC schema, the indicators, and every panel. Reusing the blocker list puts the message in front of the user in a surface that already renders blockers everywhere, while the latch keeps the automatic lane from writing on top of an unresolved conflict.

**Alternative rejected:** a new `review` field in the snapshot (a second review channel to keep coherent) and reporting it as a generic unavailable error (loses the required review semantics and hides the file names).

### D8. Provider-specific connection rules move into the descriptor

The descriptor gains the capabilities the service currently branches on: whether the storage requires an external authorization, and a hook that validates a candidate binding (address uniqueness for a folder-based storage, authorization presence for Google Drive). `viewOf` and `buildSharingView` attach authorization only when the descriptor declares it. `connectNow` invokes the hook instead of comparing ids.

**Why:** this is the exact seam the third storage breaks; without it the service grows a third `if`, and the next storage grows a fourth. It keeps the service closed for modification and the descriptor the single place that knows a storage's connection rules.

**Alternative rejected:** a `switch` over the provider in the service (same problem, more verbosity) and a sub-service per storage (duplicates the record lifecycle and the lane).

### D9. One identifier source and a client-side panel registry

`SHARING_STORAGES` becomes the single declared list in `shared/types.ts`; `SharingStorage` is derived from it, the host's `SharingProviderId` aliases it, and the RPC schema enumerates it. `TeamSettings` renders `Record<SharingStorage, Component>` instead of a ternary.

**Why:** the identifier set is declared in four places today, and a mismatch produces a silent runtime rejection rather than a compile error. A registry mirrors the host composition and keeps the selector honest as storages are added.

### D10. The duplicated panel and transport sequences are extracted

The preview block and the connected block shared by the Git and Google Drive panels move into `StoragePreview` and `ConnectedStorageSurface`; each panel keeps only its connection form and its storage-specific actions. The duplicated remote-read-and-failure block in `checkNow` and `getUpdates` moves into one helper, and the compare-verify write sequence shared with Google Drive moves into one small module with the two typed errors.

**Why:** the third panel would otherwise be a third copy of the same 60 lines, and the write sequence is where a silent divergence in error codes would be most expensive. Extraction is behavior-preserving and covered by existing tests.

**Deliberately excluded:** splitting each provider's descriptor and store into separate files. It is a structural refactor across three providers that would inflate the diff of a feature change; it stays available once the fourth storage motivates it.

## Risks / Trade-offs

- **The token check is only as fresh as the desktop client's local copy** → the conflict copy is the recovery path, the review flow refuses to pick a winner, and the documentation states that this storage offers the same best-effort guarantee as Google Drive rather than Git's atomic refusal.
- **A rewrite that preserves size and modification time is not observed** → the observation uses nanosecond timestamps and forces a full read when it is missing or unreadable; the residual case requires deliberate timestamp preservation and is documented.
- **`rename` is not atomic on some network filesystems** → worst case a reader observes a partially replicated file and the parse fails with a typed invalid-document error; no local data is lost because the temporary file is complete before the rename.
- **Windows file locking (`EBUSY`/`EPERM`) during replacement** → a bounded retry loop, then a typed failure that keeps local changes pending and retries on the next check.
- **A case-insensitive filesystem would let two spellings bind the same directory** → identity comparison lowercases the resolved path on `darwin` and `win32`, and the "already in use" refusal is exercised by a test that uses two spellings.
- **Writing inside the home directory** → the plugin creates only the suggested `~/.dsh-kanban/<hubId>` directory and only on an explicit connect, and the suggested root is injected in tests so no automation touches a real home directory.
- **The absolute path is personal data** → it stays in the local sharing record and the Team Settings surface, and never enters the published document, the snapshot's document content, or logs.

## Migration Plan

- No data migration. `local-folder` is a new value in the binding provider enum; existing v1 and v2 sharing records keep parsing through the existing migration, and their Git and Google Drive bindings are untouched. The record schema version does not change, because nothing structural is added to the record: the local folder stores its observation (`mtimeMs`, `size`) in the existing provider-state field and reuses `seen`, `lastCheck`, and `lastSyncedAt`, and the optional storage review is an additive field the previous version ignores.
- Deployment: the change ships in the plugin bundle with no new runtime dependency and no environment variable.
- Rollback: an older plugin version rejects a `local-folder` record as `SHARING_STORAGE_INVALID` and presents the Hub as unpublished, keeping every local board, workflow, task, and note. Because the storage never deletes anything, a downgrade loses only the binding; reconnecting on the newer version restores it from the document that is still on disk. Disconnecting local folder bindings before downgrading avoids the quarantine message.
