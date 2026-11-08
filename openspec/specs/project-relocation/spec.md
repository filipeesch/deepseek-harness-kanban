# Project Relocation Specification

## Purpose

Repair a project whose directory moved by relocating the project, its tasks, their conversations, and their worktree bindings to the new location as one durable, resumable operation.

## Requirements

### Requirement: Relocation request and validation
A project whose directory moved SHALL be repairable by an explicit relocation request that names the project, its canonical new project path, its Git root when the project is Git-backed, and its default branch when supplied. The request SHALL also carry the project's name and MAY change it.

The plugin SHALL accept a relocation that changes the project path, the Git root, or both, and SHALL apply the submitted values as one change. A relocation SHALL be rejected with an actionable problem when the new project path is not an existing directory, when a Git-backed project would no longer be Git-backed, when the new Git root is not the top-level directory of a repository containing the project path, or when a folder project would become Git-backed. Converting between a Git-backed and a folder project SHALL remain a registration change and SHALL NOT be performed by a relocation.

The plugin SHALL reject a relocation while any task of the project has an unresolved context operation, a pending confirmed transition, or an unsendable pending delivery. A repeated request that names the same recorded target SHALL join the pending relocation instead of recording another one; a request that names a different target SHALL be rejected until the recorded relocation is resolved.

#### Scenario: Relocate a Git-backed project whose directory moved
- **WHEN** the user requests relocation of a Git-backed project to a new existing project path inside a valid Git root
- **THEN** the request is accepted and records a relocation for that project
- **AND** the project, its tasks, and their conversations are not changed before the migration step runs

#### Scenario: Relocate when only the repository root moved
- **WHEN** the project path is unchanged and the Git root changes to the top-level directory of the repository that contains the project path
- **THEN** the relocation is accepted

#### Scenario: Reject a Git association conversion
- **WHEN** a relocation would leave a Git-backed project without a Git root, or give a folder project a Git root
- **THEN** the relocation is rejected with an actionable problem
- **AND** the stored project is unchanged

#### Scenario: Reject a relocation during an unresolved task operation
- **WHEN** a task of the project has an unresolved context operation or a pending confirmed transition
- **THEN** the relocation is rejected with an actionable problem
- **AND** no relocation is recorded

#### Scenario: Reject a request that changes no location
- **WHEN** a relocation request keeps both the project path and the Git root unchanged
- **THEN** the relocation is rejected with an actionable problem that points to the project save
- **AND** no relocation is recorded

#### Scenario: Join a repeated relocation
- **WHEN** the user requests the same relocation again while it is pending
- **THEN** the pending relocation is retained and the request does not record a second one

### Requirement: Durable relocation journal and background execution
A requested relocation SHALL be durably recorded on the project before any slow work begins, and the command SHALL return without holding the interactive command lane. The recorded operation SHALL identify the confirmed target location and SHALL report the step being performed, whether it is waiting for conversations, and the problem of a failed step.

Relocations SHALL execute in the same per-repository lane as destructive task work, so a relocation and a destructive operation for one repository never run concurrently, while projects in different repositories MAY progress independently. The recorded operation SHALL be resumable: after a plugin restart it SHALL continue, and a retry SHALL NOT repeat a completed step.

#### Scenario: Command returns before migration
- **WHEN** a valid relocation is accepted
- **THEN** the host records the operation and returns the command response
- **AND** the project path, task directories, conversation directories, workspace binding, and worktree bindings are not changed by the command itself

#### Scenario: Restart resumes a recorded relocation
- **WHEN** the plugin starts and a project has a recorded unfinished relocation
- **THEN** the relocation continues in its repository lane from its recorded step

#### Scenario: Report the failing step
- **WHEN** a relocation step fails
- **THEN** the recorded operation names the step that failed and presents the problem
- **AND** the relocation remains available for retry

