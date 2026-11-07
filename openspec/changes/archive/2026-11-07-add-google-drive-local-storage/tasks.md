# Tasks

## 1. Shared filesystem store

- [x] 1.1 Extract the directory document engine (observed read, token check, temporary-sibling replace, post-write verification, conflict-copy review) from `src/host/sharing/local-folder-store.ts` into a reusable module, keeping the local-folder descriptor behavior identical; verify `tests/host/sharing-local-folder.test.ts`, `tests/host/sharing-local-folder-service.test.ts`, and `tests/host/sharing-sync.test.ts` pass unchanged.
- [x] 1.2 Extract folder inspection and path identity (realpath, case-insensitive identity, managed-root refusal) from `src/host/sharing/local-folder-path.ts` into a helper both descriptors can compose, with the local-folder refusal tests still green and a new unit test asserting the extracted helper's refusal codes.
- [x] 1.3 Confirm the extraction added no behavior change by running `pnpm check` and confirming the existing sharing suite passes without edits to expectations.

## 2. Google Drive authorization coordinator

- [x] 2.1 Create `GoogleDriveAuthCoordinator` owning the auth view, `start`, `cancel`, `switch`, `disconnect`, `listDrives`, and `listFolders`, with its own serialized lane; verify with `tests/host/sharing-drive-auth.test.ts` and `tests/host/sharing-drive-client.test.ts` after moving the assertions to the coordinator.
- [x] 2.2 Replace the service's auth state, `authView`, `refreshAuth`, and `__auth__` lane with a narrow port (`status`, `ensureConnected`, `cancel`), route `sharing.auth.*`, `sharing.drives`, and `sharing.folders` through the coordinator from `KanbanApp`, and verify `tests/host/sharing-service.test.ts` and `tests/host/sharing-controller.test.ts` pass with the coordinator wired in.
- [x] 2.3 Verify the service no longer imports or references authorization internals by checking the module's imports and running the host typecheck in `pnpm check`.

## 3. Discovery core

- [x] 3.1 Define the discovery model (`DriveLocation`, `DriveDiscoveryState`, `DriveMount`, `BrowsePage`) in shared types and a platform-adapter interface with an injected filesystem, command runner, `platform`, and clock; add unit tests that select the adapter from `platform` and that an unknown platform yields the unsupported state.
- [x] 3.2 Implement the macOS adapter: CloudStorage account folders, `com.google.drivefs.settings` `PerAccountPreferences` parsing, and legacy `/Volumes/GoogleDrive*`, merging evidence per root; verify with fixture-driven tests covering each source alone, two sources describing one root, and one source failing while another succeeds.
- [x] 3.3 Implement the Windows adapter: parse the `DriveFS` registry mount point (user, machine, and policy keys; letter or folder path), enumerate volumes, and keep only existing directory roots; verify with fixture tests for a non-default letter, a folder mount point, absent registry keys, and malformed output.
- [x] 3.4 Implement the unsupported adapter and the discovery service that combines sources, deduplicates roots, distinguishes empty, app-missing, unsupported, and failed, caches briefly, and re-reads on refresh; verify with service tests asserting no source is required and that `refresh` bypasses the cache.
- [x] 3.5 Verify discovery performs no network access and writes nothing by asserting the injected runner/fs receive only read operations in the discovery tests.

## 4. Folder browsing

- [x] 4.1 Implement `list(path)`: resolve the path, require it inside a discovered root, list only directories one level deep, flag `kanban-hub.yaml`, cap entries with a truncated marker, and return typed reasons for unreadable folders; verify with tests for a normal listing, document detection, and the cap.
- [x] 4.2 Add confinement tests proving that `..` segments, absolute paths outside every root, and symlinks resolving outside a root are refused with `SHARING_DRIVE_BROWSE_REFUSED`, and that no directory is read in those cases.
- [x] 4.3 Implement account/My Drive/Shared Drives grouping in the browse result using recognized structure and literal fallback; verify that unrecognized localized names remain listed and reachable in a dedicated test.

## 5. Google Drive Local provider

