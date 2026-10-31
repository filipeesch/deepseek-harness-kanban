# Spec Delta

## MODIFIED Requirements

### Requirement: Execution activity is independent of workflow and attention
The board SHALL represent task execution state independently of the task's workflow stage and of its unread, awaiting-reply, and failure attention indicators. Execution state SHALL consist of two distinct facts. Agent execution SHALL mean that at least one agent owned by the task's conversations is running: a conversation's own assistant turn or an owned native subagent descendant. Background activity SHALL mean that the task owns unsettled work other than agent execution, such as jobs or schedules. Both facts SHALL aggregate across all of the task's conversations rather than only the currently selected conversation. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage. A task SHALL be presented as working while at least one owned agent is running, including when the main turn has ended and only an owned subagent descendant is still running. Work that is not agent execution and outlives the turn SHALL be presented as background activity instead.

#### Scenario: Activity in a nonselected task conversation
- **WHEN** a task conversation is executing while another task tab is selected
- **THEN** the board still represents that task's execution state

#### Scenario: Execution completion does not imply workflow completion
- **WHEN** an execution finishes in a task whose workflow stage is In Progress
- **THEN** the task remains in In Progress unless a separate stage change is requested

#### Scenario: Subagent work after the main turn ends
- **WHEN** an assistant turn ends in a task while an owned subagent descendant is still running
- **THEN** the board keeps presenting the task as working
- **AND** the running subagent is not presented as background activity

#### Scenario: Background work after the turn ends
- **WHEN** an assistant turn ends in a task while a job or schedule is still unsettled and no owned agent is running
- **THEN** the board no longer presents the task as working
- **AND** the board presents that remaining work as background activity

#### Scenario: All execution activity settles
- **WHEN** the last owned agent and the last background activity for a task have settled
- **THEN** the board presents neither an agent execution state nor background activity for that task

### Requirement: Coexisting attention indicators across task conversations
The board SHALL derive attention per task conversation and aggregate it across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Blue and red SHALL be derived by the conversation's last settled assistant turn and its stored per-conversation read acknowledgment: unread SHALL mean that the conversation has a settled turn newer than its acknowledgment, and failure SHALL mean that the settled turn ended with an error outcome and is still unread. Blue and red SHALL NOT be presented while any agent owned by that conversation is running. The orange indicator SHALL reflect a live awaiting-reply state and SHALL NOT require acknowledgment. Attention SHALL be derived from durable conversation facts and the stored acknowledgment, SHALL survive a reload or plugin restart, and SHALL NOT depend on a per-client native unread transition. A conversation with no stored acknowledgment SHALL present its last settled turn as unread. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the agent execution and background activity presentation rather than replacing one another. Background activity SHALL present a count of the task's unsettled activities; counts are not required for the blue, orange, or red attention indicators.

#### Scenario: Attention from a nonselected conversation
- **WHEN** an unread message, awaiting-reply state, or failure is present in a task conversation that is not selected
- **THEN** the corresponding task-level attention indicator is still represented on the board

#### Scenario: Multiple attention states coexist with activity
- **WHEN** a task has unread messages, a conversation awaiting a reply, a conversation with a failure, a conversation running an owned agent, and unsettled background activity
- **THEN** blue, orange, and red attention indicators are all represented together
- **AND** the agent execution state and the background activity count are represented separately from those attention indicators

#### Scenario: Unread waits for every owned agent to finish
- **WHEN** a conversation's assistant turn ends while an owned subagent descendant is still running
- **THEN** the board does not present that conversation's settled turn as unread or failed
- **AND** the board presents the settled turn as unread once the last owned agent finishes

#### Scenario: Reading a conversation clears its indicators
- **WHEN** a conversation with an unread or failed settled turn is read in the task drawer
- **THEN** the board stops presenting that conversation's blue and red indicators
- **AND** a reload does not bring the cleared indicators back

#### Scenario: Unread survives a reload
- **WHEN** a turn settles while no conversation content is being read
- **THEN** the board presents the conversation as unread after a reload

#### Scenario: A conversation never read stays unread
- **WHEN** a conversation has a settled turn and no stored acknowledgment
- **THEN** the board presents the unread indicator for that turn

#### Scenario: A later error marks the conversation again
- **WHEN** a read conversation later settles a new turn with an error outcome
- **THEN** the board presents the failure indicator for that new settled turn

### Requirement: Truthful and self-healing turn execution state
The board SHALL stop presenting a task's agent execution when the last agent owned by its conversations finishes, without requiring another session event, a reload, or any user action. The board SHALL NOT present agent execution when no owned agent is running. When an activity update is missed or a transient read fails, the board SHALL recover the correct execution state within at most two seconds. Background activity SHALL NOT be presented as agent execution.

#### Scenario: Turn end clears the card
- **WHEN** the assistant turn of the only active task conversation ends and no owned subagent descendant is running
- **THEN** the card stops presenting the agent execution state without user action and without waiting for another session event

#### Scenario: A running subagent keeps the card working
- **WHEN** a conversation's assistant turn ends while an owned subagent descendant is still running
- **THEN** the card keeps presenting the agent execution state until that descendant finishes

#### Scenario: A missed activity update self-heals
- **WHEN** the last activity update for a conversation is missed or a transient read fails
- **THEN** the board presents the correct execution state within two seconds

#### Scenario: Background work never reads as a turn
- **WHEN** the only active work for a task is a job or schedule
- **THEN** the task is not presented as running an agent

### Requirement: Visible execution state on task cards

A task card SHALL present agent execution through a visible working indicator and a distinct card accent rather than a text label alone. The indicator SHALL remain legible in the host's light and dark appearances and SHALL follow the host theme. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping the indicator and accent visible without animation. When the task owns background activity, the card SHALL present a separate background indicator that shows the number of unsettled activities and makes their labels available on hover and to assistive technology. The background indicator SHALL be visually quieter than the working indicator, and it SHALL be present on its own when no owned agent is running. The working label SHALL be presented no larger than the background indicator's text and SHALL NOT add letter-spacing. The working and background indicators SHALL be presented in the card's activity region defined by Single-line activity strip on task cards, separate from the project name and attention indicators.

#### Scenario: Card shows a running turn
- **WHEN** a task is running an assistant turn
- **THEN** its card shows the working indicator and the card accent
- **AND** the working state is announced once to assistive technology

#### Scenario: Card shows working while a subagent runs
- **WHEN** a task's assistant turn has ended and an owned subagent descendant is still running
- **THEN** its card still shows the working indicator and the card accent
- **AND** the running subagent is not shown as background activity

#### Scenario: Card shows background work only
- **WHEN** a task has no owned agent running and still owns unsettled jobs or schedules
- **THEN** its card shows the background indicator with the activity count and no working indicator

#### Scenario: Working label matches the background indicator
- **WHEN** a card presents the working indicator next to a background indicator
- **THEN** the working label's text is no larger than the background indicator's text
- **AND** the working label does not add letter-spacing

#### Scenario: Background labels are available
- **WHEN** the user points at or focuses the background indicator
- **THEN** the labels of the task's unsettled activities are available
- **AND** the labels are exposed to assistive technology

#### Scenario: Activity is separate from identity
- **WHEN** a card presents a working indicator or a background indicator
- **THEN** those indicators are in the activity region
- **AND** the project name and attention indicators are in the context region

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the working indicator and card accent remain visible without animation

#### Scenario: Theme appearance
- **WHEN** the host application uses its light or dark appearance
- **THEN** the working and background indicators remain legible and use host theme colors
