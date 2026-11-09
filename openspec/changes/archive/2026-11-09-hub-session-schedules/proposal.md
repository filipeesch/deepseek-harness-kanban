# Proposal

## Why

A Kanban Hub can already configure boards, projects, workflows, and team storage, but every
native session still starts from a human action. The schedule service available at the pinned
SDK version (`0.2.1-rc.2`) only targets an existing session and carries no workspace or model
choice, so it cannot express "run this prompt every weekday at 08:00 in project X with model Y".
Users who want recurring unattended work (a daily digest, a dependency review, a regression
sweep) have to remember to start it themselves.

## What Changes

- Add Hub-scoped session schedules. Each schedule stores a title, a prompt, a five-field cron
  expression with an IANA time zone, a model selection, the target Hub project, a
  "new conversation per run" option, an "archive when idle" option, and an enabled flag.
- Add a **Schedules** configuration tab and an overlay editor for create, edit, and delete. The
  editor validates the cron expression, shows its plain-language description and the next
  occurrences, and picks the model from the host model catalog.
- Add a host-owned coordinator that fires enabled schedules while the host runs. Each occurrence
  resolves the project workspace, creates the session (or reuses the continuous one), applies the
  model, sends the prompt, and archives the session once it is genuinely idle.
- Add deterministic run admission: an occurrence missed while the host was closed is skipped, and
  an occurrence due while the previous run of the same schedule is still active is skipped. The
  next occurrence is always a future one.
- Show, per schedule, the last run (time, status, error, and session) plus a live running
  indicator, and offer **Run now** for a saved schedule.
- Keep schedules local to the Hub. They are never written to `kanban-hub.yaml`. Deleting a
  schedule cancels its timer and keeps the sessions it already created; deleting a Hub cancels
  its schedules.
- Out of scope: creating Kanban tasks or cards, replaying missed occurrences, publishing
  schedules to a team, running while the host is closed, and per-run history beyond the last run.

## Capabilities

### New Capabilities

- `hub-schedules`: Hub-scoped session schedules, covering configuration, the settings surface,
  execution admission, run results, and local persistence.

### Modified Capabilities

- None. Existing capabilities keep their requirements; the new schedule collection is optional,
  so existing Hubs load unchanged.

## Impact

- **Domain**: `HubState` gains an optional `schedules` collection with strict validation, plus a
  pure cron module (parse, describe, next occurrences) shared by the host and the client.
- **Host**: a new schedule coordinator and runner, a dedicated local storage domain for run
  state, commands (`schedule.save`, `schedule.delete`, `schedule.setEnabled`,
  `schedule.runNow`), a model-catalog remote, and a runtime projection in the host snapshot.
- **Client**: a new configuration section and schedule editor; the editor consumes the model
  catalog and the configuration modal gains one section.
- **Dependencies**: none added. Per-schedule models use the host's public session-scoped model
  selection (DSH 0.2.2+); an older host records a clear failure instead of writing the installation
  default.
- **Tests**: cron including time-zone and DST cases, coordinator admission and archive behavior,
  command validation, client editor behavior, and the existing isolated lanes.
