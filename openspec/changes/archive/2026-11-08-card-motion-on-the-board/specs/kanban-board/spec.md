# Spec Delta

## ADDED Requirements

### Requirement: Animated card movement on the board

The active board SHALL animate card movement. When a card's stage or position changes, that card SHALL move from its previous presented position to its new one, and every other card whose position changes SHALL move to its own new position, so a rearrangement reads as one continuous movement instead of a jump. The animation SHALL cover a change of stage and a reorder within the same stage, and SHALL apply regardless of what caused the change: a board drag and drop, the task drawer's stage control, a confirmed restricted move, an automatic advance, a team-sync update, or a task deletion.

A card that newly appears on the board SHALL enter with a brief fade. A card that leaves SHALL fade out as a non-interactive representation that neither delays its removal from the board nor extends the board's scrollable area. A change that only alters a card's size, such as a status line appearing, SHALL settle immediately without motion.

The board SHALL settle card changes immediately, without motion, whenever the presented view is replaced: changing Hub, changing board, or changing the text search or the project filter. The board SHALL also settle immediately when one presentation change makes more than eight cards enter or leave the board at once, so a bulk change never launches a large cascade. Cards that stay on the board and only change position SHALL NOT count toward that limit.

When the user prefers reduced motion, the board SHALL change card positions, entries, and exits without motion while keeping every card and its content unchanged and reachable.

Motion SHALL NOT change board data, commands, card content, the drag-and-drop contract, the board frame's position or height, focus, or click activation. A card SHALL remain activatable, focusable, and draggable while it is moving. Motion SHALL NOT extend the board's scrollable area and SHALL leave no interactive remnant once it completes.

#### Scenario: Move a card between stages

- **WHEN** the user drops a card on a permitted stage
- **THEN** the card moves from its previous position to the dropped position with motion
- **AND** the cards that made room for it move to their new positions with motion
- **AND** the board presents the task in the destination stage

#### Scenario: Reorder within the current stage

- **WHEN** the user drops a card at a new position inside its current stage
- **THEN** the card and the cards whose position changes move to their new positions with motion

#### Scenario: Move a card from the drawer

- **WHEN** the user changes a card's stage from the open task drawer's stage control
- **THEN** the card moves to the top of the destination stage with motion
- **AND** the cards below it move to their new positions with motion
- **AND** the drawer stays open and keeps its position

#### Scenario: An automatic advance moves a card

- **WHEN** an automatic advance moves a card while the user is not interacting with the board
- **THEN** the card and the affected cards move to their new positions with motion

#### Scenario: A team-sync update moves a card

- **WHEN** an accepted team update changes a card's stage or position
- **THEN** the card and the affected cards move to their new positions with motion

#### Scenario: A new card enters

- **WHEN** a task appears on the active board, including a task the user just created
- **THEN** its card enters with a brief fade
- **AND** the cards that make room for it move to their new positions with motion

#### Scenario: A removed card leaves

- **WHEN** a card leaves the active board, including through deletion
- **THEN** its card fades out without delaying its removal from the board
- **AND** the remaining cards move to their new positions with motion
- **AND** the fading card does not accept interaction and does not extend the board's scrollable area

#### Scenario: A size-only change settles immediately

- **WHEN** a card grows or shrinks without changing the membership or order of any list
- **THEN** the cards that shift because of that size change settle to their new positions without motion

#### Scenario: Replace the presented view

- **WHEN** the user changes Hub, changes board, changes the text search, or changes the project filter
- **THEN** the cards that remain, appear, or disappear settle immediately without motion

#### Scenario: Settle a large batch

- **WHEN** one presentation change makes more than eight cards enter or leave the board
- **THEN** the affected cards settle immediately without motion

#### Scenario: Move a card in a long stage

- **WHEN** the user moves a card inside or between stages that already present more than eight cards
- **THEN** the card and every card whose position changes move to their new positions with motion

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** cards change position, enter, and leave without motion
- **AND** every card's content, activation, and drag behavior are unchanged

#### Scenario: Keep interaction available during motion

- **WHEN** the user activates, focuses, or starts dragging a card while cards are moving
- **THEN** the card responds with its normal activation, focus, and drag behavior
- **AND** the board frame does not change position or height because of the motion

#### Scenario: Motion changes no board data

- **WHEN** the board animates any card movement
- **THEN** no command is sent and no board data changes because of the motion
- **AND** the presented positions match the board state the client already holds
