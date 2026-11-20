# Tasks

## 1. Transfer format in the domain

- [x] 1.1 Create `src/domain/workflow-transfer/document.ts` with the format version, the accepted compressed-size limit, the schema for the document and its board entries, and a parser that reports a distinct problem for not-gzip, not-JSON, an unsupported version, a schema failure, and an empty board list; verify with `tests/domain/workflow-transfer-document.test.ts` covering each refusal and a valid document.
- [x] 1.2 Add the deterministic serialiser to the same module: a fixed key order per object, boards in Hub order, and no ambient ordering; verify with a test that serialises the same input twice and compares bytes, and with one that reorders the input boards and observes the output follow the input order.
- [x] 1.3 Create `src/domain/workflow-transfer/plan.ts` with the conflict classifier (trimmed, case-folded name equality), the free-name proposer (suffix, then a running number), and the settlement types; verify with tests for a free name, a conflict, a suffixed proposal, a numbered proposal past an existing suffixed name, and two entries proposing the same name.
- [x] 1.4 Add the orphaned-stage analysis to the plan module: for a replacement, resolve each card's stage by the identity its stage held, mark the ones an incoming stage carries as alignable, and report the ones no incoming stage carries with their identifier and card count; verify with tests for a kept identifier, a renamed identifier carrying the same identity, and a lost identity.
- [x] 1.5 Add the project-scope filter to the plan module: keep the keys the destination Hub holds, report the dropped ones, and report a scope that filtering emptied as opened; verify with tests for a partial drop, a full drop, and an entry carrying no scope.

## 2. Archive codec on the host

- [x] 2.1 Create `src/host/workflow-transfer/archive.ts` that gzip-compresses a payload without a stored timestamp, encodes it as base64, and decodes it back with a bounded decompression that refuses an oversized result; verify with `tests/host/workflow-transfer-archive.test.ts` asserting a round trip, byte-identical output for the same input twice, and a refusal above the bound.
- [x] 2.2 Export the byte-reading and byte-writing helpers the services need so the dialogs never compress or decompress; verify the module exposes no client-reachable import and `tsc -p tsconfig.client.json` still passes.

## 3. Export on the host

- [x] 3.1 Create `src/host/workflow-transfer/export.ts` that reads the chosen boards from `HubRepository`, builds the document through the domain serialiser, and returns the archive plus the reported advisories; verify with `tests/host/workflow-transfer-export.test.ts` for a chosen subset, an empty selection refusal, and an advisory for a board authoring a scripted stage with a file source.
- [x] 3.2 Prove the export changes nothing: assert the Hub revision, every board's authored YAML, and the revision log are unchanged after an export; verify in the same test file.

## 4. Import planning on the host

- [x] 4.1 Create `src/host/workflow-transfer/import.ts` with the analysis entry point: decode the archive, parse the document, read the destination Hub, and return one plan row per entry with its destination kind, target board, proposed copy name, orphaned cards, and dropped project keys; verify with `tests/host/workflow-transfer-import.test.ts` for a mixed file, an oversized file, and a file with one unreadable entry beside readable ones.
- [x] 4.2 Prove the analysis writes nothing: assert the Hub revision and every board are unchanged after an analysis; verify in the same test file.

## 5. Import write through the board writer

- [x] 5.1 Add the import method to `BoardAdministration` that walks the submitted plan inside its serialising tail, creating boards for free and copy destinations and replacing the workflow and default-preset choice for replaced destinations, recording a revision for every written board; verify with `tests/host/board-administration.test.ts` additions asserting one create, one replace, and one revision recorded per write.
- [x] 5.2 Make the replace path realign a card whose stage was renamed by identity before the existing orphan refusal runs, reusing `renameTaskStage`; verify with a test that renames a stage carrying the same identity and observes the card moved and every stage fact rewritten.
- [x] 5.3 Keep the existing orphan refusal for a lost identity, and report the stage identifier and card count per board without failing the others; verify with a test mixing a blocked board and an applicable board and asserting only the applicable one was written.
- [x] 5.4 Apply the project-scope filter as part of the create and replace writes and report the dropped keys and an opened scope; verify with a test for a partial drop and one for a full drop.
- [x] 5.5 Prove a skipped destination changes nothing and prove the whole import is not atomic: assert a failed board leaves the other boards written and the result enumerates every entry; verify with tests in the same file.

