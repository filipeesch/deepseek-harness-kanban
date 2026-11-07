# Tasks

## 1. Single storage identifier source

- [x] 1.1 Declare the storage list once in `src/shared/types.ts` (`SHARING_STORAGES` as a const tuple, `SharingStorage` derived from it) and verify `pnpm typecheck` reports no error in `src/shared`, `src/remote.ts`, and `src/host`.
- [x] 1.2 Derive the host `SharingProviderId`, `isSharingProviderId`, the `state.ts` binding `z.enum`, and the `remote.ts` `sharingStorage` enum from that list, so the storage set is declared once; the remaining `'google-drive'` literals are only the places that name that storage: its descriptor, its panel, its credential key, the shared storage list, the client panel registry, and the pre-selector compatibility fallback.
- [x] 1.3 Add a regression test that a binding with an unknown provider is still rejected by `migrateSharingRecord`, and verify `pnpm test -- tests/host/sharing-state.test.ts` passes.

## 2. Descriptor capabilities replace provider branches

- [x] 2.1 Add the descriptor capabilities the service branches on (external authorization required, and a binding-validation hook) to `SharingProviderDescriptor`, implement them in the Git and Google Drive descriptors, and verify `pnpm test -- tests/host/sharing-service.test.ts tests/host/sharing-runtime.test.ts` passes unchanged.
- [x] 2.2 Replace the `provider === 'google-drive'` branches in `HubSharingService.connectNow`, `HubSharingService.viewOf`, and `buildSharingView` with those capabilities, and verify `grep -rn "google-drive" src/host/sharing/service.ts src/host/sharing/view.ts` returns nothing.
- [x] 2.3 Move the duplicated remote-read-and-failure block of `checkNow` and `getUpdates` into one helper, and verify `pnpm test -- tests/host/sharing-service.test.ts tests/host/sharing-sync.test.ts` passes.
- [x] 2.4 Extract the compare-verify write sequence shared by the Drive store into one module with the existing typed errors, and verify `pnpm test -- tests/host/sharing-drive-store.test.ts` passes.
- [x] 2.5 Remove the unused `GitSharedConfigStoreFactory`, `GitProblem`, and `ProviderStateSchema`, move their test coverage to the descriptors, and verify `pnpm typecheck` and `pnpm test -- tests/host/sharing-git-store.test.ts` pass.

## 3. Local folder path and settings

- [x] 3.1 Implement path normalization for the binding: expand a leading `~`, resolve to an absolute canonical path, and lowercase for identity on `darwin` and `win32`; verify with unit tests covering `~`, a relative path, a symlink, and two spellings of one directory.
- [x] 3.2 Implement the refusal cases with distinct typed errors: missing directory, path is a file, directory not writable, directory inside the managed publishing workspace, and directory already bound to another Hub; verify each case has a unit test asserting the error code and that no binding is written.
- [x] 3.3 Implement the suggested default folder `~/.dsh-kanban/<hubId>` from an injected home directory, and verify a unit test that never reads the real home and covers two Hubs producing two distinct paths.
- [x] 3.4 Implement the narrow creation rule: `connect` creates the directory only when the received path resolves to the suggested path, and verify a test that a custom missing path is refused without creating anything.

## 4. Local folder store

- [x] 4.1 Implement `LocalFolderSharedConfigStore.ensure()` as a read-only check of the directory and the document, and verify a test that it never creates or modifies anything.
- [x] 4.2 Implement `read()` with the last-modified-time and size observation, a full document read when the observation differs, is absent, or cannot be read, and a `null` result when the document is absent; verify tests for the unchanged-observation skip, the changed-observation read, and the missing-file case.
- [x] 4.3 Implement `write()` as read-token, compare, dot-prefixed temporary sibling, same-directory rename, re-read, and verify; verify tests for a successful write, `SHARING_STALE_TOKEN`, `SHARING_CONCURRENT_WRITE`, no leftover temporary sibling, and a reader never observing a partial document.
- [x] 4.4 Add a bounded retry for `EBUSY` and `EPERM` around the rename and verify it with an injected failure that succeeds on a retry and one that exhausts the retries into a typed failure.
- [x] 4.5 Implement `state()`, the no-op `destroy()`, and the descriptor (`id: 'local-folder'`, label, `syncMode: 'continuous'`, default interval 1); verify a test that disconnecting leaves the directory, the document, and every other file unchanged.

## 5. Conflict copies and storage review

- [x] 5.1 Implement conflict-copy detection: list the bound directory, report entries whose name begins with the document base name and is not the document, and exclude the plugin's own dot-prefixed temporary files; verify unit tests for the Dropbox, Drive, and OneDrive naming shapes.
- [x] 5.2 Project a detected conflict copy as a storage-level blocker carrying the entry names, expose it through `HubSharingView.blockers`, and verify a view test asserting the status, the blocker code, and the names.
- [x] 5.3 Latch automatic apply and automatic publish while a storage-level blocker is present and clear it on the next successful check after the entries are gone; verify with a synchronization test that nothing is written while the blocker exists and that the Hub synchronizes after it clears.

## 6. Registry and host composition

- [x] 6.1 Register the local folder descriptor in `openHubSharing` and pass the injected home directory from the composition root; verify `pnpm test -- tests/host/sharing-runtime.test.ts` passes and the registry contains three storages.
- [x] 6.2 Extend the RPC schemas for the third storage identifier and the storage-level blockers, and verify `pnpm test -- tests/host/sharing-controller.test.ts` passes.

## 7. Client surface

- [x] 7.1 Extract `StoragePreview` and `ConnectedStorageSurface` from the Git and Google Drive panels without changing their rendered output, and verify `pnpm test:browser -- --grep "Team Settings"` passes.
- [x] 7.2 Replace the panel ternary in `TeamSettings` with a `Record<SharingStorage, Component>` registry and add the third selector option, and verify a browser test that selects each storage and sees its own connection surface.
- [x] 7.3 Implement the local folder panel: pre-filled suggested path, typed path, folder picker with manual fallback, Connect, Sync now, Disconnect, interval, status, pending and conflict counts, last successful synchronization, current failure, and the storage-level review together with its clearing step; verify browser tests covering connect, a refused connection naming its condition, the review presentation, and disconnect.
- [x] 7.4 Show a storage-level review in the board banner and the Hub tab indicators as a review state, and verify a browser test asserting the accessible label.

## 8. Integration and documentation

- [x] 8.1 Add a runtime test covering connect, automatic synchronization on a board save, and disconnect against a real temporary directory, and verify `pnpm test -- tests/host/sharing-runtime.test.ts` passes.
- [x] 8.2 Add browser coverage for the local folder in light and dark appearances with the host tokens asserted, and verify `pnpm test:browser` writes the screenshots under `.verification/`.
- [x] 8.3 Update the README Team Settings section with the local folder storage, the suggested default path, the synchronization model, the guarantee it offers, and the conflict-copy review; verify the section names all three storages and the default path.
- [x] 8.4 Update `docs/operations.md` with the local folder recovery notes: unavailable folder, missing document, conflict copies, and rollback; verify every new failure has a recovery step and the rollback note names this storage.
- [x] 8.5 Run `pnpm check` and verify typechecks, unit tests, and the build all pass.
- [x] 8.6 Run `openspec validate local-folder-sharing --strict` and verify the change validates with no error.

## 9. Review fixes

- [x] 9.1 Bind the remembered observation to the bytes actually read (stat before and after the read, compare identity, modification and change time, and size) and treat an unstable read as no observation; verify a regression test that replaces the file during the read and asserts no observation is remembered, plus one that treats a replacement during verification as `SHARING_CONCURRENT_WRITE`.
- [x] 9.2 Guard the automatic lane at the write boundary: the same store instance that will write inspects its own review after `ensure()` and, when one is detected, persists it and stops without applying or publishing; verify a regression test that lands a conflict copy after the check read and asserts the document is unchanged and the Hub reports the review.
- [x] 9.3 Keep the Hub review indicator independent of availability: show it for conflicts, for a needs-review status, and for a storage-level blocker; verify browser coverage of an unavailable Hub with board conflicts and with a storage-level conflict copy.
- [x] 9.4 Exercise the production wiring: save through the application command on a local-folder Hub, observe the synchronized document, disconnect, and confirm a later save leaves the file untouched.
- [x] 9.5 Assert the rendered host tokens: the primary button background and label equal the resolved host token values in light and dark, with a contrast floor, instead of merely differing between appearances.
