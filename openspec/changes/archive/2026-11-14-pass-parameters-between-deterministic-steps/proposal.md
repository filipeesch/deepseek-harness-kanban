# Proposal

## Why

A deterministic step can already exit to another deterministic step, but the destination's declared parameters can only be supplied by an agent-declared transition or repaired by hand after the entry fails. A script that discovers the value the next script needs — a pipeline, an artifact, a commit — cannot pass it, so a chained workflow forces a manual repair between two automated blocks and the discovered value never reaches the next conversation.

## What Changes

- A successful deterministic program may additionally return a bounded `params` object of string values in its completion, in both TypeScript and standalone Bash. The field is optional, so every existing script keeps its current contract.
- When the captured exit targets a deterministic stage, the host binds the sent values that match the destination's declared parameter names (1:1). Missing declared names keep the existing parameter admission refusal, with Play and the entry parameter editor available; extra names never become program input.
- The sent map travels with the handoff. A destination that runs a conversation (agent or manual) receives it as a bounded context block beside the handoff message, the same way a declared transition reason accompanies a stage instruction. A deterministic destination receives only its declared names in `input.params`; the raw map is not exposed on `input.handoff`.
- The logical handoff record and its History row preserve the bounded sent values, so the values that crossed a script boundary are auditable without reading conversations.
- No workflow YAML grammar change, no board-log format change, and no new executable approval: parameter values remain entry-local task data, and the reviewed authority stays the declaration.
- The shared task dialog is rendered through a portal at the plugin root, so the parameter editor is no longer clipped or overlapped by a stage or the workflow canvas. The parameter editor uses a wider, taller layout with a scrollable value list.
- Two authorized refactors: completion validation moves to one pure contract shared by the executor and the supervisor; handoff parameter binding moves to a pure domain function used by routing and delivery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deterministic-steps`: the completion contract gains optional parameter values; a completed result may supply a deterministic destination's declared parameters; the sent values accompany the handoff as model-facing context and appear in history; the card/drawer parameter editor is presented above the diagram and board surfaces with enough room for the declared values.
- `task-history`: the logical deterministic handoff entry additionally carries, bounded, the parameter values the source script sent, and its History row presents them without claiming the destination executed with them.

## Impact

Shared types and durable schemas for completion, result, and handoff; completion parsing in the executor and the supervisor; parameter binding and validation in the deterministic supervisor and router; placement of the destination entry; handoff context composition for agent and manual destinations; the script input builder; task history records and the History view; the shared client modal and the parameter editor; documentation, the workflow-architect preset reference, and the package version. Verification adds domain, host, client, browser, and isolated-lane coverage; no real model, credential, or personal profile is used.
