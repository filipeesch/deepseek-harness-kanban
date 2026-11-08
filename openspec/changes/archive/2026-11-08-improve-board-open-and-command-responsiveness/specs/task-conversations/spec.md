# Spec Delta

## ADDED Requirements

### Requirement: Attention indicators fill after the drawer's first paint

The drawer SHALL present the conversation tabs and the selected conversation without waiting for every conversation of the task to resolve its attention facts. A tab whose conversation facts are still resolving MAY present no indicator until they resolve. The conversations of the task whose drawer is open SHALL be resolved before unrelated historical conversations. Indicators SHALL appear without a reload, and the final state of a burst of activity SHALL NOT be dropped. Acknowledgment and read behavior SHALL be unchanged.

#### Scenario: Drawer first, indicators later

- **WHEN** the user opens a task drawer while its conversations' attention facts are still resolving
- **THEN** the conversation tabs and the selected conversation are presented
- **AND** each tab presents its indicators as its facts resolve, without a reload

#### Scenario: Prioritize the open task's conversations

- **WHEN** the open task's conversations and other tasks' historical conversations are both unresolved
- **THEN** the open task's conversations are resolved first

#### Scenario: A late indicator does not acknowledge a turn

- **WHEN** a tab presents its unread or failure indicator after the drawer's first paint
- **THEN** presenting that indicator does not itself acknowledge the conversation's settled turn
- **AND** the turn remains unread or failed until the conversation is displayed as defined by Conversation attention acknowledgment

#### Scenario: Keep the final state after a burst

- **WHEN** several conversations of the open task change attention in quick succession
- **THEN** every affected tab eventually presents that conversation's final attention state without a reload
