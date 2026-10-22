# Spec Delta

## ADDED Requirements

### Requirement: Host-themed board controls
The board SHALL follow the host application's light and dark appearance for its primary actions, focus indicators, and selection accents. Enabled primary actions SHALL use host theme colors for their fill, foreground, and hover state in both appearances. Primary-action text SHALL maintain at least 4.5:1 contrast against its fill at rest and on hover. The board SHALL NOT use the browser's selection highlight color as a product fill or accent.

#### Scenario: Primary action in the dark appearance
- **WHEN** the host application uses its dark appearance
- **THEN** enabled primary actions use the host dark theme fill and foreground
- **AND** the fill and foreground remain at least 4.5:1 contrast at rest and on hover

#### Scenario: Primary action in the light appearance
- **WHEN** the host application uses its light appearance
- **THEN** enabled primary actions use the host light theme fill and foreground
- **AND** the fill and foreground remain at least 4.5:1 contrast at rest and on hover

#### Scenario: Focus and selection accents
- **WHEN** a board control has keyboard focus, a tab is selected, a card is selected, or a drag shows its drop indicator
- **THEN** the indicator uses the host accent or focus color
- **AND** it remains distinguishable in both appearances

#### Scenario: No browser selection palette
- **WHEN** the board renders in either appearance
- **THEN** primary-action fills and board accents do not use the browser selection highlight color or its matching foreground color
