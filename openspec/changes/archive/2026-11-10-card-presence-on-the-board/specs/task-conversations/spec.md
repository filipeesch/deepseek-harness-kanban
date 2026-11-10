# Spec Delta

## MODIFIED Requirements

### Requirement: Conversation attention acknowledgment
The drawer SHALL acknowledge a conversation's last settled assistant turn when the conversation's native content is mounted in the Conversations section and the page is visible, and when the conversation's tab is closed. While the content remains mounted and the page visible, a turn that settles SHALL be acknowledged when it settles. The active board's mark-all-read action defined by Board-wide mark all as read in `kanban-board` SHALL also acknowledge the last settled turn of every conversation of every task on that board, without displaying those conversations. Acknowledgment SHALL be per conversation, SHALL NOT acknowledge another conversation of the same task unless the board's mark-all-read action requests it, and SHALL persist across reloads and plugin restarts. Closing a tab SHALL acknowledge only the turn settled at the moment of closing; a turn that settles after the close SHALL remain unread at the task level. Content that is not visible SHALL NOT acknowledge a turn that settles while it is not being read.

#### Scenario: Acknowledge the viewed conversation

- **WHEN** a conversation with an unread or failed settled turn is displayed in the Conversations section
- **THEN** that conversation's blue and red indicators clear
- **AND** the acknowledgment persists after a reload

#### Scenario: Keep the other conversations unread

- **WHEN** two conversations have unread settled turns and only one is displayed
- **THEN** only the displayed conversation is acknowledged
- **AND** the other conversation stays unread

#### Scenario: A settle while watching is acknowledged

- **WHEN** a turn settles while its conversation content is mounted and the page is visible
- **THEN** the conversation does not present unread or failure indicators for that turn

#### Scenario: Do not acknowledge while the page is hidden

- **WHEN** the page is hidden while the conversation content is mounted and a turn settles
- **THEN** the conversation presents its unread or failure indicator until the page becomes visible again

#### Scenario: Close acknowledges the current settled turn

- **WHEN** the user closes a conversation tab
- **THEN** that conversation's last settled turn is acknowledged

#### Scenario: A turn after the close stays unread

- **WHEN** a closed conversation settles another turn after its tab was closed
- **THEN** the task-level attention presents that turn as unread or failed
- **AND** the closed-conversation entry presents no attention indicators

#### Scenario: Acknowledge a whole board without reading it

- **WHEN** the board's mark-all-read action acknowledges every conversation of every task on the active board
- **THEN** each of those conversations records the sequence of its own last settled turn
- **AND** the acknowledgment persists after a reload even though none of those conversations was displayed

#### Scenario: A board acknowledgment leaves other boards untouched

- **WHEN** the mark-all-read action acknowledges one board
- **THEN** conversations of tasks on other boards keep their recorded acknowledgment
- **AND** their indicators do not change
