# Design

## Context

See `proposal.md` for motivation and `specs/hub-sharing/spec.md` / `specs/google-drive-local/spec.md` for the behavior contract.

The publishing feature is already storage-agnostic: a `SharingProviderDescriptor` owns how one storage is addressed, validated, and synchronized (`src/host/sharing/provider.ts`), and every storage returns the same `SharedConfigStore` contract — `ensure`, `read(cached)`, `write(expectedToken)`, `state`, `review`, `destroy` (`src/host/sharing/store.ts`). The local-folder store already implements the whole-document token, observed read, temporary-sibling replacement, post-write verification, and conflict-copy review over a directory (`src/host/sharing/local-folder-store.ts`). Binding state is version 2 and validates the provider against `SHARING_STORAGES`, so adding an id needs no record migration (`src/host/sharing/state.ts`). The client already has a `Modal` with focus trapping and Escape handling (`src/client/ui.tsx`) and a stroke-icon module (`src/client/icons.tsx`).

Constraints that shape the design:

- The host process runs on the user's machine, so filesystem and per-user settings are reachable, but the plugin must not add a network dependency.
- Google Drive for desktop owns the mount points, their names, and their locale; the plugin can only observe them.
- The host snapshot is a `.strict()` schema and is streamed to every client, so transient browsing state should not travel through it.
- `HubSharingService` currently owns Hub operations, automatic checks, *and* Google authorization state; the new storage adds a second device-scoped concern next to it.

## Goals / Non-Goals

**Goals:**

- Add Google Drive Local as a fourth storage without changing the document format, merge rules, board states, or the synchronization engine.
- Discover locations per platform through injectable adapters that are fully testable without macOS or Windows.
- Keep device-scoped concerns (Drive authorization, local discovery/browsing) out of the Hub publishing service.
- Provide a folder browser that is keyboard accessible, honest about unavailable mounts, and always backed by the native picker.

**Non-Goals:**

- Any OAuth flow, Drive API call, or Google Cloud project for this storage.
- Mounting, unmounting, repairing, or configuring Drive for desktop.
- Recursive scanning, filesystem watching, or full-text search inside the Drive.
- Typed paths in the Google Drive Local surface.
- A snapshot schema change for browsing, or a record-version bump.

## Decisions

### 1. A fourth descriptor that reuses the directory store

`google-drive-local` is a descriptor like the others: `syncMode: 'continuous'`, `defaultIntervalMinutes: 1`, `requiresAuthorization: false`. Its `createStore` returns the same directory-backed store the local folder uses, wrapped with the mount-identity checks; only `normalizeSettings`, `describe`, and `prepareBinding` differ. Folder ownership is compared across both filesystem-backed storages, so one directory can never be bound as local folder for one Hub and as Google Drive Local for another.

Shared code is extracted first rather than copied: the observation/read/write engine becomes a reusable filesystem store module, and folder inspection (`inspectFolder`, identity comparison, managed-root refusal) becomes a shared helper with the mount check composed on top. The local-folder descriptor keeps its current behavior after the extraction, so its tests are the regression gate.