### Requirement: Relocation waits for idle conversations
Migration SHALL NOT begin while any conversation of any task in the project is executing or owns background work, or while any task of the project has an unresolved context operation or a pending transition. The relocation SHALL record that it is waiting and SHALL continue when that work settles, without stopping a conversation. While the relocation is waiting, no project path, task effective directory, conversation directory, workspace binding, or worktree binding SHALL change.

#### Scenario: A busy conversation defers the relocation
- **WHEN** a conversation of a task in the project is executing or owns background work
- **THEN** the relocation records that it is waiting and no migration step runs

#### Scenario: Waiting resumes after the conversations settle
- **WHEN** every conversation of every task in the project becomes idle
- **THEN** the relocation continues without a new user request and without stopping a conversation

### Requirement: Project and task directory migration
On its migration step the plugin SHALL apply the confirmed project path, Git root, and default branch to the project record. Every task of the project whose effective directory equals the previous project path SHALL move to the new project path. A task with an associated worktree SHALL keep its worktree path and SHALL use the equivalent project subdirectory resolved from the new Git root and project path. A task whose effective directory is neither the previous project path nor derived from its worktree SHALL keep its effective directory.

The plugin SHALL NOT move, recreate, or delete the previous project directory, and SHALL NOT change a task's worktree binding to a different checkout.

#### Scenario: Base tasks follow the new project path
- **WHEN** a task of the project has no worktree and its effective directory is the previous project path
- **THEN** its effective directory becomes the new project path after the migration step

#### Scenario: A worktree task keeps its checkout
- **WHEN** a task of the project has an associated worktree
- **THEN** its worktree path is unchanged
- **AND** its effective directory uses the equivalent project subdirectory inside that worktree

#### Scenario: A monorepo subdirectory stays equivalent
- **WHEN** the previous project path was a subdirectory of its Git root and the new project path is a subdirectory of the new Git root
- **THEN** the relative project subdirectory inside each worktree is resolved from the new Git root

### Requirement: Conversation directory migration
Every conversation of every task in the project SHALL move to its task's new effective directory and SHALL retain its native session identity and history. A conversation that is not idle at that step SHALL return the relocation to waiting rather than fail it. A conversation whose directory cannot be changed SHALL fail the relocation at that step with an actionable problem, and the steps already applied SHALL remain applied.

#### Scenario: Migrate idle conversations
- **WHEN** every conversation is idle and its task has a new effective directory
- **THEN** each conversation uses the new directory with its identity and history retained

#### Scenario: A conversation directory change fails
- **WHEN** a conversation directory cannot be changed during the migration step
- **THEN** the relocation is recorded as failed at that step with the problem
- **AND** the project and task paths already applied remain applied
- **AND** retrying resumes from that step

### Requirement: Workspace binding after relocation
The plugin SHALL bind the project to a native workspace whose canonical path is the new project path, reusing an existing workspace for that path or creating one, and SHALL keep the shared project workspace visible when the host exposes workspace visibility. The plugin SHALL NOT rename or delete the previous project workspace registration. A conversation SHALL keep the native workspace it joined at creation; a conversation created after the relocation SHALL join the workspace for the new project path.

#### Scenario: Bind the new project workspace
- **WHEN** the relocation reaches its workspace step
- **THEN** the project is bound to the workspace for the new project path
- **AND** the previous project workspace registration remains unchanged

#### Scenario: Keep an existing conversation workspace
- **WHEN** a conversation had joined the previous project workspace and its directory is migrated
- **THEN** it keeps that workspace grouping while using the new effective directory

#### Scenario: A new conversation joins the new workspace
- **WHEN** the user creates a conversation for a task of the relocated project
- **THEN** the conversation joins the workspace for the new project path

