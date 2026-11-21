# Tasks

## 1. Fix answer-file delivery

- [x] 1.1 Add `src/client/answer-files.ts` exposing a factory that turns one draft answer file (`{ name, data }` base64) into a `File` and uploads it through the host upload port, mapping a successful receipt to its id and both failure shapes to readable errors; verify with `tests/client/answer-files.test.ts` asserting the uploaded body is a `File` (never a `Uint8Array`), its name and bytes match the decoded draft, and a refused or receipt-less outcome throws with the host's message.
- [x] 1.2 Wire the factory into the question dock's `fileDelivery.upload` in `src/client.tsx` and delete the manual base64 decode there; verify `tests/client/answer-files.test.ts` covers the adapter and the prompt composition, `tests/client/question-dock.test.tsx` covers the dock building one prompt with a receipt per file through the real factory, and the bridge tests still pass.
- [x] 1.3 Verify the answer-file path at both ends the plugin owns: `tests/client/answer-files.test.ts` proves the delivery sends one prompt carrying a file part per receipt in order, and `pnpm run test:browser` proves the question surface submits a round carrying its restored files and the reply names each one. The host's own upload route and prompt admission stay host responsibilities.

## 2. Shared attachment module

- [x] 2.1 Create `src/attachments/bytes.ts` with the attachment byte-size text and the browser file reader, and point `src/client/task-files.tsx` and the question surface at it; verify the existing size formatting and upload tests still pass and the duplicated implementations are gone.
- [x] 2.2 Add `src/attachments/picks.ts` with the `useAttachmentPicks` hook that serializes pick batches in call order, counts reads in flight, keeps one identity per selection, exposes `retryFailed`, `discardFailed`, `outstanding()` and `settle()` (which waits for every selection and reports whether one still needs a decision, without throwing); verify with `tests/attachments/picks.test.tsx` covering order preservation, all-or-nothing retry identity, a failing selection blocking submission, discard releasing it, the live gate, and `settle` waiting for an in-flight read.
- [x] 2.3 Add `src/attachments/AttachButton.tsx`, `src/attachments/AttachmentChips.tsx` and `src/attachments/clipboard.ts` (icon action with a hidden file input, token list with a named group and per-file removal, clipboard file extraction); verify with `tests/attachments/controls.test.tsx` covering the accessible names, disabled state, the picker opening the input, token text and size, and that pasted text yields no files.
- [x] 2.4 Add the shared `ka-` styles to a new `src/attachments/styles.ts` module, include them in the board style bundle and in the question styles, and remove the superseded `kq-files` rules; verify the browser harness renders the tokens and focus rings in both appearances.

## 3. Question panel: footer attach action

- [x] 3.1 Replace the per-slide attachment block in `src/questions/QuestionForm.tsx` with the footer icon action, the active slide's tokens, and the compact failure band between the scrolling body and the footer, keeping the "Files for this question" and "Files for the whole round" group names; verify `tests/questions/QuestionForm-files.test.tsx` passes with the rewritten selectors and still covers attaching, submission with bytes, waiting for an in-flight read, and the failed-selection escape.
- [x] 3.2 Make the action follow the active slide and keep each slide's tokens exclusive to it; verify with a test that attaches on one question, moves to another and to Additional Notes, and finds only that slide's files listed.
- [x] 3.3 Delete `src/questions/QuestionFiles.tsx` and its `kq-files` styles once nothing imports them, and keep clipboard paste working on the slide; verify with a test that pastes a file onto the active slide and a test that pasted text attaches nothing.

## 4. New task dialog: compact files in the footer

- [x] 4.1 Remove the files fieldset from `src/client/forms.tsx` — the host-path input, the add-path button, the choose-file button and their hints — and place the icon action with the tokens in the dialog's action row; verify `tests/client/new-task-dialog.test.tsx` shows no path field, one attach action, tokens for picked files, and that Create waits while a read is in flight.
- [x] 4.2 Keep the creation all-or-nothing contract with the shared hook: an unreadable selection creates no task and names the failure, and the pasted-file path still attaches; verify with tests for both cases against the harness command payload.
- [x] 4.3 Update the dialog's browser coverage and capture the new footer in both appearances: `pnpm run test:browser` with a screenshot of the New task dialog carrying one file in light and dark.

## 5. Drawer files panel: one add action

- [x] 5.1 Replace the path input, the Add button and the Choose a file button in `src/client/task-files-section.tsx` with the shared icon action plus a paste handler on the surface, keeping the confirmed removal and the download action; verify `tests/client/task-files.test.tsx` asserts one add action, no path field, confirmed removal naming the file, and download addressing the route.
- [x] 5.2 Delete the now-dead `api` parameter from `TaskFilesPanel` and `TaskFilesSection`, and the drawer wiring that passes it; verify `pnpm run typecheck` passes and no call site still supplies it.
- [x] 5.3 Verify the drawer panel in the harness with a screenshot in both appearances, plus the empty state, and confirm the existing `task-files` browser spec passes with the new control.

## 6. Documentation and capability sync

- [x] 6.1 Rewrite the attachment sections of `docs/user/task-files.md` to describe one icon action per surface, the token list, the question footer placement, and the browser-and-clipboard source list without the host path; verify `pnpm run check` passes and the document stays under its line ceiling.
- [x] 6.2 Confirm the delta specs under `openspec/changes/slim-attachment-controls-and-fix-answer-files/specs/` match the shipped behavior and that `openspec validate slim-attachment-controls-and-fix-answer-files --strict` passes.

## 7. Verification

- [x] 7.1 Run `pnpm run typecheck`, `pnpm run test` and `pnpm run check`, and record that every gate passes.
- [x] 7.2 Run `pnpm run test:browser` and review the captured screenshots for the question footer tokens, the failure band, the New task dialog footer and the drawer files panel in light and dark.
- [x] 7.3 Walk the failure the change fixes: the adapter test proves the body is a `File` (never the exact-bytes branch that threw), and the browser lane submits a round carrying a file and reads back the reply naming it. Record in the design that the real upload route is host-owned and is not requalified here.
