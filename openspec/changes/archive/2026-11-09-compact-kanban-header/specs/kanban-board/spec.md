# Spec Delta

## ADDED Requirements

### Requirement: Compact board header
The Kanban page SHALL present its chrome inside the board header in two rows: a first row with the Kanban title, the Hub tabs of the available Hubs in Hub order followed by the create-Hub action, and the page toolbar; and a second row with the board tabs of the active Hub in board order followed by the create-board action. The header SHALL NOT present a subtitle beneath the title, and the title SHALL keep its current size as the leading content of the first row.

Every interactive control in the first-row toolbar SHALL have the same height, and that height SHALL equal the height of a Hub tab so that the row reads as one line. Both rows SHALL stay horizontally scrollable rather than truncated when their tabs exceed the available width. When a row cannot present its content on one line, the toolbar SHALL wrap below that row and no control SHALL be hidden.

At a viewport width of at least 1100px each row SHALL fit on a single line, and the board header SHALL NOT be taller than 112px.

The board tabs SHALL be presented as compact chips visually smaller than the Hub tabs while the second row keeps its height, so that content below the header does not shift when the chips change. Each board chip SHALL keep the attention and publishing indicators, the running-task count, and the accessible name defined by Board attention aggregation, and the active board SHALL remain visibly distinguishable.

#### Scenario: Present the header in two rows
- **WHEN** the Kanban page renders a Hub with at least one board
- **THEN** the first row shows the Kanban title, the Hub tabs with the create-Hub action, and the page toolbar
- **AND** the second row shows the board tabs with the create-board action
- **AND** the two rows sit above the board body

#### Scenario: Omit the header subtitle
- **WHEN** the Kanban page renders its header
- **THEN** no subtitle is presented beneath the Kanban title
- **AND** the title is presented at its existing size

#### Scenario: Keep one line height across the toolbar
- **WHEN** the user inspects the filter control, the presentation switch, the select-cards action, and the configuration action
- **THEN** each has the same height as a Hub tab
- **AND** they share one baseline on the first row

#### Scenario: Stay on single rows at a desktop width
- **WHEN** the Kanban page renders at a viewport width of at least 1100px
- **THEN** the first row and the second row each occupy one line
- **AND** the board header is no taller than 112px

#### Scenario: Reflow the header at a narrow width
- **WHEN** the board header is narrower than the first row's title, Hub tabs, and toolbar together
- **THEN** the toolbar wraps below the row
- **AND** the tab rows scroll horizontally
- **AND** no title, tab, or toolbar control is hidden or clipped

#### Scenario: Present compact board chips
- **WHEN** the active Hub has more than one board
- **THEN** each board is a chip smaller than a Hub tab
- **AND** the second row keeps its height
- **AND** each chip keeps its attention indicators, its running-task count, and its publishing indicator
- **AND** the active board is visibly distinguishable

### Requirement: Board filter control
The board header SHALL present one filter control in the page toolbar that opens an anchored, non-modal popover containing the text-search input and the project select. Those two inputs are the only way to set the filters from the header: the header SHALL NOT present an always-visible search field or a separate clear-filters button, and it SHALL NOT require a keyboard shortcut to reach the search input. The project select SHALL NOT size itself to its longest option; it SHALL truncate the selected value and expose the full name through its tooltip.

Filtering SHALL apply live as the user types or changes the selected project. The popover SHALL NOT require an apply action and SHALL remain open while either input changes. The popover SHALL present a footer with a clear action and a close action, each icon-only and each carrying its name in its accessible name and tooltip. The clear action SHALL remove both filters and close the popover. The close action SHALL leave the filters unchanged.

When at least one of the two filters is active, the filter control SHALL present an accent indicator. When both are active it SHALL present a numeral stating the count of active filters. The indicator SHALL NOT change the control's height, and the control's accessible name SHALL state which filters are active.

The filter control SHALL be presented together with the presentation switch, the select-cards action, and the configuration action, and SHALL NOT be presented while card selection is active. The popover SHALL close on Escape and on an outside click and SHALL return focus to the filter control; while a task drawer is open, Escape SHALL dismiss only the popover. The popover belongs to its caller's layer: it SHALL present above the board content and below the task drawer, leaving other components free to overlap it, and it SHALL NOT move the board or change its size. When the popover opens, focus SHALL move to the search input. When the active Hub or board changes, the filters SHALL reset as defined by Board selection and persistence and the popover SHALL close. The filter control and the filters it holds SHALL remain available in both presentations defined by Board presentation selection.

#### Scenario: Open the filter popover
- **WHEN** the user activates the filter control
- **THEN** an anchored non-modal popover presents the text-search input and the project select
- **AND** focus moves to the search input
- **AND** the board keeps its position and size

#### Scenario: Filter while the popover stays open
- **WHEN** the user types in the search input or selects a project inside the popover
- **THEN** the board updates with that filter
- **AND** the popover remains open with both inputs available

