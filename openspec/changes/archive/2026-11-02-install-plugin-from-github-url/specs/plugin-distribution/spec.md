# Plugin Distribution Specification

## Purpose

Define how dsh-kanban is installed from its public GitHub repository into a DSH profile without a manual clone, build, or local link, and how that installation stays compatible, licensed, documented, and verifiable.

## ADDED Requirements

### Requirement: Install from the repository URL

A user SHALL be able to install dsh-kanban by pasting its GitHub Git address into DSH's **Add plugin** flow for the active profile. Installation SHALL fetch the repository, prepare the package, register it as a profile bundle, and enable it by default, without a prior clone, manual package install, manual build, or `link:` dependency. After installation and the profile's normal recomposition or refresh, the Kanban entry SHALL be available in the DSH sidebar.

#### Scenario: Install into a profile without the plugin
- **WHEN** a user pastes the dsh-kanban repository Git address into DSH's Add plugin flow in a profile that does not contain the plugin
- **THEN** DSH installs the package from that address, registers the bundle, and enables it
- **AND** the Kanban entry becomes available after the profile recomposes or the Web client refreshes
- **AND** the user did not clone the repository, run a build, or add a local path

#### Scenario: Reject a duplicate installation of the same address
- **WHEN** the profile already holds the plugin installed from the same Git address
- **THEN** the installation reports the package as already installed instead of installing a second copy

### Requirement: Build during installation

The package distributed from Git SHALL produce its host entry point, its client entry point, and its public declarations during installation through the package's `prepare` lifecycle. The repository SHALL NOT depend on committed build output for a Git installation, and the installed package SHALL expose the entry points declared by its package manifest.

#### Scenario: Prepare produces the loadable entry points
- **WHEN** DSH installs the package from a Git address and the build scripts are permitted
- **THEN** the installed package contains the host and client entry points declared by its exports
- **AND** the same files are produced without any prebuilt artifact committed to the repository

#### Scenario: A failed preparation aborts the installation
- **WHEN** the preparation build fails during a Git installation
- **THEN** the installation reports the failure with its diagnostic output
- **AND** the profile does not claim a usable installed bundle

### Requirement: Install does not shadow the host runtime

The package SHALL declare the DSH runtime packages it imports as host-provided peers and SHALL NOT install its own copies of those packages into the profile. Installing the plugin SHALL NOT change the version of DSH packages used by the host's own rows, and those rows SHALL remain active after the installation.

#### Scenario: Keep the host rows active after installation
- **WHEN** the plugin is installed into a Web profile on DSH 0.2.1-rc.5
- **THEN** the profile contains no `@deepseek-ai` runtime copies supplied by the plugin
- **AND** the host's session, tools, and storage rows remain active

#### Scenario: Load the installed plugin against the host packages
- **WHEN** the installed Web profile composes and serves the Kanban page
- **THEN** the plugin resolves the host's DSH packages instead of versions bundled with the plugin
- **AND** the Kanban page loads without a missing-package or version-mismatch error

### Requirement: Blocked Git build remediation

Because a Git installation runs the package's `prepare` build, pnpm may block it and DSH may report the installation as failed. The installation result SHALL expose the package manager's exact `allowBuilds` key, and the documented installation path SHALL explain how to add that key to the active profile's `pnpm-workspace.yaml` and retry. The plugin SHALL NOT silently install an unbuilt package or claim success before the retry completes. Approval SHALL be recorded per exact Git resolution: retrying the same resolution SHALL proceed without blocking again, while a different commit SHALL require its own key.

#### Scenario: Report the blocked build and exact key
- **WHEN** a Git installation's `prepare` build is blocked by pnpm
- **THEN** the installation result reports the failure and includes the exact `allowBuilds` key
- **AND** the plugin is not reported as installed and usable before the build succeeds

#### Scenario: Retry after recording the key
- **WHEN** the reported key is added to the profile's `pnpm-workspace.yaml` and the installation is retried
- **THEN** the retry runs `prepare`, builds the entry points, and activates the bundle

#### Scenario: Reuse the key for the same resolution
- **WHEN** the same profile installs the same Git resolution again after the key was recorded
- **THEN** the installation is not blocked by the same build-script decision

