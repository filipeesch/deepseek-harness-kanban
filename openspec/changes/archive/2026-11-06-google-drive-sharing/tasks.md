# Tasks

## 1. Provider foundation

- [x] 1.1 Add `SharingProviderDescriptor` and `SharingProviderRegistry` under `src/host/sharing/` with id, label, settings schema, address description, store factory, and provider-state schema; verify unit tests resolve Git, reject an unknown provider, and validate settings through the descriptor.
- [x] 1.2 Generalize `SharingBinding` to `{ provider, intervalMinutes, settings }` and add the v2 record schema plus a v1-to-v2 migration in `src/host/sharing/state.ts`; verify a v1 Git record loads with `settings.repository` and keeps base, seen, bindings, orphans, removals, preview, last check, and last error.
- [x] 1.3 Move `SHARED_DOCUMENT_FILE` to the document domain and move `sharingRoot` and `SharingCommandRunner` to neutral host modules; verify `git-store.ts` imports them and the existing sharing tests pass.
- [x] 1.4 Compose the provider registry in `src/index.ts` and pass it to `HubSharingService`; verify the publishing runtime test opens, reads an empty view, and closes with the registry.
- [x] 1.5 Replace the hard-coded `providers.create` path in `HubSharingService` with registry resolution and remove `assertSupportedProvider`; verify an unknown provider fails with `SHARING_UNSUPPORTED_STORAGE` and no operation starts.
- [x] 1.6 Replace `provider`/`repository` in `HubSharingView`, `src/shared/types.ts`, and `src/remote.ts` with the storage, address, synchronization mode, and authorization fields; verify typecheck and the existing sharing view tests.

## 2. Credentials and Google authorization

- [x] 2.1 Add `@deepseek-ai/dsh-credentials` as a peer and type dependency, declare the credential service in the plugin injection, and provide a test composition with a fake credential store; verify the plugin typechecks and the runtime test can describe a record without a value.
- [x] 2.2 Implement `GoogleDriveAuthService` with a temporary loopback server on `127.0.0.1:0`, state and PKCE S256, a single-use callback with timeout, the authorization URL, and cancellation; verify tests with an injected server and fetch.
- [x] 2.3 Implement the code exchange with no client secret by default and an optional `clientSecret` override; verify a successful exchange, a `client_secret` rejection mapped to a typed configuration error, and a custom-client exchange.
- [x] 2.4 Persist the grant in `ctx.credentials` under `kanban/google-drive`, refresh it single-flight through `modifyRecord`, expose only `describeRecord` facts, and revoke and delete it on account disconnect; verify refresh rotation, concurrent refresh, revoke, and account-switch tests.
- [x] 2.5 Add `sharing.auth.start`, `sharing.auth.cancel`, `sharing.auth.disconnect`, and `sharing.auth.switch` to the sharing command union, the remote schema, and the controller; verify the command schema tests and an end-to-end fake authorization flow that updates the snapshot without tokens.
- [x] 2.6 Map authorization failures to `SHARING_AUTH_DENIED`, `SHARING_AUTH_POLICY`, and `SHARING_RECONNECT_REQUIRED`, and assert the snapshot never contains an access token, refresh token, or authorization code.

## 3. Google Drive API client

- [x] 3.1 Implement a `GoogleDriveClient` with an injected `fetch` for `drives.list`, `files.list`, `files.get` metadata and content, `files.create` multipart, `files.update` multipart, `changes.getStartPageToken`, `changes.list`, token exchange, and revoke; verify the client tests against a fake HTTP server for My Drive and Shared Drive parameters.
- [x] 3.2 Map Drive and OAuth failures to typed codes: refresh on 401, policy and permission on 403, missing on 404, rate limit on 429, unavailable on 5xx and network, and invalid document on parse; verify every mapping with a failing fake response.
- [x] 3.3 Implement change-cursor initialization, filtering by the bound document file id, revision-change detection with `headRevisionId`, and the full-read fallback for an expired cursor; verify cursor and revision tests.

## 4. Google Drive provider

- [x] 4.1 Implement `GoogleDriveSharedConfigStore.ensure` to validate the selected folder, find or create `kanban-hub.yaml` by id, adopt an existing document, and refuse a folder already bound to another Hub; verify the provider tests for My Drive, Shared Drive, missing folder, and address in use.
- [x] 4.2 Implement `read` behind the revision gate and `write` with the pre-write token comparison and post-write verification; verify content is read only after a revision change and a concurrent write is reported without a success result.
- [x] 4.3 Implement `destroy` as a no-op for the team document, keep provider state (`driveId`, `folderId`, `fileId`, `headRevisionId`, `changesPageToken`), and verify disconnect leaves the document and other folder files untouched.
- [x] 4.4 Add the Drive settings schema with drive id, folder id, file id, and pasted folder-link normalization; verify settings tests for My Drive, Shared Drive, and a malformed address.
- [ ] 4.5 Add the shared provider contract suite and run it against the Git adapter and the fake Drive adapter; verify read, token, missing document, stale write, and destroy semantics for both.

## 5. Continuous synchronization

- [x] 5.1 Track `syncedRevision` and mark a Hub pending on local board, name, order, or workflow changes; verify pending detection and the debounce with fake timers.
- [x] 5.2 Implement automatic publish of pending changes when the remote document did not change and no conflict or blocker exists; verify successful publish, stale token, and blocker tests.
- [x] 5.3 Implement automatic application of team-only changes during a check in one `HubRepository.transact`; verify team-only apply, both-sides conflict, blocker, and all-or-nothing tests.
- [x] 5.4 Implement offline and transient-failure handling: keep changes pending, report unavailable with the last success, retry on later checks, and resume pending changes after a restart; verify each path with fake failures and a recreated service.
- [x] 5.5 Serialize synchronization per Hub and prevent a check from overlapping a publish or apply; verify the lane and overlap tests.
- [ ] 5.6 Extract the connection flow, publish flow, update flow, and record helpers from `HubSharingService` and wire the coordinator; verify the existing sharing service tests still pass and no Git behavior changes.

## 6. Service, commands, and snapshot

- [x] 6.1 Implement the Drive connection flow (authorization, folder selection, first-connection preview, receive, publish initial) and verify the controller tests for empty folder, existing document, receive, and publish-local choices.
- [x] 6.2 Project pending, syncing, synced, conflict, and offline states plus the last success, current failure, and counts into `HubSharingView`; verify the view tests and the snapshot schema.
- [x] 6.3 Update Hub deletion to remove the Drive binding and any managed workspace while keeping the account grant and the team document; verify the host test for a Drive-published Hub.
- [x] 6.4 Update team-wide board removal so a Drive binding includes the removal in the next automatic synchronization; verify the board deletion and sync tests.
- [x] 6.5 Keep the Git publish, get-updates, and orphan paths unchanged and verify the full existing Git sharing suite after the refactor.

## 7. Team Settings interface

- [x] 7.1 Rename the Configuration section, its title, its aria-label, the board banner target, and the workflow-editor copy from Publishing to Team Settings; verify the browser test opens Team Settings and the Git surface still renders.
- [x] 7.2 Replace `publishing-settings.tsx` with `src/client/settings/team-settings/` modules for the shell, storage selector, Git panel, Drive panel, account card, folder picker, sync status, board review, and blockers; verify the old file is removed and the settings tests pass.
- [x] 7.3 Implement the storage selector so it swaps the Git and Drive connection surfaces while the Hub is unpublished, and shows the bound storage without change while published; verify the selector tests and the Disconnect hint.
- [x] 7.4 Implement the Drive panel states: disconnected, authorizing with cancel, connected account, Drive and folder selection, synchronization status, pending and conflict counts, failure, and the Sync now, Review, Disconnect, and Switch account actions; verify the browser tests with the fake API.
- [x] 7.5 Update the workflow editor so a Drive binding shows a single save action with the automatic-sync hint while a Git binding keeps Save workflow and Save and share; verify both browser scenarios.
- [x] 7.6 Update the Hub and board indicators for pending, syncing, conflict, and offline states; verify the indicator and theme tests.

## 8. Verification and documentation

- [x] 8.1 Run `pnpm check` and verify host and client typechecks, vitest, and the build pass.
- [x] 8.2 Run `pnpm test:browser` and verify the Team Settings, storage swap, Drive connection, and conflict scenarios pass with screenshots under `.verification/`.
- [ ] 8.3 Run the isolated real-composition lane `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --check` and verify the Team Settings scenes pass.
- [ ] 8.4 Perform the manual OAuth acceptance run with the default client and no client secret, then with the optional secret if Google requires it; exercise My Drive, a Shared Drive, folder creation, adoption, a 60-second change, and a conflict; record evidence without tokens or account data.
- [x] 8.5 Update `README.md` and `docs/operations.md` with the Team Settings setup, the Google Cloud prerequisites, the restricted-scope verification and test-mode limits, the credential-store limitation, the Drive concurrency caveat, and the rollback path.
- [x] 8.6 Run `openspec validate google-drive-sharing --strict` and verify the change, the spec deltas, and the artifact set are valid.
