# Spec Delta

## MODIFIED Requirements

### Requirement: The panel opens and closes through the native controls

The drawer SHALL open the panel when the conversation window's native right-bar corner control expands that Session's panel, and SHALL close it when the panel's own collapse control collapses it. The panel SHALL also open when an open from the drawer conversation expands that Session's panel, because an open behind a collapsed column is not an open. Closing the last docked tab that is not the guide SHALL collapse the panel as the host defines. The drawer SHALL NOT add a second open or close control, SHALL NOT keep a panel-local expansion state, and SHALL NOT present an expanded panel as hidden. No panel control rendered in the drawer SHALL be inoperative.

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

#### Scenario: Open from a resource open

- **WHEN** an open from the drawer conversation expands the Session's panel
- **THEN** the drawer presents the panel beside the conversation in the same step
- **AND** it adds no plugin-owned control for opening or closing the panel

#### Scenario: Do not add a second control

- **WHEN** the drawer presents an expanded or collapsed panel
- **THEN** it presents no plugin-owned open, close, split, fullscreen, or floating control for the panel

## REMOVED Requirements

### Requirement: Opens from the drawer conversation land in the drawer panel
**Reason**: Replaced by "Opens from the drawer conversation open in the drawer panel". The old contract claimed an open only while the panel was expanded and let the host's failure stand while it was collapsed, which is the reported failure: a file link in the drawer conversation reports "Couldn't open file" with a Retry that cannot succeed, and Retry keeps failing.
**Migration**: None needed for stored data. The drawer claims the open for its active conversation instead, opens the panel in the same step, and keeps the host's own failure only where the host cannot expose a per-Session open.

## ADDED Requirements

### Requirement: Opens from the drawer conversation open in the drawer panel

The drawer SHALL settle an open issued from the drawer conversation in the active conversation's panel, and the open SHALL NOT report a missing Session surface. The claim SHALL cover resource links, tool line references, page shortcuts, and assistant Markdown links configured to open in the Sidebar, including external links that open a browser page in that panel. The claim SHALL apply while the panel is expanded and while it is collapsed: with the panel collapsed, the open SHALL open the panel in the same step and land as a tab or page in it. While the drawer presents the transient subagent peek, the open SHALL target the task conversation's panel; because the peek draws no panel of its own, such an open cannot be shown while the peek is presented. The drawer SHALL claim only an open the host could not resolve itself, and on a host that does not provide a per-Session open the drawer SHALL leave the host's behavior unchanged rather than report an additional error. A Session whose panel state no occurrence has materialized has nothing to open into, and the drawer SHALL NOT report an additional error for it either.

#### Scenario: Open a file link inside the drawer conversation

- **WHEN** the user activates a file link in the drawer conversation while its panel is expanded
- **THEN** the file opens as a tab in the drawer panel
- **AND** the open does not report a missing Session surface

#### Scenario: Open a file link while the panel is collapsed

- **WHEN** the user activates a file link in the drawer conversation while its panel is collapsed
- **THEN** the drawer opens the panel beside the conversation
- **AND** the file opens as a tab in that panel
- **AND** no failure notice or retry prompt is presented

#### Scenario: Open a page shortcut while the panel is collapsed

- **WHEN** the user activates a page shortcut from the drawer conversation while its panel is collapsed
- **THEN** the drawer opens the panel and the page opens in it
- **AND** the open does not report a missing Session surface

#### Scenario: Open from a transient subagent peek

- **WHEN** the user activates a file link in the transient subagent peek
- **THEN** the open targets the task conversation's panel, which the peek does not draw
- **AND** the peek presents no panel of its own
- **AND** no failure notice is presented

#### Scenario: Reveal instead of duplicating

- **WHEN** the user activates the same file link again
- **THEN** the drawer panel reveals the tab already open for that address

#### Scenario: Leave the host's own behavior when the drawer cannot claim

- **WHEN** the host does not provide a per-Session open and an open from the drawer conversation has no Session surface
- **THEN** the drawer presents no additional error or control of its own
- **AND** the host's own failure handling applies unchanged
