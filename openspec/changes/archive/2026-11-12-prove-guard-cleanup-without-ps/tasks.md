# Tasks

## 1. Process ownership port

- [x] 1.1 Define the `ProcessOwnership` port with `sweep(marker)` and the shared freeze / confirm / signal / re-scan loop, moving the logic out of `src/host/deterministic/owned-processes.ts`; verified by `tests/host/process-ownership.test.ts`, which proves a process is signalled only after its membership is confirmed and a process stopped by someone else is never resumed.
- [x] 1.2 Implement `LinuxProcOwnership` reading `/proc/<pid>/environ` and `/proc/<pid>/stat`; verified by unit tests over a fake process filesystem that the adapter needs no external program and that an unreadable environment is reported as not-owned rather than absent.
- [x] 1.3 Implement the Darwin adapter: the guard side asks the host and the host side runs the process table read; verified by unit tests over a fake process table and by the delegated sweep in `tests/native/guard-sandbox.test.ts`.
- [x] 1.4 Implement `WindowsJobOwnership` as an unsupported seam; verified by unit tests that it rejects with an actionable message and that no kill is attempted.
- [x] 1.5 Replace the direct uses of `owned-processes.ts` in `ownership.ts` reclamation with the port and delete the module; verified `tests/native/deterministic-ownership.test.ts` passes and no remaining source references the deleted file.

## 2. Guard as a built module

- [x] 2.1 Split the inline guard source into `src/host/deterministic/guard/` modules (config, proof, protocol, capture, leader, quiesce, completion, ownership); verified by unit tests for the proof comparison, the bounded capture overflow, and the configuration validation.
- [x] 2.2 Add the guard build to `scripts/build.mjs` so esbuild emits `lib/guard.mjs` before the host bundle; verified `pnpm build` produces it and that the real guard bundle runs from the built path.
- [x] 2.3 Resolve the guard artifact next to the host entry and accept an explicit override in `createDeterministicRuntime`; verified by the native suites that inject a built artifact and by the ownership fixture that resolves one next to its own bundle.
- [x] 2.4 Move the guard configuration into a `0600` file in the plugin private directory and pass only its path; verified by `tests/host/guard-lifecycle.test.ts` that no command line contains the authorization or the reviewed source, that the file mode is `0600`, and that it is removed when the execution settles.
- [x] 2.5 Remove a configuration at startup when a previous host did not finish; verified by the stale-configuration case in `tests/host/guard-lifecycle.test.ts`.
- [x] 2.6 Replace the POSIX-only wrapper with `node "<guard.mjs>" "<config.json>"`; verified that a missing guard or interpreter produces the `GUARD_UNAVAILABLE` diagnostic instead of a protocol failure in `tests/host/guard-outcome.test.ts`.
- [x] 2.7 Delete `src/host/deterministic/guard-source.ts`; verified no source, test, or script references it.

## 3. Host-delegated sweep and protocol

- [x] 3.1 Add an authenticated `sweep` action to the lifetime server, serialized with the existing registration and settlement handling; verified by `tests/host/guard-lifecycle.test.ts` that a forged proof is rejected and a valid request reaches the ownership port.
- [x] 3.2 Make the guard request the sweep during quiescence whenever its adapter delegates, and report that answer; verified by `tests/native/guard-sandbox.test.ts`, where a clean answer lets the guard emit its result envelope and the host observes the sweep.
- [x] 3.3 Carry the guard pid in registration and in the persisted witness record, and exclude that pid from sweeps; verified by the lifetime registration case and by the pid assertion in `tests/native/deterministic-ownership.test.ts`.
- [x] 3.4 Refuse `win32` in both execution modes and report the unsupported platform; verified by unit tests that watch mode has no clean tree to report and that the ownership seam rejects.

## 4. Diagnostics

- [x] 4.1 Include the guard's own reason, bounded and redacted, in the `BASH_PROTOCOL` message; verified by `tests/host/guard-outcome.test.ts` with the existing facts unchanged.
- [x] 4.2 Turn the Windows partial-enforcement refusal into an actionable configuration diagnostic; verified by `tests/host/partial-enforcement.test.ts`.
- [x] 4.3 Confirm the client panels need no change; verified `tests/client/deterministic-view.test.ts`, `tests/client/history-view.test.ts`, and the full `pnpm check` run.

## 5. Confinement regression

- [x] 5.1 Add `tests/native/guard-sandbox.test.ts` that builds the guard and runs it through the real sandbox provider of the current platform; verified it asserts a successful envelope, a detached descendant terminated, a loopback network call reaching a service, and a skip on a platform this lane has no confinement profile for.
- [x] 5.2 Run the new suite on macOS under `workspace-write` and `read-only`; verified both return their result, and a loopback HTTP call proves the confined command keeps network access. A credentialed `gh api user` call is not reproducible in the automated lane and is replaced by that loopback check.
- [x] 5.3 Update the existing native ownership tests for pid-based exclusion; verified they pass on macOS, including the recorded guard pid.
- [x] 5.4 Verify the host-loss path: kill the host during an active execution; verified the guarded cases reclaim through the same port and release the ownership record.

## 6. Documentation and release

- [x] 6.1 Update `docs/deterministic-steps.md` with the per-platform cleanup proof, the Windows refusal, the private configuration, and the removal of any implication that a broader file policy is the remedy; verified no instruction or document in the repository recommends `danger-full-access` for deterministic steps.
- [x] 6.2 Bump `package.json` version for the changed installed artifact; verified the distribution compatibility test and the built entries report the new version.
- [x] 6.3 Run `pnpm check` and verify host and client typechecks, vitest, and the build all pass.
