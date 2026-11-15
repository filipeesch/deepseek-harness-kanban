# Spec Delta

## ADDED Requirements

### Requirement: Team Settings sub-tabs

Team Settings SHALL present the two areas defined by Team Settings interface as sub-tabs: Connection and Changes. The Connection sub-tab SHALL be presented first and opened by default. The Changes sub-tab SHALL be presented only while the Hub is bound to a storage; while the Hub has no binding it SHALL NOT be presented, because a Hub without a binding publishes nothing. Each sub-tab SHALL present its own area and SHALL NOT repeat the other area's content.

The Connection sub-tab SHALL group its content into two visually separated, named panels. The Status panel SHALL present the bound storage's name, the location the binding uses, the account when the storage uses one, the last successful check, and the effective check interval. The Management panel SHALL present the actions that belong to the connection — Refresh, Disconnect, Switch account for a Google Drive Cloud binding, and Choose folder or Change folder for a Google Drive Local binding — together with the editable check interval. The storage cards SHALL be presented in the Connection sub-tab only while the Hub has no binding, and SHALL NOT be presented while the Hub is bound.

#### Scenario: Open Team Settings without a binding

- **WHEN** the user opens Team Settings for a Hub with no storage binding
- **THEN** the Connection sub-tab is presented and opened by default
- **AND** it presents the storage cards and the selected storage's connection surface
- **AND** no Changes sub-tab is presented

#### Scenario: Open Team Settings for a bound Hub

- **WHEN** the user opens Team Settings for a bound Hub
- **THEN** the Connection sub-tab presents the Status panel and the Management panel
- **AND** no storage card is presented
- **AND** the Changes sub-tab is presented

#### Scenario: Keep the connection panels separate

- **WHEN** the Connection sub-tab presents a bound storage
- **THEN** the storage name, location, account, last check, and effective interval appear in the Status panel
- **AND** the connection actions and the editable interval appear in the Management panel
- **AND** neither panel repeats the other's content

#### Scenario: Switch between the sub-tabs

- **WHEN** the user selects the Changes sub-tab and then the Connection sub-tab again
- **THEN** each sub-tab presents only its own area
- **AND** the configuration dialog stays open and keeps its size
