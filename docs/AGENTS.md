# Documentation Standard

This file is the standard for the human-facing documentation in `README.md` and `docs/`. OpenSpec artifacts under `openspec/` are behavior contracts with their own conventions; they are not duplicated here.

## Audience tiers

| Tier | Job | Does not belong there |
| --- | --- | --- |
| [README](../README.md) | Landing page: what the plugin is, requirements, install/update/pin, first use, feature map | Feature depth, recovery procedures, contributor setup |
| [docs/user/](user/) | How a person uses a feature, in the words of the interface | Implementation notes, maintenance rules, install diagnostics |
| [docs/operations/](operations/) | Install diagnostics, recovery of a failed operation, policy boundaries | Product tours, contributor setup |
| [docs/development/](development/) | Contributor and agent procedure: setup, verification, presets, releases | User-facing behavior |
| [docs/README.md](README.md) | The single index of maintained documents | Content of its own |

A document's subject fixes its scope. Describe its own subject; link the owning document for anything below or beside it.

## One home per fact

Write each fact once, in the document that owns it, and link it from everywhere else. Two documents never restate the same rule: keep it in the more specific owner and link.

## Placement

- New user-visible behavior: `docs/user/<area>.md`, extending the existing area instead of creating a file for one paragraph.
- Install, update, pin, and installation failure: [install](operations/install.md).
- Failure and recovery of an operation: [recovery](operations/recovery.md).
- Working directory, policy, workspace, and drawer panel boundaries: [boundaries](operations/boundaries.md).
- Build, gates, and the test lanes: [setup](development/setup.md).
- Acceptance procedure, smoke checklist, and evidence rule: [verification](development/verification.md).
- Preset maintenance: [presets](development/presets.md).
- Release and install-address rules: [releases](development/releases.md).

## Add, move, and delete

1. Choose the tier and file from the placement list.
2. Add the document to [the index](README.md) in the same change.
3. Repoint every link when a file moves or is deleted; the check fails otherwise.
4. Never leave a redirect file, a "moved here" note, or a duplicate copy.
5. Update the owning document in the same change as the behavior it describes.

## Writing rules

- Write in English, in the present tense.
- Document current behavior only. No change narration ("now", "previously", "after this change") and no exception log.
- One physical line per paragraph. Split a paragraph that carries several rules.
- Name interface labels exactly as the product shows them, in bold.
- Use relative Markdown links to repository files. Do not link a gitignored path.
- Never write a test count, run timestamp, build fingerprint, machine path, or acceptance-run URL.
- State a supported host, Node, or package-manager version only in the [README](../README.md) and [install](operations/install.md), matching `engines` and `packageManager` in `package.json`.
- Keep a document at 400 lines or fewer. The README targets ~150 lines, this file stays under 140, and the root `AGENTS.md` stays under 60.
- Acceptance evidence is never committed. Run artifacts, screenshots, and reports live in the ignored `.verification/` directory or in Git history.

## Contracts

- Content that a test validates is a contract, not prose. The TypeScript example in [scripted steps](user/scripted-steps.md) must stay byte-identical to `tests/e2e-dsh/scripted/wait-ci.ts`; rewrite the explanation around it, never the block.
- [install](operations/install.md) must keep the installation facts required by the `plugin-distribution` spec: the repository URL as the install address, the build approval, the built-entries check, a committish pin, and no tarball address or branch pin.
- A product spec in `openspec/specs/` owns the behavioral contract; a guide explains how to use it.

## The documentation check

`pnpm run check` runs `tests/docs/links.test.ts`. It fails on a broken relative link — inline or reference style — a missing heading anchor, a maintained document missing from the index, an index entry without a file, an absolute or home-local machine path, an acceptance-run URL, a test count, run timestamp, or build fingerprint recorded as current documentation, a historical evidence file name, a version claim outside the two allowed files or a manifest mismatch, and a root `AGENTS.md` or `docs/AGENTS.md` above its ceiling.

## Review checklist

- [ ] The fact has one home and every duplicate was replaced by a link.
- [ ] The document is in the index and its links resolve.
- [ ] No version, test count, machine path, or change narration.
- [ ] The tier owns the content: no procedure in the README, no user tour in `development/`.
- [ ] `pnpm run check` passes.