### Requirement: Worktree binding revalidation
During a relocation the plugin SHALL attempt to repair each associated worktree's administrative link to the repository and SHALL revalidate every associated worktree binding against the new Git root. A repairable binding SHALL be revalidated and SHALL keep its worktree path and branch. A binding whose checkout or repository link cannot be verified SHALL record an error that explains the failed revalidation, SHALL keep the task, its worktree binding, and its conversations, and SHALL NOT fail the relocation. The plugin SHALL NOT detach, move, or remove a worktree because of a relocation, and SHALL NOT report an unverifiable checkout as repaired.

#### Scenario: Repair a linked worktree after the repository moved
- **WHEN** a repository moved and an associated worktree's administrative link still points at the previous repository location
- **THEN** the plugin repairs the link when the checkout exists
- **AND** the binding is revalidated against the new Git root and keeps its path and branch

#### Scenario: An unverifiable binding records an error
- **WHEN** an associated worktree's checkout no longer exists or its link cannot be repaired
- **THEN** the binding records an error explaining that it could not be revalidated
- **AND** the relocation completes without removing or detaching the checkout

#### Scenario: A task without a worktree skips the worktree step
- **WHEN** no task of the project has an associated worktree
- **THEN** the relocation performs no worktree repair or revalidation

### Requirement: Blocking while a relocation is pending
While a relocation is recorded and unresolved, the plugin SHALL reject task execution, conversation creation, and worktree creation, attachment, removal, and return for every task of the project. It SHALL reject a project save and a project deletion for that project. Editing task text, editing shared notes, and moving a task between stages SHALL remain available.

#### Scenario: Reject execution and conversation creation
- **WHEN** the user requests execution or a new conversation for a task of a project with an unresolved relocation
- **THEN** the request is rejected with an actionable problem
- **AND** no directory or conversation is changed

#### Scenario: Reject worktree operations
- **WHEN** the user requests worktree creation, attachment, removal, or return for a task of a project with an unresolved relocation
- **THEN** the request is rejected with an actionable problem

#### Scenario: Reject project save and deletion
- **WHEN** the user requests saving or deleting a project with an unresolved relocation
- **THEN** the request is rejected with an actionable problem

#### Scenario: Keep text, notes, and stage moves available
- **WHEN** a relocation is unresolved and the user edits a task's text, edits its notes, or moves it between stages
- **THEN** those actions remain available

### Requirement: Relocation recovery and cancellation
The relocation SHALL record that its first durable change was applied. Cancellation SHALL be available only before that record exists, and SHALL remove the recorded relocation while leaving the project, its tasks, and their conversations unchanged. Once that record exists, the relocation SHALL be forward-only: neither the user nor a retry SHALL return the project to its previous location. A failed relocation SHALL present its recorded problem and SHALL be retryable from the failed step, including by submitting the same target again. A completed relocation SHALL clear the recorded operation.

#### Scenario: Cancel before the first write
- **WHEN** the user cancels a relocation that is still waiting or in preflight
- **THEN** the recorded relocation is removed
- **AND** the project, its tasks, and their conversations are unchanged

#### Scenario: Cancellation is unavailable after migration starts
- **WHEN** a relocation has applied the project path or migrated a conversation
- **THEN** no cancel action is offered
- **AND** the recorded relocation remains available for retry or completion

#### Scenario: Retry resumes without duplicating a step
- **WHEN** the user retries a failed relocation
- **THEN** the relocation resumes from the failed step
- **AND** a step that already completed is not applied twice

#### Scenario: Successful relocation clears the journal
- **WHEN** every relocation step completes
- **THEN** the recorded operation is cleared and the project no longer reports a relocation in progress

### Requirement: Relocation state is published
The recorded relocation state, the step being performed, and the problem of a failed step SHALL be readable from the project in every host snapshot and SHALL update connected clients without a reload.

#### Scenario: Publish progress without a reload
- **WHEN** a relocation moves to waiting, to a migration step, or to failed
- **THEN** the connected board receives the updated project state
- **AND** no client reload is required

#### Scenario: Publish a failure
- **WHEN** a relocation fails
- **THEN** the recorded problem is published with the project state
- **AND** the plugin does not present the relocation as completed
