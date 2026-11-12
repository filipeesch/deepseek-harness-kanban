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

The plugin manifest SHALL declare `engines.dsh` as `>=0.2.2-rc.1 <0.3.0-0` so DSH's own admission check decides whether the artifact may load. The upper bound SHALL exclude `0.3` prereleases as well as `0.3` releases, because DSH evaluates the range with prerelease matching. The Typert protocol package SHALL be a build-time dependency only: the published manifest SHALL NOT list it as a runtime dependency or as a peer dependency, because the artifact no longer imports it at runtime. Other DSH SDK packages that remain external peer dependencies SHALL declare bounded ranges aligned with the supported DSH 0.2.2 baseline. Build-time SDK dependencies SHALL use bounded compatible ranges rather than require the former exact 0.2.1-rc.2 SDK, and the committed lockfile SHALL record the reproducible tested resolution. The available 0.2.2-rc.1 host SHALL be supported alongside later compatible hosts admitted by the declared range; an unbounded latest-version dependency SHALL NOT substitute for a declared compatibility contract.

#### Scenario: Host inside the declared range

- **WHEN** the artifact is installed on DSH `0.2.2-rc.1`
- **THEN** admission accepts the bundle and it activates

#### Scenario: Host outside the declared range

- **WHEN** the artifact is installed on a DSH release below `0.2.2-rc.1`
- **THEN** DSH refuses the bundle through its native incompatibility report instead of failing later with an import error
- **AND** the refusal names the declared `engines.dsh` range

#### Scenario: Published manifest has no protocol dependency

- **WHEN** the packed `package.json` is inspected
- **THEN** it declares `engines.dsh`
- **AND** `@deepseek-ai/dsh-typert-protocol` appears only under `devDependencies`

#### Scenario: Exclude the next minor prerelease

- **WHEN** the artifact is installed on a DSH 0.3 prerelease or release
- **THEN** the native admission check rejects it as outside the declared range
- **AND** no runtime import failure is used as the compatibility check

#### Scenario: Resolve the tested SDK reproducibly

- **WHEN** the plugin is installed and built from its committed dependency metadata
- **THEN** its bounded SDK ranges and lockfile resolve the tested DSH 0.2.2-compatible build dependencies
- **AND** compatibility does not depend on retaining the exact former 0.2.1-rc.2 SDK

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

### Requirement: Deterministic execution capability availability

Admission by the host version range SHALL NOT be treated as proof that every optional execution provider is installed or configured. Before starting or recovering a deterministic program, the plugin SHALL verify the native capabilities needed by that program: its supported TypeScript source form when applicable, Bash execution, cancellation of the program and its nested Bash calls, execution without a host-imposed business deadline, the required file-policy enforcement, and explicitly authorized local-variable access. It SHALL use the public native execution and credential capabilities rather than require a model turn or the chat run_code transport. An absent or incompatible capability SHALL prevent that program from starting or recovering and SHALL produce a diagnostic identifying the unsupported capability and corrective action. The failure SHALL follow the configured deterministic error route when present and otherwise remain a recoverable failure in the current stage. It SHALL NOT disable conventional Kanban behavior, silently change the script language or source form, impose a short tool-call deadline on the whole program, invoke a model to perform the deterministic verification, broaden permissions, or fall back to a separate plaintext credential store. Local trust that has not been granted SHALL remain an authorization wait rather than being inferred from runtime availability.

#### Scenario: A supported host lacks the TypeScript execution provider

- **WHEN** a host inside the declared version range starts a TypeScript deterministic stage without the required compatible native provider
- **THEN** no script starts and no model turn substitutes for the missing verification capability
- **AND** the diagnostic identifies the missing or incompatible execution capability
- **AND** the configured error route is used or the task remains recoverably failed in its stage
- **AND** conventional boards and conversations remain available

#### Scenario: Refuse an incompatible source form or uncancellable provider

- **WHEN** the installed runtime cannot execute the approved source form or cannot cancel the program and its nested Bash calls
- **THEN** the stage does not start with a silently altered program or an unmanaged process
- **AND** the diagnostic identifies the unsupported capability

#### Scenario: Preserve the script-owned waiting deadline

- **WHEN** an approved script waits longer than an ordinary interactive tool-call timeout while its own loop has not completed
- **THEN** the whole program is not terminated or restarted merely because that interactive timeout passed
- **AND** Stop can still cancel the program and its nested Bash processes

#### Scenario: Native credentials are unavailable for a configured local variable

- **WHEN** an execution requires an explicitly authorized local variable but the native credential capability is unavailable
- **THEN** execution fails before exposing an unapproved environment or starting the script
- **AND** the diagnostic identifies the credential capability problem
- **AND** no value is copied into workflow YAML or a plaintext substitute

#### Scenario: Runtime availability does not replace executable trust

- **WHEN** every required runtime capability is available but the executable version lacks local trust
- **THEN** the stage waits for its local authorization
- **AND** no script starts and no runtime-availability success grants trust
