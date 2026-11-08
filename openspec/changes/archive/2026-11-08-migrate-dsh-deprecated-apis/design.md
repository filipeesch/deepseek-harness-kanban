# Design

## Context

See `proposal.md` - Why. The relevant current state:

- DSH `0.2.2-rc.1` removed `ctx.sessionController.inspect`. The public replacement, `ctx.sessionQuery.observeSession`, has existed since `0.2.1-rc.2` and returns an immutable `SessionObservation` with `header`, `events`, `inheritedEventCount`, and a `Symbol.dispose` lease.
- The plugin compiles against the pinned `0.2.1-rc.2` SDK but declares support for the whole `0.2.1-rc.2` to `0.2.2-rc.1` range. `SessionController` already injects `sessionQuery` in both lines, so the service is guaranteed wherever the plugin can currently activate.
- Session-history reads are currently spread across `src/index.ts` (question replay), `src/host/task-context.ts` (first-turn context), and `src/host/native.ts` (`policiesFor`, `directory`, `isIdle`, and the native facts fallback).
- DSH `0.2.2-rc.1` marks three additional APIs used by the plugin as `@deprecated`: the `agent/request` waterfall, the callable return of `sessionProjections.register`, and `sessionProjections.stateOf(session, key)`. The projection registry returned a disposer function in `0.2.1`; in `0.2.2` it returns a callable thenable that resolves to a handle with `stateOf(session)` and `dispose()`.
- The fresh-install sidebar symptom is profile state, not an API break: the `web` profile carried a user-layer `- id: kanban` / `disabled: true` override that survives a plugin reinstall.

## Goals / Non-Goals

**Goals:**

- One host-owned session-history adapter that supports every declared DSH version and never requires a removed or deprecated API.
- No use of a host API marked `@deprecated` in `0.2.2-rc.1` on the paths this plugin controls.
- Preserve every current behavior: question feeds and durable rounds, first-turn task context, effective-directory checks, idle/approval admission, and Git policy snapshots.
- Keep the plugin source free of DSH internals and host patches.
- Make the deprecation check repeatable through `AGENTS.md` and the change tasks.

**Non-Goals:**

- No DSH host patch or new runtime peer dependency.
- No spec-level behavior change; the change is implementation-only and `.openspec.yaml` sets `skip_specs: true`.
- No refactor of the whole `createNativePorts` factory, no question-replay optimization, and no UI redesign.
- No change to the plugin-manager disable semantics or automatic repair of owner profile files.

## Decisions

### 1. A single `SessionHistory` adapter over `sessionQuery`

Create `src/host/session-history.ts` with:

```text
SessionHistory      { header: SessionHeader; events: readonly SessionEvent[]; inheritedEventCount: SessionLogOffset }
SessionHistoryReader.read(sessionId, { signal?, projections? }): Promise<SessionHistory>
createSessionHistory(ctx): SessionHistoryReader
```

`read` calls `ctx.sessionQuery.observeSession(SessionId(sessionId), { signal, projectionMode: projections ?? 'none' })`, copies the three values, and releases the lease in a `finally` block. When the caller supplies no signal, the adapter uses the existing 30-second read timeout behavior.

`sessionQuery` is added to the plugin `inject` list. `@deepseek-ai/dsh-session-query` is added only as a `devDependency` for its type augmentation; the published host bundle does not import it at runtime.

Alternatives:

- Keep `sessionController.inspect` with a feature-detect fallback: rejected. `inspect` is removed, so the fallback would be a permanently dead path on the host that matters.
- Use `sessionController.events`/`page`: rejected. Those are page-oriented, require an address and cursor handling, and are not the exact full-log read the question index needs.
- Read live `Session.snapshotEvents()` directly: rejected. The plugin also reads cold conversations, and the synchronous event read is itself deprecated.

### 2. Return a value snapshot, not the disposable lease

Consumers receive plain values and never see `SessionObservation`. The adapter owns disposal. This keeps every consumer synchronous in shape, avoids leaking a pinned cold-observation lease, and avoids adding `using` downleveling to the host build.

