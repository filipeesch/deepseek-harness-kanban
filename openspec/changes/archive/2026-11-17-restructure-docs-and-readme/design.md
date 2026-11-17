# Design

## Context

See [proposal.md](proposal.md) for motivation. The current state that shapes the approach:

- `README.md` is 482 lines and 106 KB; 20 paragraphs exceed 1,000 characters on one physical line, the largest at 4,629. It holds install, product behavior, and contributor procedure together.
- `docs/` holds two maintained guides and ten frozen October artifacts. A scripted link scan finds 174 broken local links across those artifacts and one in `README.md`. `docs/operations.md` still names DSH `0.2.1-rc.2`–`0.2.2-rc.1` and Node `>=20.19`, while `package.json` declares `engines.dsh: >=0.2.2-rc.1 <0.3.0-0` and `engines.node: >=24.9.0`.
- The root `AGENTS.md` is 184 lines. It carries standing orders, preset maintenance rules, release rules, and two long verification procedures.
- `pnpm run check` runs both typechecks, `vitest run` over `tests/**/*.test.{ts,tsx}`, and the build. CI runs `pnpm run check` and `pnpm run test:browser`; no lane inspects documentation.
- `package.json` publishes `README.md` and `docs/scripted-steps.md`. `tests/distribution/script-fixtures.test.ts` reads that exact path and requires the guide's TypeScript example to be byte-identical to `tests/e2e-dsh/scripted/wait-ci.ts`.
- DSH loads a nested `AGENTS.md` when a file tool touches a path in that directory, so `docs/AGENTS.md` becomes the instruction file for work inside `docs/`, not a always-on baseline.

## Goals / Non-Goals

**Goals:**

- One audience per tier, one home per fact, and a single index that a test keeps complete.
- A landing README that a first-time installer can finish from, with product depth behind links.
- Root instructions reduced to standing orders, with the irreversible safety rules still in the baseline context.
- A documentation gate inside the existing `pnpm run check` lane, so drift fails on the pull request instead of accumulating.
- No versioned acceptance evidence, and no machine-local residue in maintained documents.

**Non-Goals:**

- Any change to product behavior, source modules, host contract, UI, or existing product specs.
- A CI workflow change: the new gate rides `pnpm run check`.
- Deleting `scripts/verify-native-*.mjs`, translating documentation, adding screenshots, or rewording product UI labels.
- A documentation website or generated reference.

## Decisions

### D1. Audience tiers with a single index

`docs/user/`, `docs/operations/`, `docs/development/`, plus `docs/README.md` as the only navigation list and `docs/AGENTS.md` as the standard.

- *Why*: the failure mode is not a missing file but an unclear owner. A tier answers "where does this fact live?" before a writer starts, and an index makes an orphan document visible.
- *Alternatives*: flat `docs/user-*.md` names (noisy at eleven documents and still leaves ownership implicit); three large files (same wall-of-text problem in fewer places). Both rejected by the owner during exploration.
- *No `docs/evidence/`*: the owner's rule is that acceptance artifacts are not versioned at all, so a frozen tier would contradict the policy the change establishes.

### D2. README as a landing page

The README keeps what an installer needs end to end: what the plugin is, requirements, install from the repository URL, update, pin, source-checkout development install, first use, and a feature map linking every `docs/user/` guide. Long diagnostics (failure signatures, registry troubleshooting, reconciliation) move to `docs/operations/install.md`.

- *Why*: the repository URL is the install address, so the install path must not require opening another file; everything that is not needed to install belongs behind a link.
- *Ceiling*: a soft target of ~150 lines. The gate asserts that every `docs/user/` guide is linked from the README, not a line count, so the README cannot silently lose its map while a hard line budget would reward deleting content.
- *Alternatives*: README as a pure index (~80 lines) was offered and rejected because it moves the install procedure out of the install page.

### D3. Rewrite from scratch with a traceability pass

