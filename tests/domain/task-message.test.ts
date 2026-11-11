import { describe, expect, it } from 'vitest';
import { buildTaskMessageSummary, buildTaskMessageText, taskMessageIdentity } from '../../src/shared/task-message.js';

const sender = {
  hubName: 'Product Hub',
  boardName: 'Delivery',
  taskTitle: 'Prepare release',
  taskId: 'task-1',
};

describe('task message composition', () => {
  it('names the sending Hub, board, title, identifier, and the reply route', () => {
    const text = buildTaskMessageText(sender, 'Ship it.');
    expect(text).toContain('Prepare release');
    expect(text).toContain('task-1');
    expect(text).toContain('Product Hub');
    expect(text).toContain('Delivery');
    expect(text).toContain('send_task_message');
    expect(text.endsWith('Ship it.')).toBe(true);
  });

  it('keeps the body after the sender header without rewriting it', () => {
    const body = 'Line one.\nLine two.';
    expect(buildTaskMessageText(sender, body)).toContain(body);
  });

  it('names the sending task in the collapsed summary', () => {
    expect(buildTaskMessageSummary('Prepare release')).toBe('Task message from Prepare release');
  });

  it('derives a stable identity from the sending conversation and the call', () => {
    const first = taskMessageIdentity('session-1', 'call-1');
    expect(first).toBe(taskMessageIdentity('session-1', 'call-1'));
    expect(first).not.toBe(taskMessageIdentity('session-1', 'call-2'));
    expect(first).not.toBe(taskMessageIdentity('session-2', 'call-1'));
  });
});