*Alternatives:* a separate DriveFS store (duplicates ~300 sensitive lines and creates two sync engines); a `local-folder` variant without its own id (loses typed errors and the mount contract, and pollutes the existing storage's meaning).

### 2. Device-scoped discovery behind a dedicated query

A `GoogleDriveLocalDiscovery` service owns platform adapters and caching. `KanbanApp` receives it as an injected dependency and exposes one remote method, `kanban/localDrive`, with two actions:

- `roots` → `{ locations: DriveLocation[], state: 'ready' | 'empty' | 'app-missing' | 'unsupported' | 'failed', reason? }`
- `list` → `{ path, parent, entries: [{ name, hasDocument }], truncated, reason? }`

`DriveLocation` carries `{ id, rootPath, account?, driveName?, kind: 'account' | 'legacy', status: 'available' | 'unavailable' }`. The snapshot schema is untouched, and browsing does not notify other clients.

*Alternatives:* routing through `sharing.*` commands with a snapshot view (pollutes the strict snapshot and broadcasts navigation); extending `sharing.folders` with an origin field (mixes Drive API and local discovery, with different error taxonomies).

### 3. Path identity inside a mount, validated at connect time only

A binding stores the resolved absolute folder path plus `mountId`, `account`, and `mountLabel` for display. Validation resolves symbolic links once and requires the resolved path to sit inside a discovered root; the comparison is case-insensitive on macOS and Windows, matching the existing folder identity rule. The mount root is checked, not the exact mount metadata, so a remounted account at the same path keeps working.

Every operation re-resolves the stored root and folder and requires the folder to still resolve inside the root, so a folder replaced by an outward symlink is refused before any read or write. Location membership is read from the discovery cache (at most one source scan per cache window), and a missing membership triggers one refresh before the Hub is reported unavailable, so a root that discovery no longer reports cannot stay usable just because its directory remains.

*Alternatives:* re-running discovery on every check (slow `CloudStorage` scans every minute); trusting only a stored mount id (breaks when the app remounts); accepting any path (turns the storage into a local folder with extra steps).

### 4. Authorization leaves the service through a narrow port

`GoogleDriveAuthCoordinator` owns the auth state, the `start`/`cancel`/`switch`/`disconnect` lifecycle, and the Drive/Shared Drive listings. `sharing.auth.*`, `sharing.drives`, and `sharing.folders` route to it from `KanbanApp`; `HubSharingService` receives a port with `status()`, `ensureConnected()`, and `cancel()`, uses it in `connect` and in the view projection, and no longer has the `__auth__` lane. The coordinator serializes its own operations, so device-level commands still cannot interleave.

*Alternatives:* leaving auth in the service and injecting discovery beside it (the service keeps two unrelated responsibilities and grows further); a full command bus (over-engineering for two device-scoped coordinators).

### 5. Platform adapters with one parsed evidence model

Each adapter returns the same `DriveMount[]` from local evidence:

- **macOS**: list `~/Library/CloudStorage` entries whose names follow the Drive for desktop account prefix; read `com.google.drivefs.settings` `PerAccountPreferences` for `mount_point_path`; list legacy `/Volumes/GoogleDrive*`. A root may be established by any source; failures are collected per source rather than aborting the scan.
- **Windows**: read the configured mount point from the user and machine `DriveFS` registry keys (letter or folder path), enumerate volumes, and keep only paths that exist and are directories. No letter is assumed.
- **Unsupported**: reports `unsupported` on Linux or any other platform.

Discovery uses the injected command runner (already used for Git) with short timeouts and bounded output, and never throws for one unreadable source. Adapters are selected by an injected `platform`, so tests run the Windows parser on macOS fixtures.

*Alternatives:* a native addon for volume APIs (new build dependency and platform packaging); a single cross-platform script (opaque errors, harder to test).

### 6. Browse confined to discovered roots

One level per request. The service resolves the requested path, confirms it is inside a discovered root, reads directory entries through a bounded iterator that stops at the page size plus headroom, flags `kanban-hub.yaml` from the listing, and returns a typed reason when the directory is unreadable. The page reports how many entries it shows and whether more exist, without requiring an exact total. Path rules follow the discovered platform, so Windows locations are navigated with Windows separators even from another host. No file content is read, and nothing is written during browsing.

*Alternatives:* listing the whole tree eagerly (unbounded latency and memory on large Drives); trusting the client path verbatim (a client-side path traversal surface).

### 7. Client composition: cards, panel, modal

- `TeamSettings` renders a `StorageCards` radiogroup (icon, name, one-line description) instead of the native `<select>`; when a Hub is bound, the cards show the bound storage and require Disconnect to change.
- `GoogleDriveLocalPanel` renders either the connection surface (summary of the last selection plus **Choose folder**), the connected surface (reusing `ConnectedStorageSurface`), or the empty/unsupported state with **Rescan** and the native picker.
- `DriveFolderPicker` reuses `Modal`, with a left rail of discovered accounts/locations, a breadcrumb, a virtualized-free list of folders with a current-level filter, and a footer that explains the create-versus-adopt outcome. It marks unavailable locations and refuses selection with the typed reason.
- The native picker stays reachable from both the picker (menu action) and the empty state, using the existing `useDirectoryPicker` port.
- Icons added to the existing stroke module: folder, drive, cloud, Git branch, chevron, back, search, rescan. No new visual language.

*Alternatives:* cards with detailed descriptions in a wide panel (visually heavy); a native `<select>` with a side icon (icons could not appear in the list).

### 8. `Change folder` reuses the connection flow

A new `sharing.changeLocation` command takes the selected folder and a confirmed flag. The service extracts the existing connect routine so both paths share validation, document read, preview, and first-publication behavior; `changeLocation` additionally requires an existing record, clears `bindings`, `orphans`, `removed`, `pendingRemovals`, and `base`/`seen` for the new location, and then behaves exactly like connect. Boards, tasks, notes, projects, conversations, and worktrees are never touched. The UI asks for confirmation before sending the command.

*Alternatives:* disconnect then connect from the client (loses the record between steps and makes the preview flow fragile); automatic relinking by folder name (ambiguous and silently wrong).

### 9. Error taxonomy

New typed errors: `SHARING_DRIVE_APP_MISSING`, `SHARING_DRIVE_UNSUPPORTED`, `SHARING_DRIVE_NOT_IN_MOUNT`, `SHARING_DRIVE_MOUNT_UNAVAILABLE`, `SHARING_DRIVE_PERMISSION_DENIED`, `SHARING_DRIVE_BROWSE_REFUSED`, with existing `SHARING_FOLDER_*` errors reused for missing, non-directory, and unwritable folders. The UI maps each to one sentence plus its recovery action.

### 10. Testing

- Adapter unit tests drive the Windows registry parser, the macOS preferences parser, and the CloudStorage scanner from fixtures, with an injected runner and filesystem, including an ordinary volume that must not become a mount and an installed-but-unmounted application.
- Discovery tests cover duplicate roots across sources, partial source failure, empty versus app-missing versus unsupported, and cache/rescan.
- Browse tests cover confinement, traversal and symlink escapes, unreadable folders, bounded truncation, bookkeeping filtering, and document detection, including Windows-style paths on any host.
- Store reuse is covered by the existing local-folder tests after the extraction, plus a Drive Local descriptor test for validation and refusal codes.
- Service tests cover `changeLocation` (empty and adopted folder), concurrent location changes, preserved interval and local work, auth-port wiring, and mount-loss recovery with retained drafts.
- Browser tests replace the storage `<select>` with card selection and page the picker against a faked `localDrive` query; the existing publishing flows must stay green.

## Risks / Trade-offs

- **[macOS denies access to `~/Library/CloudStorage`]** → discovery and browsing return `SHARING_DRIVE_PERMISSION_DENIED`; the panel explains the Files & Folders permission and keeps Rescan and the native picker available.
- **[Google changes its settings or mount layout]** → every source contributes evidence independently and no fixed path is required; a total failure is reported as `app-missing`/`failed`, never as an empty Drive.
- **[Localized names defeat the My Drive / Shared Drives grouping]** → grouping is best-effort, the literal names are always shown, and no folder is hidden.
- **[Online-only placeholders make reads slow]** → browsing reads directory entries only; the document read stays a single small file with existing retry behavior and the 1-minute check cadence.
- **[A remounted account changes the path]** → the binding becomes unavailable with a typed failure and `Change folder` recovers it without losing local work; no silent relocation.
- **[Discovery on every check would be costly]** → checks validate the stored root and folder, and run discovery only when validation fails.
- **[Downgrade loses the binding]** → an older plugin version treats `google-drive-local` as an unknown provider and ignores the record; local boards, tasks, and notes remain, and only the binding must be re-established. Recorded here rather than solved, to keep the change additive.
- **[Windows registry output varies in encoding and shape]** → the parser tolerates extra whitespace and value types, and tests pin the accepted formats; unrecognized output degrades to `failed` with the source named.

## Migration Plan

1. Ship the extraction with the local-folder tests unchanged; ship the auth coordinator with the existing auth tests.
2. Add the storage id, descriptor, discovery, and query while the UI still shows the old selector; the storage is inert until a client can select it.
3. Switch the Team Settings selector to cards, add the panel and picker, and update the publishing browser tests in the same step.
4. Update the README Team Settings section and the two specs.
5. Rollback: remove the client surface and the descriptor registration first; bindings created with the new storage are then ignored by older versions as an unsupported provider, with no effect on local boards, tasks, or notes.

## Open Questions

- Exact discovery cache TTL and folder-entry cap: tune during implementation against a real Drive mount; the specs only require truncation reporting and refreshability.
- Which locale spellings belong in the initial My Drive / Shared Drives recognition set: extend from observed mounts; the fallback to literal names keeps the feature correct without a complete list.
