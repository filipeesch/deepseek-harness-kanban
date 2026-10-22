# Task Notes Specification

## Purpose

Keep Markdown notes as shared task context that users and agents can maintain across all of a task's native DSH conversations and directory changes.

## Requirements

### Requirement: Notes belong to the task
A note SHALL belong to its task rather than to the individual conversation that created or edited it. Every conversation tab associated with that task SHALL access the same task note collection, and another task SHALL retain its own separate collection.

#### Scenario: Read a note from another tab of the same task
- **WHEN** a note is created for a task from one conversation and another conversation of the same task lists its notes
- **THEN** the new note is included in that shared task collection

#### Scenario: Keep different tasks' notes separate
- **WHEN** two tasks each have their own note collection and a conversation lists notes for one identified task
- **THEN** the result contains that task's notes rather than notes from the other task

### Requirement: Markdown notes in the task drawer
The task drawer SHALL provide a Notes section for creating, viewing, and editing shared task notes. The section SHALL accept Markdown content and provide a rendered Markdown view of the note content.

#### Scenario: Create a Markdown note in the drawer
- **WHEN** a user creates and saves a note containing Markdown through a task's Notes section
- **THEN** that note is stored for the task and its Markdown content can be viewed in rendered form

#### Scenario: Edit a shared note
- **WHEN** a user edits and saves an existing note through the Notes section
- **THEN** subsequent reads through the task's Notes section or note tools return the updated content for that same note

### Requirement: Shared note tools
The plugin SHALL expose create_note, list_notes, and update_note tools for the identified target task. Those tools SHALL operate on the same task notes shown by the Notes section, not on a separate per-conversation collection. A note tool invocation without a resolvable task target SHALL report that missing context rather than select an unrelated task.

#### Scenario: Create and update a note through tools
- **WHEN** an agent uses create_note for an identified task and later uses update_note on the created note
- **THEN** list_notes and the task's Notes section expose the same note with its updated Markdown content

#### Scenario: Reject a note action with no task context
- **WHEN** an agent invokes a task note tool without a task target that the plugin can resolve
- **THEN** the tool reports the missing task context without reading or modifying another task's notes

### Requirement: Notes remain independent of conversation and directory changes
Switching conversation tabs or successfully changing the task's effective agent directory SHALL NOT replace, duplicate, or discard its shared notes. This capability SHALL NOT add a separate plugin TODO checklist or decision ledger; existing native DSH capabilities SHALL remain unaffected.

#### Scenario: Keep notes when switching into a worktree
- **WHEN** a task with existing shared notes successfully switches its conversation directories from its base project path to a worktree project directory
- **THEN** its Notes section and note tools continue to use the same task note collection

#### Scenario: Keep notes without introducing another tracking system
- **WHEN** the plugin provides its task Notes section and note tools
- **THEN** it does not add a separate task TODO checklist or decision-record ledger as part of that capability
