# Tasks

## 1. Path, limit, and text primitives

- [x] 1.1 Add `src/host/team-files/limits.ts` with the constants the contract names (2000 lines, 50 KiB, 2000 characters per line, 100 path matches, 250 content matches, 30 s search deadline) and verify with a unit test that asserts each value and that no call site hardcodes a number.
- [x] 1.2 Add the `TeamFileRoot` value object: construction from a resolved absolute root, `resolve(relative)` returning the absolute and normalized relative paths, realpath containment, and the reserved `.trash` namespace. Verify with a test covering an absolute path, `..`, a backslash, a NUL, a control character, an empty segment, `.trash` and a path inside it, a symbolic link that escapes, and a valid nested path that resolves inside.
- [x] 1.3 Add UTF-8 decoding with a fatal decoder plus binary detection (decode failure, a NUL in the first window, or a known binary extension). Verify with a test that refuses PNG and PDF bytes and accepts UTF-8 with accented characters and an emoji.
- [x] 1.4 Add read rendering that numbers lines, truncates a long line at the character bound, stops at the byte budget, and reports which bound was reached. Verify with a test for each of the three truncation flags and for a window read that is not truncated.

## 2. Team file store port and the filesystem implementation

- [x] 2.1 Add `src/host/sharing/team-file-store.ts` with the `TeamFileStore` port, `TeamFileEntry`, `TeamFileContent`, and the write result. Verify with a typecheck and by asserting a fake store satisfies the port in a test.
- [x] 2.2 Add `TeamFileDirectory` (rooted list, read, atomic replace through a temporary sibling, move, and first-write directory creation) and `DirectoryTeamFileStore` on top of it. Verify with a test on a temporary directory: a replace never exposes a partial file, a list never returns a path inside `.trash`, a move creates its parent, and `ensure` creates the root only when asked.
- [x] 2.3 Add `createFileStore` to `SharingProviderDescriptor` and `supportsFiles` to `ProviderDescription`, derived from the presence of `createFileStore`. Verify with a registry test that `git`, `local-folder`, and `google-drive-local` report support and `google-drive` reports none, without any branch on the provider id inside the registry.

## 3. Git clone extraction and the Git store

- [x] 3.1 Extract a `GitClone` collaborator from `GitSharedConfigStore` (command runner, `ensure`, `fetch`, remote head, branch name, reset, commit with the fixed identity, and push) and make the document store use it. Verify that the existing sharing, sync, and Git tests pass unchanged.
- [x] 3.2 Add `GitTeamFileStore` that composes `GitClone` with `TeamFileDirectory`: fetch before a write, compare the target path at the fetched head with the working tree copy, refuse on a difference, commit and push on success, and reset to the fetched head when the push is refused. Verify with a fake command runner scripted for a clean write, a team-side change, and a refused push, asserting the clone ends at the fetched head in the last case.
- [x] 3.3 Wire `createFileStore` into the Git descriptor so the clone root is `<managed root>/<hubId>/team-files`. Verify with a descriptor test that the created store resolves inside the managed clone and that its Git identity matches the document store's.

## 4. Team files service

- [x] 4.1 Add `TeamFileStoreSource` and `TeamFiles` in `src/host/team-files/`, implementing search, read, create, edit, and delete with the path, limit, text, and trash rules, and the typed failures. Verify with a unit test per requirement scenario in `specs/team-files/spec.md`, using an in-memory store.
- [x] 4.2 Verify the edit contract explicitly: several replacements applied together, a non-unique or absent existing text refusing the whole call and naming the replacement, no partial write on failure, and a create that refuses an existing path.
- [x] 4.3 Verify the trash contract explicitly: a delete moves under `.trash/<relative>.<timestamp>`, a repeated delete of the same path creates a second entry, every tool refuses a path inside `.trash`, a delete without confirmation fails, and the directory survives the last delete.
- [x] 4.4 Add `HubSharingService.fileStoreFor(hubId)` and expose the existing per-Hub lane as a public `exclusive` seam, wrapping file writes in it. Verify with a service test: an unbound Hub reports the not-bound error, a Google Drive Cloud Hub reports the unsupported error naming the storage, a folder-backed Hub returns a working store, and a file write waits for an in-flight document operation.
- [x] 4.5 Add the optional `teamFiles` dependency to `KanbanApp` / `AppOptions` and construct it in `src/index.ts`. Verify with an app test that a fixture without the dependency yields a typed unavailable failure instead of a crash.

## 5. Tools

