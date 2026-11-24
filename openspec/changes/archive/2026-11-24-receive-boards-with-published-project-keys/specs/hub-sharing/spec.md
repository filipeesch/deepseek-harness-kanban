# Spec Delta

## ADDED Requirements

### Requirement: Receive a board whose scope names unknown project identities

A team board SHALL be applied even when its project scope names published identities the receiving Hub does not hold. Applying SHALL create a published placeholder for each such identity in the same transaction that stores the board and its scope, so the board lands and its workflow is readable. Applying SHALL NOT refuse, fail, or skip a board because of an unknown project identity, and one board's unknown identities SHALL NOT affect the application of another board.

An identity the receiving installation ignored SHALL stay represented by its hidden placeholder and SHALL NOT be presented for adoption again, and it SHALL NOT make that board a draft: the applied scope and the board scope keep naming the same identities. When an update finishes applying its boards, a placeholder that no board of the Hub names any more SHALL be removed from the project registry; one board's new scope SHALL NOT remove an identity a later board of the same update names, so the outcome does not depend on the order the boards are applied.

The published layout SHALL NOT change for this behavior: a board's log keeps carrying published identities as identifiers only, and the receiving installation keeps resolving them locally.

#### Scenario: Apply a board whose scope names projects this Hub lacks
- **WHEN** a team board whose scope names two identities the receiving Hub does not hold is applied
- **THEN** the board exists locally carrying the team's workflow
- **AND** the Hub holds a placeholder for each of the two identities
- **AND** the board is presented as up to date rather than failed

#### Scenario: One board's unknown identities do not block another board
- **WHEN** two boards of the same storage are applied and one names an unknown identity
- **THEN** both boards are applied
- **AND** no board is reported as failed because of a project identity

#### Scenario: Keep an ignored identity out of adoption
- **WHEN** a board whose scope names an ignored identity is applied
- **THEN** the board is applied and names that identity
- **AND** the identity is not presented for adoption
- **AND** the board is not presented as a draft

#### Scenario: Prune a placeholder the team stopped naming
- **WHEN** an update's boards finish applying and a scope drops an identity whose placeholder no board of the Hub names any more
- **THEN** that placeholder is removed from the registry
- **AND** that removal is not recorded as an ignore

#### Scenario: Move an identity between boards in one update
- **WHEN** one update drops an identity from one board's scope and names it in another board's scope
- **THEN** the placeholder survives, whatever order the boards are applied in
- **AND** an ignore recorded for that identity is kept
