# Presets

The bundle registers four presets without changing your default preset. A board can name one as its default agent preset — new boards that author no preset start their conversations on the workflow operator — and you can select one for an ordinary DSH chat.

## Kanban Workflow Operator

**Kanban Workflow Operator** (`kanban-workflow-operator`) is the default for a new board that authors no preset. It is a PTC-based coding preset that carries out the task's current stage; it does not design workflows.

It keeps its PTC execution and ordinary coding, filesystem, shell, skill, delegation, planning, and safety capabilities under the host's normal permissions, and it does not receive workflow-architect tools.

Its guidance explains the three stage types — an agent instruction, a configured script with named exits, and a stage with neither — treats the current stage as its scope, and does not run another stage's instruction early. It reads the current allowed transitions before deciding, declares a route only when the stage instruction or the user asks, and otherwise finishes its work and waits for a manual move. That rule never disables an automatic mode enabled independently. An unconfigured route needs the user's explicit direct request and follows the exceptional transition contract in [Execution](execution.md).

An explicit board preset wins, the host default stays selectable, and existing boards and conversations are not changed. When the host does not offer the operator, conversation creation falls back to the host default and the conversation is still created.

## Kanban Workflow Architect

**Kanban Workflow Architect** (`kanban-workflow-architect`) designs and manages workflows. Select it for a new ordinary DSH chat to create or revise one or more related boards; board administration is intentionally unavailable from task conversations. It includes developer tools, but its role is workflow architecture and management, not continuous card execution.

The agent interviews you in short `decision_request` rounds, discusses in your language, and writes workflows in English unless asked otherwise. Before applying changes it requests approval of a concise architecture and impact summary; complete YAML is available on request. It can design handoffs, request and result exchanges, and parent-child coordination across boards, while explaining which parts are agent protocols rather than native scheduling guarantees.

Its progressive skill ships with the plugin and directs the agent to current installed tools and relevant references before designing changes: [workflow design skill](<../../presets/skills/kanban-workflow-design/SKILL.md>).

Updating source alone does not update an installation: build and update or reconcile the bundle through the normal install flow. New agents use the updated preset definition; running agents retain their existing composition. A profile override of the declaration replaces its complete configuration and can mask later shipped changes. [Preset maintenance](../development/presets.md) keeps guidance aligned with product changes.

## Kanban Project Planner

**Kanban Project Planner** (`kanban-project-planner`) investigates a project and agrees its requirements, architecture, and task breakdown.

It writes the plan as a file and nothing else. `write_plan` creates or replaces a Markdown plan, and `patch_plan` applies literal replacements to one that exists; both write at `plans/<segment>/<file>.md` in the conversation workspace, where the segment is the card title in a task conversation or a project name you supply in an ordinary chat.

It still reads repositories and runs shell commands under a session pinned to the sandbox's read-only mode, holds the card and note tools it needs to plan, including deleting a card at your request, and has web access and delegation. Its delegated children join the same preset revision and are pinned the same way. Reading a plan uses the host file tools. It never stages or commits a plan, and it cannot administer a board or edit a workflow.

## Kanban Project Manager

**Kanban Project Manager** (`kanban-project-manager`) coordinates a project's cards. It has no file, shell, web, delegation, or MCP tool, and no product tool that creates, edits, deletes, or relates a card: it reads the board, writes shared notes, messages other cards, declares its own card's next transition, and pauses or resumes its own automatic advance. A change of scope or requirements goes to the planner, never to a card the manager edits itself.

## How a role receives its tools

Each role declares the product tools it receives in its own preset row, and every product tool outside that list is absent from the agent rather than refused when called.

Each role ships its own skill — [planning](<../../presets/skills/kanban-project-planning/SKILL.md>) and [orchestration](<../../presets/skills/kanban-project-orchestration/SKILL.md>) — that states the role, its boundary, and its writing conventions, and deliberately says nothing about stages, handoffs, or approvals: those belong to the stage instructions of the board that selects the preset.

Both roles are meant for a board that names them as its default preset; the manager and the planner then talk to each other across cards of the same Hub. [Preset maintenance](../development/presets.md) covers the planner and manager too.