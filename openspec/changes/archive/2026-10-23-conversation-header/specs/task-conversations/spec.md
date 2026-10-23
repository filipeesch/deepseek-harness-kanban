# Spec Delta

## ADDED Requirements

### Requirement: Native conversation status row
In the Conversations section, the task drawer SHALL render a compact status row beneath the active conversation's tab strip for the active conversation only. The row SHALL render the host's actual native agent-mode, subagent, and background-job header actions, including their native labels, counts, and popovers. The row SHALL follow the selected conversation tab, SHALL update when that session's native actions update, and SHALL be hidden when no native action renders. It SHALL NOT aggregate subagent or background-job activity from other conversations of the task; board-level task activity remains separate. It SHALL NOT appear in the Info, Git, or Notes sections.

#### Scenario: Show the native actions for the active conversation
- **WHEN** the active task conversation has native mode, subagent, or background-job actions
- **THEN** the status row shows those native actions with their native labels and counts
- **AND** the row is positioned beneath the conversation tab strip rather than replacing the task drawer header

#### Scenario: Hide the row when no action renders
- **WHEN** the active conversation has no native mode, subagent, or background-job action to render
- **THEN** the status row is hidden and does not reserve an empty band

#### Scenario: Follow the selected conversation
- **WHEN** the user switches from one conversation tab to another
- **THEN** the status row reflects the newly selected conversation's native actions
- **AND** subagent or background-job activity from the previous or other conversations is not merged into that row

#### Scenario: Keep task sections free of the row
- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the conversation status row is not shown

#### Scenario: Open a native status popover
- **WHEN** the user opens a native subagent or background-job popover from the status row
- **THEN** the native popover renders as it does in an ordinary DSH chat
- **AND** interacting with that popover does not close the task drawer

### Requirement: Read-only agent mode
The drawer SHALL display the active conversation's native agent mode read-only through the native mode action. It SHALL NOT provide a mode picker or any control that changes a conversation's mode. Mode selection remains outside this capability.

#### Scenario: Display the mode without a picker
- **WHEN** the active conversation has a native agent mode
- **THEN** the status row shows the native read-only mode label
- **AND** the drawer offers no mode selection control

#### Scenario: Do not attempt a mode change
- **WHEN** the active conversation is blank or started
- **THEN** the plugin does not call a preset selection API and does not present a mode-change action

### Requirement: Native status actions without a DSH change
The plugin SHALL render the host's native agent-mode, subagent, and background-job header-action components in the status row. It SHALL NOT reimplement their labels, counts, popovers, or selection behavior, and SHALL NOT require a DSH change for this surface. The plugin SHALL be compatible with the pinned DSH release; when the expected native entries are unavailable, the row SHALL be hidden without a plugin-owned fallback.

#### Scenario: Render the host's native components
- **WHEN** the pinned DSH host registers the native header actions
- **THEN** the row renders those native components, not a plugin replica
- **AND** their native popovers and actions remain available

#### Scenario: Do not fake missing native actions
- **WHEN** the expected native header-action entries are unavailable
- **THEN** the row is hidden
- **AND** the plugin does not display a plugin-owned mode, count, or job/subagent fallback in their place

#### Scenario: Stay on the pinned host
- **WHEN** the plugin is installed on its pinned DSH release
- **THEN** the status row works without a DSH patch or a new DSH release
- **AND** the plugin does not claim support for a different host layout
