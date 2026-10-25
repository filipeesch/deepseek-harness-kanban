# Spec Delta

## MODIFIED Requirements

### Requirement: Retained project registry
Each Hub SHALL retain its own project registry that users can configure and select from when associating a project with a task. A project SHALL belong to exactly one Hub. A Git-backed project SHALL have a project path and a separately configurable Git root; the registry SHALL NOT treat those paths as necessarily identical. The registry SHALL NOT require a Hub root folder and SHALL NOT introduce a native DSH workspace hierarchy: a Hub is a logical grouping, not a workspace.

#### Scenario: Register a monorepo project
- **WHEN** a user registers a project at /repos/platform/services/api whose Git root is /repos/platform
- **THEN** the active Hub's registry retains both paths separately and makes that project selectable for a task in that Hub

#### Scenario: Register a project at its repository root
- **WHEN** a user registers a project whose project path and Git root are both /repos/library
- **THEN** the registry accepts that context without requiring an artificial project subdirectory

#### Scenario: Scope the registry to the active Hub
- **WHEN** the user opens Projects for one Hub
- **THEN** the list contains only projects owned by that Hub
- **AND** projects from other Hubs are not selectable for its tasks

#### Scenario: Do not require a Hub root
- **WHEN** the user registers a project in a Hub without configuring a root folder
- **THEN** the registry accepts the project
- **AND** no containment check or native workspace is derived from the Hub

## ADDED Requirements

### Requirement: No Hub or project inference from native DSH workspace
The plugin SHALL NOT infer a Hub or a project from the native DSH workspace, workspace directory, or session grouping. In a task conversation, the task's board and project SHALL be authoritative. In an ordinary DSH chat, the agent SHALL discover a board through board tools before performing board-scoped work.

#### Scenario: Do not infer from a matching directory
- **WHEN** an ordinary DSH chat runs in a native workspace whose directory matches a registered project
- **THEN** the plugin does not select that project's Hub or board automatically
- **AND** board tools require an explicitly discovered board identifier

#### Scenario: Use the task's board context
- **WHEN** a board tool is called from a task conversation without a board identifier
- **THEN** the plugin resolves the board from the task that owns the conversation
- **AND** it does not use the native workspace to choose a Hub or project

#### Scenario: Keep project selection explicit
- **WHEN** a task is created through a board tool
- **THEN** the project is the explicitly requested project from the board's Hub
- **AND** no project is inferred from the native workspace
