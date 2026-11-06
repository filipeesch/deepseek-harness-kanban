# Design

## Context

See `proposal.md` for motivation and the `hub-sharing` spec for behavior. The constraints that shape this design come from the existing plugin:

- `HubRepository` is the only writer. It serializes every mutation through one tail, applies a per-Hub revision, validates the whole aggregate with zod before persisting, and rejects reentrant transactions. There is no second write path.
- Durable state is expressed as DSH storage domains (`defineDomain` / `ctx.storageDomain`), one record per Hub plus a global metadata slot. Records are schema-validated at open and every write is durable before it resolves.
- The client is a local React page that renders an immutable `HostSnapshot` delivered by a stream (`follow`) and updated by commands. There is no second status channel.
- Git already has two execution paths: a session-confined executor for worktree operations and a plugin-owned, unsandboxed `runHostCommand` used by the project probe. Only the second can operate on a repository outside a task's workspace.
- No scheduler or background timer exists in the host today; every asynchronous coordinator is created in `apply()`, injected, and disposed with the plugin.

## Goals / Non-Goals

**Goals:**

- Keep the sharing domain pure and provider-independent: document, token, merge plan, application rules, and identity/reconnection must be testable without a repository or a clock.
- Preserve the single-writer invariant: an applied update is one Hub transaction, validated in full before anything changes.
- Make the feature invisible when unused: no binding, clone, timer, or snapshot field for an unpublished Hub.
- Reuse existing seams instead of growing `HubRepository`, `HubStore`, or `KanbanApp`: a new service, a new storage domain, and a provider port.

**Non-Goals:**

- Real-time collaboration or conflict-free merging of a single workflow document. Conflicting boards are resolved by an explicit per-board choice.
- Sharing projects, tasks, notes, conversations, Hub names, worktree paths, or global settings.
- Alternative providers in this version. The port exists so a later provider does not change the document, merge rules, or interface states.
- A general-purpose notification system outside the Kanban page.
- Automatic publishing, background commits on every save, or multi-Hub repositories.

## Decisions

### D1. Shareable content is extracted from `HubState`, never added to it

`HubState`, `HubStateSchema`, `HubRepository`, and `HubStore` remain unchanged. The shareable projection is derived from a `HubState` snapshot (boards only), and all local-only data stays in the Hub aggregate. Sharing state lives in a separate `kanban_sharing` domain keyed by Hub id.

**Why:** adding publishing fields to the Hub aggregate would mix a local transport binding with a model that is otherwise portable, force a schema revision on every installation, and make the merge rules depend on fields that are not part of the published document. **Alternative rejected:** a `sharing` block inside `HubState` (simpler wiring, but couples two lifecycles and grows the strict schema for everyone).

### D2. One document per Hub, workflow as an authored literal block

The published artifact is a single YAML document, versioned, containing one entry per board: stable key, name, order, and the workflow text as a literal block scalar. The workflow is stored as text, not re-serialized from the parsed model.

**Why:** a whole-document read/write maps cleanly onto any provider (one object, one token); per-board files would require multi-object atomicity and a directory listing for non-Git backends. Literal text preserves comments and formatting, which the product already promises for the editor.

```yaml
version: 1
boards:
  - key: delivery-flow
    name: Delivery Flow
    workflow: |
      name: Delivery Flow
      initial_column: backlog
      columns:
        - id: backlog
          label: Backlog
```

The document token is the canonical hash of the parsed content. The Git adapter compares that token with the remote file before writing and still refuses a push that raced, so a stale write is rejected before anything is committed.

**Alternative rejected:** per-board files (cleaner diffs, ambiguous tokens and partial writes).

### D3. Provider boundary owns transport, not synchronization

`SharedConfigStore` exposes `read()` returning `{ token, document } | null` and `write(document, { expectedToken, message })` returning the new token. The service never sees commits, branches, or remotes; the adapter never decides merges.

**Why:** the interface states, merge rules, and document format must survive a future Drive or S3 provider. A Git-shaped port (`fetch`, `commit`, `push`) would leak the mechanism into every caller. **Alternative rejected:** using the repository or a git client directly from the service (fast, untestable, provider-locked).

### D4. Managed clone through the plugin-owned command runner

