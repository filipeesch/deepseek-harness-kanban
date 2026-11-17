# Spec Delta

## Purpose

Keeps the repository's human-facing documentation organized by audience, honest about current behavior, free of versioned evidence artifacts, and continuously validated by the check pipeline.

## ADDED Requirements

### Requirement: Documentation is organized by audience and carries one index

The repository SHALL keep human-facing documentation under `docs/`, split by audience: `docs/user/` for product behavior, `docs/operations/` for install and recovery, and `docs/development/` for contributor procedures. The root `README.md` SHALL be a landing page covering what the plugin is, requirements, install/update/pin, first use, and a feature map that links the user guides; it SHALL NOT be the full product manual. Every maintained document SHALL be listed in `docs/README.md`, and that index SHALL be the repository's only navigation list of maintained documents.

#### Scenario: A maintained document is added

- **WHEN** a Markdown file is added under `docs/` as a maintained document
- **THEN** `docs/README.md` lists it
- **AND** the documentation check fails while the entry is missing

#### Scenario: The index names a document that is gone

- **WHEN** `docs/README.md` names a document that no longer exists
- **THEN** the documentation check fails

#### Scenario: A reader lands on the README

- **WHEN** a reader opens `README.md`
- **THEN** it states what the plugin is, its requirements, install and update instructions, first use, and a feature map
- **AND** the feature map links each guide under `docs/user/`

#### Scenario: A procedural detail belongs to a document

- **WHEN** a procedure is longer than a standing order and is needed only in one situation
- **THEN** it is documented under `docs/development/` or `docs/operations/`
- **AND** the root `AGENTS.md` keeps only the standing order that links it

### Requirement: Local documentation links and anchors resolve

Every relative Markdown link in a maintained document SHALL resolve to an existing file, and every fragment SHALL name an existing heading anchor in that file. Links to external URLs are out of scope.

#### Scenario: A linked file is moved

- **WHEN** a maintained document is moved or deleted without updating its relative links
- **THEN** the documentation check fails and names the source document, the target, and the missing file

#### Scenario: A section is renamed

- **WHEN** a heading that a link targets is renamed without updating the fragment
- **THEN** the documentation check fails and names the missing anchor

#### Scenario: A valid link stays valid

- **WHEN** every relative link and fragment resolves
- **THEN** the documentation check passes without touching the files

### Requirement: Maintained documentation describes current behavior only

A maintained document SHALL describe the shipped behavior of the product or the current procedure of the repository. It SHALL NOT contain absolute local filesystem paths, user home paths, bundle installation paths, local acceptance-run URLs, test counts, run timestamps, build fingerprints, or narration of past changes as if they were current behavior.

#### Scenario: A machine path is pasted into a guide

- **WHEN** a maintained document contains an absolute local path or a user home path
- **THEN** the documentation check fails and names the file and the offending line

#### Scenario: A version claim contradicts the manifest

- **WHEN** a maintained document states a supported host or Node version
- **THEN** it agrees with `engines` in `package.json`
- **AND** the documentation check fails on a contradiction

#### Scenario: A historical register is offered as documentation

- **WHEN** a test count, run timestamp, or build fingerprint is added to a maintained document
- **THEN** the documentation check fails

### Requirement: Verification evidence is not versioned

Acceptance and audit artifacts SHALL NOT be committed to the repository. Run reports, screenshots, review records, and verification registers SHALL live in the ignored `.verification/` directory or in Git history; the maintained tree carries no evidence artifact.

#### Scenario: An audit artifact is committed

- **WHEN** a verification register, review record, or scenario-evidence file is added to the repository tree
- **THEN** the documentation check fails and names the file

#### Scenario: Evidence is kept outside the tree

- **WHEN** a validation run produces screenshots or a report
- **THEN** they are written under `.verification/`
- **AND** `.gitignore` keeps that directory out of the commit

#### Scenario: The verification policy is documented

- **WHEN** a contributor asks where acceptance evidence belongs
- **THEN** `docs/development/verification.md` states the policy, the isolated lanes, and the model-traffic rule

### Requirement: The documentation standard instructs agents and the root instructions delegate to it

`docs/AGENTS.md` SHALL define the audience tiers, one home per fact, placement of new content, the add/move/delete flow, the writing rules, a per-document size ceiling, and a review checklist. The root `AGENTS.md` SHALL keep standing orders and the irreversible safety rules, SHALL contain a Documentation section that links `docs/AGENTS.md`, and SHALL keep procedural detail out of its own body.

#### Scenario: An agent works on a document

- **WHEN** an agent reads or edits a file under `docs/`
- **THEN** `docs/AGENTS.md` is the authoritative standard for that work

#### Scenario: The root file grows into a manual

- **WHEN** the root `AGENTS.md` exceeds its size ceiling or carries a step-by-step procedure
- **THEN** the documentation check fails
- **AND** the procedure belongs to a document under `docs/development/`

#### Scenario: A safety rule must survive

- **WHEN** the root instructions are reduced to standing orders
- **THEN** the irreversible rules stay in the root: validation never uses a personal profile or a real model, installation uses the repository URL, and a preset allowlist is never widened to make an instruction work

### Requirement: Content validated by a test is a contract, not prose

When a document contains content that a test validates, that content SHALL be treated as a contract: the executable example in `docs/user/scripted-steps.md` SHALL remain byte-identical to its fixture, the test SHALL read the guide from its current path, and the published artifact SHALL carry the guide at that path.

#### Scenario: The documented example drifts

- **WHEN** the TypeScript example in the scripted-steps guide is edited without editing `tests/e2e-dsh/scripted/wait-ci.ts`
- **THEN** the distribution test fails
- **AND** the check names the guide and the fixture

#### Scenario: The guide is moved

- **WHEN** the scripted-steps guide moves to a new path
- **THEN** the distribution test reads it from the new path
- **AND** the published `files` list carries it at the new path

#### Scenario: The artifact is packed

- **WHEN** the package is packed with `npm pack --dry-run`
- **THEN** the file list contains `README.md` and `docs/user/scripted-steps.md`
- **AND** no historical evidence artifact is included
