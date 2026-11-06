# Design

## Context

See `proposal.md` for motivation and the `hub-sharing` spec deltas for behavior. The constraints that shape this design come from the existing implementation:

- `HubRepository` is the only writer of Hub state. It serializes every mutation through one tail, applies a per-Hub revision, validates the whole aggregate with zod, and rejects reentrant transactions. Board and workflow edits already reach the sharing layer through projections and the three-way plan in `src/domain/sharing/`.
- Durable Kanban state is expressed as DSH storage domains. Hubs are JSON records under `kanban_hubs/hubs/<hubId>.json` plus `global.json`; sharing state is its own `kanban_sharing` domain. The only YAML artifact is the published `kanban-hub.yaml`.
- The sharing transport boundary already exists: `SharedConfigStore` reads a whole document with an opaque token and writes it with an expected token; `GitSharedConfigStore` owns clone, fetch, commit, and push; `HubSharingService` owns the per-Hub lane, record transitions, three-way plans, and the publish/get-updates flow.
- The provider choice is hard-coded today: `SharingBinding.provider` is the literal `'git'`, `repository` is a Git field, `assertSupportedProvider` rejects everything else, and the client disables the provider select. The view, the RPC schema, and the Team Settings surface all assume one provider.
- The client renders one immutable `HostSnapshot`; there is no second status channel. Configuration sections are a small registry in `src/client/settings/configuration.tsx`.
- The plugin injects a fixed service list and has no credential or HTTP service. The host process can use `node:http`, `fetch`, and `node:crypto`; DSH provides `ctx.credentials` for secret references and stored records.

## Goals / Non-Goals

**Goals:**

- Keep the document, the three-way plan, the board-key identity, and the application rules storage-independent.
- Make provider selection a registry concern rather than a branch in the domain, the service, and the UI.
- Keep the Git behavior and the Git guarantee unchanged.
- Make the Google Drive path honest about its weaker concurrency guarantee.
- Keep the Drive authorization, the API client, and the synchronization coordinator isolated enough to be tested without a real Google account.
- Fit the new Team Settings surface into small client modules rather than one growing settings component.

**Non-Goals:**

- Syncing tasks, notes, projects, conversations, worktrees, or the raw storage tree.
- A backend, a service account, or a server-side token exchange.
- The `drive.file` plus Picker model.
- Automatic synchronization for Git.
- Multiple Google accounts on one installation.
- Deleting the team document on disconnect or Hub deletion.
- A general file-sync engine or a generic storage framework.

## Decisions

### D1. The synchronized unit is the Hub document, not local storage

The published `kanban-hub.yaml` (board keys, names, order, authored workflow text) remains the only shared artifact. The local JSON domains, tasks, notes, projects, conversations, and worktrees stay local.

**Why:** the document already has a tested three-way merge, stable keys, orphan handling, and provider-neutral application rules. Mirroring the JSON storage files would bypass the single writer, overwrite concurrent edits with no domain merge, and leak machine-specific data (projects, worktrees, session ids).

**Alternative rejected:** a raw storage mirror or a full Hub-state sync, which would require a new shared data model and conflict engine and would break the existing local-only guarantees.

### D2. Google Drive is a provider behind a registry, not a second service

Introduce a `SharingProviderDescriptor` (id, label, settings schema, address description, store factory, provider-state schema) and a `SharingProviderRegistry` composed in `src/index.ts`. `HubSharingService` keeps depending on `SharedConfigStoreFactory`; the registry resolves the storage and validates its settings. The binding becomes `{ provider, intervalMinutes, settings }`; provider state (Drive cursor and revision) is a separate record field validated by the descriptor.

**Why:** the boundary already exists in `store.ts`, and the alternative is a provider branch in every service method, the view, the RPC schema, and the UI. A registry keeps the document, merge, and application code closed for modification.

**Alternative rejected:** a discriminated union in the binding (type-safe but forces every provider addition to edit the central type and every call site) and a separate service per provider (duplicates the lane, record, and merge logic).

### D3. OAuth uses the system browser, loopback, PKCE, and the DSH credential store