## 6. Protocol and dispatch

- [x] 6.1 Declare the export read, the import analysis read, and the import write in `src/remote.ts` with strict zod codecs mirroring the plan and result shapes; verify `tests/host/product-tool-names.test.ts` and `tsc -p tsconfig.host.json` pass, and add a parity test that the declared codecs accept the shapes the host produces.
- [x] 6.2 Expose the three methods on `KanbanController` and dispatch the write command in `src/host/app.ts`; verify with `tests/host/controller-follow.test.ts` or a dedicated controller test that an unknown command is rejected and a valid one reaches the app.
- [x] 6.3 Wire the client API surface in `src/client-bridge.ts` and the `ClientApi` type; verify `tsc -p tsconfig.client.json` passes and the fake API used by client tests declares the same methods.

## 7. Browser transfer port

- [x] 7.1 Create `src/client/settings/boards/transfer-files.ts` with a `WorkflowFilePort` for offering a document for download and for asking the person for a file; verify with `tests/client/transfer-files.test.ts` using a fake port and no reliance on global `URL` or `FileReader`.
- [x] 7.2 Implement the real adapter over a Blob URL, an anchor download, and a hidden file input; verify the adapter keeps the port's contract and the test suite runs in jsdom without touching global DOM APIs directly.

## 8. Export surface

- [x] 8.1 Create `src/client/settings/boards/export-dialogs.tsx` presenting every board of the Hub with a checkbox, a select-all control, and a confirm action disabled while nothing is selected; verify with `tests/client/export-dialogs.test.tsx` for the full list, a subset selection, and the empty-selection refusal.
- [x] 8.2 Make the confirm path request the document and hand it to the port, reporting the advisories the host returned; verify a test observes one download call and the advisory text for a board with an external script source.

## 9. Import surface

- [x] 9.1 Create `src/client/settings/boards/import-dialogs.tsx` presenting the chosen file, the plan rows, the shared policy control, and a per-row settlement control; verify with `tests/client/import-dialogs.test.tsx` for a mixed plan, a policy applied to every conflict, and one overridden row.
- [x] 9.2 Present the proposed copy name as editable and block applying while a name is empty after trimming, matches an existing board, or repeats another proposed copy, naming the offending row; verify with tests for each of those three refusals.
- [x] 9.3 Present the result after applying, listing each entry as created, replaced, skipped, or failed with its reason, and keep the surface open; verify a test observes one result row per entry and the failure reason for a blocked board.
- [x] 9.4 Report an oversized, unreadable, or unsupported-version file at the moment it is chosen, before any plan is presented; verify with tests for each refusal.

## 10. Boards section wiring

- [x] 10.1 Add the Export and Import actions to `src/client/settings/boards/boards-section.tsx` as section-level actions beside New board, importing the two dialog components; verify with `tests/client/boards-section.test.tsx` additions asserting both actions are present, neither is offered per row, and neither changes the active board.
- [x] 10.2 Refresh the list behind an applied import so a created or replaced board appears when the surface closes; verify a test applies an import and observes the new board listed without a reload.

## 11. Documentation

- [x] 11.1 Add an export and import section to `docs/user/workflows.md` describing the selection, the format and its size limit, the conflict settlement, the card-placement rule, and the partial-application result; verify `pnpm run check` passes its documentation gate.
- [x] 11.2 State in `docs/user/hubs-and-boards.md` that the Boards section carries the two transfer actions and link the workflow guide for the procedure; verify the same gate passes.

## 12. Final verification

- [x] 12.1 Run `pnpm run check` and confirm both typechecks, the full suite, and the build pass.
- [x] 12.2 Add a browser test asserting the two dialogs render at the existing configuration overlay size and stay inside the fixed height and scroll region; verify `pnpm run test:browser` passes.
