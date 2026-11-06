# Spec Delta

## ADDED Requirements

### Requirement: Notes are classified by tags
A shared task note SHALL accept an optional collection of tags that classifies it within the task. A note SHALL remain valid with no tags, and a note written before tags existed SHALL continue to load and render without tags. A note whose stored tags predate normalization SHALL be compared and displayed by their normalized values without rewriting the stored collection. Tags SHALL belong to the note and SHALL be visible to every conversation of that task. The Notes user interface SHALL refer to this classification as Tags.

#### Scenario: Note created with tags
- **WHEN** a note is created with the tags `design` and `architecture`
- **THEN** the stored note includes both tags in that order

#### Scenario: Note created without tags
- **WHEN** a note is created without any tag
- **THEN** the note is stored and listed without a tag collection

#### Scenario: Existing note without tags remains valid
- **WHEN** a note persisted before tags existed is read through the Notes section or a note tool
- **THEN** the note content is returned and no tag chips are presented for it

#### Scenario: Legacy stored tags are normalized for comparison
- **WHEN** a note stores tags written before normalization and a reader filters or lists by a normalized tag value
- **THEN** the note matches and its tags are presented by their normalized values
- **AND** the stored tag collection is not rewritten

#### Scenario: Tags are shared across the task's conversations
- **WHEN** one conversation of a task creates a note with tags and another conversation of the same task lists its notes
- **THEN** the tags are included in the listed note

### Requirement: Tags are normalized before storage
Every tag SHALL be normalized before it is stored: surrounding whitespace SHALL be trimmed, the value SHALL be converted to lowercase, and it SHALL be truncated to at most 15 characters. Empty values after normalization SHALL be discarded. Duplicate values SHALL be removed while preserving first-occurrence order. A note SHALL keep at most 4 tags after normalization. An empty normalized result SHALL be stored as no tags.

#### Scenario: Tags are trimmed and lowercased
- **WHEN** a note is saved with the tags ` Design ` and `ARCHITECTURE`
- **THEN** the stored tags are `design` and `architecture`

#### Scenario: Long tags are truncated
- **WHEN** a note is saved with the tag `very-long-tag-name-here`
- **THEN** the stored tag is `very-long-tag-n`

#### Scenario: Empty tags are discarded
- **WHEN** a note is saved with the tags `design` and two spaces
- **THEN** only `design` is stored

#### Scenario: Duplicate tags are removed
- **WHEN** a note is saved with the tags `design`, ` Design `, and `architecture`
- **THEN** the stored tags are `design` and `architecture`

#### Scenario: Excess tags are limited
- **WHEN** a note is saved with the tags `a`, `b`, `c`, `d`, and `e`
- **THEN** the stored tags are `a`, `b`, `c`, and `d`

#### Scenario: All-empty tags produce no tags
- **WHEN** a note is saved with tags that are all empty after normalization
- **THEN** the note is stored without a tag collection

### Requirement: Tag updates preserve or replace explicitly
Saving a note with an omitted tag field SHALL preserve the note's existing tags. Saving a note with a tag collection SHALL replace the existing tags with the normalized collection, and an explicitly empty collection SHALL remove all tags from the note. A tag value that is not text SHALL be rejected without modifying the note.

#### Scenario: Omitting tags preserves them
- **WHEN** a note with the tags `existing` is updated without a tag field
- **THEN** the note keeps `existing`

#### Scenario: Providing tags replaces them
- **WHEN** a note with the tags `old` is updated with the tags ` New `
- **THEN** the note has the single tag `new`

#### Scenario: An empty collection clears tags
- **WHEN** a note with tags is updated with an explicitly empty tag collection
- **THEN** the note has no tags

#### Scenario: Invalid tag values are rejected
- **WHEN** a note is saved with a tag value that is not text
- **THEN** the save is rejected and the note is unchanged

### Requirement: Tag authoring in the note editor
The note editor SHALL provide a tag input that turns entered text into removable chips, adding a chip when the user presses Enter or types a comma. The input SHALL suggest tags already used by the task, and SHALL allow a new tag value. Duplicate existing tags SHALL NOT produce another chip. When the note holds 4 tags, the input SHALL be disabled and the editor SHALL explain the limit. A chip SHALL present the normalized value that will be stored.

#### Scenario: Add a chip with Enter
- **WHEN** the user types `Design` in the tag input and presses Enter
- **THEN** a chip labelled `design` is added to the note draft

#### Scenario: Add a chip with a comma
- **WHEN** the user types `todo,` in the tag input
- **THEN** a chip labelled `todo` is added and the input is cleared

#### Scenario: Remove a chip
- **WHEN** the user removes the `design` chip
- **THEN** the note draft no longer includes `design`

#### Scenario: Duplicate chips are not added
- **WHEN** the note already has the tag `design` and the user enters `Design`
- **THEN** no second chip is added

#### Scenario: Limit reached
- **WHEN** the note holds 4 tags
- **THEN** the tag input is disabled and the editor explains that a note keeps at most 4 tags

#### Scenario: Suggest existing task tags
- **WHEN** the user focuses the tag input for a task whose notes use `design` and `todo`
- **THEN** both values are offered as suggestions

### Requirement: Note editor overlay
Creating and editing a note SHALL happen in a dedicated overlay rather than inline in the Notes list. The overlay SHALL be a wide modal that presents a Markdown textarea, the tag input, a Preview tab that renders the current Markdown, and Save and Cancel actions. Save SHALL be unavailable while the Markdown content is blank. Saving SHALL close the overlay and the Notes list SHALL present the saved note without an additional success message. Closing the overlay with unsaved changes, including through Cancel, the close action, Escape, or the backdrop, SHALL discard the draft without a confirmation prompt. A failed save SHALL keep the overlay open with an error and preserve the draft.

