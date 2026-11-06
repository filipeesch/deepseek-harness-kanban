# Spec Delta

## ADDED Requirements

### Requirement: Note tools support tags
The plugin's note tools SHALL operate on the same shared task note collection as the Notes section and SHALL support tags with the same normalization rules. `create_note` and `update_note` SHALL accept an optional tag collection, and every returned note SHALL include its tags. `list_notes` SHALL accept an optional tag collection and SHALL return the notes that have any of those tags, comparing both stored and requested values after normalization. An empty tag collection SHALL apply no filter. `update_note` SHALL allow changing only tags, changing only content, or changing both, and SHALL require at least one of content or an explicit tag collection. An omitted tag collection SHALL preserve existing tags, and an explicitly empty collection SHALL clear them. The note tool surface SHALL NOT add a tool that deletes a note.

#### Scenario: Create a note with tags
- **WHEN** an agent creates a note with the tags ` Design ` and `TODO`
- **THEN** the note is stored with the tags `design` and `todo` and the result includes them

#### Scenario: List notes filtered by one tag
- **WHEN** an agent lists the notes of a task with the tag `design` and notes exist with `design` and `architecture`
- **THEN** only the notes tagged `design` are returned

#### Scenario: List notes filtered by several tags
- **WHEN** an agent lists notes with the tags `design` and `architecture`
- **THEN** notes tagged with either value are returned

#### Scenario: List notes without a filter
- **WHEN** an agent lists notes without a tag collection
- **THEN** every note of the task is returned regardless of tags

#### Scenario: Empty tag collection applies no filter
- **WHEN** an agent lists notes with an explicitly empty tag collection
- **THEN** every note of the task is returned

#### Scenario: Tag filtering is normalized
- **WHEN** an agent lists notes with the tag `Design` and a note has the tag `design`
- **THEN** the note is returned

#### Scenario: Update only the tags
- **WHEN** an agent updates a note with a tag collection and no content
- **THEN** the note's tags are replaced and its Markdown content is unchanged

#### Scenario: Update only the content
- **WHEN** an agent updates a note with content and no tag collection
- **THEN** the content changes and the existing tags are preserved

#### Scenario: Empty tag collection clears tags
- **WHEN** an agent updates a note with an explicitly empty tag collection
- **THEN** the note has no tags and its content is unchanged

#### Scenario: Update without content or tags is rejected
- **WHEN** an agent updates a note without content and without a tag collection
- **THEN** the tool reports a validation error and the note is unchanged

#### Scenario: Note reads include tags
- **WHEN** an agent reads a note with tags
- **THEN** the returned note includes the tag collection

## MODIFIED Requirements

### Requirement: Restricted board tool surface
The plugin SHALL expose tools for discovering Hubs, boards, and projects, reading board and task information, creating tasks, editing task titles and descriptions, and creating, listing, and tag-aware updating of shared task notes. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, or sending messages to other cards. It SHALL NOT include Hub or board creation, rename, or deletion. It SHALL NOT introduce decision-ledger or task-TODO tools from Railyin.

#### Scenario: Discover available product operations
- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, and shared note creation, listing, and tag-aware updating are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub or board administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface
