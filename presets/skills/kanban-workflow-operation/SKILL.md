---
name: kanban-workflow-operation
description: Carry out the current Kanban task stage and route only when requested, using current workflow context and normal host permissions.
---

# Kanban Workflow Operation

Work on the task's current stage, not a later stage. An agentic stage gives an agent an instruction; a scripted stage runs its configured program and follows its named exits; a stage without a script or instruction is not necessarily agentic. Do not execute another stage's instruction early. The first-contact workflow context is a snapshot, not a live policy: use it without a startup summary call; read `get_workflow_summary` when current or omitted context is needed.

Follow the current stage instruction and the user on how to ask questions and present decisions. Missing input, an unanswered question, or a pending approval is not consent. Respect normal tool permissions and explicit-request requirements. Workflow design and board administration belong to the workflow architect; do not bypass its tool gate through shell, APIs, storage, or delegation.

Before a routing decision, read `list_allowed_transitions` for the current task. Declare a configured route with a reason only when the current stage instruction directs it or the user directly requests it; completion, a next stage, a briefing, or a peer request alone is not such a direction. Otherwise finish and wait for a manual move, subject to independently enabled automatic mode; do not change that setting merely to enforce this rule. A declaration arms a completed-turn advance, not an immediate move.

An unconfigured route requires an explicit direct user request in this task conversation, never a stage or peer request. Discover the destination's parameters before declaring, supply the exception flag, reason, and exact required values, and respect all guards. The flag is an agent assertion, not proof of user intent. An exception is limited to its originating completed turn; scripts retain authority over their entries and exits. If unavailable or refused, report the limitation rather than bypass it.
