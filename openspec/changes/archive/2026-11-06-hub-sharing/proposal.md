# Proposal

## Why

A Hub's boards and workflows currently live only in one installation. A team has no way to keep those definitions aligned: people copy YAML by hand, drift silently, and nobody is told when a teammate changes a shared workflow. The sharing mechanism must be optional and storage-agnostic, because a Git repository is the first backend, not the product concept.

## What Changes

- Add an optional per-Hub publishing binding to a Git repository. The user provides the repository URL; the plugin owns a local clone, and credentials come from the ambient Git configuration.
- Share one document per Hub containing the board list (stable key, name, order) and each board's workflow YAML. Projects, tasks, and notes stay local. Hub names stay local.
- Make publishing explicit: the workflow editor offers a quiet `Save` and a primary `Save and share`; a board or workflow changed locally becomes a `Draft` until published.
- Make receiving explicit: `Get updates` applies a three-way per-board merge. Boards changed only by the team are applied, boards changed only locally stay `Draft`, and a board changed on both sides requires a per-board choice.
- Refuse the whole update application when it would orphan a task column or collide with an unpublished local board name. Nothing is applied and the blocking boards, columns, and tasks are named.
- Treat a board removed by the team according to its local work: a board with tasks or unpublished changes becomes a local orphan with a tab indicator, and a board without local work is removed. An orphan can be published as a new board or deleted, and reconnects automatically when the team publishes a board with the same name.
- Poll the team repository from the host every five minutes per Hub by default, configurable per Hub with a one-minute minimum, and expose the result in the host snapshot so the interface reacts without a second channel.
- Add the Publishing section to Configuration, a board banner for available updates, a Hub tab indicator, per-board tab indicators, and the `Save and share` workflow action.
- Introduce a storage port with a Git adapter so another backend can be added later without changing the domain, the merge rules, or the interface.
- Keep the feature opt-in: with no binding, no clone, no polling, and no new interface state, the product behaves exactly as it does today. There are no breaking changes.

## Capabilities

### New Capabilities

- `hub-sharing`: optional Hub-to-repository publishing, the shared document and its stability rules, three-way updates, orphan handling, host polling and status, the Publishing interface, and the storage-provider abstraction.

### Modified Capabilities

- `hubs`: Hub deletion while the Hub is published disconnects it locally and leaves the published document untouched.
- `kanban-board`: deleting a board that belongs to a published Hub offers a local-only or team-wide removal instead of a single deletion.

## Impact

- **Domain**: new pure sharing module for the shared document, canonical token, three-way plan, application rules, and identity/reconnection; `HubState` and its schema stay unchanged.
- **Host**: a separate `kanban_sharing` storage domain, a sharing service with its own serialized lane, a polling scheduler with an injectable timer, a Git adapter over the plugin-owned host command runner, and wiring in `src/index.ts`. `HostSnapshot` gains a per-Hub sharing map.
- **RPC and types**: a `SharingCommand` union, one additional remote method, `ClientApi.sharing`, and the snapshot schema addition. The existing command union is unchanged.
- **Client**: a Publishing section in Configuration, a board banner, Hub and board tab indicators, and the second workflow save action. Configuration sections move to a small registry.
- **Dependencies**: none added at runtime. Git remains an environment requirement only while sharing is enabled; no secrets are stored by the plugin.
- **Tests**: domain state matrix and merge rules, the Git adapter against temporary repositories with a local bare remote, the scheduler with fake timers, snapshot projection, and browser-harness coverage of the Publishing interface and indicators.
- **Data**: no migration. Existing installations have no sharing binding, so no stored shape changes.
