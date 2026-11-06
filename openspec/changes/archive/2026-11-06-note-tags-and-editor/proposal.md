# Proposal

## Why

Shared task notes already carry an optional `tags` field in the domain type, persisted schema, command, and note tools, but the behavior behind it is incomplete: writes only trim and deduplicate, the Notes tab renders tags as plain text, users cannot author or filter tags, and the note list and editor share one cramped inline surface. The original Railyin notes experience classifies and filters notes by tags and edits them in a focused overlay, which is what this project should offer.

## What Changes

- Normalize note tags on write: trim, lowercase, truncate to 15 characters, keep at most 4 per note, deduplicate, and discard empty values.
- Allow both users and agents to author tags: the drawer edits tags, and `create_note`/`update_note` keep accepting them.
- Keep a list `tags` update as an explicit clear (`tags: []` removes all tags) while an omitted `tags` field preserves existing tags.
- Replace the inline note editor with an overlay: a wide modal containing the Markdown editor, a chip-based tag input with suggestions from tags already used by the task, `Edit`/`Preview` tabs, and a note delete action.
- Show notes as cards with tag chips and a Markdown preview limited to 250px; open a note through an explicit pencil icon button.
- Add a tag bar above the note list (`All` plus unique tags in alphabetical order) that filters the list client-side, one tag at a time, with the selection remembered per task for the plugin session.
- Let `list_notes` filter by an optional tag list using OR matching, and let `update_note` update tags without rewriting the Markdown content.
- Add a UI-only note delete operation (`note.delete` command); the agent tool surface does not gain a `delete_note` tool.
- Compare and display legacy stored tag values through the same normalization without rewriting them.
- Extract tag normalization and the note write rule into a pure shared domain module so the Hub operations and the legacy board store enforce the same rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-notes`: adds the tag model and normalization rules, tag authoring in the Notes UI, the tag filter bar, the note editor overlay, note deletion, and the related drawer interaction requirements.
- `product-tools`: extends the note tool surface with tag filtering on `list_notes` and tag-only updates on `update_note`.

## Impact

- Domain and host: `src/domain/hub-operations.ts`, `src/domain/store.ts`, a new `src/domain/note.ts`, `src/host/app.ts`, `src/host/tools.ts`, `src/shared/types.ts`, `src/remote.ts`.
- Client: `src/client/forms.tsx` loses the inline note editor; new `src/client/notes/` modules, `src/client/page-state.ts`, `src/client/icons.tsx`, and `src/client/styles.ts`.
- Persisted state stays compatible: tags remain optional in the persisted note schema, and no backfill is performed. Notes written before this change may carry tags that were only trimmed and deduplicated; reads normalize those values for comparison and display without rewriting the stored collection.
- Tests: domain and hub-operation coverage, note tool coverage, React client coverage for the list, filter, overlay, and tag input, plus the plugin-owned browser lane for appearance and interaction evidence.
- Documentation: the README notes section and `docs/operations.md` describe tags and the editor overlay instead of the current inline note text.
