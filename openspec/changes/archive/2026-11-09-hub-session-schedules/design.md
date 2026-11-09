# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- The plugin targets the pinned DSH SDK `0.2.1-rc.2`. At that version the public schedule
  service is session-bound: `schedule.create(sessionId, request)` delivers a prompt to an existing
  session and accepts no target, working directory, or model. The 0.2.2 target API is not
  available without a broad SDK bump and still carries no model choice.
- Hub state is one aggregate per Hub, persisted through `storageDomain` and written only by
  `HubRepository.transact`, which clones, validates with a strict zod schema, increments
  `revision`, and persists before publishing. The client reads state through a typert snapshot
  stream; a frame carries `state` only when the revision changed, and the client merges frames by
  spreading them over the state it holds.
- A Hub record contains projects, boards, tasks, and notes. The team document serializes only
  boards and workflows, so anything else stored in the Hub is local by construction.
- Sessions are created through `SessionPort.create(projectPath, workspaceId)`; project workspaces
  are provisioned visibly by `WorkspaceCoordinator.ensureProject`. The model catalog and
  per-session selection are public on `sessionController`; the installation default model is
  exposed by the `agentDefaultModel` service, published at the same pinned version but not yet a
  dependency of this package. Archiving is `workspaceRegistry.archiveSession`, which refuses a
  session with reported activity unless `stopActivity` is requested.
- Existing host code already uses injectable timers (`AutoAdvanceCoordinator`,
  `PublishScheduler`, `SharingPollScheduler`) and injectable clocks, so the scheduler can follow
  the same testable pattern instead of inventing a new one.
- The configuration modal renders one section per concern; `useAction`, `Modal`, and
  `ErrorNotice` already provide the interaction and error conventions used by every editor.

## Goals / Non-Goals

**Goals:**

- Store a Hub-scoped schedule collection inside the Hub aggregate, validated by the same writer
  and optimistic revision every other Hub edit uses.
- Execute occurrences from the plugin host with deterministic admission: one run per schedule,
  skipped missed occurrences, and no queue.
- Apply the stored model to the session created for an occurrence while preserving the
  installation default for new conversations.
- Archive a conversation only at genuine quiescence, and only when the schedule created it.
- Keep run results (last run and in-flight state) out of the Hub revision so a background run
  cannot invalidate an open editor.
- Present the schedule list and editor in the existing configuration modal, with cron validation,
  plain-language description, occurrence preview, and last-run feedback.

**Non-Goals:**

- Team sharing of schedules, per-run history, catch-up of missed occurrences, seconds-level cron,
  prompt templating, approvals before execution, or creating Kanban tasks.
- Refactoring existing command dispatch, remote schemas, or Hub settings components. The new
  feature is added next to them in their current shape; those candidates are recorded separately
  and are not part of this change.
- Changing the native schedule service, the SDK pin, or any deprecated host API.

## Decisions

### 1. The plugin owns the scheduler

A plugin host coordinator owns timers and admission; it does not call the native schedule
service.

- The pinned native service cannot choose a workspace or a model, and it binds delivery to a
  session created before the schedule exists. Archiving that session would also detach the reminder
  from its visible target.
- Alternatives considered: a dedicated native-schedule session per schedule (rejected: no model or
  workspace control, couples schedule lifetime to a session), and bumping to the 0.2.2 target API
  (rejected: still no model, broad SDK bump, no benefit for this design).

### 2. Configuration lives in `HubState`; run state lives in its own domain

`HubState` gains an optional `schedules` array. Each schedule carries identity, title, prompt,
cron, time zone, project reference, optional model selection, the two behavior options, and
enabled state. All writes go through `HubRepository.transact` with the caller's
`expectedRevision`, so editing a schedule participates in the same optimistic concurrency as
boards and projects. The collection is optional, so Hubs stored before this change validate
unchanged and no storage migration is needed.

Run state (last run, in-flight marker, and the continuous-session binding) is written to a new
per-record domain, `kanban_schedule_runs`, keyed by schedule id, following
`openQuestionStorage`.

- Rationale: a completed run must not bump `hub.revision`, or a finished background run could
  reject a user's open editor with `REVISION_CONFLICT`. It also keeps machine-local runtime out
  of a document that is conceptually user-authored configuration.
- The continuous-session binding is runtime, not configuration: binding it must not change the
  config revision either.
- The aggregate requires every schedule's project to exist, so deleting a project a schedule
  targets is refused with an instruction to delete or repoint the schedule first; cascading the
  deletion would discard configuration the user did not ask to remove.
- Alternatives considered: run state in the Hub record (rejected: revision churn), or both config
  and run state in a separate domain (rejected: adds a second snapshot channel for data that
  already belongs to the Hub aggregate).

### 3. Cron is a pure domain module

