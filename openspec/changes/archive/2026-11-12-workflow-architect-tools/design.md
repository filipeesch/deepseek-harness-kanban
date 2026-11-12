# Design

## Context

- Product tools are registered once on the root context, so every session sees every tool. The pinned DSH build (0.2.2-rc.1) accepts a step-time activation predicate on `tools.register`, and a false result removes the tool from the declarations as well as from dispatch.
- Every board workflow write funnels through `BoardAdministration` into one serialized transaction and then into `saveBoardWorkflow`. Publishing happens after the local commit and never rolls it back.
- `parseWorkflow` throws the first problem and disables the parser's line-position output. It is the accepting path; nothing produces a report today.
- The deterministic fingerprint hashes canonical `{language, directory, executionDirectory, source, env, params, exits, code}`. Exits carry `{columnId, stageIdentity}`, so retargeting an exit changes the fingerprint without touching source. Review authorization is keyed by Hub, board, project, and stage identity, and the capture store both plans and persists, in one method.
- A stage entry records only origin stage, destination stage, and moment. The move's own origin exists at the moment of the move, in `pendingTransition.origin` for an advance and in the deterministic result for a script exit, and is discarded on placement.
- Connection geometry — routing, anchors, fan-out, clearance, automatic placement, scene assembly — lives under `src/client/workflow-view/` and imports nothing from React. A stage's rendered height is measured in the browser with `ResizeObserver` and is never stored; the authored `size` is a minimum.
- `get_board_summary` with `include_workflow` returns the authored document together with the parsed workflow, which on a large board exceeds 100 KB and spills to a file.
- There is no revision storage. The journal module (`src/domain/journal`) already models a board as a snapshot plus ordered events, materializes each event as a text-range edit, and folds a long tail into the snapshot — but only the sharing layer stores it, and only for a published Hub.

## Goals / Non-Goals

**Goals:**

- One connection-geometry implementation shared by the GUI, the new tools, and the tests, with the GUI's React concerns kept where they are.
- One write pipeline that composes, validates, reports, and commits, so a refusal and a success describe the same thing.
- Reads that never require the whole document in a model's context and never lose authored text.
- A local revision history whose documents are byte-identical to what was written, with attribution and bounded retention.
- Tool visibility decided per calling agent without a second plugin entrypoint.

**Non-Goals:**

- A preview or dry-run mode for a write. Validation happens on the write, which persists nothing when it refuses.
- An auto-layout solver or constrained re-layout.
- Changing how the GUI measures, renders, or animates stages.
- Changing the published board-log format or the publishing protocol.
- Rendering through a browser or the connected GUI.
- Storing card text anywhere in the new payloads.

## Decisions

### D1 — Gate the new tools with a step-time predicate, registered globally

Register every new tool on the root context exactly like the existing ones, and pass a `when` predicate that resolves the calling agent's preset and admits only `kanban-workflow-architect`. A false result removes the tool from that step's declarations and from dispatch, which is the behavior the spec requires.

*Alternatives.* A separate plugin entrypoint mounted by the preset keeps the tools out of the root registry, but adds a package export and a second composition root for no benefit. Registering globally and refusing at call time still declares the tools to every agent, which the spec forbids. Denying the tools inside every other preset leaks them into any preset added later.

*Consequence.* When the preset projection is unavailable for a session, the predicate withholds the tools; a missing answer never widens access.

### D2 — Move connection geometry into the domain

Extract `routing/`, the layer placement, the scene assembly, and the stage-size helpers from `src/client/workflow-view/` into `src/domain/diagram/`, with the same functions and no behavior change, and leave the client importing them. The client keeps the React components, gestures, xyflow wiring, and measurement; the domain owns points, rectangles, routes, shapes, placements, and the scene.

*Why.* The diagram the agent shows must be the diagram the GUI draws, and the only way to guarantee that over time is a single implementation. A host-side reimplementation would drift on the first routing change; asking the GUI to render would fail whenever no client is connected.

### D3 — Estimate a stage's height from its authored size and its cards

