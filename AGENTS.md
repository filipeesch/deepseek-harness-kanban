# Project Instructions

## Language

- Write all specifications and OpenSpec planning artifacts in US English (`en-US`).
- Write source code, identifiers, code comments, and documentation in US English (`en-US`).

## Documentation

- Follow [the documentation standard](docs/AGENTS.md) for any file under `docs/` and for the `README.md` landing page.
- Keep the README a landing page and never the product manual; product depth belongs in `docs/user/`.
- Never commit acceptance evidence. Run reports, screenshots, and reviews live in the ignored `.verification/` directory or in Git history.
- `pnpm run check` runs the documentation gate; a broken link, a missing index entry, or a version claim that contradicts `package.json` fails it.

## Workspaces

- Register task worktree and session-directory workspaces hidden by default when the host exposes workspace visibility. Keep the shared base-project workspace visible.
- Hide a pre-existing worktree workspace once, at its first binding. Never hide workspaces retroactively and never re-hide one after a reader reveals hidden workspaces; startup reconciliation only repairs workspaces.
- Use the positional workspace API and keep workspaces visible on hosts without visibility support. A failed hide is reported and never blocks conversation creation.

## Kanban agent presets

Maintenance rules for the three shipped presets live in [Preset maintenance](docs/development/presets.md). Never widen a role's product-tool allowlist to make an instruction work; change the instruction or explain that the role cannot do it. Keep the planner's read-only guarantee real, and treat the manager as a coordinator with no card, scope, or requirement writes.

## Releases

Release and install-address rules live in [Releases](docs/development/releases.md). The install address is the repository URL, a committish is the only reproducible pin, a pull request that changes the installed artifact bumps `version`, and `releases/latest/download/dsh-kanban.tgz` is never the install address.

## Host API deprecations

- Before using or changing a DSH host API, check the pinned DSH source for `@deprecated` on the service, method, event, type, or slot.
- Prefer the documented replacement; never add a new use of a deprecated API.
- When no replacement exists, treat it as a design problem: look for an adjacent public hook, a local adapter, or another integration point, and record the chosen alternative and its trade-offs in the change design. Keep the deprecated use only as a temporary fallback until that alternative lands.

## Verification

Verification procedure, isolated lanes, and the smoke checklist live in [Verification](docs/development/verification.md). Acceptance never uses the owner's profile or a real model, model traffic stays deterministic under replay, and evidence is never committed.
