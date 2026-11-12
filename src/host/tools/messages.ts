import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { invariant } from '../../shared/errors.js';
import type { InterCardMessaging } from '../inter-card-messaging.js';
import { normal, text } from './support.js';

export function messageTools(messaging: InterCardMessaging): ToolDefinition[] {
  return [
    normal('send_task_message',
      'Send one message from this task conversation to another task in the same Hub. Use it when the user explicitly requests the message, or when this conversation\'s stage instruction explicitly directs it; never message another task for unsolicited progress tracking. To request a stage transition, read the target\'s targets with list_allowed_transitions first, then name the destination stage identifier and the reason in the body; the target\'s own stage conditions decide whether it declares, and this call neither validates nor moves anything. The target must be a different task in the same Hub. When the user or the directing stage instruction asks for a reply, or when you need the transition outcome, ask for it explicitly in the message body. A reply is allowed only when the received message asks for one, or when the user in this conversation asks you to reply; a reply uses this tool with the sending task as task_id. Never invent a reply request.',
      {
        task_id: text('Target task ID. It must be another task in the same Hub.', true),
        message: text('Message body. Include an explicit reply request only when the user, the stage instruction that directed the message, or the need for the transition outcome requires one.', true),
      },
      async (args, exec) => {
        invariant(exec.agent, 'MISSING_SESSION', 'Sending a task message requires an owning native conversation.');
        return messaging.send({
          senderSessionId: String(exec.agent.id),
          targetTaskId: args.task_id,
          body: args.message,
          callId: String(exec.callId),
        });
      }),
  ];
}
