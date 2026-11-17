# Schedules

**Configuration → Schedules** runs a prompt unattended on a cron schedule. A schedule belongs to one Hub and stores a title, a prompt, a five-field cron expression with an IANA time zone, the Hub project it runs in, an optional model, and two behavior options.

The editor offers **Hourly**, **Daily**, **Weekly**, and **Manual** quick choices; the manual choice leaves the expression editable, and the editor always shows its plain-language description and the next three occurrences. An invalid expression, an unknown zone, a missing prompt, a project outside the Hub, and an expression that never fires are refused at save time.

## Execution

A schedule executes only while the host is open. An occurrence missed while the host was closed is skipped, and an occurrence due while the previous run of the same schedule is still active is skipped instead of queued; the next occurrence is always a future one. **Run now** executes one occurrence through the same path without moving the scheduled occurrence, and refuses a paused or already-running schedule.

Every run creates a native conversation in the project's workspace unless **New conversation for each run** is turned off, in which case one conversation is reused. The conversation is titled after the schedule and the occurrence time.

**Archive the conversation once it is idle** (on by default, available only for per-run conversations) removes it from the workspace list after the turn settles, provided no question, approval, queued prompt, job, or subagent still needs attention. Archived conversations remain in session persistence and can be reopened from the schedule's last run.

A continuous conversation is reused only while it still belongs to the schedule's current project and its recorded directory still passes native admission; otherwise the occurrence creates a fresh conversation.

## Model and failures

The **Model** choice comes from the host catalog and is applied only to the scheduled conversation; the installation default is never written. That session-scoped selection requires a host that exposes it. On a host without that capability, an occurrence with a model fails before sending anything and the failure is recorded, instead of changing your default. A model that is no longer in the catalog fails the same way.

A schedule that cannot run — a missing project directory, an unavailable model, a rejected prompt — stays enabled, reports the failure as its last run, and tries again at the next occurrence. A failed occurrence keeps its conversation identity, and the last-run action opens that conversation, unarchiving it first when the host supports it.

## Limits and data

Schedules are local to the Hub and are never published. The last-run summary and the running indicator are machine-local runtime state, so a run finishing in the background never invalidates an open editor.

A Hub holds at most 50 schedules, a title of up to 120 characters, and a prompt of up to 20,000 characters.

Deleting a schedule stops future occurrences and keeps the conversations it already created. Deleting a Hub removes its schedules the same way. Deleting the last schedule removes the schedule collection from the Hub, so an older strict schema can parse it again; with schedules still stored, downgrading to a plugin release that predates them fails to parse the Hub.

A scheduled prompt runs unattended with the host's normal file policy and no per-run approval. Pause the schedule when you do not want it to run.
