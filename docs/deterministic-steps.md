# Deterministic workflow steps

> **Safety limitation:** Process ownership is tracked by an inherited run token that the guard sweeps before reporting cleanup, so a descendant that detaches into another process group is normally terminated on Stop and after host loss. Because POSIX signalling has no native process handle, a pid that another actor kills and the kernel reuses at that exact instant, or a descendant that changes credentials, is a residual best-effort gap rather than a proof; details are under execution and process ownership. A program that deliberately removes that token from its children's environment, or that hands work to another machine, is outside the tracked set. The sweep also needs a readable process table; when it cannot read one, cleanup is reported as uncertain and the next attempt fails closed instead of running concurrently. Review this limitation before relying on deterministic steps for irreversible side effects.

Deterministic stages run repeatable Bash or TypeScript checks without creating a conversation, selecting a model, or spending model tokens. Scripts own their loops, sleep intervals, and business deadlines. Entry requests execution even when **Auto mode** is off, subject to local trust, execution capability, file policy, and task-directory admission. No implicit worktree or five-second prompt countdown is needed. Saving configuration, opening a drawer, reordering within a stage, or loading an old card does not start code.

## Compatibility and installation

Artifact **0.29.0** requires **DSH >=0.2.2-rc.1 <0.3.0-0**, **Node >=24.9.0**, and development **pnpm 10.15.1**. The lockfile records the tested **0.2.2-rc.1** SDK; declared SDK ranges are bounded. DSH evaluates prereleases in admission, so the explicit upper bound excludes 0.3 prereleases too. Host admission is not a claim that every optional execution provider is available.