- [x] 5.1 Add `google-drive-local` to `SHARING_STORAGES` and verify the state schema, command schema, and snapshot schema accept it without a record-version bump by running `tests/host/sharing-state.test.ts` plus a new compatibility test reading a v2 record with the new provider.
- [x] 5.2 Implement the descriptor: normalize display and path settings, describe as account / location / folder, validate with `prepareBinding` (inside a discovered root, exists, directory, writable, not already bound, not reserved), and create the shared filesystem store; verify refusals with descriptor tests naming each typed error.
- [x] 5.3 Wire the descriptor into `openHubSharing` with the discovery service and the extracted store; verify a connect against a temporary fake mount publishes `kanban-hub.yaml` and a second connect to the same folder is refused.
- [x] 5.4 Implement mount-aware checking: validate the stored root and folder on each check, run discovery only when that validation fails, and record `SHARING_DRIVE_MOUNT_UNAVAILABLE` without dropping pending changes; verify with a service test that removes the mount, observes unavailable plus retained drafts, and restores it.
- [x] 5.5 Add the `sharing.changeLocation` command and extract the connect routine so both paths share validation, preview, and first publication; verify tests for changing to an empty folder (publishes local), to a folder with a document (preview presented), and that boards, tasks, and notes survive.
- [x] 5.6 Verify no `google-drive-local` code path calls the Drive client or the auth coordinator, and that its store is the extracted filesystem store, by checking imports and the descriptor unit tests.

## 6. Remote query

- [x] 6.1 Add the `kanban/localDrive` method to the controller, app, typert schema, shared `ClientApi`, and client bridge with `roots` and `list` actions; verify `tests/host/sharing-controller.test.ts` (or a new controller test) covers both actions and the owner check.
- [x] 6.2 Verify the host snapshot schema is unchanged by running the existing snapshot tests and confirming `SnapshotSchema` and `follow` are untouched.

## 7. Client surface

- [x] 7.1 Add folder, drive, cloud, Git branch, chevron, back, search, and rescan icons to `src/client/icons.tsx`; verify with the existing icon rendering tests or a new snapshot-free assertion that each renders an `svg` with `aria-hidden`.
- [x] 7.2 Replace the storage `<select>` with a `StorageCards` radiogroup (icon, name, one-line description, selected state, roving tabindex, disabled while bound) and update labels to "Google Drive Cloud" and "Google Drive Local"; verify with a browser test that selects a card by accessible name and shows the bound note.
- [x] 7.3 Build `GoogleDriveLocalPanel` covering the unbound, connected, empty, unsupported, permission-denied, and unavailable states, with **Choose folder**, **Change folder**, **Rescan**, and the native picker; verify each state in browser tests against a faked `localDrive` API.
- [x] 7.4 Build `DriveFolderPicker` on the existing `Modal`: left rail of discovered locations, breadcrumb, folder list, current-level filter, create-versus-adopt hint, unavailable rows, keyboard navigation, and the native-picker action; verify with browser tests for navigation, filtering, selection, Escape, and a refused location message.
- [x] 7.5 Add the `Change folder` confirmation and its command wiring, keeping local boards, tasks, and notes; verify the confirmation copy, the cancel path, and that the preview appears for an adopted folder.
- [x] 7.6 Add the panel and picker styles to the client stylesheet using existing host tokens only, and verify light and dark rendering with `page.emulateMedia` in the browser lane.
- [x] 7.7 Update `tests/browser/publishing.spec.ts` and `tests/browser/fake-api.ts` for card selection and the faked `localDrive` query; verify the whole `pnpm test:browser` suite passes.

## 8. Verification and documentation

- [x] 8.1 Run `pnpm check` and confirm host/client typechecks, vitest, and the build pass.
- [ ] 8.2 Run the isolated real-composition lane for the affected views (`node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only hubs`) against a throwaway `DSH_HOME` and confirm the publishing flows still pass.
- [x] 8.3 Run the isolated web smoke with a throwaway `DSH_HOME` and confirm the storage cards, the Drive Local panel, and the empty state render without binding a real Drive folder; store screenshots under `.verification/` and remove the temporary profile.
- [x] 8.4 Update the Team Settings, Google Drive, and Local folder sections of `README.md` with the new storage, the card selector, the picker, and the mount requirements; verify the documented labels match the UI.
- [x] 8.5 Run `openspec validate add-google-drive-local-storage --strict` and confirm the change remains valid before handoff.
