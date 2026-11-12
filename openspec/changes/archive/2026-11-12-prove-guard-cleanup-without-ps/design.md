# Design

## Context

See `proposal.md` for the motivation. This section records only the current state that
shapes the approach.

The deterministic runtime starts a program-lifetime guard for every execution. The host
passes the guard to the mounted shell provider, which confines it under the session file
policy. Today the guard is a single inline `node -e` source, and it has two jobs that pull
in opposite directions: run the captured program and capture its bounded output, and prove
that nothing the program started survived.

Four facts constrain the solution:

1. The guard runs inside the confinement. On macOS the profile is
   `(version 1) (allow default) (deny file-write*)`; `/bin/ps` is setuid, so
   `sandbox-exec` refuses to execute it with `EPERM`. `pgrep`, `kill -0`, and
   `process.kill(pid, 0)` all work inside the same profile. Linux and Landlock do not have
   this problem because the kernel exposes `/proc/<pid>/environ`.
2. Reading another process's environment on macOS requires root. No library helps; the
   primitive simply is not available to a confined process.
3. The host runs outside the confinement and already holds a loopback channel
   authenticated with HMAC over a per-execution authorization, used for registration,
   completion, and reclamation.
4. `ShellExecSpec` carries `command: string` only, so the mounted provider decides which
   shell language the wrapper must be written in. The current wrapper is POSIX-only.

The host also duplicates the guard's stop/kill/re-check loop in `owned-processes.ts`, used
when a guard was force-killed before it could answer.

Every existing native deterministic test installs a `danger-full-access` policy, so no test
ever exercises a confined guard.

## Goals / Non-Goals

**Goals:**

- A confined macOS execution returns its captured result, and still proves whole-tree
  cleanup.
- Linux proves cleanup without any external process-listing program.
- One ownership implementation, reachable from both the guard and the host.
- The guard becomes unit-testable without spawning a process, and integration-testable
  under the real confinement profile of the current platform.
- No lifetime secret or reviewed Bash program text on a native process command line.

**Non-Goals:**

- Enabling deterministic execution on Windows. The seam ships; the semantics do not.
- Changing how DSH decides file-policy enforcement, or accepting partial enforcement.
- Giving a Bash stage a different meaning on a platform without Bash.
- Automated evidence for Linux and Windows in this change.
- A configurable "best-effort" cleanup posture.

## Decisions

### D1. The guard ships as a built module, not as inline source

`scripts/build.mjs` builds `src/host/deterministic/guard/main.ts` with esbuild into
`lib/guard.mjs`, before the host bundle. The host resolves the artifact next to its own
entry (`new URL('./guard.mjs', import.meta.url)`), and `createDeterministicRuntime` accepts
an explicit path so a test can point at a build of its own.

*Why:* the current source string cannot be imported, typed, or unit-tested, and it forces
every argument through shell quoting. A file removes all three problems at once, and the
package already publishes `lib`.

*Alternatives:* composing several `String.raw` fragments keeps the build untouched but
preserves the stringly-typed shape and the quoting problem. A minimal in-place patch fixes
only this bug and leaves the duplication and the untestable flow.

*Constraint accepted:* the guard file must be readable inside the execution world. All
three backends allow reads outside the workspace today (`allow default`, `--ro-bind /`,
Landlock read-only `/`). This becomes an explicit assumption to re-check if a future backend
restricts reads.

### D2. Guard configuration travels in a private file

The host writes `{ authorization, port, mode, command, marker, parent }` to a `0600` file in
the plugin's private directory and passes only that path. The file is removed when the
execution settles, and the next startup removes leftovers.

*Why:* today the whole configuration, including the HMAC authorization, is a command-line
argument. `/proc/<pid>/cmdline` is world-readable, so any same-user process can read the
authorization that authenticates the lifetime channel. The reviewed source has the same
exposure. A file also removes the cross-shell quoting hazard that blocks any non-POSIX
shell.

*Alternatives:* stdin cannot carry the configuration because standalone Bash already
receives the program input there. Environment variables inherit into every descendant,
which reintroduces the exposure.

### D3. One ownership port, three adapters, and macOS delegates the proof

`ProcessOwnership` exposes one operation: `sweep(marker): Promise<void>` — signal every
process that still carries the run's token, and reject when an owned process survives or
ownership cannot be confirmed. Process-group emptiness is not part of the port: a signal to
the group id that fails with `ESRCH` proves it empty, and the same probe against a live
parent proves that the parent leads its group.

Adapters: `LinuxProcOwnership` (reads `/proc/<pid>/environ`), `DarwinOwnership` (the guard
asks the host; the host runs `ps -E` outside the confinement), and
`WindowsJobOwnership` (a seam that reports unsupported). The host uses the same port for
reclamation.

