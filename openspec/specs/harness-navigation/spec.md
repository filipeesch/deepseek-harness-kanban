# Harness Navigation Specification

## Purpose

Provide a Kanban-centered product entry point within DeepSeek Harness while preserving the host application's normal startup, native conversations, and existing navigation.

## Requirements

### Requirement: Plugin-provided Kanban main page
The product SHALL be delivered as an independent DSH plugin without requiring changes to the DSH core. It SHALL expose a main page named Kanban and a corresponding sidebar item alongside Automation tasks and Plugins.

#### Scenario: Open Kanban from the sidebar
- **WHEN** the plugin is available and the user selects Kanban in the DSH sidebar
- **THEN** DSH displays the Kanban main page
- **AND** Automation tasks and Plugins remain available as existing navigation destinations

### Requirement: Preserve normal host startup
The plugin SHALL preserve DSH's normal startup behavior and SHALL NOT force Kanban to become the startup page.

#### Scenario: Start DSH with the plugin available
- **WHEN** the user starts DSH with the Kanban plugin available
- **THEN** DSH follows its normal startup behavior rather than an override introduced by the plugin

### Requirement: Configuration within the Kanban page
The Kanban page SHALL provide access to General, Hub, Projects, and Board configuration within the board experience rather than requiring a separate Railyin-style application setup area. The configuration action SHALL open the General section by default. The General section SHALL contain the global worktree base path. The Hub section SHALL contain the active Hub's name, Hub deletion, and board management. The Projects section SHALL contain the active Hub's project registry. The Board section SHALL contain the active board's name, workflow, and deletion, and SHALL be unavailable when the active Hub has no board. The empty-board Configure projects action SHALL open the Projects section. The create-board empty state SHALL open the Hub section or an equivalent board-creation action.

#### Scenario: Open configuration from the board
- **WHEN** the user opens configuration from the board's configuration action
- **THEN** the General section is presented
- **AND** Hub, Projects, and Board remain available

#### Scenario: Configure projects from the board
- **WHEN** the user accesses Projects configuration from Kanban
- **THEN** the active Hub's project registry is available

#### Scenario: Configure the workflow from the board
- **WHEN** the user opens the Board section with an active board
- **THEN** that board's name, workflow, and deletion are available

#### Scenario: Configure general board settings from the board
- **WHEN** the user opens the General section
- **THEN** the global worktree base path setting is available

#### Scenario: Configure the active Hub
- **WHEN** the user opens the Hub section
- **THEN** the active Hub's name and board management are available
- **AND** projects from other Hubs are not shown

#### Scenario: No Board section without a board
- **WHEN** the active Hub has no boards
- **THEN** the Board section is unavailable
- **AND** the page presents the create-board empty state

#### Scenario: Configure projects from an empty board
- **WHEN** the user selects Configure projects on a board without projects
- **THEN** the Projects configuration section is presented for the active Hub

### Requirement: Preserve native DSH interaction boundaries
The plugin SHALL retain native DSH conversations and execution rather than replace the host's agent experience. It SHALL preserve access to ordinary DSH chats and existing native features. This scope SHALL NOT add a new shortcut for navigating from a task card to the main chat area.

#### Scenario: Continue using ordinary DSH conversations
- **WHEN** the user opens an ordinary DSH chat outside a task drawer
- **THEN** the native chat experience remains available independently of the Kanban page

#### Scenario: Use native conversation behavior in task work
- **WHEN** a conversation is used within a Kanban task
- **THEN** conversation execution uses the native DSH experience rather than a separate Railyin agent runtime
