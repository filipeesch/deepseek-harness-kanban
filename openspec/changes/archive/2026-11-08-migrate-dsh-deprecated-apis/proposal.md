# Proposal

## Why

DSH `0.2.2-rc.1` is inside the plugin's declared host range, but the plugin still reads session history through `ctx.sessionController.inspect`, which `0.2.2` removed. On that host, structured questions fail with `Question rounds are unavailable: ctx.sessionController.inspect is not a function`, and the same read path silently breaks first-turn task context, cold-directory resolution, idle and approval checks, and Git policy snapshots. The plugin also uses three host APIs that `0.2.2` marks `@deprecated`: the `agent/request` waterfall, the callable return of `sessionProjections.register`, and `sessionProjections.stateOf(session, key)`. Separately, a fresh install can appear to miss the Kanban sidebar item when a stale profile override keeps the bundle disabled.

## What Changes

- Replace every session-history read with a `SessionHistory` host adapter over `ctx.sessionQuery.observeSession`; copy `header`, `events`, and `inheritedEventCount`, and release the observation lease inside the adapter. Apply it to questions, first-turn task context, effective-directory reads, idle and approval checks, and Git policy snapshots.
- Move the task execution-context guard from the deprecated `agent/request` waterfall to the public `llm/stream` waterfall, keeping the existing `agent/pre-step` guard. Validate ordinary conversation requests for task sessions only.
- Migrate `sessionProjections` to awaited registration: on `0.2.2` use the returned handle's `stateOf` and `dispose`; on `0.2.1` hosts use the disposer and registry-level `stateOf`. `registerConversationFacts` becomes asynchronous and `apply` awaits it.
- Migrate the plugin-owned Inspector scripts and the real-composition e2e template off `sessionController.inspect`, and update their UAT fakes and assertions.
- Add a host API deprecation policy to `AGENTS.md`: check the pinned DSH source for `@deprecated`, use the documented replacement, and design an alternative when no replacement exists.
- Document the fresh-install sidebar check: a stale `- id: kanban` / `disabled: true` override in the profile's `cordis.patch.yml` survives a reinstall and hides the entry.
- Bump the plugin version for the published artifact.

The same user-visible behavior SHALL work on every supported host; this is a compatibility and deprecation migration, not a product change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an implementation-only compatibility change. The affected behavior is already specified by `structured-questions` (question feeds and durable rounds), `task-conversations` (first-turn context and execution-directory alignment), and `plugin-distribution` (activation inside the declared DSH range). The change's `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Host: `src/index.ts`, `src/host/native.ts`, `src/host/task-context.ts`, `src/host/native-facts.ts`, `src/host/conversation-facts.ts`, and a new `src/host/session-history.ts`.
- Manifest and tooling: `package.json` devDependency and version bump, `pnpm-lock.yaml`, and `tsconfig.json` (`ESNext.Disposable`).
- Tests and evidence: host, native, task-context, and projection tests; Inspector scripts under `scripts/`; the `tests/e2e-dsh` template; and UAT helper fakes.
- Documentation: `AGENTS.md`, `docs/operations.md`, and the install/troubleshooting guidance in `README.md`.
- Compatibility: DSH `0.2.1-rc.2` through `0.2.2-rc.1`; no host patch and no new runtime peer dependency.
