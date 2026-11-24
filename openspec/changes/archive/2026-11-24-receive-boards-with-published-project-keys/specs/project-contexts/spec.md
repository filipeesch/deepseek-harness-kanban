# Spec Delta

## MODIFIED Requirements

### Requirement: Stable project key
Every project SHALL have a local project key that identifies it inside its Hub. The key SHALL be generated from the project name when the project is registered, SHALL be editable, and SHALL be unique within its Hub. Generating a key SHALL be scripted for a given name and existing key set, so projects registered on two installations from the same names receive the same key. A rename or a relocation of the project SHALL NOT change its key. A project MAY additionally carry a published key, which is the key this Hub's boards, the published configuration, and an exported document name it by; a project without one SHALL be named publicly by its local key. A project's published identity SHALL therefore be its published key when it carries one and its local key otherwise, and published identities SHALL be unique within a Hub. Editing a local key SHALL rewrite that key in every board scope of the same Hub in the same write only when the edit changes the project's published identity; an edit that leaves the published identity unchanged SHALL NOT change any scope. A change to a published key SHALL rewrite the previous published identity in every board scope of the same Hub in the same write, so no board is left naming an identity no project carries. A project that predates the key SHALL receive a scripted key when its Hub opens, before any board is published.

#### Scenario: Generate a key on registration
- **WHEN** the user registers a project named "Platform API"
- **THEN** the project is stored with a key derived from that name
- **AND** the key is unique within the Hub

#### Scenario: Keep the key across a rename
- **WHEN** the user renames a project that has a key
- **THEN** the project key is unchanged

#### Scenario: Keep the key across a relocation
- **WHEN** the user relocates a project that has a key
- **THEN** the project key is unchanged

#### Scenario: Edit a key used by board scopes
- **WHEN** the user changes the local key of a project that carries no published key and that boards of the same Hub reference
- **THEN** those board scopes name the new key in the same write
- **AND** no board names the previous key

#### Scenario: Keep the scopes when a linked project's local key changes
- **WHEN** the user changes the local key of a project that carries a published key
- **THEN** no board scope changes
- **AND** the project remains allowed by every board that names its published identity

#### Scenario: Rewrite the scopes when a published key changes
- **WHEN** the user links a project to a different published key and boards of the Hub name its previous published identity
- **THEN** those board scopes name the new published key in the same write
- **AND** no board names the previous published identity

#### Scenario: Reject an ambiguous key
- **WHEN** the user sets a local key that another project of the same Hub already uses
- **THEN** the key is rejected with an actionable problem
- **AND** the stored keys are unchanged

#### Scenario: Reject a published identity a registered project carries
- **WHEN** the user links a project to a published identity that another registered project of the same Hub already carries
- **THEN** the link is refused with an actionable problem
- **AND** the stored projects, board scopes, and Hub revision are unchanged

#### Scenario: Take over an identity a placeholder carries
- **WHEN** the user links a project to a published identity that a placeholder of the same Hub carries
- **THEN** the link is applied and the placeholder is removed
- **AND** the link is not refused as a conflict

#### Scenario: Key an existing project on open
- **WHEN** a Hub opens with a project stored before project keys existed
- **THEN** the project receives a scripted key that no other project of the Hub uses
- **AND** the key is recorded before the Hub is published

### Requirement: Published project placeholder
A project SHALL become a published placeholder when a received board, or an imported document, names a published identity the Hub does not hold. Its local key SHALL be that published identity, unless another project of the Hub already holds that identity as its local key while answering a different published identity; then the placeholder SHALL take a distinct scripted local key and SHALL carry the received identity as its published key, so a local key stays unique within the Hub and the received identity still resolves to one project. It SHALL carry no project path, and it SHALL be presented in the project registry as awaiting adoption together with the boards that name its identity. A placeholder SHALL NOT create a task or a worktree, SHALL NOT be offered in a task creation input, and SHALL NOT be selectable for a task. A placeholder SHALL be adoptable by supplying its project path and linkable to an already registered project; adopting SHALL keep both the local key and the published identity the board scopes name, and a save that changes either while the placeholder is being adopted SHALL be refused with an actionable problem. Removing a placeholder from the adoption list SHALL mark it ignored instead, keeping every board scope that names its identity valid. A placeholder that no board of the Hub names any more SHALL be removed from the registry, and that removal SHALL NOT be recorded as an ignore. A placeholder SHALL be removed without the project-in-use precondition that a project with tasks carries, because it cannot own tasks.

#### Scenario: Receive a scope with an unknown key
- **WHEN** a board is received whose scope names a key the Hub does not hold
- **THEN** the Hub holds a placeholder with that key
- **AND** the placeholder presents no project path
- **AND** it is presented as awaiting adoption

