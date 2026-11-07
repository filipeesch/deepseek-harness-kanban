# Design

## Context

See `proposal.md` — Why for the failure and its evidence.

Facts that constrain the approach, verified against the installed DSH `0.2.1-rc.5` runtime and the failing `web` profile:

- A profile is a pnpm project. Its `pnpm-workspace.yaml` sets `nodeLinker: hoisted` and `autoInstallPeers: false`, so peer dependencies are never installed for a plugin and any package installed transitively by another plugin is hoisted into `profiles/<name>/node_modules`.
- DSH's profile loader (`dsh-app-boot`) resolves bare specifiers from a plugin's location with Node semantics and only falls back to the installation's runtime table when the name is absent from the profile. A physical older copy therefore shadows the host's copy.
- The `web` profile gains `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2` through `dsh-codex` → `@deepseek-ai/dsh-session-format-catalog@0.2.0-rc.2` → `dsh-compaction-image-offload` → `dsh-llm@0.2.0-rc.2`. That version's `exports` has no `./remote-info`.
- The host installation ships `0.2.1-rc.5`, whose `exports` does declare `./remote-info`; the client bundle already inlines the same module because its external list is explicit, while the host build passes `packages: 'external'`.
- `src/remote.ts` is shared by both entries: `src/index.ts` registers `TYPERT_HOST`, and `src/client.tsx` calls `raw.remote.$mount(TYPERT_REMOTE)`. Any seam around the protocol helper must serve both bundles.
- DSH admission reads `engines.dsh` first and ignores peer ranges when it is present, comparing with `semver.satisfies(version, range, { includePrerelease: true })`.
- The release workflow publishes `v<manifest version>` and overwrites the asset with `--clobber`; the manifest has stayed at `0.1.1`.

## Goals / Non-Goals

**Goals:**

- Make activation independent of the profile's copy of `@deepseek-ai/dsh-typert-protocol`.
- Concentrate the Typert SDK dependency in one module that both entries import, so the build rule and the contract have a single owner.
- Let DSH decide and report compatibility from the manifest instead of failing at import time.
- Make each published version identifiable and immutable.

**Non-Goals:**

- No automated regression test for the shadowed-package scenario (explicit owner decision); the verification is a documented manual run.
- No change to `apply()`/`openHubSharing` structure, no split of `src/remote.ts`, no deduplication of the client external list between `scripts/build.mjs` and `package.json`.
- No change to the plugin's runtime behavior, storage schema, board, drawer, chat, or sharing features.
- No fix for DSH's profile-first resolution order itself; that stays an upstream concern.

## Decisions

### D1 — Inline the Typert helper in both host entries

Replace `packages: 'external'` in the host esbuild call with an `onResolve` hook that classifies each specifier: relative and absolute paths, `#` import aliases, and URL-scheme specifiers keep esbuild's own resolution; `@deepseek-ai/dsh-typert-protocol` and its subpaths are inlined; every other package stays external.

The whole package is inlined, not only the `./remote-info` helper, because `src/host/controller.ts` imports `Remote` and `TypertRemoteService` from its root and would otherwise resolve the profile's older copy. Mixing an inlined helper with a profile-provided root is the failure being removed, so both come from one copy. The inlined root costs a few kilobytes, its only runtime dependency is `@deepseek-ai/cordis`, and that stays external, so no second Cordis instance exists. Cross-copy identity is not a hazard here: Remote markers use the shared string key `@deepseek-ai/dsh-typert-protocol/remote-methods` with descriptor version `1`, owned values use `Symbol.for`, and descriptors are structural data that the host registry reads without `instanceof` checks.

Alternatives rejected:

- **Depend on the package at runtime** (`dependencies` with a compatible range): creates a second protocol instance next to the host's, contradicts the peer-only manifest, and only moves the resolution target.
- **Vendor the helper in `src/`**: duplicates ~180 lines of SDK logic that must track the host contract; bundling gets the same isolation without owning a copy.
- **Fix DSH's resolver instead**: correct long term, but it needs a host release and leaves every existing installation broken until then.

Rejecting `external: [...]` as a replacement list: it forces enumerating every bare import, and a forgotten entry silently breaks the artifact. The hook keeps the invariant "everything is external except this one package" explicit and reviewable.

### D2 — One seam: `src/sdk/typert.ts`

The seam cannot live under a host-only directory: `src/client.tsx` mounts the same contribution, so the client bundle needs the helper too. The path is therefore `src/sdk/typert.ts` rather than the `src/host-sdk/` name used when the option was chosen — a deliberate path correction for accuracy, recorded here.

