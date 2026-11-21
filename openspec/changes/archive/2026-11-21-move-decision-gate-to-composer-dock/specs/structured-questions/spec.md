# Spec Delta

## MODIFIED Requirements

### Requirement: Fixed question panel above the composer

The active question round SHALL be presented in a panel docked directly above the message composer, in the host input-dock strip, and that panel SHALL remain in place while the conversation transcript scrolls. The panel SHALL show a header bar with the round title, a progress indicator, and a collapse toggle, and SHALL be expanded by default.

In its normal presentation the panel's height SHALL be bounded by the height its composer seat can spare inside the conversation's scrolling body, so the panel, the message composer, and every other entry waiting in the same seat fit inside that body together. The bound SHALL be measured from the conversation rather than from the browser window, so an embedded conversation and a growing draft both reduce it. While the bound can hold the panel's fixed controls, the header bar and the footer actions SHALL stay outside the panel's scrolling body and only the body's content SHALL scroll. In the fallbacks below that guarantee is replaced by reachability. When the bound can hold the header bar but not every fixed control, the panel SHALL keep its header bar as its entry point and SHALL scroll as a whole, so its navigation, submit, and dismiss actions remain reachable. When the seat cannot hold even the header bars beside the composer, the panel SHALL be presented above the conversation, scrolling as a whole and leaving the composer reachable again once the panel is collapsed. When the visible conversation is too shallow to present two usable panels, each panel SHALL be presented as a compact launcher and only one SHALL be open at a time, opening the launcher the person chooses. A launcher's header SHALL report whether its body is visible, moving focus alone SHALL NOT open it, and activating a launcher SHALL select and open it in one action, even one the person had collapsed before. Only the disclosure button SHALL be treated as an activation: every other control that stays visible on an inactive launcher, such as the countdown cancel action, SHALL keep working. Reopening the conversation SHALL open a visible launcher again instead of remembering a closed one, and leaving the launcher presentation SHALL keep the panel's disclosure state. A short window SHALL therefore never hide a control permanently: it decides only whether that control is visible at once or reachable by scrolling the panel.

The answer-file controls SHALL stay reachable at every height. In the normal presentation the attach action and the footer actions stay outside the panel's scrolling body, and a list of attached files scrolls inside a bounded row of its own instead of growing the footer until the actions are clipped. In the fallbacks every action remains reachable: the head of the panel keeps the entry point, and the panel scrolls as a whole so the file row and the footer can be brought into view.

#### Scenario: Answer while the conversation scrolls

- **WHEN** an unanswered round is displayed and the user scrolls the transcript
- **THEN** the panel remains docked above the composer showing the active slide

#### Scenario: Collapse to the bar

- **WHEN** the user activates the collapse toggle
- **THEN** the panel body is hidden and only the header bar remains above the composer

#### Scenario: Expanded by default

- **WHEN** a new unanswered round appears
- **THEN** the panel body is shown without an additional action

#### Scenario: Bound the panel in a short window

- **WHEN** the viewport is shorter than the round's content
- **THEN** the panel's height stays within its bound
- **AND** the header bar, the progress indicator, and the collapse toggle remain visible
- **AND** the panel's actions remain reachable

#### Scenario: Scroll the body instead of growing the panel

- **WHEN** the round's content exceeds the panel's bound
- **THEN** the panel does not grow past the bound
- **AND** the body scrolls inside the panel

#### Scenario: Keep the actions reachable when the controls cannot fit

- **WHEN** the conversation can hold the header bars but not the panels' full fixed controls
- **THEN** each panel keeps its header bar above the composer
- **AND** the panel scrolls as a whole so its navigation, submit, and dismiss actions remain reachable

#### Scenario: Present the panel above the conversation when the seat cannot hold it

- **WHEN** the conversation cannot hold even the header bars beside the message composer
- **THEN** the panel is presented above the conversation
- **AND** the panel scrolls as a whole
- **AND** collapsing the panel leaves the composer reachable again

#### Scenario: Keep the footer actions reachable with many answer files

- **WHEN** the round carries more answer files than fit in one row at a short height
- **THEN** the list of files scrolls inside its own bounded region
- **AND** the attach, navigation, dismiss, and submit actions remain reachable outside it
