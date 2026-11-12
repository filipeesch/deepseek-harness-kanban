# Proposal

## Why

Reorganizing a board's workflow with an agent was expensive because the product surface offered no data about how the workflow is actually used, no official way to validate a proposed edit, no picture of the diagram, and no way to read or edit one stage without dragging the whole document through the model's context. The agent compensated with local hacks: it copied `lib/index.js` to reach the official parser, reconstructed the diagram routing from the client bundle, estimated stage heights from card counts, and salvaged a 100 KB payload out of a spill file with `jq`. The results were slow, occasionally wrong (a trailing newline from `jq -r` corrupted a diff; a literal edit failed because a description repeated), and one authorization consequence was only discovered by reading the fingerprint code after the edit had been saved.

The plugin already knows all of this internally: stage entries record every move, the parser validates, the client owns the exact routing geometry, and every board write flows through one save path. This change exposes that knowledge to the agent that designs workflows, in small, paginated, read-only-first tools, and makes every board write validate and report before it commits.

## What Changes

- Add read-only route usage statistics (`get_route_stats`) covering per-transition usage by origin, per-script-exit usage including unused exits, per-stage entries and dwell time, current card dwell, per-card loop counts, and configured routes or exits never used in a period.
- Make **every** board workflow write validate atomically and return a full report — parse errors with line and column, semantic per-stage diff, graph warnings, deterministic-script fingerprint impact per allowed project, and affected cards — on both refusal and success. There is no separate dry-run mode.
- Add diagram rendering (`render_workflow_diagram`, SVG always and PNG when a rasterizer is available) and layout diagnostics (`layout_metrics`) that reuse the same routing geometry as the GUI.
- Add exact document reads (`get_board_yaml`) and per-stage reads (`get_stage`), both paginated, plus structured writes (`set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, `remove_stage`) that preserve authored text outside the edited field.
- Add per-board revision history backed by a local board change log (`list_board_revisions`, `diff_board_revisions`, `revert_board`).
- **BREAKING** `get_board_summary` with `include_workflow` no longer returns the authored YAML; the exact document comes from `get_board_yaml` and `get_stage`.
- Record an optional transition `origin` on every stage entry, carried from the move that settled it.
- Register the new tools globally but declare them only for the `kanban-workflow-architect` agent preset.
- Update the bundled workflow-design skill so it stops teaching the superseded read path.

## Capabilities

### New Capabilities

- `workflow-authoring`: reading one board's exact workflow document and one stage of it in full or in pages, structured stage edits that preserve authored text, adding and removing stages, setting layout, and the atomic validation report every board workflow write returns.
- `workflow-insights`: read-only route usage statistics for a board and the diagram presentation and layout diagnostics derived from the same routing geometry the GUI draws.
- `workflow-revisions`: the per-board revision log, listing revisions with author and origin, semantic comparison between two revisions, and reverting a board to an earlier revision as a new revision.

### Modified Capabilities

- `product-tools`: the product tool inventory grows, the workflow-authoring tools are declared only for the workflow architect preset, and `get_board_summary` stops carrying the authored YAML.
- `task-history`: a stage entry additionally records the origin of the transition that produced it.

## Impact

- **Tool registration**: `src/host/tools/` gains modules for authoring, insights, and revisions; registration moves from a plain list to definitions with a step-time activation predicate keyed on the calling agent's preset.
- **Domain**: a new shared diagram module is extracted from `src/client/workflow-view/` (routing, layout, scene, stage-size estimation) and imported by both the client and the host, so no routing code is duplicated. New domain code covers the validation report, the revision log adapter, stage insertion and removal, and the stage-entry origin.
- **Host**: `BoardAdministration` and `HubRepository` gain the report-returning write path and the revision recorder; a new storage domain holds per-board logs; a rasterizer port wraps the optional PNG path.
- **Storage**: a new local storage domain for board change logs. Nothing new is published to team storage, and the existing published board log format is unchanged.
- **Dependencies**: `@resvg/resvg-js` as an optional dependency; the PNG path degrades to SVG when it does not resolve.
- **Preset and docs**: `cordis.patch.yml` declares the tool activation predicate, the bundled `kanban-workflow-design` skill and its `operations` reference are updated to the new read and write paths, and the plugin version is bumped because the installed artifact changes.
- **Compatibility**: existing tool names, argument shapes, and stored workflow documents remain valid; the only tool-contract break is the removed `workflowYaml` field of `get_board_summary`.
