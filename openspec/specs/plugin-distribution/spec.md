# Plugin Distribution Specification

## Purpose

Defines how the `dsh-kanban` artifact is built, declared compatible with a DSH range, and installed or updated from the repository URL, where the profile builds the plugin during installation, so that a supported host activates the bundle regardless of the other plugins sharing its profile. No build artifact is published: the CI pipeline that verifies the solution produces nothing to install.

## Requirements

### Requirement: Artifact activates independently of a profile-scoped Typert protocol copy

The published host entries SHALL activate on every supported DSH host even when the target profile already carries a different version of the Typert protocol package. The artifact SHALL NOT resolve that package from the profile's `node_modules` at runtime; every runtime use of it, including the Remote descriptor helper and the decorators the host controller imports, SHALL be part of the published host bundle, as the client bundle already does. Activation SHALL remain independent of whether the profile contains no copy of that package, a compatible copy, or an older copy that does not export the required subpaths.

#### Scenario: Profile carries an older protocol copy

- **WHEN** the artifact is installed into a profile whose `node_modules` contains `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2` while the host ships a newer copy
- **THEN** the bundle activates without `ERR_PACKAGE_PATH_NOT_EXPORTED`
- **AND** the Kanban surface becomes available in the running host

#### Scenario: Profile carries no protocol copy

- **WHEN** the artifact is installed into a profile whose `node_modules` contains no `@deepseek-ai/dsh-typert-protocol`
- **THEN** the bundle activates and registers its Remote surface

#### Scenario: Published entries stay self-contained

- **WHEN** the published `lib/index.js` and `lib/remote.js` are inspected
- **THEN** neither contains a runtime import of `@deepseek-ai/dsh-typert-protocol` or any of its subpaths
- **AND** the Typert descriptor helper is inlined in those entries

### Requirement: Compatibility is declared with the host version

The plugin manifest SHALL declare `engines.dsh` as `>=0.2.1-rc.2 <0.3.0-0` so DSH's own admission check decides whether the artifact may load. The upper bound SHALL exclude `0.3` prereleases as well as `0.3` releases, because DSH evaluates the range with prerelease matching. The Typert protocol package SHALL be a build-time dependency only: the published manifest SHALL NOT list it as a runtime dependency or as a peer dependency, because the artifact no longer imports it at runtime. Other DSH SDK packages that remain external peer dependencies SHALL keep their declared ranges.

#### Scenario: Host inside the declared range

- **WHEN** the artifact is installed on DSH `0.2.2-rc.1`
- **THEN** admission accepts the bundle and it activates

#### Scenario: Host outside the declared range

- **WHEN** the artifact is installed on a DSH release below `0.2.1-rc.2`
- **THEN** DSH refuses the bundle through its native incompatibility report instead of failing later with an import error
- **AND** the refusal names the declared `engines.dsh` range

#### Scenario: Published manifest has no protocol dependency

- **WHEN** the packed `package.json` is inspected
- **THEN** it declares `engines.dsh`
- **AND** `@deepseek-ai/dsh-typert-protocol` appears only under `devDependencies`

### Requirement: Installation is documented from the repository URL

The installation documentation SHALL document `https://github.com/filipeesch/deepseek-harness-kanban` as the recommended install address. It SHALL state that the address installs a Git dependency whose `prepare` build the profile must allow for the resolved commit, SHALL give the `allowBuilds` entry that records that approval, and SHALL tell the reader to confirm the installed copy carries its `lib/` entries before trusting a reported success. It SHALL document pinning with a committish, updating an already installed profile, and diagnosing a stale DSH SDK copy inside a profile. The documentation SHALL NOT present `releases/latest/download/dsh-kanban.tgz` as the install address and SHALL NOT present a branch name as a pin.

#### Scenario: Install from the repository URL

- **WHEN** a reader follows the installation guide
- **THEN** the guide gives the repository URL as the install specification
- **AND** the guide gives the build approval the profile must record before the install can complete

#### Scenario: Install reports success without built entries

- **WHEN** an installation completed without running the `prepare` build
- **THEN** the guide tells the reader to check `lib/index.js` in the installed copy and names the missing approval as the cause

#### Scenario: Pin an exact version

- **WHEN** a reader needs a reproducible install
- **THEN** the guide gives the repository URL with a `#<commit sha>` committish as the pin that cannot move
- **AND** the guide warns that a `#v<version>` tag exists only where one was published or pushed by hand

#### Scenario: Update an installed profile

- **WHEN** a reader already installed an older build from the same address
- **THEN** the guide gives the command that updates the plugin in that profile
- **AND** the guide states that a floating address builds a new commit and needs a new approval key, while a pinned address stays put

#### Scenario: Diagnose a stale SDK copy

- **WHEN** activation fails because the profile carries an older DSH SDK copy
- **THEN** the troubleshooting guidance names that cause and the commands that identify the installed copy