A dedicated `GoogleDriveAuthService` starts a temporary loopback HTTP server on `127.0.0.1:0`, builds an authorization URL with `state` and a PKCE S256 challenge, returns it to the client, and completes the code exchange when the callback arrives. It requests `https://www.googleapis.com/auth/drive` because `drive.file` cannot list Shared Drives, discover another member's files, or follow a shared document across users, and `drive.readonly` is also a restricted scope with no write access.

The default client ID is versioned in the plugin; an optional custom client ID and secret override it for organizations with their own Google Cloud project. The token exchange attempts PKCE without a client secret, because Google's installed-app documentation marks the secret optional; if the endpoint rejects the request for a missing secret, the service reports a typed configuration error and accepts the public desktop client secret through the same optional setting. The desktop client type and the restricted-scope verification of the published external app are release prerequisites, not runtime options.

The authorization record is stored in `ctx.credentials` under `kanban/google-drive` as a `grant` payload with access token, refresh token, expiry, scopes, and account identity. Refreshes use `modifyRecord`, which serializes the read-decide-replace across processes; `describeRecord` feeds the UI without exposing values; disconnect revokes the grant and deletes the record. The account grant is installation-scoped and may serve several Hubs; disconnecting a Hub removes only that binding.

**Why:** it keeps the one-click experience without a backend or a per-user secret setup, keeps tokens out of configuration, snapshots, logs, and the document, and uses the host's sanctioned secret seam.

**Alternatives rejected:** `drive.file` plus Picker (per-user, per-file access; no `drives.list`; folder descendants are not guaranteed; other members' new files stay invisible), a service account (not the user's permissions, Drive quota caveats), a backend and server-side exchange (new infrastructure), and the device flow (different UX, kept only as a future fallback).

### D4. The Drive binding is a folder and a document ID, never a name

After authorization the user selects a folder in My Drive or a Shared Drive. The plugin lists drives and folders through the Drive API and stores the Drive id, folder id, and document file id. Each Hub binds its own folder containing `kanban-hub.yaml`; a folder already bound to another Hub is refused with `SHARING_ADDRESS_IN_USE`. The file is created when absent and adopted by id when present. The plugin never reads, modifies, or deletes other files in the folder, and never deletes the team document on disconnect or Hub deletion.

**Why:** the folder-scoped document keeps the existing first-connection semantics (empty storage publishes; existing document previews), keeps the document format portable between Git and Drive, and avoids depending on names after the connection.

**Alternative rejected:** a single file picker (a missing file cannot be selected cleanly) and a shared folder with a per-Hub editable filename (extra naming states and collisions).

### D5. Continuous synchronization is a coordinator over the existing plan

Add a `SharingSyncCoordinator` for continuous storages. A local board, board-name, order, or workflow save marks the Hub pending; a short debounce (about two seconds) starts a publish if the remote document did not change and no conflict or blocker exists. A check that finds a team-only change applies the existing plan in one `HubRepository.transact`; a board changed on both sides, a blocker, or a concurrent write switches the Hub to review. Offline or transient failures keep the pending state and retry on the next check. The coordinator is serialized by the same per-Hub lane as the service and persists enough state to resume after a restart. Git keeps the explicit Publish and Get updates actions and never enters the coordinator.

**Why:** the user chose automatic bidirectional sync for Google Drive, and the existing plan already decides what can be applied safely. A debounce avoids publishing every keystroke; the lane prevents a check from interleaving with a write.

**Alternative rejected:** polling-only automatic sync (a local save would wait up to the check interval) and auto-publishing every local change without the plan (would overwrite or duplicate team changes).

### D6. Checks use the Drive change feed with a persisted cursor

Google Drive checks default to one minute and use `changes.getStartPageToken` and `changes.list` with the stored cursor, `driveId` for Shared Drives, and `includeItemsFromAllDrives`/`supportsAllDrives` where required. The plugin reads the document content only when the document's `headRevisionId` changed; an expired cursor triggers a full read and a fresh cursor. Rate limits and server errors are reported and retried on later checks, not in a tight loop. Git keeps the five-minute default and the existing fetch-based check.

**Why:** the user asked for 60-second polling and incremental detection; reading the whole document every minute would be wasteful and would add quota pressure. A per-Hub cursor keeps the existing scheduler and lane model.