The Git adapter resolves the clone under `DSH_HOME` (default `~/.dsh`), at `kanban/shared/<hubId>`, using an injected root for tests. Clone, fetch, commit, and push run through an injected `SharingCommandRunner` with the same shape as `ProbeRunner` in `project-probe.ts`, defaulting to `runHostCommand`.

**Why:** the clone is not a task workspace, so the session-confined executor cannot be used; `runHostCommand` already runs without a sandbox, clears `GIT_*` environment variables, disables terminal prompts, bounds output, and is injectable. Credentials stay in the user's Git configuration; the plugin stores no secret. **Alternative rejected:** requiring a pre-existing clone (decided against) and shelling out without a runner abstraction (untestable).

### D5. Application is a pure plan followed by one transaction

The domain computes a `SyncPlan` from three inputs (last received document, current local projection, published document): apply list, conflict list, refusal list, removal list, orphan list. `applySharingPlan(draft, plan)` mutates a Hub draft only after the whole plan validates. The service executes it inside a single `HubRepository.transact`, so a failure leaves the Hub untouched.

**Why:** the repository already clones, validates, and persists atomically; a plan keeps policy testable without I/O and prevents partial application. Reusing `saveBoardWorkflow`'s orphan-column rule before mutating keeps the same invariant. **Alternative rejected:** applying board by board through `HubStore` calls (partial states on failure, revision churn).

### D6. Identity is a document key; local ids never leave the machine

A board key is assigned at first publish from the normalized board name, made unique in the document, and stored in a `boardId → key` binding. Renames keep the key. An orphan keeps `lastKey` and `lastPublishedName`. Reconnection prefers an exact key match, then an exact normalized-name match among orphans only.

**Why:** local board ids are random UUIDs and names are mutable; neither is portable. **Alternative rejected:** using the local board id as the document key (leaks machine identity and breaks on adoption) and re-deriving the key from the name on every publish (a rename looks like a delete plus a create).

A published board that collides with an unpublished local board name is a refusal, never an implicit bind: binding would silently replace a local draft.

### D7. Published state is projected into the host snapshot

`HostSnapshot` gains a `sharing` map keyed by Hub id: publication status, interval, last successful check, current failure, draft/update/conflict counts, and per-board states. The client derives every indicator, banner, and panel state from it.

**Why:** the client already re-renders on snapshots; a separate subscription or RPC would duplicate the transport and risk split-brain between board data and sharing data. **Alternative rejected:** a dedicated `sharingFollow` stream (more moving parts, no benefit at this size).

Status model:

```
per Hub:  not-published | published | updates-available | needs-review | unavailable
per board: in-sync | draft | updates-available | needs-review | orphan | removed-here
```

### D8. Host-side polling with an injected clock

`SharingPollScheduler` schedules one timer per published Hub, checks immediately after startup and after a connection, then waits `intervalMinutes`. Default 5, minimum 1, `0` disables automatic checks. A due check waits five seconds and retries while a publish or update application for that Hub is in flight, then runs once that operation finishes. A failed check records the failure and keeps the last success; the next check simply retries at the interval.

**Why:** status must exist even when the page has been closed, and the decision was host-side. Injected timers keep tests deterministic and let disposal clear every handle.

### D9. One serialized lane per Hub for every sharing operation

Connect, disconnect, check, get updates, publish, resolve, restore, and orphan actions share a per-Hub promise chain inside `HubSharingService`, with the same tail pattern as the repository. A reentrant call is rejected rather than queued forever.

**Why:** a publish must not interleave with a check that changes the base, and a disable must not delete a clone under a running operation.

### D10. Publish gating and stale-token handling

Publishing is available only when the comparison shows no pending team change and no unresolved conflict. The write supplies the token of the last document read; a teammate's newer publish is refused by the provider, at which point the service refreshes the seen document, reports the updates, and publishes nothing.

**Why:** prevents overwriting a teammate's publish without review while keeping the write itself simple. **Alternative rejected:** auto-merging remote updates inside publish (decided against; it hides review) and last-writer-wins (loses team work).

### D11. UI composition stays out of the domain and the app

Configuration sections move to a small registry (id, label, render). The Publishing section is a standalone client module that reads the snapshot and calls `sharing` commands; the banner and tab indicators are pure presentational components fed by projections. The workflow editor exposes two actions and reports a failed share without discarding the save or the draft.

**Why:** the current nested-ternary section rendering would not survive a fifth section, and board/hub navigation already takes every fact through props, so indicators fit the existing pattern.

