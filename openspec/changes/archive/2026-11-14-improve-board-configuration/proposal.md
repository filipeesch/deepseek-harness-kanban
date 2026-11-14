# Proposal

## Why

The Kanban configuration dialog is fixed at a narrow width, and the Board section stacks identity,
project scope, the default model, deletion, and the YAML editor in one scrolling column. The
workflow editor starts below the fold and the screen wastes most of its width, so the surface that
carries the most content has the least room. At the same time, a board can name a default model but
not a default agent preset: every new conversation silently uses the host default preset, and an
explicit start still requires a card choice every time. The model control is also a plugin copy of
DSH's picker rather than the host's native selector, and the same copy is duplicated in the
schedule editor.

## What Changes

- Configuration surfaces are sized per section: form sections use a wider dialog than today, and the
  active board's workflow uses the widest surface, bounded by the viewport. The top-level section
  tabs stay where they are.
- The Board section becomes five sub-sections: General (board name), Projects (project scope),
  Defaults (model and agent preset), Workflow (YAML editor), and Danger zone (board deletion).
- Navigating away from a configuration surface that would discard unsaved edits asks for
  confirmation. The workflow draft keeps surviving section switches, so switching away from
  Workflow does not ask and does not discard it.
- A new Defaults sub-section saves the board's default model and default agent preset together in
  one guarded workflow write.
- The default model is chosen with DSH's native model selector, reached through the slot the
  execution preparation already borrows, plus an explicit choice between the host default model and
  a specific model. A host that composes no selector shows the stored route read-only instead of
  falling back to the plugin picker.
- **BREAKING** (published-board compatibility): a board's workflow accepts an optional root
  `agent_preset` scalar. Every new conversation of that board applies it, including conversations
  the host creates without the drawer, and falls back to the host default preset with a dismissible
  notice when the preset is unavailable. Explicit card choices still override it. A board
  published with the field requires a plugin version that understands it.
- Preset cards mark the board's default preset and give it initial focus. The plugin stores no
  task-level preset default and owns no preset.
- The schedule editor adopts the same native model selector and the same explicit host-default
  choice.
- The plugin's custom model combobox, its option model, and their tests are removed.
- README, operations documentation, the workflow-architect YAML reference, and board tool
  descriptions cover the new root field and the board summary's default preset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-navigation`: the configuration shell's surface sizing, the Board section's sub-section
  composition, and the unsaved-change confirmation across configuration navigation.
- `kanban-board`: the Defaults sub-section and its single guarded save, the native model selector
  and explicit host-default choice, the new root `agent_preset` field, and the workflow editor,
  diagnostics, draft, and project-scope requirements moving under their sub-sections.
- `task-conversations`: the board default agent preset applied to every new conversation, its
  fallback notice, preset-card marking and focus, and the explicit card override and failure
  fallback.
- `hub-schedules`: the schedule editor uses the host native model selector with an explicit
  host-default choice and a read-only stored model when the selector is unavailable.

## Impact

- Client: configuration shell and section descriptors, board settings panels, Defaults form, native
  model field and synthetic directory adapter, preset roster extraction, preset cards, schedule
  editor, conversation fallback notices, styles.
- Domain and host: workflow parser and persisted schema, workflow meaning and difference inputs,
  root preset and defaults writers, session preset port, conversation creation and receipts, board
  summary tool, and the creation-outcome plumbing.
- Documentation: README, `docs/operations.md`, the workflow-architect skill and YAML reference, and
  board tool parameter descriptions.
- Verification: domain, client, browser-harness, and real-composition lanes. The native selector's
  appearance belongs to the real-composition lane; the plugin-owned harness covers the adapter and
  the configuration behavior.
- Compatibility: no new runtime dependency. The native selector reuses the host slot already used by
  the execution preparation. A host that does not compose that slot is a supported read-only state.