Alternative: expose the lease and require `using`/`try-finally` in every consumer. Rejected because it spreads lifecycle knowledge across the app, task-context, and native ports and is easy to get wrong.

### 3. Wire the adapter once in the composition root

- `src/index.ts` creates one reader and passes it to `createNativePorts`, `registerTaskContextInjection`, and the `KanbanApp` history callback.
- `src/host/native.ts` uses `history.read` in `policiesFor`, `directory`, and `isIdle`; `inspectedDirectory` reads `header.cwd`, and the detached `Session.create` call uses `header` and `inheritedEventCount`.
- `src/host/task-context.ts` replaces its `inspect` seam with the reader and keeps its narrow `{ events }` need.
- `src/host/native-facts.ts` reduces `InspectionLike` to the event list the folds actually use; `meta` was only needed by the directory helper.
- `AppOptions.history` remains a narrow `(sessionId) => Promise<readonly unknown[]>` function. The app does not gain an SDK dependency.

### 4. Move the request guard from `agent/request` to `llm/stream`

Replace the deprecated `agent/request` listener in `registerTaskExecutionGuards` with a public `llm/stream` listener:

```text
on llm/stream(options, next):
  id = options.sessionId
  task = id ? locator.bySession(id)?.task : undefined
  if task and options.purpose is undefined:
    options.signal?.throwIfAborted()
    reject while the task operation is changing
    await app.assertExecutionContext(id)
    options.signal?.throwIfAborted()
    reject if the operation changed while validating
  yield* next()
```

`agent/pre-step` keeps its existing validation. Only ordinary conversation requests (`purpose` omitted) are guarded, matching the scope of the old `agent/request` listener and avoiding interference with auxiliary model calls that the old listener never covered. `llm` is added to `inject` and the event type augmentation.

Alternatives:

- Keep `agent/request` as a documented exception: rejected by the agreed deprecation policy; it would remain deprecated usage in `0.2.2`.
- Remove the guard and rely only on `agent/pre-step`: rejected because it opens the window between pre-step and the provider call that the request-era guard specifically covered.
- Use another hook: no other public non-deprecated hook runs after request-configuration middleware and before the provider call.

### 5. Projection registration as a version adapter

`registerConversationFacts` becomes asynchronous and returns a reader with synchronous `read(session)` and `dispose()`. The adapter awaits the registration result:

```text
registration = ctx.sessionProjections.register(definition)
resolved = await registration
if typeof resolved === 'function':     // 0.2.1 hosts
  read = registry.stateOf(session, key)
  dispose = resolved()
else:                                  // 0.2.2 handle
  read = resolved.stateOf(session)
  dispose = resolved.dispose()
```

`src/index.ts` awaits the reader before creating native ports and keeps the existing `ctx.effect` disposal. Registration failures now reject plugin activation instead of being logged asynchronously; that fail-fast behavior is intended.

Alternatives:

- Replace the projection with a plugin-owned fold: rejected. It would lose the registry's replay/checkpoint behavior for live sessions and expand the change.
- Keep the deprecated callable/`stateOf`: rejected by the deprecation policy.
- Bump the minimum host to `0.2.2`: rejected; `0.2.1-rc.5` is the verified host.

### 6. Migrate the Inspector scripts and e2e template

The plugin-owned scripts evaluate serialized functions through `Runtime.callFunctionOn`, so a shared imported helper cannot enter those scopes. Each function gets a small local `readSession` helper that calls `ctx.get('sessionQuery').observeSession`, copies `header`/`events`/`inheritedEventCount`, and disposes the lease. Capability preconditions change from `inspect` to `observeSession`, and every `meta.cwd`/`meta.parentSession`/`meta.origin` becomes `header.*`.

The real-composition template uses `scaffold.ctx.sessionQuery.observeSession` with `try/finally`, and its UAT helper fakes provide a `sessionQuery` mock returning observations with `[Symbol.dispose]`.