### D12. One RPC method with a discriminated command

`kanban/sharing` accepts a `SharingCommand` union (connect, disconnect, check, get updates, publish, resolve, restore, publish orphan, set interval); deleting an orphan is an ordinary board deletion and returns the updated `HostSnapshot`, matching `kanban/command`.

**Why:** each command currently costs four edits (types, schema, remote descriptor, host switch). One method and one union keeps the surface small and the return value consistent. **Alternative rejected:** one remote method per action (surface explosion) and reusing the existing `Command` union (mixes board mutations with a separate lifecycle).

### D13. Separate durable domain for sharing state

A new `kanban_sharing` domain (per-record, keyed by Hub id) holds the binding, the base document and token, board bindings, orphans, locally removed markers, and the last check result. The clone path is derived, not stored. Schema versioned independently from `kanban_hubs`.

**Why:** opening, validating, and closing the sharing domain independently of the Hub domain keeps existing installations untouched and lets the feature be disabled without migrating Hub records.

### D14. Bundled cleanups

Two refactors ship with this change because sharing touches them directly:

- a Configuration section registry replacing the nested ternaries in `configuration.tsx`;
- a settings validation module that the host command path and `normalizeSettings` share, removing the duplicated checks in `KanbanApp.settings()`.

Deferred on purpose: unifying `BoardSettings` / `KanbanSettings` / `KanbanMeta`, migrating the older settings panels to `useAction`, and reducing the four-place command definition pattern.

### D15. Deterministic tests

Domain tests cover the plan matrix and identity rules without I/O. The Git adapter runs against real temporary repositories with a local bare repository as the team remote, so no network is involved. The scheduler uses fake timers. The service runs with an in-memory `SharedConfigStore`. The browser harness covers the Publishing section, banner, indicators, and the two save actions.

## Risks / Trade-offs

- **Background fetch traffic every five minutes per Hub** → interval is per Hub, `0` disables it, checks skip when unreachable without blocking work, and `Refresh` exists for manual checks.
- **Credential or network failure during a check** → terminal prompts are disabled, so the failure is an explicit error with the last successful check time rather than a hung process; local work continues.
- **Silent automatic reconnect by name could bind a semantically different board** → key match wins, name matching applies only to orphans, and only when no key matches; the orphan state and the reconnected board are both visible on their tabs.
- **A publish from two machines at once loses the race on one side** → the stale token is refused; the loser keeps drafts and is told to get updates first.
- **Applying an update while a workflow editor holds a draft for the same board** → the existing revision conflict protects the save; the editor shows the host error and keeps the draft.
- **Clone disk usage and leftover clones** → one clone per Hub, removed on disable and on Hub deletion; a plugin uninstall can leave the directory behind, which is documented in operations.
- **Scheduler lifecycle leaks** → the scheduler is created in `apply()`, its timer is injectable, and disposal clears every handle before the app closes.
- **Document growth for very large workflows** → whole-document writes are bounded by the existing host command output limit; a limit and truncation policy are not part of this version.
- **Provider abstraction could leak Git semantics through the token** → the token is treated as an opaque string by the service; only the adapter interprets it.
- **A failed durable state save after a Hub transaction or a provider write** → no board content is lost, but the record can lag the effect: created boards may be unbound (the next update reports a name collision) or the seen document may be stale (the next publish reports a race and refreshes it). A pending journal is intentionally out of scope for this version; the recovery paths are documented in `docs/operations.md`.

## Migration Plan

No data migration. Existing installations have no `kanban_sharing` record, so every Hub reads as unpublished and the feature stays inert. The new domain is created on first enable. `HubState` and its stored records are untouched, so a rollback is a plugin downgrade with the sharing domain simply unused (and its records removable without affecting boards). Disabling publishing removes the binding and the clone; Hub deletion removes them too. Deployment requires no configuration change and no new runtime dependency; Git is required only while a Hub is published.

## Open Questions

- The exact clone root (`DSH_HOME/kanban/shared/<hubId>`) is a first choice; if the host later exposes a supported plugin data directory, the adapter can switch without touching the domain or the specs.
- Exponential backoff after repeated failed checks is deliberately left to the interval only; adding it later changes check timing, not behavior.
- Supporting several Hubs in one repository is deferred; the document already carries board keys, so it would be a path-scoping change in the adapter and the binding record.
