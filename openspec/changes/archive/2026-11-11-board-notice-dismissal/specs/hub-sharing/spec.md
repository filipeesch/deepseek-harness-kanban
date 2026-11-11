# Spec Delta

## ADDED Requirements

### Requirement: Dismissible team-changes banner

The board banner that reports available team changes or a required review SHALL be dismissible for the active Hub. Dismissing it SHALL NOT apply, receive, publish, or discard any change, SHALL NOT clear a Hub tab or board tab state indicator, SHALL NOT change the Hub's publishing state, and SHALL leave **Review team changes** available from the Hub tab indicators and Team Settings.

The dismissal SHALL belong to the current page session for that Hub. It SHALL NOT be stored on the host, SHALL NOT be sent to the team, and SHALL NOT be published. The banner SHALL be presented again when the Hub's pending team state changes — the available updates, the conflicts, or the blocking boards — and SHALL NOT be presented while that state is unchanged. A reload SHALL present the banner again while the state that caused it remains.

#### Scenario: Dismiss the team-changes banner

- **WHEN** the board presents the team-changes banner and the user activates its dismiss control
- **THEN** the banner is removed from the board
- **AND** the Hub tab and board tab state indicators are unchanged
- **AND** Team Settings still presents the team changes and the action that applies them

#### Scenario: Dismissal resolves nothing

- **WHEN** the user dismisses the team-changes banner
- **THEN** no change is applied, published, received, or discarded
- **AND** the Hub's pending state remains available on its own surfaces

#### Scenario: A new team change restores the banner

- **WHEN** the user dismissed the banner and the Hub's available updates, conflicts, or blocking boards then change
- **THEN** the board presents the banner again

#### Scenario: An unchanged state does not restore the banner

- **WHEN** the user dismissed the banner and the Hub's pending team state does not change
- **THEN** the board does not present the banner again during that page session

#### Scenario: A reload restores the banner

- **WHEN** the user dismissed the banner and reloads the page while the Hub's pending team state is unchanged
- **THEN** the board presents the banner again