- [x] 5.1 Add `src/host/tools/team-files.ts` with `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`, resolving the Hub with `resolveHub` and registering through `normal(...)`. Verify that `productToolDefinitions` exposes exactly the expected names and that no name collides with a host-native tool.
- [x] 5.2 Verify the model-facing guidance: every write description contains `explicitly`, search and read are marked concurrency-safe, and the three writes are not.
- [x] 5.3 Verify the tools end to end against a Hub bound to a temporary local folder: create, search by path and by text, read, edit, and delete, including the trash being invisible, a reserved path being refused, a missing file, an existing file, and a binary file.
- [x] 5.4 Verify the unsupported and unbound paths through the tools: a Hub bound to Google Drive Cloud and a Hub with no binding each produce a typed, actionable failure and leave the location untouched.

## 6. Documentation and release

- [x] 6.1 Update `README.md`: the Git, local folder, and Google Drive Local sections name the `team-files` directory and its trash behavior, the Google Drive Cloud section states that team files are unavailable, and the registered-tool table gains the five tools. Verify by reading the rendered sections.
- [x] 6.2 Bump `package.json` `version` in this change, per the repository release rule. Verify the build emits the new version.
- [x] 6.3 Expose `supportsFiles` on the sharing view and render the Team Settings line that names the `team-files` directory, plus the unavailability line for Google Drive Cloud. Verify with the client tests that cover both states and the absent storage.

## 7. Verification

- [x] 7.1 Run `pnpm check` and confirm host typecheck, client typecheck, vitest, and the build all pass.
- [x] 7.2 Add an integration test that binds a local folder to a temporary directory, uses the tools on a Git-free binding, and asserts after each write that every other entry of the folder is unchanged. Verify it passes in vitest.
- [x] 7.3 Confirm the published document is unaffected: run the existing sharing tests plus an assertion that a team file write leaves the document, its token, and the merge path untouched.
- [x] 7.4 Run the isolated real-composition lane for the affected surfaces (`--only board`, `--only conversation`) and confirm the Team Settings line renders without a new surface. Store the evidence under `.verification/`.

## 8. Review fixes

- [x] 8.1 Validate every existing ancestor before a write creates a directory, so a symlink that escapes the root never receives a new entry. Verify that the outside directory gains nothing on refusal.
- [x] 8.2 Reserve the trash by canonical identity, not by spelling: refuse a read, write, edit, or deletion reached through an alias that resolves into it, and exclude such an alias from the listing.
- [x] 8.3 Refresh the checked-out team files on the automatic publishing check when no tracked file is modified, so a Git read is at most one check interval behind. Verify with the commit-aware Git double.
- [x] 8.4 Compare the target against the fetched remote, then adopt the fetched head before writing, so an unrelated team change no longer rejects the push; a refusal resets the clone to the fetched content so a retry is possible; a rollback that fails is reported instead of swallowed.
- [x] 8.5 Hold the publishing lane for a whole create, edit, or delete, make the lane re-entrant for the same Hub, and resolve the binding inside the lane. Verify that two concurrent creates or edits cannot both succeed and that a write queued behind a disconnect is refused.
- [x] 8.6 Bound a content search by an emitted-match budget and by the input cap, search every path-matching file instead of a page, return only matching paths, and budget the rendered line objects in a read. Verify the byte, candidate, and truncation cases.
- [x] 8.7 Replace the literal existing text by index instead of `String.replace`, so `$&` and `$$` are written as characters. Verify both tokens.
- [x] 8.8 Preserve a UTF-8 byte order mark across decode and edit. Verify that an unrelated edit round-trips the file bytes.
- [x] 8.9 Allocate the trash destination with a non-overwriting operation, fail when every candidate is taken, and report the destination the file actually reached.
- [x] 8.10 Guard the Google Drive Local file store with the same mount check the document store uses, before every operation.
- [x] 8.11 Classify text consistently: a content search skips a binary path and a binary payload, and supplied content is refused when a later read would classify it as binary.
- [x] 8.12 Validate the path exactly as supplied — no trimming — so a control character cannot be hidden and a name with surrounding spaces stays addressable.
- [x] 8.13 Implement the advertised glob syntax, including `[...]` character classes, ranges, and negation.
- [x] 8.14 Strengthen the Git double to model commits, ancestry, remote contents, and reset effects, and correct the assertions that endorsed divergent behavior.
- [x] 8.15 Create through a transport-level non-replacing operation, so an entry a listing did not show cannot be replaced.
- [x] 8.16 Bound the owned directory to a direct child of its bound location, and compare the trash by its canonical identity, refusing a symlinked trash as a deletion destination.
- [x] 8.17 Measure both byte budgets on the serialized representation, and check the deadline during a long file scan.
- [x] 8.18 Validate the content an edit produces before writing, so a replacement cannot introduce NUL or a lone surrogate.
- [x] 8.19 Delete without loading the file, using the move as the existence check.
- [x] 8.20 Map every Git protocol failure to the team-file error shape, and treat a failed rollback as a failure rather than a retryable refusal.
- [x] 8.21 Keep a glob character class inside one path segment and report a malformed pattern as a typed error.
- [x] 8.22 Add a real publish ordering test and move the failed-rollback test to the rejected-push point.