A stage's height is `max(authoredHeight, header + gaps + cards × cardHeight)`, where the constants live in one domain module whose values are derived from the diagram's stylesheet: the header row, the card-list padding and gaps, and one card slot. The authored size stays the floor; the card count can only grow it. Rendering, card-mode variants, and every layout metric use the same function.

*Alternatives.* Measuring in the browser is exact but unavailable to a host tool and unreproducible offline. Persisting measured heights would write the workflow on every card change, producing revisions, publishing noise, and stale sizes for a reader who has not opened the board.

*Guard.* One browser test renders representative stages through the real components and asserts the estimate stays within a documented tolerance, so a stylesheet change that invalidates the constants fails a test instead of silently skewing the metrics.

*Trade-off.* A card with an unusually long title or several status lines is taller than the constant assumes. The report marks the stages whose cards exceed the authored height, so a reader can tell an estimate from a measured value.

### D4 — One write pipeline, report included

Introduce one domain function that takes the authored text, a composition step (literal edits, struct: field writes, insertion, removal, or a whole document), and the facts the report needs, and returns the composed text plus a report. The host commits the text only when composition and validation succeed; the same report is returned when a write is refused.

The report is assembled from what the pipeline already knows: parser diagnostics, the previous and next parsed workflows, the board's graph, the deterministic definitions on both sides, and the board's cards. Script impact is the one part that needs the filesystem, so it is a port that resolves each allowed project's directory and returns, per deterministic stage, whether a review would still hold and why.

*Why one pipeline.* A refusal and a success must agree, and no surface should be able to save a document that was not reported. The alternative — a separate preview path — was rejected because two implementations of "what would change" diverge, and the product decided against a dry-run mode.

*Consequence.* The agent sees the impact of a saved change after it is saved. Reverting is the compensating action, which is why the revision history ships in the same change.

### D5 — Split planning a capture from persisting it

Extract the pure planning half of the capture store — resolve the execution directory, read a file source when one is declared, sort environment names, collect parameter names, and map exits to stable destinations — so the report can compute each deterministic stage's fingerprint without writing immutable blobs or registering transient references. The store keeps persistence, integrity verification, and collection.

*Why.* Without this split, computing "does the authorization still hold" would either write storage as a side effect of a read-only question, or duplicate the fingerprint inputs in a second place that could disagree with the real capture.

*Trade-off.* A project directory that cannot be resolved produces "cannot verify" rather than "still holds". That is reported honestly instead of being guessed.

### D6 — Keep a local board log and reuse the journal

Store one log per board in a new local storage domain, shaped like the published one: a snapshot text with its sequence, an ordered event list, and — new — a commit index whose entries carry the moment, the author, the origin, and a seq range. Every accepted workflow write derives the events that turn the previous text into the new text with the existing differ and appends one commit.

Byte-exactness is guaranteed by a replay check: apply the derived events to the previous text and compare the result with the authored next text. When they differ — for example because the differ writes a stable stage key into a recreated block — the log records one whole-document event carrying the authored text. Reverting therefore replays or reads documents that are identical to what was stored.

Retention is counted in commits, not events: past the bound, the oldest commits are folded into the snapshot and reported as no longer retained. The commit index is local-only and never enters the published event format; a published Hub keeps its own log in team storage exactly as today.

*Alternatives.* Storing a full snapshot per revision is simpler but multiplies storage on a large board and duplicates what the journal already does. Promoting the published log to the only log would change the publishing protocol's cursor and conflict model, which is out of scope.

*Trade-off.* A bound Hub holds two logs with different jobs. The local one answers "what changed and who changed it"; the published one synchronizes the team.

*Ordering.* The log records after the board write commits, in the same serialized lane. A logging failure is reported and never rolls back a committed workflow; a crash between the two loses a revision rather than inventing one.

### D7 — Record the transition origin on the stage entry

Add an optional origin to the stage entry and to the entry-writing helper, and thread it from the three places a move settles: the pending transition distinguishes a declared transition from an automatic advance and treats an absent origin as an operator move; the deterministic router records the named exit that routed the card; the reserved error route records itself as such. Entries written before this change decode unchanged and present an unrecorded origin.

