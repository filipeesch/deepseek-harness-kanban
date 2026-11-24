# Spec Delta

## REMOVED Requirements

### Requirement: Align an imported project scope with the destination Hub
**Reason**: Filtering an imported scope discarded the project the exporting installation had chosen and silently opened a restricted board to every project of the destination Hub. The imported document is now aligned by receiving its identities as published placeholders, so the scope survives the trip.
**Migration**: Read and apply an import through the receiving rule: every identity the document names resolves to the project that already carries it or to a placeholder created for it, and an identity the installation ignored stays out of the adoption list without leaving the scope.

## ADDED Requirements

### Requirement: Receive an imported project scope by its published identities

An imported board's project scope SHALL be received by its published identities. An identity the destination Hub does not hold SHALL become a published placeholder in the project registry, exactly as a received team board does, and the read of the document SHALL name each identity that will await adoption once, even when the document repeats it. An identity the destination Hub already holds SHALL keep the project it already names. An identity the destination installation ignored SHALL stay out of the presented adoption list while keeping its entry in the imported scope. A board entry with no recorded scope SHALL continue to accept every project of the destination Hub. Import SHALL NOT drop an identity from an imported scope, and SHALL NOT open a restricted scope.

#### Scenario: Receive an unknown identity instead of dropping it
- **WHEN** an imported board's scope names one identity the destination Hub holds and one it does not
- **THEN** the board keeps both identities
- **AND** the destination Hub holds a placeholder for the unknown identity
- **AND** the read names that identity as awaiting adoption

#### Scenario: Keep the identity the Hub already holds
- **WHEN** an imported board's scope names an identity a project of the destination Hub carries
- **THEN** the board keeps that identity
- **AND** no placeholder is created for it

#### Scenario: Report the identities awaiting adoption
- **WHEN** the person reads an import document whose boards name identities the Hub does not hold
- **THEN** the surface names each identity awaiting adoption and the board that names it
- **AND** the import stays available

#### Scenario: Keep an ignored identity out of the adoption list
- **WHEN** an imported board's scope names an identity the destination installation ignored
- **THEN** the identity stays in the imported scope
- **AND** it is not presented for adoption
- **AND** no second placeholder is created for it

#### Scenario: Import a board with no recorded scope
- **WHEN** an imported board carries no project scope
- **THEN** the board accepts every project of the destination Hub