#### Scenario: Require a new key for a new commit
- **WHEN** the installation resolves a different commit of the repository
- **THEN** the exact key names that resolution and the previous key does not authorize it

### Requirement: Declared DSH compatibility

The package SHALL declare its compatible DSH runtime with `engines.dsh` as the range `^0.2.1-rc.2`. The declaration SHALL accept the 0.2.x line from `0.2.1-rc.2` onward and SHALL reject `0.3.0` and its prereleases. An installation on a host outside the declared range SHALL be refused by DSH with an actionable incompatibility result that names the unmet requirement and the exact-version exemption path, rather than loading the plugin and failing at runtime.

#### Scenario: Accept the verified runtime
- **WHEN** the plugin is installed on DSH `0.2.1-rc.5`
- **THEN** the declared range admits it
- **AND** the installation proceeds normally

#### Scenario: Accept another 0.2.x patch release
- **WHEN** the plugin is installed on DSH `0.2.2` or a `0.2.2` prerelease
- **THEN** the declared range admits it

#### Scenario: Refuse the next minor line
- **WHEN** the plugin is installed on DSH `0.3.0` or a `0.3.0` prerelease
- **THEN** the declared range does not admit it
- **AND** DSH reports the incompatibility and how to grant an exact-version exemption instead of loading the plugin

### Requirement: Public and licensed distribution

The repository SHALL be publicly reachable and SHALL carry an MIT license so that installation does not require repository credentials. The package manifest SHALL declare the MIT license, the repository SHALL include a license file, and the published installation guidance SHALL NOT describe the package as private or UNLICENSED.

#### Scenario: Install from an anonymous GitHub address
- **WHEN** a user without repository credentials installs the public GitHub address
- **THEN** the fetch and installation are not blocked by repository access

#### Scenario: Verify the license metadata
- **WHEN** the repository is inspected
- **THEN** it contains an MIT license file and the package manifest declares the MIT license
- **AND** the README no longer states that the package is private or UNLICENSED

### Requirement: Installation guidance and update path

The README SHALL lead with the URL installation path and SHALL state the prerequisites (a compatible DSH 0.2.x runtime, GitHub reachability, and network access for the package manager). It SHALL explain the blocked Git build and how to add pnpm's exact `allowBuilds` key to the profile before retrying, state that a non-official plugin updates by uninstalling and reinstalling rather than by an in-place update, and provide troubleshooting for an unreachable GitHub address, blocked build scripts, and an incompatible runtime. The local development installation by `link:` SHALL remain documented separately from the end-user path.

#### Scenario: Follow the documented URL installation
- **WHEN** a new user reads the README installation section
- **THEN** the first path presented is Add plugin with the repository address
- **AND** the blocked-build remediation and the update-by-reinstall path are stated

#### Scenario: Troubleshoot a failed installation
- **WHEN** an installation fails because GitHub is unreachable, build scripts are blocked, or the runtime is incompatible
- **THEN** the README names the failure and the action that resolves or reports it

#### Scenario: Keep the development install separate
- **WHEN** a contributor installs the checkout for development
- **THEN** the documented `link:` path remains available and is distinct from the end-user installation

### Requirement: Repeatable isolated install verification

The repository SHALL provide a repeatable verification that installs the package from a temporary Git snapshot into an isolated DSH home and profile, writes the exact `allowBuilds` key, and asserts the installed host and client entry points, the absence of plugin-installed `@deepseek-ai` copies, the saved bundle selection, and an enabled composed Kanban row. The verification SHALL NOT touch the developer's DSH home, profile, or stored data, and SHALL report failure rather than skip when the installation cannot be completed.

#### Scenario: Verify the install contract
- **WHEN** the verification runs on a checkout
- **THEN** it installs from a temporary Git snapshot into an isolated profile, writes the reported key, and asserts the entry points, the bundle selection, the absence of host package copies, and the enabled Kanban row
- **AND** it leaves the developer's DSH home and profile unchanged

#### Scenario: Report an incomplete installation
- **WHEN** the verification cannot install, build, or compose the plugin
- **THEN** it exits with a failure that identifies the failed stage instead of reporting success
