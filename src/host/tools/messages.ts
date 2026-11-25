import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { invariant } from '../../shared/errors.js';
import type { InterCardMessaging } from '../inter-card-messaging.js';
import { normal, text } from './support.js';

export function messageTools(messaging: InterCardMessaging): ToolDefinition[] {
  return [
    normal('send_task_message',
      'Send one message from this task conversation: to another task in the same Hub, or to another conversation of this task. Use it when the user explicitly requests the message, or when this conversation\'s stage instruction explicitly directs it; never message for unsolicited progress tracking. Omit task_id to address this task: the main conversation by default, an agent conversation with agent, and a stage with deliver_at. A message with deliver_at is held and delivered when the task first enters that stage, together with that stage\'s instruction when the destination conversation is the same, so it reports the work of a finished stage without racing the next one; a message without it is delivered now. When the target is another task, task_id is required and agent and deliver_at are refused. To request a stage transition, read the target\'s targets with list_allowed_transitions first, then name the destination stage identifier and the reason in the body; the target\'s own stage conditions decide whether it declares, and this call neither validates nor moves anything. When the user or the directing stage instruction asks for a reply, or when you need the transition outcome, ask for it explicitly in the message body. A reply is allowed only when the received message asks for one, or when the user in this conversation asks you to reply; a reply names the sending task and, when the message came from an agent conversation, that agent. Never invent a reply request.',
      {
        task_id: text('Target task ID. Omit to address this task. When present it must be another task in the same Hub unless you also name an agent or a destination stage.'),
        agent: text('Agent identity of this task whose conversation receives the message. Accepted only when addressing this task.'),
        deliver_at: text('Stage identifier of this task. The host holds the message and delivers it when the task first enters that stage. Accepted only when addressing this task.'),
        message: text('Message body. Include an explicit reply request only when the user, the stage instruction that directed the message, or the need for the transition outcome requires one.', true),
      },
      async (args, exec) => {
        invariant(exec.agent, 'MISSING_SESSION', 'Sending a task message requires an owning native conversation.');
        return messaging.send({
          senderSessionId: String(exec.agent.id),
          ...(args.task_id === undefined ? {} : { targetTaskId: args.task_id }),
          ...(args.agent === undefined ? {} : { agent: args.agent }),
          ...(args.deliver_at === undefined ? {} : { deliverAt: args.deliver_at }),
          body: args.message,
          callId: String(exec.callId),
        });
      }),
  ];
}
