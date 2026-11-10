# Spec Delta

## Purpose

Drop the immutable release publisher from this capability and move the documented install address from the release asset to the repository URL, where the profile builds the plugin during installation.

## REMOVED Requirements

### Requirement: Every release is immutable

**Reason**: no workflow publishes a release any more. The pipeline that replaced the release workflow verifies the solution and produces no distributable, so there is no asset to keep immutable and no tag it creates.

**Migration**: install and pin with the repository URL plus a committish (`#<commit sha>`), and push a `v<version>` tag by hand when a named address is wanted. Releases published before this change, and their `dsh-kanban.tgz` assets, stay downloadable but never advance.

### Requirement: Install and update guidance is documented

**Reason**: the requirement named `releases/latest/download/dsh-kanban.tgz` as the recommended install address. No workflow publishes that asset any more, so the address freezes at the last release and the requirement can no longer be satisfied.

**Migration**: the "Installation is documented from the repository URL" requirement below replaces it and keeps its other obligations: pinning, updating an installed profile, and diagnosing a stale SDK copy.

## ADDED Requirements

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