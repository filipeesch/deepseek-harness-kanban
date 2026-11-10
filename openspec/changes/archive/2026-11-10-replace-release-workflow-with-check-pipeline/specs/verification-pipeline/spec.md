# Spec Delta

## Purpose

How the repository proves a change passes every CI-safe test lane on a pull request and on `main`, without producing anything a person could install.

## ADDED Requirements

### Requirement: Every CI-safe lane runs on every change

The repository SHALL run a workflow on every pull request, on every push to `main`, and on manual dispatch. The workflow SHALL install the locked dependencies with `pnpm install --frozen-lockfile`, install the Chromium browser the harness needs, run `pnpm run check`, and then run `pnpm run test:browser`. A failing lane SHALL fail the run. The real-composition lane `scripts/e2e-dsh.mjs` SHALL stay manual because it needs an installed and built DSH checkout on the runner, and no lane SHALL call a real model.

#### Scenario: Pull request runs both gates

- **WHEN** a pull request is opened or updated
- **THEN** the workflow runs `pnpm run check` and `pnpm run test:browser` on `ubuntu-latest`
- **AND** the run fails when any lane fails

#### Scenario: A merge to main is verified the same way

- **WHEN** a commit lands on `main`
- **THEN** the same workflow runs the same gates on that commit

#### Scenario: Manual dispatch

- **WHEN** the workflow is dispatched by hand
- **THEN** the same gates run with no additional setup

### Requirement: The pipeline publishes no distributable

The CI workflow SHALL NOT pack, upload, or publish an artifact, SHALL NOT create a release or a tag, and SHALL request `contents: read` and no write permission.

#### Scenario: A green run leaves nothing to install

- **WHEN** the workflow finishes successfully
- **THEN** the run created no artifact, release, or tag

#### Scenario: The workflow cannot write to the repository

- **WHEN** the workflow definition is inspected
- **THEN** its permissions grant `contents: read` and nothing more
