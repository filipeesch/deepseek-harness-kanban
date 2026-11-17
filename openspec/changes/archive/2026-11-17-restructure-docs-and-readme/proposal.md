# Proposal

## Why

`README.md` became the complete product manual: 482 lines and 106 KB, with twenty paragraphs longer than 1,000 characters on a single line. It serves as install page, user manual, and contributor guide at once, while `docs/` mixes two maintained guides with ten frozen October audit artifacts that no longer describe the shipped product. The drift is measurable: 174 local links in `docs/` and one in the README point at files or anchors that no longer exist, `docs/operations.md` still declares DSH 0.2.1-rc.2–0.2.2-rc.1 and Node >=20.19 while the manifest requires `>=0.2.2-rc.1 <0.3.0-0` and Node >=24.9.0, and `docs/verification-runs.json` still records plugin 0.1.0. Nothing states which document owns which fact, where a new document belongs, or how stale content is retired, and `pnpm run check` notices none of it.

## What Changes

- Replace `README.md` with a ~150-line landing page: what the plugin is, requirements, install/update/pin, first use, and a feature map linking into `docs/user/`. Installation stays complete in the README; long diagnostics move to `docs/operations/install.md`.
- Reorganize `docs/` by audience:
  - `docs/README.md`: the single index of maintained documents.
  - `docs/AGENTS.md`: the documentation standard (audience tiers, one home per fact, placement, writing rules, add/move/delete flow, size ceiling, review checklist, and the rule that content validated by a test is a contract, not prose).
  - `docs/user/`: eleven rewritten guides covering hubs and boards, getting started, workflows, execution, conversations, team sharing, Git and worktrees, schedules, agent tools, presets, and scripted steps. **BREAKING** for readers linking to the old README sections and anchors; every user-visible behavior and limitation is preserved, the old URLs are not.
  - `docs/operations/`: `install.md`, `recovery.md`, and `boundaries.md`, rewritten from `docs/operations.md`.
  - `docs/development/`: `setup.md`, `verification.md`, `presets.md`, and `releases.md`, receiving the long procedures and maintenance rules currently in the root `AGENTS.md`.
- Shrink root `AGENTS.md` to standing orders (~40 lines): Language, Workspaces, Host API deprecations, a new Documentation section pointing at `docs/AGENTS.md`, and one-line orders for presets, releases, and verification that link their owning document. The irreversible safety rules stay in the root.
- Rewrite `docs/scripted-steps.md` as `docs/user/scripted-steps.md`. Its TypeScript example stays byte-identical to `tests/e2e-dsh/scripted/wait-ci.ts`, and the distribution test path plus `package.json` `files` follow the move.
- Delete the ten historical evidence artifacts (`active-schedule-runner-review.md`, `code-review.md`, `coordination-runner-review.md`, `lifecycle-bridge-review.md`, `lifecycle-transaction-review.md`, `native-ask-runner-review.md`, `scenario-evidence.md`, `schedule-quiescence-review.md`, `schedule-wake-review.md`, `verification-preliminary.md`, `verification-runs.json`) and stop versioning verification evidence: run artifacts belong to the already-ignored `.verification/` directory. **BREAKING** for readers linking to those files; Git history keeps them.
- Add `tests/docs/links.test.ts` to `pnpm run check`: it fails on a broken local link, a heading anchor that does not exist, a maintained document missing from `docs/README.md`, an absolute local path in a maintained document, or a historical evidence artifact reappearing in the tree.
- Bump the manifest version, because the installed artifact's `files` list changes.

## Capabilities

### New Capabilities

- `documentation`: how the repository organizes human-facing documentation and how the check pipeline keeps that organization true: the audience tiers, the single index, the maintained-document standard, the evidence policy, and the validation that fails when links, anchors, or index coverage drift.

### Modified Capabilities

None. No product capability changes: board, workflow, conversation, sharing, and tool behavior described by the existing specs is preserved verbatim in meaning, and the documentation requirements of `plugin-distribution` keep the same facts at new paths.

## Impact

- Documentation: `README.md`, `AGENTS.md`, and everything under `docs/`.
- Package: `package.json` `files` (publish `docs/user/scripted-steps.md` instead of `docs/scripted-steps.md`) and `version`.
- Tests: new `tests/docs/links.test.ts`; `tests/distribution/script-fixtures.test.ts` reads the moved guide.
- CI: `.github/workflows/ci.yml` is unchanged, because `pnpm run check` already runs vitest and therefore the new gate.
- No runtime source, host contract, UI, or product spec changes.
