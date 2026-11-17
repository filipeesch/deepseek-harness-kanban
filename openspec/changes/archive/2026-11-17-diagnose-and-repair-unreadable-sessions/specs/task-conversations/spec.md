# Spec Delta

## MODIFIED Requirements

### Requirement: Immediate native conversation opening

Opening a task conversation SHALL present the host's native conversation window without waiting for a Session-catalog refresh or for history opening to settle. The drawer SHALL acquire the native Session and present the hosted window and the conversation close action immediately; history settling SHALL be presented through the host window's native settling state rather than a plugin-owned blocking placeholder. A Session-catalog refresh SHALL be attempted only when the requested Session is unknown to the client catalog, and SHALL be attempted at most once per opening attempt before a failure is reported. A failed history or session opening SHALL be reported by the drawer with the close action available, presenting the diagnosis defined by `session-diagnostics`, and the drawer SHALL NOT present a plugin-owned message that instructs the person to close and reopen the conversation as a remedy.

#### Scenario: Open a conversation that is already open in DSH

- **WHEN** a user opens a task conversation whose native Session is already open in the DSH main panel
- **THEN** the drawer presents the hosted conversation window immediately
- **AND** it does not acquire the session through a Session-catalog refresh
- **AND** it does not make the history wait again before presenting the conversation

#### Scenario: Open a conversation that is not open anywhere

- **WHEN** a user opens a task conversation that no DSH surface has open
- **THEN** the drawer presents the hosted window and the host's native settling state immediately
- **AND** the transcript is presented when history settles
- **AND** the conversation tab and close action remain available while history settles

#### Scenario: Open a Session missing from the client catalog

- **WHEN** a requested task Session is unknown to the client catalog
- **THEN** the drawer refreshes the catalog once and acquires the Session
- **AND** it presents the hosted conversation window instead of an indefinite placeholder
- **AND** if the Session still cannot be acquired, the failure is reported without trapping the conversation tab

#### Scenario: Close a conversation whose history failed

- **WHEN** the native conversation reports that its history could not open
- **THEN** the drawer presents the diagnosis defined by `session-diagnostics` in the conversation area
- **AND** it does not replace that diagnosis with a plugin-owned instruction to close and reopen the conversation
- **AND** the conversation's close action remains available in its tab