#### Scenario: Indicate one active filter
- **WHEN** the user has entered search text or selected a project and closed the popover
- **THEN** the filter control presents an accent indicator
- **AND** its accessible name states which filter is active

#### Scenario: Indicate two active filters with a count
- **WHEN** search text and a project filter are both active
- **THEN** the filter control presents the indicator with the numeral 2
- **AND** the control keeps the same height as the other toolbar controls

#### Scenario: Clear both filters from the popover
- **WHEN** the user activates the clear action in the popover footer
- **THEN** the search text and the project filter are both removed
- **AND** the board presents all of its tasks
- **AND** the popover closes
- **AND** focus returns to the filter control

#### Scenario: Close the popover without changing filters
- **WHEN** the user activates the close action in the popover footer
- **THEN** the popover closes
- **AND** the search text and the project filter are unchanged

#### Scenario: Present the popover under the task drawer
- **WHEN** the filter popover is open over the board and a task drawer opens over it
- **THEN** the task drawer presents above the popover
- **AND** the popover stays open until the user dismisses it

#### Scenario: Dismiss the popover without closing the drawer
- **WHEN** the filter popover is open, a task drawer is open over it, and the user presses Escape or clicks the task drawer
- **THEN** only the popover closes
- **AND** the task drawer remains open
- **AND** Escape returns focus to the filter control
- **AND** a click that lands on a control in the drawer leaves focus on that control

#### Scenario: Keep the popover inside the viewport on a narrow header
- **WHEN** the filter popover is open and the page is narrower than 760 pixels
- **THEN** the popover is anchored to the leading edge of the filter control
- **AND** both of its edges stay inside the viewport
- **AND** the search input and the project select can both be reached and used

#### Scenario: Hide the filter control during card selection
- **WHEN** the user enters card selection mode
- **THEN** the filter control is not presented
- **AND** the selection count, delete, and cancel actions are presented instead

#### Scenario: Keep filtering available in the workflow diagram
- **WHEN** the board presents the workflow diagram and a filter is active
- **THEN** the filter control is presented in the toolbar
- **AND** the diagram presents only the tasks that match the active filters

#### Scenario: Reset and close the popover on navigation
- **WHEN** the user switches the active Hub or the active board while the filter popover is open
- **THEN** the popover closes
- **AND** the search text and the project filter are cleared

## MODIFIED Requirements

### Requirement: Text search and project filtering
The active board SHALL support text search over its task titles and descriptions and filtering by project, separately and together. The project filter SHALL list the projects owned by the active Hub. The two inputs SHALL be presented by the board filter control defined by the Board filter control requirement. This scope SHALL NOT add activity or worktree-status filters.

#### Scenario: Find a task by its title or description
- **WHEN** the user searches for text that matches a task's title or description
- **THEN** that task is included in the board's matching results

#### Scenario: Filter tasks by project
- **WHEN** the user selects a project filter
- **THEN** the board displays only tasks associated with that project

#### Scenario: Combine search and project filtering
- **WHEN** the user applies text search and a project filter together
- **THEN** the displayed tasks satisfy both the text search and the selected project filter

#### Scenario: Keep the filter inside the active board
- **WHEN** the user changes from one board to another
- **THEN** the project filter options are limited to the active Hub's projects
- **AND** tasks from the previous board are not shown

#### Scenario: Reach both filters from one control
- **WHEN** the user wants to combine a text search with a project filter
- **THEN** both inputs are available in the same filter popover without leaving it

### Requirement: Board header clears collapsed-sidebar window chrome
When the host sidebar is fully collapsed on macOS, the Kanban board header SHALL offset its leading content by the host-published frame leading clearance so the Kanban title, the Hub tabs, and the toolbar do not overlap the window traffic lights or the shell's sidebar and new-session controls. The header SHALL use its normal leading inset when the clearance is absent, SHALL use the fullscreen clearance when the host reports fullscreen, and SHALL wrap its content without clipping at supported widths.

#### Scenario: Collapse the sidebar on macOS
- **WHEN** the DSH sidebar is fully collapsed on macOS and the host publishes a frame leading clearance
- **THEN** the board header's leading content starts after that clearance
- **AND** the Kanban title, the Hub tabs, and the toolbar do not sit under the traffic lights or shell controls

#### Scenario: Keep the normal inset when expanded
- **WHEN** the sidebar is expanded or the host publishes no frame leading clearance
- **THEN** the board header uses its normal leading inset

#### Scenario: Keep the fullscreen clearance
- **WHEN** the collapsed macOS window is fullscreen and the host publishes the smaller clearance
- **THEN** the header clears the remaining shell controls without reserving the traffic-light band

#### Scenario: Wrap at a narrow width
- **WHEN** the board header is narrower than its title, Hub tabs, and toolbar together
- **THEN** the header content wraps or reflows without clipping or overlapping the window chrome
