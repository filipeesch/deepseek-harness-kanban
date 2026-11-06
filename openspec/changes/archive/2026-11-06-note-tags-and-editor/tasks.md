# Tasks

## 1. Domain And Persistence

- [x] 1.1 Add `src/domain/note.ts` with `NoteInput`, `NotePatch`, `MAX_NOTE_TAGS`, `MAX_NOTE_TAG_LENGTH`, and `normalizeNoteTags`, keeping it free of Node and schema imports; verify a new `tests/domain/note.test.ts` covers trim, lowercase, 15-character truncation, empty removal, duplicate removal, the 4-tag limit, and empty results.
- [x] 1.2 Rework `saveNote` in `src/domain/hub-operations.ts` to use the shared normalizer and to accept an update with optional content and optional tags; verify `tests/domain/hub-operations.test.ts` covers replace, preserve, clear, tags-only, content-only, and rejection when both are missing.
- [x] 1.3 Point the legacy `BoardStore.saveNote` in `src/domain/store.ts` at the same normalizer and behavior; verify `tests/domain/store.test.ts` stays green and a new case asserts the same normalized tags.
- [x] 1.4 Add `deleteNote` to `src/domain/hub-operations.ts` that removes only the matching note of the identified task and reports a missing note; verify a domain test covers the successful delete and the unknown-id failure without touching another task's notes.
- [x] 1.5 Make `note.save` partial and add `note.delete` in `src/shared/types.ts`, and mirror both in the `src/remote.ts` command schema; verify `pnpm typecheck` passes and a remote/command test rejects an update with neither content nor tags.
- [x] 1.6 Wire the command paths in `src/host/app.ts` for partial `note.save` and `note.delete`, including the `note` receipt; verify a host test asserts tags-only save and delete receipts through `app.command`.

## 2. Note Tools

- [x] 2.1 Add the optional `tags` parameter to `list_notes` with normalized OR matching and pass the same normalization through `create_note`; verify `tests/host/tools.test.ts` covers one tag, several tags, no filter, and case-insensitive matching.
- [x] 2.2 Make `update_note` accept content and/or tags and delegate validation to the command; verify tool tests cover tags-only, content-only, omitted tags, empty tags clearing, and the missing-field error.
- [x] 2.3 Keep `delete_note` absent from the registered tool surface and state the note tag behavior in the affected tool descriptions; verify the tool inventory test still lists only create, list, and update for notes.

## 3. Client Foundation

- [x] 3.1 Add a `PencilIcon` to `src/client/icons.tsx` and an optional `headerActions` slot to `Modal` in `src/client/ui.tsx` without changing existing callers; verify typecheck and the existing client dialog tests.
- [x] 3.2 Add `noteTagFilter` to `TaskPageState` in `src/client/page-state.ts` and pure `uniqueTags`, `filterNotes`, and `toggleTag` helpers in `src/client/notes/note-tags.ts`; verify unit tests for alphabetical unique tags, filtering, and toggle-to-clear.
- [x] 3.3 Add `src/client/notes/use-note-editor.ts` with the draft content and tags, pending and error state, dirty tracking, and fenced save/delete completion keyed by task and note; verify tests cover stale completion, unmount, failed save keeping the draft, and close discarding it.
- [x] 3.4 Build `src/client/notes/note-tag-input.tsx` with Enter/comma chips, chip removal, suggestions from the task's tags, duplicate suppression, the 4-tag disabled state, and accessible labels; verify component tests for each behavior.
- [x] 3.5 Build `src/client/notes/note-tag-bar.tsx` with All and alphabetically sorted unique tags, single active filter, `aria-pressed`, and toggle-to-clear; verify component tests and that the bar is absent when no tag exists.
- [x] 3.6 Build `src/client/notes/note-list.tsx` with the 250px Markdown preview, tag chips, and the pencil-icon edit action; verify component tests for chips on tagged notes only and the accessible edit name, plus the 250px clamp in the browser lane.
- [x] 3.7 Build `src/client/notes/note-editor-dialog.tsx` with the wide modal, Edit/Preview tabs, tag input, header delete with inline confirmation, blank-content save guard, close-discard, and save-closes behavior; verify component tests for create, edit, preview, delete confirm/cancel, blank save, and error retention.
- [x] 3.8 Replace the inline note editor in `src/client/forms.tsx` with the new `NotesPanel` composition, keeping the original Markdown whitespace behavior and the fenced save guarantees; verify client tests for overlay creation, pencil editing, filter memory across drawer sections, filter clearing after save, and the absence of an inline textarea.

## 4. Documentation

- [x] 4.1 Update the Notes section of `README.md` and the notes passage of `docs/operations.md` to describe tags, normalization, the tag bar, the editor overlay, and UI-only note deletion; verify `rg -n "inline|shared task notes" README.md docs/operations.md` no longer contradicts the new behavior.

## 5. Verification

- [x] 5.1 Run `pnpm check` and confirm typechecks, vitest, and the build pass with the new note tests included.
- [x] 5.2 Run `pnpm test:browser` in light and dark appearances, assert the tag chips, the clamped preview, and the overlay contrast against host tokens, and store the screenshots under `.verification/`.
- [x] 5.3 Run `openspec validate "note-tags-and-editor" --strict` and confirm the change remains valid after implementation.