#### Scenario: Receive an identity another project holds as a local key
- **WHEN** a board is received whose scope names the identity "api" while another project of the Hub holds the local key "api" and answers a different published identity
- **THEN** the Hub holds a placeholder whose local key is distinct and whose published identity is "api"
- **AND** the board applies with "api" in its scope
- **AND** adopting the placeholder keeps the identity "api"

#### Scenario: Name the boards that await a key
- **WHEN** the project registry presents a placeholder
- **THEN** it names every board of the Hub whose scope names that identity

#### Scenario: Adopt a placeholder with a directory
- **WHEN** the user supplies an existing project path for a placeholder
- **THEN** the project becomes a folder or Git-backed project with that path
- **AND** it keeps its local key and its published identity

#### Scenario: Refuse a key change while adopting
- **WHEN** a save that supplies a directory for a placeholder also changes its local key or its published identity
- **THEN** the save is refused with an actionable problem
- **AND** no board scope and no Hub revision changes

#### Scenario: Refuse a task for a placeholder
- **WHEN** a task creation requests a project that is a placeholder
- **THEN** the task is not created
- **AND** the failure states that the project must be adopted first

#### Scenario: Omit placeholders from creation
- **WHEN** the user opens New task on a board that allows a placeholder
- **THEN** the placeholder is not offered as a selectable project

#### Scenario: Delete a placeholder
- **WHEN** the user removes a placeholder from the adoption list
- **THEN** the placeholder is kept in the registry marked as ignored
- **AND** every board scope keeps naming its identity

#### Scenario: Remove a placeholder no board names
- **WHEN** a received scope stops naming an identity whose placeholder exists and no other board of the Hub names it
- **THEN** that placeholder is removed from the registry
- **AND** the removal does not hide the identity from a later reception

## ADDED Requirements

### Requirement: Link a project to a published key
A registered project SHALL be linkable to a published identity. Linking SHALL set the project's published key to that identity, SHALL NOT change its local key, its name, its project path, or its Git root, and SHALL remove the placeholder that carried that identity. Every board whose scope already names that identity SHALL allow the linked project without that scope being rewritten. A board whose scope names the project's previous published identity SHALL be rewritten to the new identity in the same write, and the surface SHALL name every board it will rewrite before the person confirms. A save that creates or updates a project whose requested identity is carried by a placeholder SHALL link that project and remove the placeholder, because a placeholder states that the identity is not answered yet rather than competing for it. Linking SHALL be refused when another registered project of the Hub carries the requested published identity.

#### Scenario: Link a received key to an existing project
- **WHEN** a board of the Hub names the identity "management" and the user links an existing project to it
- **THEN** that board allows the linked project without its scope changing
- **AND** the placeholder for "management" no longer exists
- **AND** the project's local key is unchanged

#### Scenario: Rewrite the boards naming the previous identity
- **WHEN** the user links a project whose previous published identity is "management-local" and a board of the Hub names it
- **THEN** the confirmation names that board before the link is applied
- **AND** after the link that board names the new published identity

#### Scenario: Bind by creating a project with the received identity
- **WHEN** the user registers a project whose key is a published identity a placeholder currently carries
- **THEN** the registered project carries that published identity
- **AND** the placeholder is removed

#### Scenario: Refuse a link onto a carried identity
- **WHEN** the user links a project to a published identity another project of the Hub already carries
- **THEN** the link is refused with an actionable problem
- **AND** no stored project changes

### Requirement: Ignore and restore a published key
Ignoring a received identity SHALL keep its placeholder in the project registry marked as ignored rather than removing it, so every board scope that names it keeps naming a project of the Hub. An ignored placeholder SHALL NOT be presented among the projects awaiting adoption, SHALL NOT be re-presented by a later check or apply, SHALL NOT be counted as needed attention, and SHALL NOT create a task. Restoring SHALL clear the mark and present the placeholder as awaiting adoption again. Creating, adopting, or linking a project with that identity SHALL clear the mark. Removing a placeholder no board names SHALL NOT record an ignore.

#### Scenario: Ignore a received identity
- **WHEN** the user ignores a placeholder a board of the Hub names
- **THEN** the placeholder remains in the registry marked as ignored
- **AND** it is not presented among the projects awaiting adoption
- **AND** every board scope still names that identity
- **AND** that board is not presented as a draft

#### Scenario: A later check does not re-present it
- **WHEN** a team check or apply runs after the user ignored an identity
- **THEN** the ignored placeholder is not presented for adoption again
- **AND** no new placeholder is created for that identity

#### Scenario: Restore an ignored identity
- **WHEN** the user restores an ignored placeholder
- **THEN** the placeholder is presented as awaiting adoption again
- **AND** no board scope changes

#### Scenario: Clear the ignore by binding the identity
- **WHEN** the user creates or links a project that carries the ignored identity
- **THEN** the ignore no longer applies
- **AND** the placeholder is removed