import { describe, expect, it } from 'vitest';
import { createTaskMessage, TASK_MESSAGE_SOURCE_KIND } from '../../src/host/task-message.js';

const delivery = {
  requestId: 'task-message:session-1:call-1',
  senderSessionId: 'session-1',
  senderTaskId: 'task-1',
  text: 'Message from task "Prepare release" (task-1).\n\nShip it.',
  summary: 'Task message from Prepare release',
};

describe('task message native record', () => {
  it('builds a user message with the plugin notice source', () => {
    const message = createTaskMessage(delivery);
    expect(message.role).toBe('user');
    expect(message.content).toEqual([{ type: 'text', text: delivery.text }]);
    expect(message.source).toMatchObject({
      kind: TASK_MESSAGE_SOURCE_KIND,
      form: 'notice',
      summary: delivery.summary,
      requestId: delivery.requestId,
      senderTaskId: delivery.senderTaskId,
      senderSessionId: delivery.senderSessionId,
    });
  });

  it('bounds the summary and keeps the record JSON-safe', () => {
    const message = createTaskMessage({ ...delivery, summary: 'Task message from ' + 'Long title '.repeat(30) });
    const summary = (message.source as { summary: string }).summary;
    expect(summary.length).toBe(120);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });
});
