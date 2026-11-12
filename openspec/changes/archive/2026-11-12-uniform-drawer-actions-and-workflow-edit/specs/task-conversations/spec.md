## ADDED Requirements

### Requirement: Consistent task drawer header actions

The task drawer header SHALL present its advance, Auto, delete, and close actions with consistently sized and aligned icons and consistent spacing between adjacent controls. Icon-only actions SHALL have matching interactive dimensions. The Auto action SHALL retain its text label, state indication, accessible name, tooltip, and behavior. Actions SHALL retain their existing availability, accessible names, tooltips, and keyboard operation. The header SHALL continue to wrap without hiding controls at supported narrow widths. The embedded native conversation header SHALL NOT be changed by this requirement.

#### Scenario: Inspect the header actions
- **WHEN** the drawer presents its header actions
- **THEN** their icons are consistently sized and aligned, and adjacent controls are consistently spaced
- **AND** icon-only actions have matching interactive dimensions
- **AND** Auto retains its text and state indication

#### Scenario: Use a narrow drawer
- **WHEN** the drawer is too narrow for a single header row
- **THEN** the header wraps without hiding actions or overflowing
- **AND** the actions remain keyboard operable with their accessible names and tooltips