Install from `https://github.com/filipeesch/deepseek-harness-kanban`, optionally pinned with `#<commit sha>` (immutable) or an existing version tag (a convenience, not an immutable pin). Follow [repository installation](<../README.md#install-from-the-repository-url>): the profile must approve the resolved Git dependency's **prepare** build. An unbuilt clone has no loadable bundle and can report installation success before failing to import. Verify its built entries and actual native activation; installation alone is not activation evidence.

The plugin consumes the public native PTC runtime and shell seams, not the chat run_code transport, a model turn, or a plugin-process evaluator. TypeScript requires a fresh isolated **function-body** provider; retained REPL/Script formats are not interchangeable. Bash requires no-deadline execution, abort/drain, bounded output, and the selected native policy. Its lifetime guard also requires a compatible Node executable in the native execution world, not just Node in the plugin host. Both executors use authenticated private auxiliary lifecycle witnesses to report on process ownership and cleanup; these records are not a second run-control database. Bare PIDs or control-channel EOF alone are not cleanup proof. Each execution also owns a random `DSH_DETERMINISTIC_RUN` token inherited through the environment; before reporting cleanup, the guard signals the recorded process group and then sweeps every remaining process that carries the token. It confirms the token in a candidate's own environment before touching it, freezes it only then, and never resumes a process that was already stopped. A pid that another actor kills and the kernel reuses in the instant between that confirmation and the signal cannot be excluded by POSIX signalling alone, and a descendant that changes credentials can no longer be inspected; on Linux the native systemd scope remains authoritative when the provider selected one. Hosts without an OS ownership primitive therefore get best-effort exclusion rather than a hard guarantee, and the product does not claim one. A descendant that detaches into another session is therefore still owned, while a child whose environment the program deliberately rewrites is not. A process whose environment cannot be read cannot be inspected, so it is outside the tracked set (the credential-change residual above); the rest of the table is still swept, and an unreadable table on another platform reports uncertain ownership instead of clean. The current Windows guard is unsupported and fails closed. An absent/incompatible provider, unsupported confinement, missing credentials, or uncertain process ownership fails visibly without permission widening, plaintext credential fallback, or disabling conventional Kanban.

## YAML

The complete [local CI workflow fixture](<../tests/e2e-dsh/deterministic/workflow.yaml>) uses this stage:

```yaml
- id: wait_ci
  label: Wait for local CI
  deterministic:
    language: typescript
    directory: task
    file: wait-ci.ts
    params:
      - name: pipeline
        description: Local CI pipeline identifier.
    exits:
      passed: review
      rejected: fix
      error: repair
```

- **language:** `bash` or `typescript`.
- **source:** exactly one nonempty `code` or `file`. Files contain the same primary program body as inline code, not an export-default module.
- **directory:** `task` (default effective task directory, including a bound worktree) or `project` (base project). Relative file paths resolve there; absolute paths still require native policy admission. Review shows the canonical source.
- **env:** optional authorized names only, for example `env: [CI_TOKEN]`. Never put values or credential references in shared YAML.
- **params:** required parameters declared as a list of `{ name, description? }`. Names are unique safe identifiers; each description is optional guidance for the origin stage. The declaration is reviewed authority and never carries a value.
- **exits:** named outcomes to existing stages. Different names may share a destination; self-routes are rejected. There is no first-exit default. Do not also configure a nonempty entry instruction or an allowed-transition list.

The exit mapping is the only script routing declaration. Existing free-text transition conditions remain documentation, not expressions.

### Required parameters

A deterministic stage can declare parameters when the same script must monitor a different pipeline, app, or environment per task. The declaration is published with the workflow; the values are not. Every declared name is required: there is no default, optionality, or secret parameter, because local variables remain the credential channel. The accepted bounds are 32 parameters, a 64-character name, a 200-character description, a 4,096-character value, and 32 KiB across the value set.

The values come from the transition that creates the entry. `list_allowed_transitions` reports each target's declared names and descriptions, and `set_next_transition` accepts a `parameters` object containing exactly those names as nonempty strings. A missing, unknown, empty, or oversized value is rejected with the accepted names, so the agent corrects before the task moves. Placement revalidates the recorded set against the destination's current declaration and fails that transition instead of creating a mismatched entry.

An entry created without a value, including by a manual move, task creation, an automatic advance, or a script exit, fails in place with a diagnostic that names the missing parameters. That failure is a configuration refusal, not an executor failure: it never follows the `error` exit, it adds no history entry, and the entry stays available for repair. The card and drawer script panel show the entry's values read-only and offer **Edit parameters** whenever the entry is not active or stopping. Saving values neither grants trust nor starts code; press **Play** afterwards. Play captures the latest saved declaration and revalidates against it, so a newly declared name must be filled before the new execution starts. Parameter values are task data: they are recorded on the execution that used them and are never published, resolved as credentials, or interpolated into source.

## Script ABI

A successful program produces exactly `{ exit: string, message: string }`, with nonempty values and no extra fields. Both source forms use the same ABI.

### TypeScript

TypeScript is an asynchronous function body supporting top-level await/return. The host provides:

- `input`: structured task/project metadata, entry and execution identity, original `startedAt`, attempt identity/restart count, the entry's declared parameter values as `params`, and an incoming deterministic handoff when applicable. It contains no resolved secrets and never an undeclared parameter name.
- `await env.get("CI_TOKEN")`: read-only access to an explicitly authorized local variable, separate from metadata.
- **Only** `tools.bash({ command, timeoutMs? })` in the tool namespace. The command deadline is optional and kills on expiry; it never creates a detached chat job. The result includes `exitCode`, `signal`, `timedOut`, `aborted`, and bounded `stdout/stderr: { text, truncated }`. A nonzero nested Bash exit is data that the program may handle; a host rejection is an exception, and leaving it uncaught reports the host cause rather than the exception.

The [TypeScript CI fixture](<../tests/e2e-dsh/deterministic/wait-ci.ts>) checks a [local fake CI script](<../tests/e2e-dsh/deterministic/fake-ci.cjs>) and waits in its own loop:

```typescript
const deadline = Date.parse(input.startedAt) + 60_000;
while (Date.now() < deadline) {
  const check = await tools.bash({ command: 'node fake-ci.cjs', timeoutMs: 5_000 });
  if (check.exitCode === 0) return { exit: 'passed', message: 'Local CI passed.' };
  if (check.exitCode === 1) return { exit: 'rejected', message: 'Local CI rejected the change.' };
  if (check.exitCode !== 2) throw new Error('Local CI checker failed.');
  await tools.bash({ command: 'sleep 0.02', timeoutMs: 1_000 });
}
throw new Error('Local CI business deadline expired.');
```

No short interactive tool-call deadline bounds the whole program. Keep checks repeatable: primary code approval cannot prove arbitrary code read-only or make remote effects exactly once. Outstanding nested Bash calls are canceled and drained when the outer program returns, throws, or is stopped.

### Bash

Standalone Bash receives one JSON input-context document on stdin. It must exit **zero** and write exactly one JSON completion document to stdout; use stderr for diagnostics. Logs followed by JSON, multiple documents, truncated/oversized data, extra fields, and missing completion are errors. A nonzero standalone Bash exit fails even when stdout resembles a valid completion.

```bash
printf '%s\n' '{"exit":"passed","message":"Local CI passed."}'
```

The [equivalent looping Bash fixture](<../tests/e2e-dsh/deterministic/wait-ci.sh>) reads stdin and derives its deadline from the preserved start time. It needs only Node and Bash plus the local fake checker; it calls no real CI/CD account.

## Completion, handoff, and errors

An entry that lacks a declared parameter value never reaches the program: it fails in place with a diagnostic that names the missing parameters, follows no error exit, adds no history entry, and stays available for Play and parameter editing.

A valid exit selects exactly the destination in the trusted captured mapping, independently of Auto mode. The host persists the terminal result before movement or native delivery. Pending user work/context changes may hold delivery without checking CI again. A renamed destination retains its stable identity; removing it causes a routing failure, and reusing its authored identifier cannot hijack delivery. Editing a mapping affects the next capture, not an active result.

Every settled failure is classified by origin before it is routed or reported:

- **script** — the program threw, or returned an exit its captured mapping does not name.
- **contract** — the returned completion violates `{exit, message}` or its size bound.
- **infrastructure** — the guard, its transport, or the execution runtime failed while the program was running.
- **configuration** — the run could not be attempted as configured: a changed entry context, a missing or out-of-scope variable, an unrecoverable capture, a missing host capability, or a file policy the host cannot establish.

The origin is stored with the diagnostic and shown on the card's script panel and in History. A script or contract failure follows the captured reserved **error** destination, which also receives an infrastructure failure when the stage does not map the reserved **infrastructure** destination. `infrastructure` never receives a script failure. A configuration refusal follows no destination: the task stays in its stage with the diagnosis and **Play**. Ungranted trust is an authorization wait, not a failure. Stop and supersession never route. Destination removal or native handoff delivery failure does not recursively follow a failure route. An execution already captured keeps its captured mapping, so mapping the reserved destination requires a new capture and therefore a new local approval, because exits are part of the approved fingerprint.

### Guard failures and retries

A guarded Bash call can end without the guard's result envelope. The host repeats that call only when the guard provably never started the command: both streams exactly empty and not truncated, exit status 125, and no terminating signal, timeout, or abort. Any other evidence — command output, a guard diagnostic line, a signal, or another status — is not repeated, because the command may already have produced an effect. One call makes at most three attempts with a short growing wait, and **Stop** vetoes the next attempt immediately, even while native cleanup is still draining. A repeated call is invisible to the program and never restarts the execution.

An infrastructure failure is delivered as one sentence carrying its origin, the number of attempts, and where the detail lives; it never contains a stack trace or a local filesystem path. A provider's own text is kept as the nested cause and the delivered sentence comes from the failure code, so arbitrary provider output cannot reach the destination stage. A configuration failure never reaches a destination: its summary stays on the card. The bounded guard facts — whether the command was admitted, its exit status or signal, how long it took, how much it wrote, and both retained windows of its diagnostic stream — are recorded on that execution and shown in the script panel and, behind an expandable **Evidence** block, in History. Redaction runs over the whole stream before a window is cut, so a secret that crosses that boundary is redacted as a whole value. A program that catches a host rejection and then finishes normally is not a failure; one that lets it escape reports the host cause with the program exception recorded as its nested cause.

An agent destination receives its own instruction and one identified output/provenance block in the same native context message and turn; only that downstream instruction creates a conversation when needed. A script destination receives structured input, without a conversation. A manual destination retains the handoff for the next explicit native execution in that exact entry; merely opening or creating a conversation does not consume it or force a turn. Handoffs are not user input, composer text, queued user work, title text, or fake agent-declared reasons. Durable delivery identity prevents duplicate accepted context across retries/restart; recorded delivery failures remain manual-retry.

## Stop, Play, edits, and restart

- **Stop** durably revokes the current run, then aborts/drains its owned processes. It stays in the stage, sends no handoff, and remains stopped after restart.
- **Play** captures the latest valid saved configuration and primary file, performs any new trust review, revalidates the entry's parameter values against the captured declaration, and starts a new execution/start time in the same entry. A declaration name added after the entry was created fails in the card until its value is edited. Play is not dry-run: a later success routes normally. It waits for predecessor cleanup before replacement.
- Saving agent/manual mode does not stop an existing captured script or hide Stop. Play explains when saved configuration is no longer deterministic instead of silently running old code or starting an agent.
- A genuine move away invalidates the old entry. Moving back creates a new one; late results and native admission from the old visit are rejected. A refused move does not stop a run.
- Active recovery restarts **from the beginning**, using captured primary bytes/routes, the same logical execution and original start, and a new attempt/restart count. No stack, shell variables, timer remainder, or missed polls are restored. Compute business deadlines from `input.startedAt`.
- Changed/deleted original files do not replace an active capture. Missing/corrupt captured bytes fail closed. Stopped/failed/historical runs do not restart automatically; saved results resume delivery, not source execution. Interrupted uncertain admissions reconcile their existing identity; recorded failures do not auto-retry.
- Task deletion, checkout removal, and project relocation must drain execution or visibly defer the operation rather than remove/change a live script's directory. Browser/drawer visibility never owns program lifetime.

## Local trust and variables

Approval is installation-local and scoped to the selected board, project, and stable stage. Review covers primary code bytes, language/format, canonical provenance, directory scope, routes, authorized variable names, and declared parameter names. Editing the entry's parameter values does not invalidate that approval; adding or removing a declared name does. Saving YAML, publishing, and accepting team updates never approve code. Changed code or expanded authority needs a new review; unchanged captures can reuse their approval.

Only the primary program is frozen. Imported modules, executables, and remote services can change after approval; review those dependencies and avoid irreversible side effects. Trust is not a native filesystem-policy exemption.

Local settings expose configured/missing status and masked **write-only** replacement/removal, not stored-value read-back. Another project's or stage's values are never inherited. Native credential storage holds the values; only declared names are resolved at execution, so rotation takes effect on later access/recovery without putting values in captures. Bash and TypeScript receive the same authorized-name set, with native managed environment/scrubbing rules rather than wholesale ambient credential inheritance.

Known resolved values are redacted before persisted/displayed results, diagnostics, history, and native handoffs. Diagnostic/output sizes are bounded; polling/console output does not flood History. Redaction cannot stop a trusted program from transforming or exfiltrating a secret. Never embed credentials in source literals.

Team journals share authored definitions and file references only, not file bytes, captures, execution state, trust, local bindings, credential references/values, parameter values, or task data. A log that declares a parameter uses board-log envelope 3, which requires an updated reader even after compaction or later removal of deterministic configuration; an envelope-2 reader reports the board as requiring an update instead of reading it as invalid, and unsupported clients must not overwrite it. Hub manifest v3 is unchanged.

## Safe rollback and verification

Stop all active scripts explicitly; the guard drains its owned token-bearing processes before it reports a clean stop. Preserve/back up local records and native credentials, and review workflows plus a compatible shared-log backup before selecting an older plugin. Do not delete captures to force a downgrade, strip executable fields silently, or rewrite a v2 journal as v1. There is no automatic downgrade writer.

Fast gates are separate: `pnpm check`, `pnpm test:browser`, then the isolated [real-composition lane](<../tests/e2e-dsh/README.md>) against a built DSH checkout. The lane's deterministic fixture declares parameters so a run covers supplied values, the in-place refusal, and the repair overlay. The lane stages plugin tests in a temporary directory, uses a throwaway HOME/DSH_HOME/profile/workspace and replay-only model fixtures, and imports native scaffolding read-only. No acceptance check may use personal GUI/profile data, real model traffic, or real CI/CD credentials. Native admission and package installation checks do not by themselves prove bundle activation or process-ownership cleanup; retain those separate integration results.
