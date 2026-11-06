# Design

## Context

See `proposal.md` for motivation and `specs/task-notes/spec.md` plus `specs/product-tools/spec.md` for the behavior contract.

Current state that shapes the approach:

- Notes live in the persisted Hub aggregate (`HubState.notes`) with an optional `tags` array already accepted by the type, persisted schema, `note.save` command, and note tools. The legacy `BoardStore` in `src/domain/store.ts` keeps a second copy of the same note logic, and `NoteInput` is declared twice.
- The client renders the Notes list and its editor from one inline component in `src/client/forms.tsx`. It has no tag input, renders tags as plain text, and has no overlay.
- Drawer UI bookmarks live in `TaskPageState` and are read through `usePageField`, which is how the Notes filter can survive navigation without a second state store.
- `Modal` in `src/client/ui.tsx` already provides backdrop, focus trap, Escape handling, `aria-modal`, and a wide variant; `Tabs` and `Markdown` are reusable primitives.
- Save races are already a reviewed concern: the note editor keys its lifetime by task and fences stale completions. The overlay must preserve that guarantee.
- No note delete operation or command exists today, and the agent tool surface deliberately exposes only create, list, and update for notes.

## Goals / Non-Goals

**Goals:**

- One normalization rule enforced by every write path, including the legacy board store.
- A single editor overlay shared by create and edit, with a controller that owns drafts, fences, and errors so the view stays presentational.
- A tag filter that is pure client state, testable without the host, and remembered per task.
- Tool changes that reuse the same domain behavior instead of duplicating validation in `src/host/tools.ts`.

**Non-Goals:**

- Tags on task cards, projects, workflows, or columns.
- A `delete_note` agent tool or any change to the approved agent mutation surface beyond note tag support.
- Backfilling or rewriting tags already persisted in existing Hub state.
- Removing `BoardStore` or migrating the legacy board aggregate.
- Multi-tag (AND/OR) filtering in the drawer, saved filters, or tag administration across tasks.
- Full-screen editing, autosave, or draft recovery after closing the overlay.

## Decisions

### 1. One pure note module shared by Hub and legacy paths

Create `src/domain/note.ts` exporting `NoteInput`, `NotePatch`, `NoteWrite`, `MAX_NOTE_TAGS`, `MAX_NOTE_TAG_LENGTH`, `normalizeNoteTags`, `noteTagsOf`, `applyNoteTags`, and `validateNoteWrite`. `hub-operations.saveNote` and the legacy `BoardStore.saveNote` both use the same write rule and normalizer. The module has no Node-only or framework imports so the client can import the same helper for chip display and comparison.

- Why: the project already duplicates note logic between `hub-operations.ts` and `store.ts`; adding limits in two places would drift immediately.
- Alternatives considered: normalizing inside the Zod schema (rejected: the schema validates persisted state, and transforming on read would rewrite history and could reject old data); duplicating the rule in the client (rejected: the chip would lie about what gets stored); normalizing only in the host command layer (rejected: tools, UI, and imports would diverge).

### 2. Normalization and persisted shape

Normalization produces a deduplicated array in first-occurrence order. A note stores `tags` only when the normalized result is nonempty; an empty result removes the property instead of persisting `[]`. The persisted schema keeps `tags` optional and unrestricted by count or length so previously written state always loads.

- Why: an absent property is the existing representation of "no tags" and keeps the UI check simple.
- Alternative considered: storing `[]` (rejected: two representations for the same state, and archive/backup comparisons become noisy).

### 3. Update semantics

`note.save` becomes a partial update: `content` is required when creating and optional when updating; `tags` is optional everywhere. The command is rejected when an update provides neither content nor tags. An omitted tag field preserves the current tags; an explicit array replaces them; an empty array clears them. This applies to the UI and to `update_note`.

- Why: without it, `update_note` cannot change tags without rewriting Markdown, and the overlay could not remove the last tag.
- Trade-off: an empty array clearing tags intentionally diverges from Railyin, where `[]` is a no-op. The spec and tool description state the divergence so agents and users get predictable behavior.
- The editor omits `tags` when the user did not change them, so a content-only edit never rewrites legacy stored values; it sends the normalized collection only after a tag change.
- Alternative considered: a separate `note.tags` command (rejected: two write paths, two receipts, two race surfaces for one aggregate).

### 4. Note deletion is a command, not a tool

Add `note.delete` to the `Command` union, the remote schema, the app dispatcher, and the Hub operations. It deletes only the matching note for the identified task and returns the deleted note id as a `note` receipt. No tool is registered.

- Why: the overlay needs a lifecycle action, but the approved agent surface explicitly excludes destructive note operations; keeping it a command mirrors how UI-only administration works elsewhere.
- Alternative considered: routing deletion through `note.save` with a tombstone (rejected: implicit semantics and no clean receipt).

### 5. Client decomposition under `src/client/notes/`

```
notes-panel.tsx      composition: New note, tag bar, cards, empty states
note-tag-bar.tsx     All + unique tags, aria-pressed, toggle behavior
note-list.tsx        cards: 250px Markdown preview, tag chips, pencil action
note-editor-dialog.tsx  Modal wide: title, tabs, textarea, tag input,
                        header delete + inline confirm, footer actions
note-tag-input.tsx   chip input: Enter/comma, removal, suggestions, limit
use-note-editor.ts   controller: draft, tags, pending, error, dirty,
                     fenced save/delete, close/discard behavior
note-tags.ts         pure helpers: uniqueTags, filterNotes, toggleTag
```

`NotesPanel` receives `task`, `state`, `run`, and `viewState` and passes narrow props down. It passes `run` to the dialog, which owns the draft controller; the dialog never reads the board store directly. `note-tags.ts` imports the domain helper for chip text and filtering, so legacy tags are presented by their normalized values.

- Why: it follows the `projects/` and `execution-preparation/` pattern of a controller hook plus presentational components, keeps `forms.tsx` from growing, and makes each piece testable in isolation.
- Alternative considered: one `NotesPanel` with internal subcomponents (rejected: it already produced a single-line god component and hides the save fence).
- Alternatives considered for the tag model: a generic tag picker reused across the product (premature: no other surface uses tags).

### 6. Overlay behavior and shared primitives

Reuse `Modal` with `size="wide"`. Add an optional `headerActions` slot to `Modal` so the note delete action can live in the header without forking the primitive; existing callers are unaffected. Use the existing `Tabs` primitive for Edit/Preview and `Markdown` for the preview. Close discards silently, including Escape and backdrop, but `Modal`'s `busy` lock prevents closing during save or delete. On success the panel closes the overlay and the refreshed snapshot updates the list; no success banner is shown. Errors stay in the dialog with the draft intact.

- Why: the project already has accessible dialog and tab primitives; a bespoke overlay would duplicate focus and Escape handling.
- Alternative considered: a full-screen overlay like Railyin (rejected: second dialog pattern in the same product for no behavioral gain).

### 7. Filter state and list preview

Store `noteTagFilter` on `TaskPageState` and read/write it with `usePageField`, mirroring `infoDraft`. The tag bar renders when at least one tag exists or a filter is active; keeping All available prevents a filter from trapping the section after its last tag disappears. `filterNotes` and `uniqueTags` normalize stored tags before comparing them, so legacy values filter consistently without a rewrite. Saving a note clears the active filter so the saved note is visible. The list preview uses a 250px maximum height with the existing Markdown renderer and a soft bottom fade.

- Why: per-task memory falls out of the existing page-state mechanism and needs no persistence layer.
- Trade-off: a filter that no longer matches any note stays active until cleared; the empty state explains it.
- Trade-off: links inside a clamped preview remain focusable, so keyboard focus can scroll the clamped area. The pencil action remains the canonical way to open the note; the preview is an excerpt, not the reading surface.

### 8. Tools stay thin

`create_note`, `list_notes`, and `update_note` keep their current names and descriptions, gain an optional `tags` array where relevant, and delegate validation and normalization to the command/domain layer. `list_notes` filters after normalizing the requested tags with OR matching. `update_note` passes an optional `content` through the same partial-update command. The tools do not implement tag rules themselves.

- Why: one behavior, one implementation; tool schemas remain a thin adapter.
- Alternative considered: filtering in SQL or storage (not applicable: notes are part of the Hub JSON aggregate).

### 9. Compatibility and rollback

No migration: `tags` is optional and already accepted by the persisted schema. Legacy notes may carry tags written before normalization; reads normalize them for comparison and display and the editor preserves them until the user changes tags. Rollback is a code revert; tagged notes still parse under the previous schema because the field already existed. Tag limits are enforced only on write, not by the schema.

## Risks / Trade-offs

- **Empty array clears diverges from Railyin** → Documented in the spec and in the `update_note` tool description; tests assert clear, preserve, and replace.
- **`note.save` becomes partial** → Creating always requires content; validation rejects an update with neither field. Domain tests cover create-without-content, update-tags-only, and update-content-only.
- **Extending `Modal` with header actions could disturb existing dialogs** → The slot is optional and additive; existing call sites are unchanged and the browser lane covers dialog appearance.
- **Client imports a domain module** → `src/domain/note.ts` stays dependency-free (no Node, no Zod) so it remains client-safe; a typecheck build catches accidental imports.
- **Clamped preview can hide focusable links** → The pencil action is always present; the trade-off is recorded so a future change can render links as plain text if it becomes a problem.
- **Deleting a note is not undoable** → Inline confirmation inside the dialog, busy lock during the operation, and no agent tool. The spec limits deletion to one note of the task.
- **Save race regressions** → The controller mirrors the existing fenced-completion and keyed-task lifetime; client tests re-run the stale-completion scenarios for notes.

## Migration Plan

1. Land the domain module, command, and tools first; existing clients keep sending content, so no state change is required.
2. Ship the client overlay and filter; no persisted shape changes and no backfill.
3. Update the README and operations documentation in the same change.
4. Rollback is a revert of the change; persisted notes remain valid because tags stay optional and unknown fields are not introduced.