*Why optional.* The stored record is validated strictly; an optional field keeps every existing record valid, needs no data migration, and lets the statistics answer "how" from the moment of the upgrade instead of pretending to know the past. An older build reading a record with the field fails closed on load, which the release version bump makes visible.

### D8 — Split the tools into small modules behind narrow ports

Three tool modules — authoring, insights, revisions — each depending on the operation it needs rather than on the application object, in the style of the existing transition tools. The write modules share one port that performs the pipeline and commit; the read modules depend on board reads and the revision log; the renderer depends on a geometry port and a rasterizer port. Tool registration accepts a visibility predicate so the gating rule lives with registration, not inside each tool.

*Why.* The existing tool modules are already testable against a fake port, and a single module holding five features would be the god object this project avoids.

### D9 — Bound and page every large payload

The exact-document read returns a requested slice with its total line count, a continuation offset, and a path to the full text under the plugin's private directory, so ordinary file tooling can read or search it. The report caps its warning list and names "and N more". Statistics aggregate on the host and never return per-card text. Revision listing takes a limit and a continuation.

### D10 — Render in the domain, rasterize behind a port, attach when the route allows it

The SVG is assembled in the domain from the scene: stage rectangles, headers, card slots, rounded connection paths, arrowheads, and exit labels, using the same numbers the geometry module produces. A rasterizer port dynamically imports `@resvg/resvg-js`; when it does not resolve, the tool returns the drawing path and a stated reason. Attachment is attempted only when the resolved route declares image input and the attachment service exists.

The plugin manifest does not declare that package. This environment's registry answered every attempt with a connection reset, so a declared optional dependency would have shipped a manifest whose lockfile entry no installation could reproduce — and a bundle installed from a repository URL must not fail its profile install over an optional native binary. A host that provides the package, for example in its profile, gets PNG; every other host gets SVG and the reason. Declaring it later is a manifest-only change.

## Risks / Trade-offs

- **Estimator drift** → one browser test pins the estimate to the rendered heights within a stated tolerance; the constants live in one module; the report names the stages whose cards exceed their authored height.
- **Authorization preview disagrees with the real capture** (symlinked project directories, an unreadable execution directory) → the preview uses the same planning code and reports "cannot verify" instead of a false verdict.
- **The differ injects authored stage keys** → the replay-equality check downgrades that commit to a whole-document event, keeping local text byte-exact.
- **Two logs for a bound Hub** → documented roles; the local log is never published; publishing behavior is unchanged, so a reader can still trust the team document.
- **A lost revision on a crash between commit and log append** → accepted and stated: the history can be missing a revision, never show one that did not happen.
- **Extraction of the geometry is a large mechanical diff** → move first, with the existing client tests unchanged and passing, before any new behavior lands on top.
- **A stylesheet change silently invalidates the estimator** → the browser guard test.
- **A very large board produces an enormous report** → capped warning lists, aggregate counts, and a remainder count.
- **No rasterizer in a stock install** → PNG is a capability a host opts into; the tool states why no raster exists, and the requirement only asks for PNG when a rasterizer is available.
- **Downgrade** → an older build cannot read entries that carry an origin. The release version bump makes the installed build visible; no stored data migration exists for a downgrade.

## Migration Plan

1. Move the geometry into the domain and repoint the client, with no behavior change, so the rest builds on one implementation.
2. Add the report pipeline and the report-returning write path, keeping every existing tool's accepted arguments and results, then make existing board writes surface the report.
3. Add the capture planning split and the script-impact port.
4. Add the origin field and thread it through the three move paths.
5. Add the local board log, the revision tools, and the revert path.
6. Add the authoring tools and the paged reads; remove the authored document from `get_board_summary`.
7. Add the insights tools and the diagram renderer.
8. Gate the new tools on the preset, update the bundled skill and references, and bump the plugin version.

No stored data is migrated. Rollback is the previous release: workflows, tasks, and the published team document stay compatible; the revision log becomes inert; entries with an origin are unreadable by that older build.

## Open Questions

- The exact card-height constant and its tolerance are measured against the browser lane during implementation; no requirement depends on the number.
- The retention default for revisions is one hundred commits per board; making it configurable is deferred.