The seam exports `createTypertContribution(spec, zod)` returning `{ remote, host }`, owns the only `import ... from '@deepseek-ai/dsh-typert-protocol/remote-info'`, and carries the comment that explains why the package must stay inlined by the build. `src/remote.ts` keeps the schema set and the method spec, and destructures the contribution into the existing `TYPERT_REMOTE` / `TYPERT_HOST` exports, so `src/index.ts` and `src/client.tsx` do not change.

This keeps descriptor assembly out of the contract module and gives future protocol moves one file to update.

### D3 — Manifest declares the host range and drops the protocol peer

`package.json` gains `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"` and `@deepseek-ai/dsh-typert-protocol` moves from `peerDependencies` to `devDependencies` (pinned to `0.2.1-rc.2`, matching the rest of the SDK). The other DSH SDK peers stay: they are still resolved from the host at runtime.

The upper bound is `<0.3.0-0`, not `<0.3.0`: DSH evaluates the range with `includePrerelease: true`, under which `0.3.0-rc.1` is numerically below `0.3.0` and would be admitted. `0.3.0-0` is the lowest possible `0.3.0` prerelease, so it excludes every `0.3` prerelease and release while keeping `0.2.2-rc.1` eligible.

Bundling makes the peer declaration false — the artifact never resolves that package — and DSH ignores peers for admission whenever `engines.dsh` exists, so the peer would only be documentation that contradicts the build.

### D4 — Immutable release publishing

The workflow keeps the fixed asset name and `latest` behavior, and replaces the `view` → `upload --clobber` branch with:

1. read `version` from the manifest;
2. fail with an actionable message when `git ls-remote --exit-code --tags origin refs/tags/v$version` finds the tag, or when `gh release view v$version` succeeds; a tag lookup that fails for any reason other than "no match" also fails the run;
3. otherwise `gh release create v$version dsh-kanban.tgz --target "$GITHUB_SHA" --title ... --generate-notes`.

A job-level `if: github.ref == 'refs/heads/main'` keeps manual dispatches from publishing a build of another ref, and `--target "$GITHUB_SHA"` binds a newly created tag to the commit that was built rather than to the default branch tip at publication time. The tag check covers a tag that exists without a release, which the release check alone would miss.

Releases are not marked prerelease, so GitHub's `latest` keeps pointing at the newest published version.

Alternatives rejected: automatic bump plus a bot commit to `main` (needs push rights, risks loops and branch-protection conflicts); version derived from the run number (not comparable, pollutes the plugin manager display).

### D5 — Documentation states the real contract

- README: keep `releases/latest/download/dsh-kanban.tgz` as the recommended address; document the exact-tag address; document `dsh plugin --profile <name> update dsh-kanban` for an installed profile; correct the claim that peers guarantee a single SDK copy.
- `docs/operations.md`: add the stale-SDK diagnostic (`dsh plugin --profile <name> why <package>`, inspecting `node_modules/@deepseek-ai`, removing or updating the plugin that hoists it) and the profile update step.
- `AGENTS.md`: release rule already added in this change's preparation.

### D6 — Verification by isolation

Build, `pnpm pack`, then create a throwaway `DSH_HOME`, clone the shipped `web` template into a smoke profile, install the packed tarball, and additionally install `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2` into that profile so the old copy exists at the hoisted position. Boot the profile and confirm the bundle activates and the Kanban surface renders. Static check: `lib/index.js` and `lib/remote.js` contain no `@deepseek-ai/dsh-typert-protocol` specifier. Evidence goes under `.verification/` without tokens or owner data, and the smoke home is removed afterwards.

## Risks / Trade-offs

- **Bundled descriptor shape drifts from the host contract** → the helper is pure data assembly and the host validates descriptors structurally; type-only imports still compile against the pinned SDK, and a DSH upgrade that changes the contract surfaces in the typecheck before release.
- **A future protocol version imports another package** → that import stays external and is resolved from the profile like any other peer, so only the protocol package's own code is covered by the inline rule. Review the protocol's imports when bumping the SDK devDependency, and extend the inline rule only for packages that must be isolated.
- **`engines.dsh` is a hard gate** → hosts outside the range are refused instead of attempted. That is the intent, and it is marked breaking in the proposal.
- **Immutable tags remove the "re-publish to fix a bad build" escape hatch** → publish a new bumped version; the README update instructions cover the consumer side.
- **`latest` alone still leaves stale installs in place** → the profile's lockfile keeps its resolved version until updated, which the documented update command addresses.
- **Removing the protocol peer weakens no runtime guarantee** → other SDK peers remain, and `engines.dsh` is the authoritative compatibility statement.

## Migration Plan

1. Land the build, seam, manifest (version `0.1.2`), workflow, and documentation changes in one pull request.
2. Merge; the workflow publishes `v0.1.2` with the same asset name.
3. Existing installations keep `0.1.1` until the documented update runs.
4. Rollback: revert the pull request and publish a new bumped version; never overwrite an existing tag.
