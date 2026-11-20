# Spec Delta

## MODIFIED Requirements

### Requirement: Recorded relations between cards

The Hub SHALL store relations as a collection of typed edges beside its tasks and notes. A relation SHALL carry its own identifier, a type, a source task identifier, and a target task identifier. The stored relation collection SHALL be local to the installation and SHALL NOT enter anything the plugin publishes to team storage.

This version SHALL support two types. `epic` SHALL be directed: the source task is the epic and the target task belongs to it. `related` SHALL be symmetric: it records an association with no direction and SHALL be stored once, with its endpoints in a canonical order, so reading either endpoint reports the same relation and a second relation between the same pair in reverse order is not created.

Cardinality SHALL be many-to-many. A task MAY be the epic of any number of tasks and MAY belong to more than one epic, and a task MAY carry any number of relations of either type. Epic nesting SHALL be allowed: a task that belongs to an epic MAY itself be the epic of other tasks.

Every relation SHALL have both endpoints in the Hub that stores it, and SHALL NOT have one task as both endpoints. A requested relation that violates either rule SHALL be rejected with an actionable problem and SHALL NOT be stored.

Epic relations SHALL NOT form a cycle. A requested epic relation that would make a task its own ancestor, directly or through other epic relations, SHALL be rejected with an actionable problem naming the tasks involved, and SHALL NOT be stored.

Removing a task from its Hub SHALL remove, in the same mutation, every relation in which that task is the source or the target, and SHALL remove the task shared notes with it. Every path that removes a task SHALL apply that same cascade: the interface deletion, the background destructive execution the confirmed deletion command admits, and any direct aggregate delete. A stored relation whose endpoint task is absent from the Hub SHALL be invalid state, rejected by the Hub own validation, rather than tolerated data that reads must filter.

#### Scenario: Record an epic relation

- **WHEN** an agent creates an `epic` relation from one card to another card of the same Hub
- **THEN** the relation is stored with its own identifier and both endpoints
- **AND** reading the source card reports it as an outgoing relation and reading the target card reports it as an incoming relation

#### Scenario: Store a symmetric relation once

- **WHEN** an agent creates a `related` relation between two cards and later creates the reverse pair
- **THEN** one relation exists between the pair
- **AND** reading either card reports it with the other card as the endpoint

#### Scenario: Allow many epic relations per card

- **WHEN** a card belongs to two epics and is the epic of three other cards
- **THEN** every relation is stored
- **AND** reading the card reports both incoming and outgoing relations

#### Scenario: Allow an epic to belong to another epic

- **WHEN** an agent creates an epic relation from a card that already belongs to an epic to another card
- **THEN** the relation is stored
- **AND** both relations remain readable

#### Scenario: Reject a target outside the Hub

- **WHEN** an agent creates a relation whose target task belongs to a different Hub or does not exist
- **THEN** the relation is not stored
- **AND** the tool reports an actionable problem

#### Scenario: Reject a self relation

- **WHEN** an agent creates a relation whose source and target are the same task
- **THEN** the relation is not stored
- **AND** the tool reports an actionable problem

#### Scenario: Reject an epic cycle

- **WHEN** an epic relation would make a task its own ancestor through existing epic relations
- **THEN** the relation is not stored
- **AND** the tool reports an actionable problem naming the tasks involved

#### Scenario: Remove incident relations with the task

- **WHEN** a task that has relations is deleted
- **THEN** every relation in which that task is an endpoint is removed
- **AND** every other relation remains readable

#### Scenario: Remove incident relations through every deletion path

- **WHEN** a card that takes part in a relation between cards is deleted from the task drawer, from the board bulk selection, or by an agent through the card deletion tool
- **THEN** the deletion succeeds and removes that card incident relations in the same mutation
- **AND** the Hub remains valid state, and no deletion fails because a relation would have outlived its endpoint

#### Scenario: Never publish relations

- **WHEN** a Hub bound to a team storage publishes its boards
- **THEN** no relation enters the published layout