`src/domain/cron.ts` parses, validates, describes, and computes next occurrences for a
five-field expression plus an IANA zone. The host and the client editor use the same module, so
the preview and the actual schedule never diverge.

- Supported: `*`, single values, lists, ranges, steps, three-letter month and weekday names, and
  `@hourly`/`@daily`/`@weekly`.
- Time-zone math uses `Intl.DateTimeFormat` over UTC instants rather than a new dependency. A
  candidate wall-clock time is mapped to an instant and formatted back; a mismatch means the
  local time does not exist (daylight-saving gap) and that date is skipped. When a wall-clock time
  exists twice, the earlier instant is chosen.
- Validation rejects malformed expressions, out-of-range fields, and expressions with no
  occurrence inside a bounded search horizon (for example, February 30), so an enabled schedule
  always has a future occurrence.
- Alternatives considered: `cron-parser` or `croner` (rejected: new dependency and different
  daylight-saving semantics from the host's documented behavior; the supported subset is small and
  testable).

### 4. One coordinator, one runner

`ScheduleCoordinator` owns timers and admission; `ScheduleRunner` performs exactly one
occurrence. Both receive their collaborators through constructor options, matching the existing
coordinators.

- The coordinator arms one timer per enabled schedule for its next occurrence. `setTimeout` is
  clamped to its maximum delay and re-armed, so schedules farther in the future still fire.
- On fire, the coordinator admits the occurrence when the schedule is enabled and not already
  running. When the timer fired late, the occurrence it was armed for still runs once; every
  intervening occurrence is skipped by recomputing the next occurrence strictly after the current
  time. When the host was not running, no timer exists, so nothing is replayed; startup only
  re-arms future occurrences.
- Admission reserves the schedule synchronously, persists the running marker, and only then lets
  the runner create a session; a failed marker write rolls the reservation back. A due occurrence
  for a dispatching schedule is dropped, not queued; a run-now request is rejected with a problem.
- A dispatch is active from admission until its prompt is admitted; an already-admitted model turn
  may still be running when the next occurrence is admitted. The skip rule therefore governs
  overlapping dispatches, not the whole model turn.
- Run-now shares the runner and the running set but does not touch the timer.
- Startup arms timers after the app finishes its own initialization. Shutdown aborts the plugin
  lifetime, stops timers, drains admitted executions before run storage closes, and lets an
  already-admitted native turn finish without creating or sending another occurrence. A run that
  never finished leaves a `running` record that becomes an interrupted failure at the next startup.

Alternatives considered: a single global tick loop (rejected: harder to test and to reason about
late firing), and a queue per schedule (rejected by the skip semantics).

### 5. Occurrence pipeline

For one admitted occurrence the runner:

1. persists the running marker and refuses a duplicate admission (before any native side effect);
2. loads the current schedule from the Hub, revalidates its project reference, and rejects a
   relocating project;
3. ensures the project's visible native workspace through the existing workspace coordinator;
4. resolves the target session — a new session for a new-conversation schedule, or the recorded
   continuous session only while its binding names this project and `validateDirectory` admits its
   directory; otherwise it creates and binds a fresh session;
5. records the session on the running marker;
6. applies the model selection, when present;
7. sets the conversation title, best effort;
8. re-reads the project and calls `validateDirectory` again immediately before the prompt, refusing
   a relocation or changed path;
9. sends the prompt through `SessionPort.send` with a stable request identity;
10. records the run result;
11. registers a per-run session for idle-archiving when archiving is on.

Failures before the prompt (project missing, workspace failure, session creation, unavailable
model) end the occurrence with the failure recorded; a session already created for it is archived
under the same idle rules. Failures never pause or disable the schedule.

The runner awaits the durable marker and finalizes the run after the prompt is admitted, so a crash
is visible as an interrupted run and storage failure creates no unrecorded session.

### 6. Model selection is session-only

`applySelection(sessionId, selection)` validates the route with `llm.resolveCallConfig`, checks
catalog membership, resolves the live Agent through `sessionController.resolveAgent`, and installs
the selection through the Agent's session-scoped model face (`agent.model.select`, public on DSH
0.2.2 and newer). That face records the choice on the Session and has no persistence side effect.

- The plugin never calls `sessionController.selectModel` and never writes `agentDefaultModel`.
  That entry point also persists the installation default in a queued background save, and a
  restore queued after a user's pending save can overwrite the user's newer selection; no public
  compare-and-swap over pending writes exists, so avoiding the write is the only compliant path.
- When the host exposes no session-scoped face, the occurrence fails before sending and records
  the failure. A schedule model therefore requires DSH 0.2.2 or newer; this is the documented
  compatibility boundary for that field.
- At save time the editor validates a stored model against the catalog when the catalog is
  available and preserves the reasoning effort; at run time an unavailable model fails before the
  prompt.

### 7. Idle-archiving is event-driven