**Alternatives rejected:** metadata-only polling with `files.get` every minute (more requests, no change feed) and a single drive-wide watcher (a new cross-Hub component with little benefit for a handful of Hubs).

### D7. Drive writes are best-effort; the design never claims atomicity

A Drive write compares the document token read before the write, refuses a mismatch, uploads, and re-reads the document to verify the written content. A change detected before or after the write is reported as a concurrent write, keeps the local changes pending, and requires review; the previous content remains in the Drive revision history. The Git adapter keeps its atomic stale-write refusal.

**Why:** Google Drive exposes no server-enforced conditional write or lock; pretending otherwise would create a false guarantee and silent data loss. The user chose best-effort detection.

**Alternative rejected:** an application-level lock file in the folder (not atomic across independent Drive clients and prone to stale locks).

### D8. The sharing record moves to version 2 with a transparent migration

`HubSharingRecord` v2 stores the storage-neutral binding, the provider-specific state (`fileId`, `headRevisionId`, `changesPageToken`, `driveId`, `folderId`), and `syncedRevision` for pending detection, while keeping `base`, `seen`, `bindings`, `orphans`, `removed`, `pendingRemovals`, `preview`, `lastCheck`, and `lastError`. Records are read with a v1-to-v2 migration that maps `{ provider: 'git', repository }` to `{ provider: 'git', settings: { repository } }` and preserves every field; validation still quarantines a genuinely corrupt record.

**Why:** existing Git-published Hubs must keep working without a reconnect, and the provider state must survive restarts.

**Alternative rejected:** a new storage domain per provider (splits the record lifecycle and the snapshot projection) and an untyped `settings` blob with no provider validation (loses the schema boundary).

### D9. Team Settings is a shell over per-storage surfaces

Rename the Configuration section to **Team Settings** and replace the hard-coded publishing form with a shell: a storage selector (Git, Google Drive) plus a per-storage surface resolved by a small client registry. The Git surface keeps the repository form and the explicit actions. The Google Drive surface is a small state machine: connect the account, wait for authorization, choose the Drive and folder, then show the account, location, synchronization status, pending and conflict counts, last success, current failure, and the actions Sync now, Review, Disconnect, and Switch account. The selector swaps the surface only while the Hub has no binding; a bound Hub shows its storage without change and requires Disconnect to switch. The workflow editor keeps `Save workflow` and, for Git, `Save and share`; on Drive the save itself synchronizes, so the editor presents a single save action and states that the change synchronizes automatically.

**Why:** the current `publishing-settings.tsx` already holds four states in one component; adding authorization, a folder picker, and two action sets would make it a god component. A registry follows the existing Configuration-section pattern and makes a third storage a client-only addition.

### D10. Keep the service and the UI from growing into god objects

Split the current `HubSharingService` responsibilities: a record/state module for the stored record helpers and transitions, a connection flow for connect/preview/receive/publish-initial, the publish and update flows, and the synchronization coordinator, with the service keeping the per-Hub lane and the command surface. Move `SHARED_DOCUMENT_FILE` to the document domain, and move `sharingRoot` and `SharingCommandRunner` out of the Git adapter. Split `publishing-settings.tsx` into `team-settings/` modules (`team-settings`, `storage-select`, `git-panel`, `google-drive-panel`, `account-card`, `folder-picker`, `sync-status`, `board-review`, `blockers`).

**Why:** the new authorization and synchronization concerns would otherwise add several hundred lines to an already 500-line service and a five-state component. The extraction also gives the provider contract and the coordinator independent test seams.

### D11. Typed failures and a storage-neutral status projection

The service maps provider failures to typed codes (`SHARING_AUTH_DENIED`, `SHARING_AUTH_POLICY`, `SHARING_RECONNECT_REQUIRED`, `SHARING_PERMISSION`, `SHARING_DOCUMENT_MISSING`, `SHARING_INVALID_DOCUMENT`, `SHARING_STALE_TOKEN`, `SHARING_CONCURRENT_WRITE`, `SHARING_RATE_LIMITED`, `SHARING_UNAVAILABLE`, `SHARING_UNSUPPORTED_STORAGE`, `SHARING_ADDRESS_IN_USE`, `SHARING_FOLDER_MISSING`) and never exposes a raw Google error or a token. `HubSharingView` gains the storage label, the address, the synchronization mode, the authorization state, and pending/syncing/offline/conflict facts; the existing board states stay.