Every maintained document is rewritten from `openspec/specs/`, `src/`, and the test suites, not copied from the old text. The writer keeps a claim-to-source list while drafting: each user-visible rule, limit, and error comes from a spec requirement, a source module, or a test. Current documents remain an inventory of what must exist, so a rule is preserved or deliberately dropped, never lost by accident.

- *Why*: the old text wraps many rules into single-line paragraphs, so mechanical splitting preserves the density that made it unreadable. A free rewrite would drift.
- *Preservation rule*: a rule that changes what the user does — downgrade behavior, size limits, refusal conditions, background queue behavior, when a card does not move — survives the rewrite even when no spec states it.
- *Unresolved claims*: a claim that cannot be confirmed against the tree is recorded in the change review as unresolved, never written as current behavior.
- *Alternatives*: move-as-is with splitting (keeps 4.6 KB paragraphs and copies stale facts); free rewrite (cheapest to read, highest drift risk). The owner chose from-scratch with all user-visible behavior preserved.

### D4. `docs/AGENTS.md` as the documentation standard

A ~90-line file, loaded by DSH whenever an agent touches `docs/`, containing: the tier table with one home per fact, placement examples, the add/move/delete flow (index update, link repointing, evidence rule), writing rules (English, current state only, one physical line per paragraph, relative links, no test counts or machine paths), a per-document size ceiling, the contract-content exception, and a review checklist that mirrors the gate.

- *Why*: the root file cannot carry both standing orders and the full standard; a nested file keeps the standard in context exactly when it matters.
- *Size*: ~90 lines, below the 140-line ceiling the gate enforces, leaving room for later rules.
- *Alternatives*: a root section (dilutes the baseline and duplicates the tier table); a wiki (out of the tree, unversioned, unreviewable).

### D5. Root `AGENTS.md` layering

The root keeps: Language; Workspaces; Host API deprecations; a new Documentation section linking `docs/AGENTS.md`; and one-line standing orders for presets, releases, and verification whose procedure lives in `docs/development/presets.md`, `docs/development/releases.md`, and `docs/development/verification.md`. The irreversible rules stay in the root verbatim in meaning: acceptance never uses the owner's profile or a real model, the install address is the repository URL with a committish pin, and a role allowlist is never widened to make an instruction work. Target ≤60 lines, enforced by the gate.

- *Why*: standing orders are cheap and must be in baseline context; a 1,100-word verification checklist is situational. Moving it does not lose the safety rules because those stay as one-liners.
- *Degradation risk*: a reader who never opens `docs/development/verification.md` misses the procedure. Mitigation: the root line names the exact file and the rule that matters.
- *Alternatives*: keep presets and releases in the root (~80 lines, still mixing tiers); root reduced to ~25 lines (loses the preset and release guards that prevent real mistakes).

### D6. Evidence deletion

Delete the ten historical artifacts, keep `.verification/` ignored, and move the verification policy into `docs/development/verification.md`. The gate fails when a known evidence file name or a `*-review.md` style audit returns to the tree.

- *Why*: those files are frozen snapshots of an October codebase, carry absolute local paths, and are the source of most broken links. Their provenance lives in Git history.
- *Consequence*: any external bookmark to them breaks; this is recorded as a breaking change in the proposal.
- *Alternatives*: a frozen `docs/evidence/` tier (keeps the volume and the stale links); keeping only two audits (still unmaintained and still cited by the README).

### D7. Documentation gate inside `pnpm run check`

A new `tests/docs/links.test.ts` runs with the existing vitest suite. It reads the maintained tree and fails on:

1. a relative link whose target file does not exist, ignoring links inside fenced code blocks and external URLs;
2. a fragment that does not match a GitHub-style heading slug in the target file;
3. a maintained document under `docs/` missing from `docs/README.md`, or an index entry with no file;
4. an absolute local path (`/Users/`, `/home/`, `/Applications/`, a Windows drive path) in a maintained document;
5. a historical evidence file name in the tree (`*-review.md`, `scenario-evidence.md`, `verification-runs.json`, `verification-preliminary.md`);
6. a version-range claim outside `README.md` and `docs/operations/install.md`, or a Node/DSH minimum there that differs from `engines` in `package.json`;
7. the root `AGENTS.md` above 60 lines or `docs/AGENTS.md` above 140 lines.