*Why:* the loop that freezes, re-checks membership, signals, and re-scans exists twice
today. Reusing it removes the duplication and gives one place to change the safety rules.
On macOS the guard cannot read a membership proof, so asking the one party that can is the
smallest correct mechanism — and that party already runs this code.

*Alternatives:* the guard could ask for a membership list and signal locally, which keeps
kill authority with the tree owner but requires porting freeze, re-check, and
"never resume what you did not freeze" over RPC. `pgrep -P` tree walking covers descendants
that stay in the parent chain but misses a double-forked daemon, which would regress the
current contract.

*Residual:* on macOS the proof is only as strong as the host's read, which happens outside
the confinement. This is the same authority the host already applies when a guard is
force-killed, so it adds no new trust relationship.

### D4. Group emptiness without a process listing

Process-group emptiness uses `process.kill(-pgid, 0)` until it reports `ESRCH`. Because a
group id is the pid of the process that created the group, a successful probe against a
live parent also proves that the parent leads its group, so the watch-mode leader check
needs no listing program at all.

*Why:* `pgrep -g` was tried first and rejected: on macOS it returns no members when the
caller is a child of the target group, which is exactly the guard's posture. The signal
probe is portable, needs no external binary on any platform, and already ran inside
Seatbelt.

### D5. The guard is excluded from its own sweep by witness pid

Registration carries the guard's pid. Sweeps skip that pid instead of matching the literal
`NATIVE_LIFETIME_GUARD_V1` on a command line.

*Why:* the literal is forgeable by any user command and disappears when the guard stops
being `node -e`.

*Residual:* a reused pid could exclude an unrelated process from one sweep. The exclusion
only removes a candidate; it never signals anything, and the stored record exists to be
reclaimed after the guard is gone.

### D6. Windows ships the seam and keeps failing closed

`WindowsJobOwnership` reports unsupported. The guard refuses `win32` in every mode, not
only in Bash mode, and the refusal is a configuration diagnostic.

*Why:* a confined Windows stage is already refused before the guard, because the local
sandbox backend reports partial file enforcement, and a Bash stage on Windows has no
defined meaning. Writing the job-object helper now would produce code nobody here can
execute. Closing the watch-mode hole is not optional: today that path reports a clean tree
it never inspected.

*Alternatives:* a PowerShell `Add-Type` helper implementing
`CreateJobObject`/`AssignProcessToJobObject`/`QueryInformationJobObject`; or accepting
partial enforcement on Windows. Both need a Windows machine and a Security decision
before they can be justified.

### D7. No cleanup posture knob

An execution whose cleanup cannot be proven does not report its result. The guard's own
reason becomes part of the diagnostic message, bounded and redacted; the existing facts
structure is unchanged.

*Why:* the silent failure was the harm, and the diagnostic path already exists. A
"best-effort" mode would create an execution that knowingly lets an external effect
outlive its step, which contradicts the guarantee the runtime is built on.

### D8. Test the confinement, not only the logic

A new native suite builds the guard, then runs it through the mounted sandbox provider's
own confined argv for the current platform. Cases: a successful command returns its
envelope under `workspace-write` and under `read-only`; a detached descendant is still
terminated; a loopback service stays reachable from the confined command. The suite skips
on a platform this lane has no confinement profile for.

*Why:* the bug survived because every native test installed `danger-full-access`.
*Trade-off:* Linux and Windows stay unproven. Recorded as accepted risk.

## Risks / Trade-offs

- **Windows adapter is unreachable code.** → Keep it to an interface, a factory branch, and
  a test that asserts the refusal. Do not embed an untestable C#/PowerShell helper.
- **Linux is unproven.** The Linux adapter keeps exactly today's `/proc` logic, and the
  `--unshare-pid` mount is the only new variable. → Recorded as accepted risk; the adapter
  has unit coverage with a fake process filesystem.
- **The guard file must be readable inside the execution world.** → Verified against the
  three backends' profiles today; documented as an assumption that a read-restricting
  backend would break.
- **Removing `exec` adds one process per Bash call.** → Negligible; the guard already
  spawns an inner leader.
- **A stale `lib` without `guard.mjs`.** → The version bump makes the loaded build
  identifiable, and the missing artifact produces a distinct diagnostic instead of a
  protocol failure.
- **Existing ownership records carry no guard pid.** → The field is optional; a record
  without it is reclaimed through the marker sweep only, which never needed the exclusion
  because the guard does not carry the marker.
- **macOS proof depends on the host's process table.** → Same authority already used for
  force-killed guards; documented in the safety limitation.

## Migration Plan

No data migration. Ownership records gain an optional `pid`; the guard configuration file
is new. Rollback is a revert: an older host never sees the new protocol action, and a newer
host treats a record without a pid as before. `package.json` version is bumped in the same
pull request so the loaded build is identifiable. Documentation is updated in place.

## Open Questions

None. The Windows execution semantics and the job-object helper are explicitly deferred to
a separate change.
