# Spec Delta

## ADDED Requirements

### Requirement: Fork adoption into the task conversation

When a native DSH conversation fork is created or resumed, the plugin SHALL adopt it as another conversation of the task that retains its direct parent conversation when the fork records a direct parent session, does not record `origin: subagent`, is not already associated with a task, and its direct parent is a retained conversation of that task. The plugin SHALL NOT adopt a fork of a subagent descendant, a fork of a session that no task retains, or a session already associated with a task. Adoption SHALL be idempotent and SHALL NOT attach the same session to a task twice.

Adoption SHALL align the fork's effective directory with the task's effective directory before associating it. When that alignment fails, the plugin SHALL NOT associate the fork and SHALL report the failure. Adoption SHALL associate the fork through the same conversation-retention path as an explicit conversation creation, so the new conversation appears as an open conversation tab after the task's existing conversations and receives the task's normal conversation behavior. The plugin SHALL NOT select the adopted conversation automatically and SHALL NOT change the native DSH navigation that follows a fork.

When the task has a pending context operation at adoption time, the plugin SHALL retry adoption for a bounded interval and SHALL report the failure when the task remains unavailable. An adoption failure SHALL NOT fail, cancel, or roll back the native fork.

#### Scenario: Adopt a fork of a task conversation

- **WHEN** a user branches a retained conversation of a task
- **THEN** the fork is associated with that same task as a new conversation
- **AND** the task drawer shows it as an open conversation tab after the existing conversations

#### Scenario: Adopt a fork when its session is resumed

- **WHEN** a fork of a task conversation that is not yet associated with any task is resumed
- **THEN** the plugin adopts it into that task

#### Scenario: Do not adopt a fork of a subagent descendant

- **WHEN** a user branches a native subagent descendant of a task conversation
- **THEN** the fork remains foreign
- **AND** the task conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: Do not adopt a fork with no task-retained direct parent

- **WHEN** a fork's direct parent session is not a retained conversation of any task
- **THEN** the plugin does not associate the fork with a task

#### Scenario: Do not adopt the same session twice

- **WHEN** an adoption is announced again for a session already associated with a task
- **THEN** the plugin leaves the task conversation list unchanged

#### Scenario: Align the fork directory before associating it

- **WHEN** a fork of a task conversation has an effective directory that differs from the task's effective directory
- **THEN** the plugin moves the fork to the task's effective directory before associating it
- **AND** the adopted conversation can execute in the task directory

#### Scenario: A failed directory alignment leaves the fork foreign

- **WHEN** the plugin cannot move a fork to the task's effective directory
- **THEN** the plugin does not associate the fork with the task
- **AND** it reports the failure without canceling the native fork

#### Scenario: Retry while the task is busy

- **WHEN** a fork is created while the task has a pending context operation
- **THEN** the plugin retries adoption for a bounded interval
- **AND** it associates the fork if the task becomes available within that interval
- **AND** it reports the failure and leaves the fork foreign when the task remains unavailable

#### Scenario: Do not select the adopted conversation automatically

- **WHEN** a fork is adopted while the task drawer is open on another conversation
- **THEN** the adopted conversation is appended without changing the active conversation
- **AND** the native DSH navigation that followed the fork is unchanged

#### Scenario: Adopt a fork of a closed conversation as open

- **WHEN** a user branches a closed conversation of a task
- **THEN** the fork is adopted as an open conversation tab
- **AND** the original closed conversation remains closed

## MODIFIED Requirements

### Requirement: Native conversation lineage

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. A top-level conversation session SHALL include a conversation created for the task and a fork the task adopted. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations.

A subagent descendant MAY be retained transiently and displayed as an in-drawer peek. That transient reference SHALL NOT be recorded as a task session ID, tab, or closed-conversation entry, and SHALL be released when the peek ends. Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A fork the plugin has not adopted — including a fork of a subagent descendant and a fork of a session that no task retains — SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: An in-drawer peek does not persist the child

- **WHEN** the user peeks a native subagent descendant and then leaves the peek
- **THEN** the child's transient reference is released
- **AND** the task's conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: A direct or nested subagent descendant is owned

- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: An adopted fork is a top-level task conversation

- **WHEN** the plugin has adopted a fork of a task conversation
- **THEN** the fork is one of the task's retained top-level conversation sessions
- **AND** it is owned for lineage, task deletion, and shared-worktree protection

#### Scenario: A fork remains foreign

- **WHEN** a fork was created from a subagent descendant or from a session that no task retains
- **THEN** the plugin does not treat the fork as an owned descendant or conversation

#### Scenario: Archiving a parent gates its descendants

- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes
