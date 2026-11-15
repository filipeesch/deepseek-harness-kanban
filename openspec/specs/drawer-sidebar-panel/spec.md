# drawer-sidebar-panel Specification

## Purpose
Lets a task drawer show the native right Sidebar beside its embedded conversation, so workspace files, document and image previews, terminals, and browser tabs are available inside the drawer with the same per-Session panel state as the main chat.

## Requirements

### Requirement: The drawer hosts the right Sidebar panel beside the active conversation

In the Conversations section, the drawer SHALL render the host's public embedded right Sidebar panel for the active root conversation, beside the embedded conversation window and on the right of it. The occurrence SHALL take its Session from the retained Session area that already wraps the conversation window, and the drawer SHALL NOT pass an independent Session identity to it. The panel SHALL present that Session's tabs and its active tab body. The panel SHALL NOT appear in the Info, Git, Notes, Relations, or History sections, while the transient subagent peek is presented, while the first-conversation creation surface is presented, or when the task has no open conversation.

#### Scenario: Show the panel beside the active conversation

- **WHEN** the user opens a task conversation whose Session's panel is expanded
- **THEN** the drawer shows the embedded conversation window with the right Sidebar panel beside it
- **AND** the panel shows that Session's tabs and the active tab's body

#### Scenario: Follow the active conversation tab

- **WHEN** the user switches between the task's open conversations
- **THEN** the panel shows the panel state of the newly active Session
- **AND** a Session that never expanded its panel presents the conversation without a panel

#### Scenario: Keep the panel out of the other sections

- **WHEN** the user opens the Info, Git, Notes, Relations, or History section
- **THEN** the right Sidebar panel is not shown

#### Scenario: Keep the panel out of transient surfaces

- **WHEN** the drawer presents the transient subagent peek or the first-conversation creation surface
- **THEN** the right Sidebar panel is not shown
- **AND** the drawer does not write the descendant's or the new conversation's panel state

#### Scenario: No panel without an open conversation

- **WHEN** the task has no open conversation
- **THEN** the drawer presents its conversation creation surface without a right Sidebar panel

### Requirement: One panel state per Session, shared with the main chat

Every mounted occurrence of a Session's panel SHALL read and write the same panel state as the main column: the same layout, the same open tabs, the same history, and the same persisted layout for that Session. Opening the same resource from the drawer conversation or from the main chat SHALL reveal the same tab, a terminal tab SHALL remain one terminal process, and a reload SHALL restore the panel before a tab body renders. A Session whose panel was never expanded SHALL remain collapsed.

#### Scenario: Opening either place reveals the same tab

- **WHEN** a file is opened from a link in the main chat and, later, the same file is opened from a link in the drawer conversation
- **THEN** the drawer panel reveals the tab the main chat opened
- **AND** both occurrences show the same active tab

#### Scenario: One terminal process

- **WHEN** a terminal tab is open in the drawer panel and the main column draws the same Session's panel
- **THEN** both draw the same terminal process

#### Scenario: Restore the panel after a reload

- **WHEN** the application reloads with a Session whose panel was expanded
- **THEN** the drawer's panel opens for that Session with its tabs restored
- **AND** the drawer's base width and the rail width are restored as well

#### Scenario: Leave an unused Session collapsed

- **WHEN** the user opens a conversation whose Session never expanded its panel
- **THEN** the drawer shows the conversation without a panel
- **AND** the drawer does not create or expand that Session's panel by itself

### Requirement: The panel opens and closes through the native controls

The drawer SHALL open the panel when the conversation window's native right-bar corner control expands that Session's panel, and SHALL close it when the panel's own collapse control collapses it. Closing the last docked tab that is not the guide SHALL collapse the panel as the host defines. The drawer SHALL NOT add a second open or close control, SHALL NOT keep a panel-local expansion state, and SHALL NOT present an expanded panel as hidden. No panel control rendered in the drawer SHALL be inoperative.

#### Scenario: Open from the conversation header

- **WHEN** the user activates the native right-bar corner control of the drawer's conversation window
- **THEN** the right Sidebar panel opens beside the conversation
- **AND** the control reflects the expanded state as the host defines it

#### Scenario: Close from the panel

- **WHEN** the user activates the panel's collapse control
- **THEN** the panel closes and the drawer returns to the conversation alone
- **AND** the conversation header's corner control offers the way back in

#### Scenario: Close by closing the last docked tab

- **WHEN** the user closes the last docked tab that is not the guide
- **THEN** the panel collapses as the host defines
- **AND** the drawer returns to the conversation alone

#### Scenario: Do not add a second control

- **WHEN** the drawer presents an expanded or collapsed panel
- **THEN** it presents no plugin-owned open, close, split, fullscreen, or floating control for the panel

### Requirement: The drawer reserves room for the panel and restores its base width

While the panel is expanded, the drawer SHALL grow by the smallest amount that fits a usable conversation beside the panel, remembering the width the drawer had before the panel opened. The persisted drawer width SHALL remain the base width and SHALL be restored when the panel collapses, when the active conversation switches to a Session whose panel is collapsed, when the drawer leaves the Conversations section, and when the drawer closes. The panel width SHALL default to 45% of the drawer, SHALL be resizable, and SHALL persist as one product-wide preference. When the available viewport cannot fit a usable conversation beside the panel, the panel SHALL cover the conversation inside the drawer instead of shrinking the conversation below its minimum.

