# Spec Delta

## ADDED Requirements

### Requirement: Closed conversations stay out of the conversation flow
The Conversations section SHALL NOT reserve space in the conversation body for closed conversations. Closed conversations SHALL be reachable from a compact control at the end of the open-conversation tab strip, before the new-conversation action. The control SHALL be presented only when the task has at least one closed conversation and SHALL show a small history icon and the closed-conversation count. Its accessible name SHALL state the number of closed conversations.

Activating the control SHALL open an anchored, non-modal popover listing the task's closed conversations. Each entry SHALL be a button whose visible label is the native DSH session title when one exists and `Agent N` otherwise. Activating an entry SHALL reopen that conversation and select it. A reopen failure SHALL be presented inside the popover and SHALL NOT close it. The popover SHALL close on Escape, on an outside click, and after a successful reopen. While a reopen is pending, Escape and an outside click SHALL NOT dismiss the popover, so that a failure can be presented there. While the popover is open, Escape SHALL dismiss only the popover and SHALL NOT close the task drawer. Escape and an outside click SHALL return focus to the closed-conversations control. A successful reopen SHALL move focus to the reopened conversation tab, falling back to the control when that tab is not available. The popover SHALL be scrollable when its list exceeds the available height.

When every conversation is closed, the section SHALL present a short empty state that points to the closed-conversations control without duplicating the closed list or adding a second reopen action.

#### Scenario: Show the closed-conversations control only when needed
- **WHEN** a task has no closed conversations
- **THEN** the Conversations section does not present the closed-conversations control
- **AND** the conversation body keeps its full height

#### Scenario: Open the closed-conversation list
- **WHEN** a task has closed conversations and the user activates the closed-conversations control
- **THEN** an anchored popover lists those conversations
- **AND** each entry shows the native session title or `Agent N`
- **AND** the conversation body is not resized by the list

#### Scenario: Reopen from the list
- **WHEN** the user activates a closed conversation entry
- **THEN** the conversation is reopened and selected
- **AND** its session and history are preserved
- **AND** the popover closes
- **AND** focus moves to the reopened conversation tab

#### Scenario: Reopen failure stays in the popover
- **WHEN** reopening a closed conversation fails
- **THEN** the failure is presented inside the popover
- **AND** the popover remains open for another attempt

#### Scenario: Keep the popover open while reopening
- **WHEN** a reopen is pending and the user presses Escape or clicks outside the popover
- **THEN** the popover remains open
- **AND** the pending entry is presented as unavailable

#### Scenario: Dismiss the closed-conversation list
- **WHEN** the popover is open and the user presses Escape, or clicks outside it but inside the task drawer
- **THEN** the popover closes
- **AND** focus returns to the closed-conversations control
- **AND** the task drawer remains open

#### Scenario: Empty state points to the control
- **WHEN** every task conversation is closed
- **THEN** the Conversations section presents a short empty state that points to the closed-conversations control
- **AND** it does not repeat the closed list or add a second reopen action

### Requirement: Close the active conversation from its session header
The Conversations section SHALL present the close action for the active task conversation at the end of that conversation's native session header row. The action SHALL be an additional plugin action and SHALL NOT replace or reimplement the host's native header components. The action SHALL close the active root conversation and SHALL be absent while a subagent conversation is peeked. The action SHALL be disabled while a conversation command is pending. Its accessible name SHALL identify the conversation being closed.

The close action SHALL remain reachable while the native conversation body is loading or has failed to open, so that the tab can still be closed. Closing SHALL only hide the conversation from the open-tab strip; it SHALL NOT archive the native session, delete its history, or change the task's session identifiers.

#### Scenario: Close the active conversation
- **WHEN** the user activates the close action in the native session header of the active root conversation
- **THEN** that conversation moves to the closed state
- **AND** its native session and history remain
- **AND** the drawer selects the next open conversation or presents the all-closed empty state

#### Scenario: Hide the close action during a subagent peek
- **WHEN** the drawer is displaying a peeked subagent conversation
- **THEN** the close action is not presented
- **AND** the root conversation tabs are unchanged

#### Scenario: Keep the close action available when the native body fails
- **WHEN** the active conversation's native body is loading or fails to open
- **THEN** the close action remains available in the conversation surface
- **AND** activating it closes the conversation rather than trapping the user in the failed view

#### Scenario: Disable the close action while a command is pending
- **WHEN** a conversation close, reopen, or create command is pending
- **THEN** the close action is disabled
- **AND** it becomes available again when the command settles

## MODIFIED Requirements

### Requirement: Drawer resizing, dismissal, and draft retention
The task drawer SHALL be resizable within defined minimum and maximum bounds and SHALL persist its width across reloads. Clicking the board background SHALL close the drawer, while clicks inside a native overlay or portal, or on the resize handle, SHALL NOT close it. Escape SHALL close the drawer unless a conversation popover is open, in which case Escape SHALL dismiss that popover without closing the drawer. Closing SHALL preserve unsaved Info drafts for that task. Selecting another task card SHALL switch the drawer to that task.

#### Scenario: Resize and persist the drawer
- **WHEN** the user drags the drawer's resize handle to a new width
- **THEN** the drawer uses that width within its bounds
- **AND** the width is restored after a reload

#### Scenario: Close by clicking the board background
- **WHEN** the drawer is open and the user clicks the board background outside the drawer
- **THEN** the drawer closes

#### Scenario: Interact with a native overlay
- **WHEN** the drawer is open and the user interacts with a native menu, picker, or overlay outside the drawer panel
- **THEN** the drawer remains open

#### Scenario: Close with Escape
- **WHEN** the drawer is open and no conversation popover is open and the user presses Escape
- **THEN** the drawer closes and any unsaved Info draft for that task is retained

#### Scenario: Switch tasks
- **WHEN** the drawer is open and the user activates another task card
- **THEN** the drawer displays the newly selected task without a separate chat navigation flow
