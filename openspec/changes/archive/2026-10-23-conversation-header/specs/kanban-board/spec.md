# Spec Delta

## ADDED Requirements

### Requirement: Board header clears collapsed-sidebar window chrome
When the host sidebar is fully collapsed on macOS, the Kanban board header SHALL offset its leading content by the host-published frame leading clearance so the title, subtitle, and toolbar do not overlap the window traffic lights or the shell's sidebar and new-session controls. The header SHALL use its normal leading inset when the clearance is absent, SHALL use the fullscreen clearance when the host reports fullscreen, and SHALL wrap its content without clipping at supported widths.

#### Scenario: Collapse the sidebar on macOS
- **WHEN** the DSH sidebar is fully collapsed on macOS and the host publishes a frame leading clearance
- **THEN** the board header's leading content starts after that clearance
- **AND** the Kanban title, subtitle, and toolbar do not sit under the traffic lights or shell controls

#### Scenario: Keep the normal inset when expanded
- **WHEN** the sidebar is expanded or the host publishes no frame leading clearance
- **THEN** the board header uses its normal leading inset

#### Scenario: Keep the fullscreen clearance
- **WHEN** the collapsed macOS window is fullscreen and the host publishes the smaller clearance
- **THEN** the header clears the remaining shell controls without reserving the traffic-light band

#### Scenario: Wrap at a narrow width
- **WHEN** the board header is narrower than its title, subtitle, and toolbar together
- **THEN** the header content wraps or reflows without clipping or overlapping the window chrome
