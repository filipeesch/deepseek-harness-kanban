# Spec Delta

## MODIFIED Requirements

### Requirement: Native workspace binding for task conversations

A new task conversation SHALL join a native DSH workspace whose canonical path is the task's current effective directory, rather than being created with only a cwd. The plugin SHALL reuse an existing workspace for that path or create one. The base-project workspace SHALL be shared by tasks in that project; a worktree workspace SHALL belong to one task. The plugin SHALL NOT require the user to select a workspace for a task conversation. An existing conversation SHALL keep the workspace it joined at creation when the task's effective directory changes; a conversation added after the change SHALL join the workspace for the new effective directory. The base workspace title SHALL be the project name and the worktree workspace title SHALL be `project · branch`; an existing workspace SHALL preserve its title. If a required workspace cannot be created or resolved, the plugin SHALL fail the conversation creation with an actionable error and SHALL NOT fall back to a cwd-only session.

When the host exposes workspace visibility, the plugin SHALL register a task worktree workspace and a session-directory workspace hidden by default. The shared base-project workspace SHALL remain visible; when the resolved base-project workspace reports hidden, the plugin SHALL reveal it. A pre-existing worktree workspace adopted for the first time SHALL be marked hidden once, and the persisted task workspace binding SHALL be the decision record. A pre-existing session-directory workspace resolved by reconciliation or conversation creation SHALL be reused without changing its visibility. A workspace already recorded in a task worktree binding SHALL NOT be marked hidden again by reconciliation; the shared project workspace is kept visible as described above. A host that does not expose workspace visibility SHALL keep every workspace visible and SHALL NOT fail a conversation because it cannot hide one. A failed visibility write SHALL be reported and SHALL NOT block the conversation.

#### Scenario: Open a conversation for a task without a worktree

- **WHEN** a task uses its base project directory and its conversation is created
- **THEN** the conversation joins the workspace for that project path
- **AND** the user is not asked to select a workspace

#### Scenario: Open a conversation for a task with a worktree

- **WHEN** a task uses its worktree project directory and a new conversation is created
- **THEN** the conversation joins the workspace for that worktree path

#### Scenario: Add a conversation after a directory change

- **WHEN** an existing task conversation keeps its original workspace after the task moves to a worktree, and the user adds another conversation
- **THEN** the new conversation joins the workspace for the worktree path
- **AND** the existing conversation retains its original workspace grouping

#### Scenario: Reuse an existing workspace

- **WHEN** a workspace already exists at the canonical path required for a conversation
- **THEN** the plugin reuses it without renaming it

#### Scenario: Fail without a cwd-only fallback

- **WHEN** the required workspace cannot be created or resolved
- **THEN** the conversation is not created as a cwd-only session and the plugin reports the failure

#### Scenario: Register a new worktree workspace hidden

- **WHEN** the host exposes workspace visibility and a task conversation creates a worktree workspace
- **THEN** the workspace is registered hidden

#### Scenario: Keep the shared project workspace visible

- **WHEN** a task conversation joins the shared base-project workspace
- **THEN** that workspace remains visible
- **AND** a hidden base-project workspace is revealed when the host exposes workspace visibility

#### Scenario: Hide an adopted worktree workspace once

- **WHEN** a pre-existing visible worktree workspace is adopted for a task's first conversation and the host exposes workspace visibility
- **THEN** the plugin marks that workspace hidden once and records the task workspace binding
- **AND** a later reconcile or a reader reveal does not mark it hidden again

#### Scenario: Register a new session-directory workspace hidden

- **WHEN** the host exposes workspace visibility and the plugin creates a workspace for a session directory other than the base project path
- **THEN** the workspace is registered hidden

#### Scenario: Reuse an existing session-directory workspace without hiding it

- **WHEN** a workspace already exists for a session directory other than the base project path
- **THEN** the plugin reuses it without changing its visibility

#### Scenario: Keep workspaces visible on a host without visibility support

- **WHEN** the host does not expose workspace visibility
- **THEN** the conversation is created and its workspace remains visible
- **AND** no visibility failure is reported

#### Scenario: Report a visibility failure without blocking the conversation

- **WHEN** marking a task workspace hidden fails
- **THEN** the conversation is still created, the workspace remains visible, and the failure is reported

### Requirement: Workspace ownership and cleanup

The plugin SHALL record which native workspaces it created and SHALL treat any pre-existing workspace as not owned. When a task is deleted, the plugin SHALL delete the registration of an owned worktree workspace when no other task or session uses it. It SHALL NOT delete the shared base-project workspace or any workspace it did not create. Deleting a workspace registration SHALL retain its directory and native conversation logs. The plugin SHALL NOT change the visibility of a workspace that it neither creates nor adopts. When the host exposes workspace visibility, the plugin SHALL register an owned task worktree or session-directory workspace hidden, and SHALL hide a pre-existing worktree workspace once when it first adopts it. The shared base-project workspace SHALL remain visible. The plugin SHALL NOT hide workspaces retroactively and SHALL NOT re-hide a workspace after a reader reveals hidden workspaces. A failed visibility change SHALL be reported and SHALL NOT be represented as a successful hide; it SHALL NOT block a conversation. On a host without workspace visibility, the plugin SHALL keep every workspace visible and SHALL still create the conversation. A failed cleanup SHALL be reported and SHALL NOT be represented as a successful removal.

#### Scenario: Remove an owned worktree workspace

- **WHEN** a task with a Kanban-created worktree workspace is deleted and no other task or session uses that workspace
- **THEN** the workspace registration is removed
- **AND** the directory and native conversation logs are retained

#### Scenario: Keep a shared base workspace

- **WHEN** a task using the shared project workspace is deleted while other tasks or a user-created workspace still use that path
- **THEN** the workspace registration is retained

#### Scenario: Report a cleanup failure

- **WHEN** deleting an owned worktree workspace registration fails
- **THEN** the failure is reported and the plugin does not claim that the registration was removed

#### Scenario: Hide an adopted worktree workspace once

- **WHEN** a pre-existing visible worktree workspace is adopted for the first time on a host that exposes workspace visibility
- **THEN** the workspace is marked hidden once and the persisted binding records that decision
- **AND** a later restart or a reader reveal does not mark it hidden again

#### Scenario: Do not hide the shared project workspace

- **WHEN** a task uses the shared base-project workspace
- **THEN** the workspace is visible
- **AND** a hidden shared project workspace is revealed when the host exposes workspace visibility

#### Scenario: Do not hide an unmanaged workspace

- **WHEN** a workspace exists that the plugin neither creates nor adopts
- **THEN** its visibility is unchanged

#### Scenario: Do not hide workspaces retroactively

- **WHEN** the plugin starts against workspaces created or adopted before this behavior
- **THEN** their visibility is unchanged

#### Scenario: Do not re-hide after a reader reveals hidden workspaces

- **WHEN** a hidden task workspace is revealed by the reader and the host later reconciles or restarts
- **THEN** the plugin does not mark that workspace hidden again

#### Scenario: Keep workspaces visible without host visibility support

- **WHEN** the host does not expose workspace visibility
- **THEN** every workspace remains visible and the plugin still creates task conversations
