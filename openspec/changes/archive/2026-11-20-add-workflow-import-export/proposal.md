# Proposal

## Why

A Hub's workflows are authored one board at a time, and there is no way to move a set of them to another Hub or another installation. Someone who builds a working set of boards has to retype each workflow YAML by hand elsewhere, and nothing states which boards were meant to travel together. Exporting the chosen boards as one file and importing that file into a Hub closes the gap without making a Hub share state, a project scope, or a task with another.

## What Changes

- Add **Export** to **Configuration → Boards**: choose any subset of the Hub's boards, receive one gzip-compressed JSON document through the browser's download, and keep the current page untouched.
- Add **Import** to **Configuration → Boards**: choose a previously exported file, see every workflow it carries with the destination it would take in the active Hub, settle each name conflict with one shared policy plus a per-board override, and apply.
- The exported document carries each board's name, exact authored workflow YAML, recorded default-preset choice, project scope, and local stage identities, together with a format version and the export's origin Hub name.
- Importing a board whose name is free creates it. Importing a name that already exists is a conflict resolved as **Replace**, **Create a copy** with an automatically suggested, editable name, or **Skip**.
- Replacing a board's workflow keeps every card in the stage it already occupies. A stage the incoming workflow no longer defines blocks that board and names the stage and the card count; a stage whose stable identity survives a rename is realigned instead, so a renamed stage does not block.
- A project scope entry the destination Hub does not hold is dropped and reported, and a scope left with no entries accepts every project of the destination Hub.
- Import applies the boards it can and reports the rest, naming each failure. A Hub can therefore end up with part of the file applied, and the report is the only statement of what landed.
- The import surface accepts a gzip-compressed document of at most 4 MB and refuses a larger one before reading its content, naming the limit and the observed size.

## Capabilities

### New Capabilities

- `workflow-transfer`: exporting a chosen set of a Hub's boards as one compressed document, reading that document back, resolving name conflicts, and applying an import into a Hub while preserving card placement and reporting every board's outcome.

### Modified Capabilities

- `kanban-board`: the Boards section gains Export and Import as section-level actions beside New board, and states that they open the transfer surfaces defined by `workflow-transfer`.

## Impact

- **Domain**: new pure modules under `src/domain/workflow-transfer/` for the document format, its version and bounds, and the import plan (conflict classification, free-name suggestion, orphaned-stage detection, project-scope filtering). The existing workflow parser, stage-identity helpers, and `renameTaskStage` are reused rather than duplicated.
- **Host**: new archive codec and export/import services under `src/host/workflow-transfer/`, composing with `node:zlib`. The import writes through `BoardAdministration`, so the single board writer, its revision log, its orphan-column refusal, and its publishing bookkeeping keep their authority; no second board writer is introduced.
- **Protocol**: one read method for export, one read method for the import analysis, and one command for the import write, all declared in `src/remote.ts` with a strict codec, and dispatched from `src/host/app.ts`.
- **Client**: new export and import dialogs plus a small browser file-transfer port under `src/client/settings/boards/`. `boards-section.tsx` gains two section-level actions and hosts the dialogs as separate components.
- **Dependencies**: none added. `node:zlib` supplies gzip, and the browser supplies download and file selection.
- **Documentation**: a new section in `docs/user/workflows.md` covering export and import, and one index-neutral update to the Boards section description in `docs/user/hubs-and-boards.md`.
- **Known limitation**: a scripted stage that names its program with `file:` exports its path, not the bytes. The export reports such boards as an advisory and the import cannot guarantee the path exists in the destination.
