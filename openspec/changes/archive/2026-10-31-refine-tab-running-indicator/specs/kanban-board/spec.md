# Spec Delta

## MODIFIED Requirements

### Requirement: Board attention aggregation

The board tab SHALL present aggregated attention for all tasks on that board. Attention SHALL consist of the unread indicator, the awaiting-reply indicator, the failure indicator, and a running-task indicator. The unread, awaiting-reply, and failure indicators SHALL be presented first, in that order, and the running-task indicator SHALL follow them. The running-task indicator SHALL be presented as a pulsing ring in the host accent with an adjacent numeral, and SHALL be present whenever at least one task on the board is running, including when exactly one task is running. The numeral SHALL be the number of running tasks, counting each task once regardless of how many agents, subagents, jobs, or schedules it owns. A task SHALL count as running while it has a running agent turn, an owned subagent still running after the turn ends, or unsettled background work such as jobs or schedules. The numeral SHALL be legible in the host's light and dark appearances, SHALL use tabular figures so the board label does not shift as the count changes, and SHALL remain visible without animation when the host prefers reduced motion. Hovering the indicator SHALL expose the titles of the running tasks. The board tab's accessible name SHALL include the running-task count. The unread, awaiting-reply, and failure indicators SHALL coexist with the running-task indicator. The running-task indicator SHALL communicate both the presence and the number of running tasks rather than a static status color alone. The running count SHALL clear when no task on the board is running. Attention on a board that is not active SHALL remain visible on its tab.

#### Scenario: Aggregate unread activity on the board tab
- **WHEN** a task on a board has unread activity
- **THEN** that board's tab presents an unread indicator

#### Scenario: Aggregate awaiting reply on the board tab
- **WHEN** a task on a board is awaiting the user's reply
- **THEN** that board's tab presents an awaiting-reply indicator

#### Scenario: Aggregate execution on the board tab
- **WHEN** two tasks on the same board are running
- **THEN** that board's tab presents a running-task indicator
- **AND** its numeral is 2

#### Scenario: Count a task once
- **WHEN** a task has a running agent turn and also owns unsettled jobs
- **THEN** that task contributes 1 to the board's running-task count

#### Scenario: Keep counting an owned subagent
- **WHEN** a task's assistant turn ends while an owned subagent descendant is still running
- **THEN** that task still contributes 1 to the board's running-task count

#### Scenario: Count background work without an agent
- **WHEN** a task on the board owns only unsettled background work and no agent is running
- **THEN** that task contributes 1 to the board's running-task count

#### Scenario: Order the running count after the attention indicators
- **WHEN** a board tab presents unread, awaiting-reply, and failure indicators together with running tasks
- **THEN** the unread, awaiting-reply, and failure indicators appear first, in that order
- **AND** the running-task indicator appears after them

#### Scenario: Expose the running task titles on hover
- **WHEN** the user hovers the running-task indicator on a board tab
- **THEN** the exposed detail lists the titles of the running tasks on that board

#### Scenario: Announce the running count to assistive technology
- **WHEN** a board tab carries a running-task indicator numbered 2
- **THEN** the tab's accessible name includes that there are 2 running tasks

#### Scenario: Keep the ring visible without animation
- **WHEN** the host prefers reduced motion and a board has running tasks
- **THEN** the running-task indicator remains visible without animation

#### Scenario: Clear the board indicator
- **WHEN** no task on the board has unread activity, is awaiting a reply, has failed, has a running agent, has an owned subagent, or owns unsettled background work
- **THEN** the board tab presents no attention or running-task indicator

#### Scenario: Keep every attention indicator alongside the count
- **WHEN** a task on the board has unread activity, an awaiting reply, or a failure in addition to running tasks
- **THEN** the board tab presents the corresponding attention indicators together with the running-task indicator

#### Scenario: Show attention for an inactive board
- **WHEN** a task on a board in the active Hub gains unread activity, awaits a reply, or starts running while another board is active
- **THEN** the inactive board's tab presents the corresponding indicator