- *Why vitest and not a new script*: `pnpm run check` already runs the suite and CI already runs the check, so the gate inherits both without a workflow change; a separate script would be forgotten locally.
- *False-positive control*: only local relative links are validated; fenced blocks are skipped; version checks are limited to two files and compare against the manifest instead of pattern-matching arbitrary numbers. The pin example in the README (`#v0.15.0`) is a tag, not a range, and the check does not treat it as one.
- *Alternatives*: a standalone `check:docs` script (does not block a pull request by default); no automation (the state that produced 174 broken links).

### D8. Scripted-steps reference move

`docs/scripted-steps.md` becomes `docs/user/scripted-steps.md`. The TypeScript example stays byte-identical to `tests/e2e-dsh/scripted/wait-ci.ts`; the distribution test reads the new path; `package.json` `files` publishes the new path; the manifest version bumps because the installed artifact changes.

- *Why*: the example is an executable fixture, not prose, so it is the one block the rewrite may not touch. The test already enforces that contract; only its path changes.
- *Version bump*: `0.36.7` → `0.36.8`, per the repository rule that a pull request changing the installed artifact bumps the manifest.

### D9. One change, ordered by dependency

Scaffold and standard first, then delete evidence, then the user tier, then operations, then development, then the root instructions, then the README, then the gate, then packaging and the distribution test. The gate is written after the content converges, then run repeatedly while links are repointed.

- *Why*: the gate cannot be green before the tree it validates exists, and writing it last avoids a long red window masking real failures.
- *Review*: task slices per tier keep the diff reviewable even though the change ships as one pull request, as the owner chose.

## Risks / Trade-offs

- **[Rewrite drifts from behavior]** → claim-to-source pass per document; the specs and tests are the source; unresolved claims are reported instead of asserted; the owner reviews each tier.
- **[A user-visible rule is lost]** → inventory the current README section by section; every rule is marked preserved or deliberately dropped; `plugin-distribution`'s install requirements are re-checked against the rewritten install guidance.
- **[Link gate false positives block unrelated work]** → validate only local relative links, skip fenced blocks, normalize GitHub slugs, and compare versions against the manifest rather than scanning arbitrary numbers.
- **[Version check becomes brittle]** → limit range checks to `README.md` and `docs/operations/install.md`, and require an exact match with `engines`.
- **[Moving the scripted guide breaks the distribution test mid-change]** → move the guide, the test path, and `files` in one task; run `pnpm check` before moving on.
- **[Root instructions lose a safety rule]** → the one-liners are written first and diffed against the old body before the procedures are removed.
- **[Nested `docs/AGENTS.md` is not loaded by `grep`/`glob`]** → the root Documentation section names the file so an agent reads it deliberately.
- **[The change is large]** → nine ordered tasks with a gate at the end; no source files change, so the risk stays editorial.

## Migration Plan

1. Scaffold `docs/` (tiers, index, standard) and delete the ten evidence artifacts.
2. Rewrite `docs/user/` and move the scripted guide with its fixture contract.
3. Rewrite `docs/operations/` and `docs/development/`.
4. Reduce the root `AGENTS.md`, add the Documentation section, and repoint every link.
5. Rewrite `README.md` and repoint its links.
6. Add the gate, run `pnpm run check`, and pack-check the `files` list.
7. Bump the manifest version.

Rollback is a revert of the pull request: no runtime state, data, or host contract is touched. External links to the removed paths break permanently; Git history keeps the artifacts and the old text.

## Open Questions

None that change the specs, approach, or task breakdown. The rewrite's unresolved claims are recorded during implementation review, not deferred here.