#### Scenario: Grow and restore

- **WHEN** the panel opens in a drawer narrower than the combined minimum
- **THEN** the drawer grows to fit the conversation and the panel
- **WHEN** the panel closes
- **THEN** the drawer returns to the width it had before the panel opened

#### Scenario: Resize the panel and keep the preference

- **WHEN** the user drags the divider between the conversation and the panel
- **THEN** the panel takes that width within its bounds
- **AND** a later panel open in any task uses that width

#### Scenario: Resize the drawer while the panel is open

- **WHEN** the user resizes the drawer while the panel is open
- **THEN** the drawer uses that width for the conversation and panel together
- **WHEN** the panel then closes
- **THEN** the drawer returns to the base width it had before the panel opened

#### Scenario: Cover the conversation when space is short

- **WHEN** the viewport cannot fit a usable conversation beside the panel
- **THEN** the panel covers the conversation inside the drawer
- **AND** collapsing the panel returns the conversation
- **AND** the drawer does not compress the conversation below its minimum

### Requirement: The rail presents the host panel unchanged

The drawer's panel SHALL be the host's docking-only embedded occurrence: it SHALL present tabs, the add control, and collapse, and SHALL NOT present a split control, a fullscreen control, or a floating-panel affordance. Splits already committed in the shared layout SHALL render; floating panes SHALL stay in the main occurrence and SHALL NOT be drawn in the drawer. The drawer SHALL NOT register tab bodies or titles, SHALL NOT add its own tab chrome, and SHALL NOT implement split, floating, or fullscreen.

#### Scenario: Docking chrome only

- **WHEN** the drawer's panel renders
- **THEN** it shows tabs, the add control, and collapse
- **AND** it shows no split, fullscreen, or floating control

#### Scenario: Render a committed split

- **WHEN** the Session's layout already holds a split created in the main column
- **THEN** the drawer panel draws both panes of that split

#### Scenario: Leave floating panes to the main column

- **WHEN** the Session holds a floating pane created in the main column
- **THEN** the drawer panel does not draw it
- **AND** the floating pane keeps its record and remains drawn by the main column

#### Scenario: Register no tab contribution

- **WHEN** the drawer panel renders the host's tab types
- **THEN** the plugin has registered no tab body, no tab title, and no panel control for the drawer

### Requirement: Opens from the drawer conversation land in the drawer panel

While the panel is expanded, resource links in the drawer conversation, tool line references, page shortcuts, and assistant Markdown links configured to open in the Sidebar SHALL open in the drawer's panel, and the open SHALL NOT report a missing Session surface. While the panel is collapsed, the drawer SHALL NOT claim those opens and the host's behavior applies unchanged.

#### Scenario: Open a file link inside the drawer conversation

- **WHEN** the user activates a file link in the drawer conversation while its panel is expanded
- **THEN** the file opens as a tab in the drawer panel
- **AND** the open does not report a missing Session surface

#### Scenario: Reveal instead of duplicating

- **WHEN** the user activates the same file link again
- **THEN** the drawer panel reveals the tab already open for that address

#### Scenario: Do not claim while collapsed

- **WHEN** the panel is collapsed and a resource link is activated in the drawer conversation
- **THEN** the drawer does not claim the open
- **AND** the host's behavior applies

### Requirement: The split is accessible

The divider between the conversation and the panel SHALL be a vertical separator with an accessible name, its current value, and the allowed bounds, and SHALL be operable from the keyboard with arrow keys and Home within those bounds. The panel SHALL be a labeled region for assistive technology. Opening, closing, and resizing the panel SHALL NOT trap focus, and while the panel covers the conversation the conversation SHALL remain reachable when the panel collapses.

#### Scenario: Resize from the keyboard

- **WHEN** the divider has focus and the user presses an arrow key or Home
- **THEN** the panel width changes within its bounds
- **AND** the divider reports the new value

#### Scenario: Label the regions

- **WHEN** the panel is shown
- **THEN** the divider and the panel expose their accessible names and values

#### Scenario: Keep focus usable

- **WHEN** the panel opens, closes, or covers the conversation
- **THEN** focus is not trapped in the panel
- **AND** the conversation is reachable again after the panel collapses

### Requirement: Host compatibility and absence

The drawer SHALL render the panel only when the running host reports the embedded-panel capability and provides the per-Session expanded state. On a host without that capability the drawer SHALL keep today's behavior: no panel, no notice, no additional control, and no plugin-owned replica of the panel's tab types. The plugin SHALL keep the supported DSH 0.2.2 compatibility floor; the panel appears when the host exposes the capability.

#### Scenario: Render on a supported host

- **WHEN** the running host reports the embedded-panel capability
- **THEN** the drawer renders the panel for the active conversation Session

#### Scenario: Keep today's behavior on an older host

- **WHEN** the running host does not report the embedded-panel capability
- **THEN** the drawer presents no panel and no additional control
- **AND** it does not present an update notice for this capability
- **AND** the conversation window and the rest of the drawer behave as before

#### Scenario: Do not rebuild the panel

- **WHEN** the capability is unavailable
- **THEN** the plugin does not assemble its own files, preview, terminal, or browser surface in the drawer

#### Scenario: Keep the compatibility floor

- **WHEN** the plugin's supported DSH range is inspected
- **THEN** it still declares the 0.2.2 floor
- **AND** the panel is an optional capability rather than a new minimum
