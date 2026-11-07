# Spec Delta

## Purpose

Defines how the published `dsh-kanban` artifact is built, declared compatible with a DSH range, released as an immutable version, and installed or updated from its GitHub release asset, so that a supported host activates the bundle regardless of the other plugins sharing its profile.

## ADDED Requirements

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

### Requirement: Every release is immutable

The release workflow SHALL publish exactly one release per manifest version, using the fixed asset name `dsh-kanban.tgz`. A run SHALL fail, without publishing or overwriting anything, when the release tag or the release for the current manifest version already exists. The workflow SHALL NOT overwrite an existing release asset. The release tag SHALL be created on the commit that was built and published, and the workflow SHALL refuse to run for any ref other than `main`. The version in the manifest SHALL be bumped in the pull request that changes the published artifact.

#### Scenario: New version publishes a release

- **WHEN** a commit with manifest version `0.1.2` lands on `main` and no `v0.1.2` tag exists
- **THEN** the workflow publishes `v0.1.2` with the single asset `dsh-kanban.tgz`

#### Scenario: Existing version fails instead of overwriting

- **WHEN** a commit lands on `main` with a manifest version whose tag already exists
- **THEN** the workflow fails without replacing the release or its asset
- **AND** the failure states that the manifest version must be bumped

#### Scenario: A tag exists without a release

- **WHEN** the tag `v<version>` already exists but no GitHub release was created for it
- **THEN** the workflow fails before publishing and states that the manifest version must be bumped

#### Scenario: Manual dispatch off main

- **WHEN** the workflow is dispatched for a ref other than `main`
- **THEN** the release job does not run and nothing is published

#### Scenario: Install address stays stable

- **WHEN** any new version is published
- **THEN** `releases/latest/download/dsh-kanban.tgz` resolves to that release's asset

### Requirement: Install and update guidance is documented

The installation documentation SHALL keep `releases/latest/download/dsh-kanban.tgz` as the recommended install address, and SHALL document pinning an exact release tag, updating an already installed profile, and diagnosing a stale DSH SDK copy inside a profile.

#### Scenario: Install from the latest release

- **WHEN** a reader follows the installation guide
- **THEN** the guide gives the stable `latest` asset address as the recommended install specification

#### Scenario: Pin an exact version

- **WHEN** a reader needs a reproducible install
- **THEN** the guide gives the exact-tag asset address for the installed version

#### Scenario: Update an installed profile

- **WHEN** a reader already installed an older build from the same address
- **THEN** the guide gives the command that updates the plugin in that profile

#### Scenario: Diagnose a stale SDK copy

- **WHEN** activation fails because the profile carries an older DSH SDK copy
- **THEN** the troubleshooting guidance names that cause and the commands that identify the installed copy
