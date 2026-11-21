# Proposal

## Why

Answering a decision request with a file is broken: the plugin hands the answer file to the host's
upload service as exact bytes, and that branch of the host service resolves a Remote namespace
against the caller's inject list, so every submission carrying a file fails with
`cannot get property "remote.fileUploads" without inject` and the round stays in its draft. The
attachments capability only works today on the paths that were never exercised.

The three surfaces that accept a file are also far heavier than the value they carry. Each one
spends a full fieldset or slide block on a path field, an add button, a choose button, a hint, and
a list, duplicating the same reading, failure, and retry logic twice.

## What Changes

- Fix answer-file delivery by uploading through the host's documented background carrier (a
  `Blob`/`File` body) instead of the exact-bytes branch, behind a small injectable adapter that a
  unit test can hold to that contract.
- **BREAKING** (person-facing): remove the attach-by-host-path control from every person-facing
  surface — task creation, the task drawer's files panel, and the question round. Absolute host
  paths stay available to the agent through the card tools. Task attachments now come from the
  browser file dialog and the clipboard.
- Replace the add controls on all three surfaces with one compact icon action that opens the
  browser file dialog, attached files presented as small tokens (name, size, remove).
- Move the question round's attach action into the panel footer, next to the existing actions; the
  action attaches to the slide currently shown, and the footer lists that slide's files as compact
  tokens.
- Move the New task dialog's attach action and its file tokens into the dialog footer, next to
  Cancel and Create task.
- Keep a failed selection blocking the action it belongs to, with a compact retry/discard notice
  above the footer instead of the previous inline block.
- Extract the shared attachment UI (size text, file reading, the picker icon, the token list, and
  the pending/failed selection gate) into one module used by all surfaces, and delete the duplicate
  implementations.
- Update the capabilities and the user documentation to match the narrower source list.

## Capabilities

### New Capabilities

None. The behavior belongs to the existing `task-attachments` and `structured-questions`
capabilities.

### Modified Capabilities

- `task-attachments`: the person-facing add sources shrink to the browser file dialog and the
  clipboard, the add action becomes one compact icon in the footer of the task-creation dialog and in
  the drawer's files panel, and the created task's files are shown as compact tokens. Agent path
  support is unchanged.
- `structured-questions`: the round's attach action moves to the panel footer and attaches to the
  active slide, that slide's files are listed as compact tokens beside it, and a failed selection
  keeps the round unsubmittable until it is retried or discarded.

## Impact

- Client: `src/client.tsx` (answer-file delivery wiring), `src/client/question-dock.tsx`,
  `src/questions/QuestionForm.tsx`, `src/questions/QuestionFiles.tsx`,
  `src/questions/styles.ts`, `src/client/forms.tsx`, `src/client/task-files-section.tsx`,
  `src/client/task-files.tsx`, `src/client/styles/task-files.ts`, plus a new shared attachment
  module.
- Host: no storage change. `task.create` keeps its `attachments` field and `task.edit` keeps its
  `attachmentPaths` field, because the agent's card tools write through both.
- Specs: `openspec/specs/task-attachments/spec.md`,
  `openspec/specs/structured-questions/spec.md`.
- Docs: `docs/user/task-files.md`.
- Tests: client component tests for the new controls, a delivery-adapter unit test, the browser
  question and task-file specs, and the documentation gate.
- Host dependency: the fix relies on the documented `fileUpload.upload` carrier behavior, not on a
  host patch. The exact-bytes branch stays defective in the pinned host and is avoided, not fixed.
