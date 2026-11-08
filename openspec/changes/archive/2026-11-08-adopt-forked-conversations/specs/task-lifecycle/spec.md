# Spec Delta

## MODIFIED Requirements

### Requirement: Successful task deletion archives conversations and keeps its branch

A successfully completed task deletion SHALL remove the task card and its shared notes and archive every retained top-level native DSH conversation associated with the task, including a fork the task adopted, without erasing their histories. Native subagent descendants of those conversations SHALL belong to the task's conversation lineage for ownership decisions but SHALL NOT be moved or archived individually; archiving a parent conversation SHALL gate descendant execution according to native behavior. Before removing an associated worktree, the plugin SHALL return every retained task conversation to the base project path through the all-idle directory coordinator. If that return fails, the plugin SHALL retain the worktree and recovery information rather than report deletion success. Successful deletion SHALL remove an eligible associated worktree, including an externally attached checkout, preserve the task's associated Git branch, and SHALL NOT delete native conversation log files directly.

#### Scenario: Permanently delete an idle task with a clean unshared worktree

- **WHEN** the task's conversations are idle, its worktree is not in use by another task or a foreign native session, its worktree is clean, and the user confirms permanent deletion
- **THEN** successful deletion removes the card, notes, and worktree, archives the associated native conversations while retaining their histories, and leaves its Git branch intact

#### Scenario: Permanently delete an idle task without a worktree

- **WHEN** an idle task has no associated worktree and the user confirms its permanent deletion
- **THEN** successful deletion removes the card and notes and archives the associated conversations with their histories retained, without removing the base project directory

#### Scenario: Delete a task with an adopted fork

- **WHEN** an idle task has a fork it adopted and the user confirms permanent deletion
- **THEN** the deletion confirmation counts that fork with the task's conversations
- **AND** successful deletion archives the fork with the task's other conversations while retaining its history

#### Scenario: Delete a task whose subagent child uses the worktree

- **WHEN** an idle task's conversation has a direct or nested native subagent descendant whose effective directory is inside the task's worktree
- **THEN** the subagent descendant does not block deletion
- **AND** the parent conversation is archived while the descendant is not moved or archived individually
- **AND** native behavior remains responsible for gating or recovering the descendant after the worktree is removed

#### Scenario: Delete a task with an externally attached worktree

- **WHEN** an idle task has a clean, unshared externally attached worktree and the user confirms permanent deletion
- **THEN** deletion removes that checkout, keeps the associated branch, and retains the native conversation histories

#### Scenario: Delete a task whose worktree directory is already absent

- **WHEN** the recorded worktree directory no longer exists and the user confirms permanent deletion
- **THEN** the sharing preflight does not fail because the directory is absent
- **AND** deletion completes the remaining task cleanup without substituting the base project or Git root

#### Scenario: Resume an archived conversation after task deletion

- **WHEN** task deletion has removed its worktree and a user later unarchives one of its retained native conversations whose base project path is /repos/platform/services/api
- **THEN** the conversation retains its history and uses /repos/platform/services/api rather than the deleted worktree or /repos/platform

#### Scenario: Retain the worktree when returning a conversation fails

- **WHEN** a retained task conversation cannot be returned to its base project path during task deletion
- **THEN** the worktree is not removed, recovery information remains available, and the plugin does not report successful deletion
