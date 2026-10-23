# Spec Delta

## ADDED Requirements

### Requirement: Native conversation lineage

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations. Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A session forked from a task conversation or from a subagent descendant SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: A direct or nested subagent descendant is owned

- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: A fork remains foreign

- **WHEN** a session was forked from a task conversation but its header does not record `origin: subagent`
- **THEN** the plugin does not treat the fork as an owned descendant

#### Scenario: Archiving a parent gates its descendants

- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes

### Requirement: Visible operation status and recovery

The task drawer SHALL show the task's current context operation above its section tabs for every operation kind, including create, attach, return, remove, and delete. The status SHALL distinguish waiting, in progress, and failed states; SHALL state which steps completed and which remain; and SHALL offer Retry when the recorded operation can resume. It SHALL offer Return only when returning the task's conversations to the base project is permitted; it SHALL NOT offer Return once native conversation archiving has begun. The status SHALL remain visible from the Conversations, Info, Git, and Notes sections and SHALL use user-facing language rather than a raw error code as its primary explanation. A failed destructive confirmation SHALL also present its failure and recovery in the confirmation surface.

#### Scenario: A failed deletion is visible from every section

- **WHEN** a deletion fails before moving any conversation, removing the worktree, or archiving a conversation
- **THEN** opening the task drawer shows the failed operation above the tabs from any section
- **AND** the status states that no chats were moved and no worktree or archive change completed
- **AND** Retry and Return are available when their preconditions permit

#### Scenario: Waiting for idle is visible

- **WHEN** a context operation is waiting for every task conversation to become idle
- **THEN** the status explains that it is waiting and remains visible outside Conversations and Git
- **AND** it does not present the operation as failed

#### Scenario: Return is unavailable after archiving starts

- **WHEN** a failed deletion has already archived at least one native conversation
- **THEN** the status does not offer Return as a recovery action
- **AND** it directs the user to retry the recorded deletion instead

#### Scenario: Operation copy follows the operation kind

- **WHEN** the current operation is a worktree creation, attachment, return, removal, or task deletion
- **THEN** the status uses copy and recovery actions appropriate to that kind and phase
- **AND** it does not describe a deletion as a "worktree operation" or report a "conversations switched" count as the primary explanation