#### Scenario: Create a note in the overlay
- **WHEN** the user activates New note, enters Markdown and tags, and saves
- **THEN** the overlay closes and the new note appears in the Notes list with its content and tags

#### Scenario: Edit a note in the overlay
- **WHEN** the user opens an existing note, changes its Markdown and tags, and saves
- **THEN** the overlay closes and the Notes list presents the updated note

#### Scenario: Preview the Markdown
- **WHEN** the user selects the Preview tab while editing
- **THEN** the current Markdown draft is rendered and the stored note is unchanged

#### Scenario: Blank content cannot be saved
- **WHEN** the Markdown content is blank or whitespace only
- **THEN** Save is unavailable

#### Scenario: Close discards unsaved changes
- **WHEN** the user closes the overlay with unrendered edits
- **THEN** the draft is discarded without a confirmation prompt and the stored note is unchanged

#### Scenario: Failed save keeps the draft
- **WHEN** saving the note fails
- **THEN** the overlay stays open with the error and the entered content and tags remain

### Requirement: Tag filtering in the Notes section
The Notes section SHALL present a tag bar above the note list when at least one tag exists among the task's notes, and SHALL keep the bar present while a filter is active even if its tag no longer exists so the filter can be cleared. The bar SHALL contain an All action and each unique tag in alphabetical order. Selecting a tag SHALL filter the list client-side to the notes with that tag, and selecting the active tag again or selecting All SHALL clear the filter. The bar SHALL expose each action to assistive technology with its selected state. When the filter matches no note, the section SHALL state that no notes match the selected tag. The active filter SHALL be remembered per task for the plugin session and SHALL be cleared when a note is saved.

#### Scenario: Filter by a tag
- **WHEN** the task has notes tagged `design` and `architecture` and the user selects `design`
- **THEN** only the notes with the `design` tag are listed

#### Scenario: Clear the filter with the active tag
- **WHEN** the user selects the active `design` tag again
- **THEN** every note of the task is listed

#### Scenario: Clear the filter with All
- **WHEN** a tag filter is active and the user selects All
- **THEN** every note of the task is listed

#### Scenario: Tags are ordered and unique
- **WHEN** the task's notes carry the tags `zoo`, `apple`, and `design`, and `design` appears on two notes
- **THEN** the bar presents All, `apple`, `design`, and `zoo` in that order

#### Scenario: Empty filter result
- **WHEN** the active tag no longer matches any note
- **THEN** the section states that no notes match the selected tag and keeps the filter active

#### Scenario: Clear a filter whose tag disappeared
- **WHEN** the active tag is no longer present on any note
- **THEN** the bar remains present with All
- **AND** selecting All lists every note of the task

#### Scenario: Filter survives navigation within the session
- **WHEN** the user selects a tag filter, switches to another drawer section, and returns to Notes for the same task
- **THEN** the same tag filter is active

#### Scenario: Saving a note clears the filter
- **WHEN** a tag filter is active and the user saves a note
- **THEN** the filter is cleared and the saved note is visible in the list

### Requirement: Delete a shared note from the drawer
The note overlay SHALL offer a delete action for an existing note. The action SHALL require an inline confirmation in the overlay before the note is removed, and SHALL be unavailable while a note operation is in progress. A confirmed deletion SHALL remove only that note from the task, close the overlay, and return the Notes list to the remaining notes. Note deletion SHALL be a user-interface operation only; the agent tool surface SHALL NOT add a note deletion tool.

#### Scenario: Confirmed delete removes the note
- **WHEN** the user opens a note, activates delete, and confirms
- **THEN** the note is removed and the Notes list no longer presents it

#### Scenario: Cancelled delete keeps the note
- **WHEN** the user activates delete and cancels the inline confirmation
- **THEN** the note remains and the overlay stays open on the note

#### Scenario: Deleting affects only the selected note
- **WHEN** a task has several notes and the user deletes one
- **THEN** the other notes of the task remain unchanged

#### Scenario: No agent delete tool
- **WHEN** an agent receives the plugin's tools
- **THEN** no tool for deleting a note is exposed

## MODIFIED Requirements

### Requirement: Markdown notes in the task drawer
The task drawer SHALL provide a Notes section that lists the task's shared notes and creates, views, and edits them through a dedicated overlay. Each listed note SHALL present its content as rendered Markdown limited to a preview height of 250 pixels, its tags as chips when present, and an explicit pencil-icon edit action with an accessible name. The Notes list SHALL NOT contain the Markdown editor or the tag input.

#### Scenario: List notes with previews and tags
- **WHEN** the task has notes with tags and notes without tags
- **THEN** each note is listed with a rendered Markdown preview of at most 250 pixels, tag chips are shown for the tagged notes only, and every note has a pencil-icon edit action

#### Scenario: Create a Markdown note in the drawer
- **WHEN** a user creates and saves a note containing Markdown through the New note action
- **THEN** that note is stored for the task and its updated Markdown preview and tags appear in the list

#### Scenario: Edit a shared note
- **WHEN** a user edits and saves an existing note through the pencil action
- **THEN** subsequent reads through the task's Notes section or note tools return the updated content and tags for that same note

#### Scenario: The list has no inline editor
- **WHEN** the Notes section renders with no overlay open
- **THEN** the list does not present a Markdown textarea or a tag input
