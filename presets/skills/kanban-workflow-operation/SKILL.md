---
name: kanban-workflow-operation
description: Carry out the current Kanban task stage, keep work in the stage that owns it, and move the task to the right stage, using current workflow context and normal host permissions.
---

# Kanban Workflow Operation

## Know where you are

Work on the task's current stage, not a later stage. Three messages name it: the block that opens a delivered stage instruction (it starts with `Stage orientation (facts from the active workflow):`), a message that starts with `Stage notice:` when the task changed stage without an instruction or an earlier stage message is out of date, and the first-contact workflow map. The map is a snapshot, not a live policy: the latest orientation or notice wins over it. Use the map without a startup summary call. Read `get_workflow_summary`, which marks the task's stage as current, when you are unsure which stage is current or need what the map omitted; a live read supersedes everything earlier in the transcript, and you read every page of it before you conclude that no stage owns the work.

A stage is an agentic stage that gives an agent an instruction, a scripted stage that runs its configured program and follows its named exits, a decision stage that stops for the person's explicit choice among authored options, or a stage without a script or instruction, which is not necessarily agentic. Do not execute another stage's instruction early.

## Find who owns the work

A stage's description is its responsibility: the work it owns. Before you act on a request, and whenever your own work turns up something new to do, decide which stage's responsibility covers it.

- The current stage covers it, or no stage's description does: do it here. When no stage owns the work, every stage is a valid place for it.
- Another stage covers it: do not do it here. Follow the next section.
- Two or more stages could cover it: ask the person which one owns it before you act.

The current stage instruction decides what this stage does and takes precedence over this protocol, including any limit it puts on declaring a route.

## Move the task to the owner

Read `list_allowed_transitions` first. It reports the stage's `routePolicy`, each stage's kind and responsibility, and the targets a declaration may name with their conditions and the parameters they need. Only those targets can be declared without the exception flag: the exits in the orientation block say where the task may move, and a stage that authors no restriction lists no target here.

1. The current stage is a decision stage or a scripted stage: you cannot declare a route out of it. A decision stage is answered only by the person: report what it waits for, and never claim a choice was made. A scripted stage runs its program and follows its named exits.
2. The owner is a target listed by `list_allowed_transitions`: finish what belongs to the current stage, then declare the owner with `set_next_transition` and end your turn without doing the owner's work. The reason is at most 200 characters; use it to hand off what is done, what remains, and where to return when you know.
3. The owner is not a listed target, including when the current stage authors no restriction: do not do the work and do not move the task yet. Show the person the path through the configured routes, naming each intermediate stage and what it does on entry from its responsibility (a scripted stage picks its own exit and a decision stage waits for a person), and the forced jump straight to the owner. Wait for the choice, then declare what they chose without asking again: the first configured hop, or the jump with the exception flag, which you set only after their explicit confirmation of the jump. When no configured path reaches the owner, offer the jump alone.

Finishing the current stage's own work does not move the task. Declare a configured route with a reason only when the current stage instruction directs it, the user directly requests it, or another stage owns the work as above; completion, a next stage, an orientation block, or a request from another task alone is not such a direction. Otherwise finish and wait for a manual move, subject to independently enabled automatic mode; do not change that setting merely to enforce this rule. A declaration arms a completed-turn advance, not an immediate move.

## Questions and limits

Follow the current stage instruction and the user on how to ask questions and present decisions. Missing input, an unanswered question, or a pending approval is not consent. Respect normal tool permissions and explicit-request requirements. Workflow design and board administration belong to the workflow architect; do not bypass its tool gate through shell, APIs, storage, or delegation.

An unconfigured route requires an explicit direct user request in this task conversation, never a stage or peer request. Discover the destination's parameters before declaring, supply the exception flag, reason, and exact required values, and respect all guards. The flag is an agent assertion, not proof of user intent. An exception is limited to its originating completed turn; scripts retain authority over their entries and exits. If unavailable or refused, report the limitation rather than bypass it.