### 7. Deprecation policy and the fresh-install sidebar check

`AGENTS.md` gains a short **Host API deprecations** section: check the pinned source for `@deprecated`, use the documented replacement, never add a new use, and design an alternative when no replacement exists rather than keeping the deprecated call as the final solution.

`docs/operations.md` and the install guidance document that a stale profile override (`- id: kanban` / `disabled: true`) survives a reinstall and hides the sidebar item. The verification lane checks `--dump-config` before booting and treats a remaining override as a configuration failure, not a plugin failure.

### 8. Version and manifest

Bump the manifest to `0.1.6` in the pull request. Add the session-query package as a dev-only dependency, update the lockfile, and add `ESNext.Disposable` to the TypeScript lib for `Symbol.dispose`. No runtime peer or storage schema changes.

### 9. Deprecation inventory

A sweep of the private DSH checkout (`0.2.2-rc.1`) against every host API the plugin uses found:

- Removed and migrated: `sessionController.inspect`.
- Deprecated and migrated: the `agent/request` waterfall, the callable return of `sessionProjections.register`, and `sessionProjections.stateOf(session, key)`.
- Deprecated and not used by the plugin: `Session.snapshotEvents`/`ownEvents`, `sessionController.page`, `cachedSnapshot`, `agent-tool-presentation`, and the client timer helpers.
- Deliberate evidence-tooling exceptions: `scripts/verify-native-ask.mjs` reads the host's existing `workingDirectory` projection through registry-level `stateOf` because the script cannot obtain the host's retained handle; the optional Inspector scripts install their own `agent/request` budget/guard listeners (`verify-native-conversations.mjs`, `verify-native-coordination.mjs`, and `verify-native-ask.mjs`). These are runtime evidence tools, not product paths: the plugin does not load them, they are not in `pnpm check`, and they should be migrated when the tooling is next revised. UAT fixtures keep `agent/request` or `inspect` only as fake service shapes and never exercise them against a live host.

No product path uses an API marked `@deprecated` on the `0.2.2` host after this change.

## Risks / Trade-offs

- **The `0.2.2` lane reveals another API gap** -> Run the isolated real-composition lanes early. If the gap is outside the history/deprecation paths, stop and bring a scoped decision instead of silently broadening the change.
- **`llm/stream` wrapping changes streaming or cancellation** -> Use an async generator that validates before `yield* next()`, and test abort propagation, provider rejection, and pass-through for non-task and purpose-bearing calls.
- **Moving the guard later in the lifecycle misses a path** -> Keep `agent/pre-step` and add a regression test that simulates a directory change during request-configuration middleware and asserts the provider is never called.
- **Projection registration errors now fail activation** -> Add a test for a rejected registration and for the handle/disposer branches. The behavior is intentionally fail-fast.
- **A consumer retains a cold observation** -> The adapter disposes internally and a focused test asserts the lease is released on success and on error.
- **Inspector scripts are not in CI** -> Their in-memory UAT tests update alongside them, and the manual scripts are run only in an authorized environment.
- **A stale profile disable override masks a successful install** -> Document the check and include it in the fresh-install verification; never mutate the owner's profile automatically.

## Migration Plan

1. Add the session-history adapter, its dev dependency, and the `ESNext.Disposable` lib setting.
2. Wire the adapter through native ports, task context, and the app history callback; simplify the native facts shape.
3. Replace the `agent/request` guard with the `llm/stream` guard.
4. Make `registerConversationFacts` asynchronous and add the projection version adapter.
5. Update host, native, task-context, projection, and guard tests.
6. Migrate the Inspector scripts, e2e template, and UAT helper fakes.
7. Update `AGENTS.md`, `docs/operations.md`, the install guidance, and the version.
8. Run `pnpm check` and the isolated `0.2.2-rc.1` lanes, then the fresh-install sidebar check.

Rollback is a source revert. No persisted data shape, projection state version, or profile migration is introduced.

## Open Questions

None.
