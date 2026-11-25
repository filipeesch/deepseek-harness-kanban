# Agents and stage conversations

A board may declare agents and let a stage run in one agent's own conversation.

## The document

- Root `agents`: a list of `{id, name, preset?, model?}`. `model` accepts the same mapping as the board default model.
- `main` is always resolvable and cannot be removed. Authoring `agents.main` names the main conversation's preset and model; an entry without `preset` is an explicit host default; without any `agents.main` the legacy root `agent_preset`/`model` and the board metadata still decide.
- Column `agent: <id>` names the agent a stage runs with. An undeclared identifier is invalid, a scripted or decision stage cannot name one, and several stages may share an agent and therefore one conversation.
- An agent change is a change to the workflow's meaning, not to its layout.
- A preset or model the running host does not offer is an authoring warning and never a refusal, because a board travels between installations with different rosters.

```yaml
agents:
  - id: main
    name: Main
  - id: designer
    name: UX Design
    preset: ux-design
columns:
  - id: design
    label: Design
    agent: designer
    on_enter_prompt: |
      Design the feature and record the result in a shared note.
      Then read list_allowed_transitions and declare the next stage with set_next_transition.
```

## Runtime

A stage that names an agent runs its entry instruction in that agent's conversation, created with the agent's preset and model before its first turn and titled with the agent's name; a stage that names none runs in the main conversation. The specialist routes like any agent stage: its instruction must ask it to declare the transition, otherwise auto mode or the person moves the card, and the host never advances alone. Its preset must not mask the Kanban product tools it needs to declare that transition and to send a message.

An agent preset the host does not offer holds the stage: no conversation is created, the card names the missing preset, and its run action retries once the preset is installed. A missing model falls back to the main agent's model and then to the deployment default, reported on the card and in the conversation. A conversation keeps the preset it started with, so a later edit to that agent's preset applies only to conversations created afterwards.

A specialist that produces something another conversation needs sends it with `send_task_message` and names `deliver_at`, so the host holds the message until the task enters that stage instead of racing the next instruction. Address the main conversation by omitting `task_id` and `agent`.

## Authoring and migration

Prefer `set_agent`, `set_stage_agent`, and `remove_agent` over literal edits. Removing an agent a stage still names is refused until the stage is cleared. The first save of the board's agents or defaults materializes the effective main-agent choice and retires the legacy root fields; no other edit rewrites the document's shape.