`ScheduleArchiveWatcher` tracks sessions created by occurrences (never continuous ones). It
evaluates after a `turn/end` for that session and after the agent reports idle, using the same
question-aware facts source as attention: plugin `decision_request` rounds count as pending, so a
conversation awaiting one is never archived. An observation that arrives during an awaited
evaluation sets a dirty flag and triggers a coalesced reevaluation, so a final idle event is not
lost. Archive uses `archiveSession` without `stopActivity`; a failed attempt is recorded as
`archiveError` on the run it belongs to (matching the session, so an older conversation cannot
overwrite a newer run) and never fails the delivery. A later successful archive clears it. The
watcher unregisters after a successful archive or when attempts are exhausted.

### 8. Command and read surface

- New commands: `schedule.save`, `schedule.delete`, `schedule.setEnabled`, and
  `schedule.runNow`, added to the existing command union, remote schema, and controller switch.
  Each config command validates the Hub, the schedule fields, and the caller revision.
- A new unary remote, `kanban/modelCatalog`, returns the host model catalog (including model
  reasoning metadata) for the editor. The host caches the catalog briefly; the editor requests a
  refresh when it opens, so opening the overlay never reads a stale route list.
- Run runtime rides the existing snapshot as the optional `scheduleRuntime` projection keyed by Hub,
  merged by the existing frame spread. No new stream is introduced; the coordinator calls the app's
  publication path when a run starts or finishes.

### 9. Client composition

- The configuration modal gains a `Schedules` section when a Hub is selected.
- `src/client/settings/schedules/` holds the surface: a list with per-schedule actions, a draft
  module with pure validation, a controller hook for load/save/delete/run-now, and one overlay
  editor using `Modal`. The editor shows the cron description and the next three occurrences from
  the shared domain module, offers hourly, daily, weekly, and manual quick choices (the first three
  fill the expression and manual leaves it editable), and loads the model catalog when it opens.
- The last-run link uses the optional `uiWorkspace` service to unarchive and open the session,
  for a sent or failed run. When that service is absent, the row shows the conversation identity
  without a link. The adapter is a small tested module so the unarchive-before-open order is not
  buried in the page.

### 10. Limits and compatibility

- At most 50 schedules per Hub; exceeding it is rejected by validation.
- `HubStateSchema` gains an optional array, so no schema-version bump is needed and existing Hubs
  load unchanged.
- Deleting the last schedule removes the optional collection from the Hub, so the older strict
  schema can parse it again. With schedules still stored, a rollback to a plugin version that
  predates this change fails to parse the Hub; this is recorded in the migration plan.

## Risks / Trade-offs

- **Late timers and sleeping hosts** → The coordinator runs the occurrence it was armed for once,
  then recomputes strictly after the current time; occurrences that passed while no timer existed
  are never replayed, matching the chosen policy.
- **Timer drift and `setTimeout` overflow** → Delays are clamped and the next occurrence is always
  recomputed from the clock, never accumulated.
- **Model default race** → Eliminated by never writing the default; a host without session-only
  selection fails the occurrence instead. The trade-off is that scheduled models require DSH
  0.2.2 or newer.
- **Archive race with a new turn** → The watcher gates on question-aware facts, never uses
  `stopActivity`, coalesces observations, and records a persistent failure without changing the
  delivery outcome.
- **Crash between admission and dispatch** → The running marker is durable before any native side
  effect; a crash becomes an interrupted failure rather than an unrecorded execution.
- **Shutdown during preparation** → The runner checks the plugin lifetime before each native side
  effect, and shutdown drains admitted executions before closing run storage.
- **Cron/time-zone correctness** → The module is pure and covered by gap, overlap, name, step,
  leap-day, and unsatisfiable-expression tests; unsupported syntax is rejected rather than
  approximated.
- **Many schedules or long prompts** → A per-Hub cap and a bounded prompt length keep the Hub
  record and the editor responsive; run admission stays one per schedule.
- **Downgrade incompatibility** → Recorded in the migration plan; no backward-compatible reading
  is possible once a Hub stores schedules.
- **Unattended execution** → A scheduled prompt runs with the host's normal policy and no
  per-run approval; the editor copy states this, and pausing the schedule is the supported stop.

## Migration Plan

1. Ship the schema addition and the new run domain together. No data migration is required:
   existing Hubs parse with no schedules, and the new domain starts empty.
2. On first startup after the upgrade, the coordinator finds no schedules and arms no timers;
   adding a schedule through the editor arms it immediately.
3. Rollback: remove schedules before installing an older plugin, or accept that the older strict
   schema cannot parse a Hub that stores them. The run domain can be left in place; older code
   ignores unknown domains.
4. Verification: domain and host suites for cron, admission, injection, and archiving; client
   suites for the editor and list; the isolated lanes for the settings surface where they already
   cover configuration.
