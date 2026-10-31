# Spec Delta

## ADDED Requirements

### Requirement: Immediate native conversation opening
Opening a task conversation SHALL present the host's native conversation surface without waiting for a Session-catalog refresh or for history opening to settle. The drawer SHALL acquire the native Session and present the native session header, the conversation region, and the conversation close action immediately; history settling and open failures SHALL be presented through the host's native conversation states rather than a plugin-owned blocking placeholder. A Session-catalog refresh SHALL be attempted only when the requested Session is unknown to the client catalog, and SHALL be attempted at most once per opening attempt before a failure is reported. The close action SHALL remain reachable while the native conversation body is settling or has failed to open.

#### Scenario: Open a conversation that is already open in DSH
- **WHEN** a user opens a task conversation whose native Session is already open in the DSH main panel
- **THEN** the drawer presents the native session header and conversation content immediately
- **AND** it does not acquire the session through a Session-catalog refresh
- **AND** it does not make the history wait again before presenting the conversation

#### Scenario: Open a conversation that is not open anywhere
- **WHEN** a user opens a task conversation that no DSH surface has open
- **THEN** the drawer presents the native session header and the host's native settling state immediately
- **AND** the transcript is presented when history settles
- **AND** the conversation tab and close action remain available while history settles

#### Scenario: Open a Session missing from the client catalog
- **WHEN** a requested task Session is unknown to the client catalog
- **THEN** the drawer refreshes the catalog once and acquires the Session
- **AND** it presents the native conversation surface instead of an indefinite placeholder
- **AND** if the Session still cannot be acquired, the failure is reported without trapping the conversation tab

#### Scenario: Close a conversation whose history failed
- **WHEN** the native conversation reports that its history could not open
- **THEN** the host's native failure state is presented in the drawer
- **AND** the conversation's close action remains available

### Requirement: Warm conversation surfaces within the open task drawer
While a task drawer remains mounted, a conversation tab that has been opened SHALL remain retained when the user switches conversation tabs or moves between the Conversations, Info, Git, and Notes sections. Returning to a visited conversation within that drawer SHALL present the same native Session and its already-open history without re-opening the Session or downloading its history again. Warm retention SHALL start lazily at each conversation's first visit; a tab that was never opened SHALL NOT open its Session in the background. Closing the task drawer or closing the conversation tab SHALL release that retained conversation. Warm retention SHALL NOT acknowledge a settled turn for a conversation whose content is not visible, and leaving the Conversations section SHALL still clear a subagent peek as defined by In-drawer subagent conversation peek.

#### Scenario: Return to a visited conversation tab
- **WHEN** the user switches from one task conversation tab to another and then back to the first
- **THEN** the first tab presents the same native Session and its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Return from another drawer section
- **WHEN** the user opens a task conversation, moves to Info, Git, or Notes, and returns to Conversations
- **THEN** the previously active conversation is presented with its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Warm lazily on first visit
- **WHEN** a task has several open conversation tabs and the user has visited only one of them
- **THEN** only the visited conversation is retained while the drawer remains mounted
- **AND** an unvisited tab opens its Session when the user selects it

#### Scenario: Release on drawer close
- **WHEN** the user closes the task drawer and later reopens the task
- **THEN** the task still provides its existing conversation sessions and histories
- **AND** the conversations are acquired again for the reopened drawer

#### Scenario: Release on tab close
- **WHEN** the user closes a visited conversation tab and later reopens it from the closed-conversation list
- **THEN** the reopened conversation keeps the same native Session identity and history
- **AND** its content is acquired again when it becomes active

#### Scenario: Keep an unread turn while warm but not visible
- **WHEN** a retained conversation is not visible because another drawer section is open and its turn settles
- **THEN** the conversation's unread or failure indicator remains
- **AND** the hidden content does not acknowledge the settled turn

#### Scenario: Leaving Conversations still clears a peek
- **WHEN** a subagent conversation is being peeked and the user moves from Conversations to another drawer section
- **THEN** the next Conversations view starts from the active root conversation
- **AND** the peeked child is not reopened

## MODIFIED Requirements

### Requirement: Continuous sessions retain separate histories
Each conversation tab SHALL represent a continuous native DSH session with its own retained identity and history. Switching between task conversation tabs or reopening the task drawer SHALL return to those existing sessions instead of replacing them with newly created sessions. Within a mounted task drawer, returning to a conversation that was already visited SHALL reuse its already-open native Session without opening it or downloading its history again.

#### Scenario: Return to a previous conversation tab
- **WHEN** a user switches from one task conversation tab to another and then returns
- **THEN** the original tab still represents the same session with its prior messages

#### Scenario: Reopen a task containing multiple conversations
- **WHEN** a user closes and later reopens a task drawer containing multiple conversations
- **THEN** the task still provides its existing conversation sessions and their histories

#### Scenario: Reuse a warm conversation without reopening it
- **WHEN** a user returns to a conversation tab that was already visited while the same task drawer stayed open
- **THEN** the tab still represents the same session with its prior messages
- **AND** the conversation is not opened again from its history before it is presented

### Requirement: Conversation tab attention indicators
Each open conversation tab in the Conversations section SHALL present that conversation's blue unread, orange awaiting-reply, and red failure indicators, with the same meaning as the attention indicators defined by Coexisting attention indicators across task conversations in `kanban-board`. The indicators SHALL be scoped per conversation so a task with several conversations shows which conversation is pending, SHALL update live while the drawer is open, and SHALL be available to assistive technology as part of the tab's accessible name. Updates SHALL reflect the final state after a burst of activity, including while many conversations run concurrently; a bounded coalescing delay of no more than a few hundred milliseconds is permitted, and no update may be dropped. Closed-conversation entries SHALL NOT present attention indicators.

#### Scenario: Show which conversation is pending
- **WHEN** a task has several open conversation tabs with different attention states
- **THEN** each tab presents its own conversation's attention indicators
- **AND** a tab without attention presents none

#### Scenario: Update the tab live
- **WHEN** an open conversation gains an unread, awaiting-reply, or failure state while the drawer is open
- **THEN** its tab presents the corresponding indicator without a reload

#### Scenario: Present the final state after a burst
- **WHEN** several conversations change attention state in quick succession while the drawer is open
- **THEN** every affected tab eventually presents that conversation's final attention state without a reload
- **AND** a bounded delay before the final state is presented is acceptable

#### Scenario: Clear the read indicators on the viewed tab
- **WHEN** the active conversation is read and its blue and red indicators clear
- **THEN** its tab stops presenting those indicators
- **AND** the other conversation tabs keep their own indicators

#### Scenario: Expose the indicators to assistive technology
- **WHEN** assistive technology reads a conversation tab with pending attention
- **THEN** the tab's accessible name includes the applicable unread, awaiting-reply, or failure states

#### Scenario: Closed entries show no indicators
- **WHEN** a conversation tab is closed, including one whose turn settles after the close
- **THEN** its closed-conversation entry presents no attention indicators
