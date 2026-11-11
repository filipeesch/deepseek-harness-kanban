# Tasks

## 1. Contracts and message composition

- [x] 1.1 Add `src/shared/task-message.ts` with the delivery value, the source fields, the identity builder (`[senderSessionId, callId]`), the content builder (sender Hub, board, title, and identifier before the body), and the summary builder (the native message factory bounds it); verify with `pnpm vitest run tests/domain/task-message.test.ts` covering header text, summary bound, and identity stability.
- [x] 1.2 Declare the `task-message` source in the plugin's `MessageSourceMap` augmentation and add `createTaskMessage` in `src/host/task-message.ts`; verify with a host unit test that the built message is a `user/message` with `kind: 'task-message'`, `form: 'notice'`, the bounded summary, and JSON-safe extra fields.
- [x] 1.3 Add the `TaskMessageDelivery` (and any scope/preparation) port types to `src/shared/ports.ts` without adding a method to `SessionPort`; verify `pnpm typecheck` compiles host and client programs.

## 2. At-most-once plugin message delivery

- [x] 2.1 Generalize `src/host/stage-delivery.ts` into a source-kind-parameterized `createPluginMessageDelivery` that keeps the in-flight join, pending-inbox check, and durable-log check, and make stage delivery compose it; verify `pnpm vitest run tests/host/stage-delivery.test.ts` passes without test changes.
- [x] 2.2 Add a native adapter that resolves the target via `sessionController.resolveAgent` and delivers with `agent.steer`, using the generalized delivery with the `task-message` source and `[senderSessionId, callId]` identity; verify with a host test that an idle target receives one steer, a repeated identity delivers once, and a pending or logged message is skipped.
- [x] 2.3 Cover the failure path in the adapter test: an unresolvable target or an admission error reports the failure and does not retry or mark the identity as delivered.

## 3. Target conversation preparation

- [x] 3.1 Extract the worktree decision currently inside `planFirstExecution` into a reusable domain function returning `blocked`, `create-default`, `base`, or `none`, and use it from both first execution and message preparation; verify the existing `tests/domain/first-execution.test.ts` and `tests/host/first-execution.test.ts` pass unchanged.
- [x] 3.2 Implement the conversation preparer: resolve `firstOpenSessionId`, fail a preparing or error binding with `WORKTREE_BINDING_UNRESOLVED`, create the default worktree through the existing defaults and coordinator for a Git-backed undecided task, then create the conversation through `KanbanApp.createConversation`; serialize the whole preparation; verify with host tests for the first-open, create-default, base-choice, folder-project, and blocked-binding branches.
- [x] 3.3 Re-resolve the task and its first open conversation immediately before delivery, return the created worktree and conversation in the delivery result, and keep a created worktree when the conversation cannot be created; verify with a test that injects a conversation created concurrently and with a test that fails conversation creation after worktree creation.

## 4. Message service and tool

- [x] 4.1 Implement `InterCardMessaging` with the structural policy: the sender session must be task-owned, the target must exist in the same Hub, the target must differ from the sender task, and the body must be non-empty; verify with unit tests for each rejection and one accepted delivery.
- [x] 4.2 Build the message content and result through the service, including the sender identity header and the text-only reply guidance, and report the target task, conversation, delivery, and created resources; verify with a service test asserting every result field.
- [x] 4.3 Add `src/host/tools/messages.ts` with the `send_task_message` definition (target task identifier and message body), the explicit-user-request description, and the task-conversation-only rule, and register it in `src/host/tools/index.ts`; verify with a host test that the tool rejects an ordinary chat, a subagent session, the sender task, a cross-Hub target, and an empty body, and that it delegates an accepted call to the service.
- [x] 4.4 Ensure the tool is not offered new behavior outside the scope: no size or rate limit, no deferral, and no reply flag or thread metadata; verify the tool schema snapshot in a test contains only the two arguments.

## 5. Client transcript row

- [x] 5.1 Extract a `createPluginContextRow({ nodeKind, sourceKind, title, fallbackClass })` factory from the shared context-row module and migrate the `kanban-task` and `stage-instruction` modules to it; verify the existing client tests for both nodes pass without behavior changes.
- [x] 5.2 Add the `kanban-task-message` node kind and register its definition and view in `src/client.tsx`, delegating to the host context-row renderer with an inline fallback titled `Task message`; verify with a client test that the definition claims the `task-message` source, builds the node payload at the message position, and renders the fallback text.

## 6. Wiring, documentation, and verification

- [x] 6.1 Compose the service, delivery adapter, and conversation preparer in `src/index.ts` with the plugin lifetime and disposal, and register the tool in the product tool set; verify `pnpm typecheck` and that the plugin still loads in the isolated profile.
- [x] 6.2 Update the README: remove the "no model tools to ... message another card" statement, add `send_task_message` to the tool table, and document the same-Hub scope, explicit user request, text-only reply request, first-conversation preparation, and the absent limits; verify the rendered statements match the new specs.
- [x] 6.3 Bump `version` in `package.json` for the installed artifact and verify the build reports the new version.
- [x] 6.4 Run `pnpm check` (host and client typechecks, vitest, build) and `pnpm test:browser`; verify both exit successfully.
- [x] 6.5 Add a browser test under the plugin-owned harness that renders the delivered row under the host theme fixture, asserts the collapsed summary and the expanded body in light and dark, and writes screenshots under `.verification/`; verify `pnpm test:browser` passes.
- [x] 6.6 Run the isolated web smoke from AGENTS.md with two tasks on a throwaway `DSH_HOME`: deliver a message from one task conversation to the other, confirm the collapsed `Task message` row and its expansion in the target drawer, confirm the first-conversation preparation path when the target has none, capture evidence under `.verification/`, then stop the background job and remove the temporary home; verify the existing GUI and personal profile were untouched.
- [x] 6.7 Resolve the reviewer findings: scan durable `agent/inbox/spliced` admissions for dedupe, use the source summary in the fallback row, make first-start conversation creation reuse a concurrently prepared conversation while the plus action still creates, align the design and task wording, and prove both queue orders plus the canceled-steering restart; verify with the targeted host/client tests, `pnpm check`, and `pnpm test:browser`.