**Why:** the UI must explain a Drive failure without revision-control vocabulary and without coupling to Google error payloads; the client already renders everything from the snapshot.

### D12. Deterministic tests, one manual authorization check

The provider contract runs against Git temporary repositories and a fake Drive HTTP server: ensure, read, missing document, token, write, stale write, destroy. Authorization tests inject `fetch`, the loopback server, the clock, and the credential store: PKCE, state, token exchange, refresh rotation through `modifyRecord`, revoke, switch, policy errors, and the missing-secret path. Synchronization tests cover debounce, automatic publish, automatic apply, conflicts, blockers, offline pending, retry, restart, and serialization. Browser tests cover Team Settings, the storage swap, the Drive connection states, and the conflict review. The real OAuth client, My Drive, Shared Drive, folder creation, and the 60-second change feed are exercised by one documented manual acceptance run, not by CI.

**Why:** no Google credentials or Drive traffic belong in the deterministic lanes; the only behavior that needs the real service is the token exchange without a client secret and the account/folder authorization.

## Risks / Trade-offs

- **External published app plus the restricted `drive` scope** → the app must complete restricted-scope verification and security assessment before users outside the test list can authorize; until then only test users work and refresh tokens expire in seven days. Mitigation: treat verification as a release prerequisite and document the test-mode limitation.
- **Google may still require a client secret for Desktop clients** → the default mode could fail at the token exchange. Mitigation: attempt PKCE-only first, keep an optional public client-secret setting, surface a typed error, and settle the behavior with the manual acceptance run.
- **No atomic conditional write on Drive** → a concurrent publish can overwrite content. Mitigation: pre-write comparison, post-write verification, pending state, explicit review, and Drive revisions as recovery; the spec states the weaker guarantee.
- **Change-feed cursor expiry, rate limits, and quota** → a check can fail or require a full read. Mitigation: full-read fallback, report the failure with the last success, retry at the interval, and keep local work available.
- **Folder collision** → two Hubs bound to the same folder would share one document. Mitigation: one folder per Hub and an explicit `SHARING_ADDRESS_IN_USE` refusal.
- **Account switch or lost permission** → bindings can become inaccessible. Mitigation: keep the binding by id, present reconnect/permission states, and never delete local data; switching accounts requires consent for the new account.
- **A remote deletion or a hand-edited document** → the file can disappear or fail to parse. Mitigation: report missing/invalid document states, never delete local boards, and leave the overwrite to an explicit choice.
- **Credential store is not an OS keychain** → tokens live in a 0600 file and the agent runs as the same user. Mitigation: document the limitation; a keychain provider can replace the store later without changing the rest of the design.
- **Loopback callback with a remote GUI** → the browser and the host must be on the same machine. Mitigation: document the local-GUI requirement; a manual URL fallback can be added later.
- **Automatic synchronization surprise** → a team change can appear without a click. Mitigation: the debounce, the visible pending/synced state, conflict review, and the unchanged explicit Git behavior.
- **Rollback after the v2 record write** → an older plugin cannot read v2 records and would present those Hubs as unpublished (local data remains). Mitigation: document the disconnect/reconnect rollback path and keep the document unchanged.

## Migration Plan

1. Open the `kanban_sharing` domain with the v2 schema and migrate v1 records in memory; no user action and no clone or document change.
2. Existing Git bindings keep their repository, base, seen, bindings, orphans, removals, preview, and last check; the first subsequent save persists the v2 shape.
3. New Google Drive connections create v2 records and credentials; existing Hubs are untouched until the user connects them.
4. Rollback: disconnect Google Drive bindings first, then downgrade. Git Hubs migrated to v2 appear unpublished to the older plugin but retain every local board, workflow, task, and note; reconnecting restores the binding from the team document. The team document is never modified by the downgrade.

## Open Questions

- Whether the real default Desktop client accepts PKCE without a client secret. The code path and the optional secret setting are decided; the manual acceptance run records the answer and configures the default client accordingly.
- When the published external app's restricted-scope verification completes. It affects rollout, not the design, the specs, or the task breakdown.
