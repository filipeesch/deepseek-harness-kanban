// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client';
import { taskContextText } from '../../src/client.js';

function windowWith(entries: readonly unknown[]): SessionEventWindow {
  return { entries, hasMore: false, revision: 1, change: { kind: 'replace', entries: [] } } as SessionEventWindow;
}
const user = (text: string, kind = 'user') => ({ type: 'event', event: { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } } });

describe('task context row extraction', () => {
  it('returns the first plugin-owned task-context text', () => {
    expect(taskContextText(windowWith([user('Hello'), user('Task: Alpha', 'kanban-task')]))).toBe('Task: Alpha');
  });

  it('returns null without a task-context message', () => {
    expect(taskContextText(windowWith([]))).toBeNull();
    expect(taskContextText(windowWith([user('Hello')]))).toBeNull();
  });

  it('concatenates multiple text blocks in one context message', () => {
    const entry = { type: 'event', event: { type: 'user/message', data: { source: { kind: 'kanban-task' }, content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } } };
    expect(taskContextText(windowWith([entry]))).toBe('one\ntwo');
  });
});
