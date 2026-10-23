import { describe, expect, it, vi } from 'vitest';
import { InstructionDraftPortImpl, type InstructionDraftBinding } from '../../src/client/instruction-draft.js';

function binding(result: 'applied' | 'preserved' | 'blocked' = 'applied') {
  let draft = '';
  const attachments = ['attachment-1'];
  const requestDraftInitialization = vi.fn(({ prompt, clearPreviousDraft }: { prompt: string; clearPreviousDraft?: boolean }) => {
    if (result === 'blocked') return 'blocked' as const;
    if (result === 'preserved') return 'preserved' as const;
    if (!clearPreviousDraft && draft) return 'preserved' as const;
    draft = prompt;
    return 'applied' as const;
  });
  const focus = vi.fn();
  const removeAttachment = vi.fn((id: string) => { const index = attachments.indexOf(id); if (index >= 0) { attachments.splice(index, 1); return true; } return false; });
  const value: InstructionDraftBinding = {
    requestDraftInitialization,
    focus,
    attachmentIds: () => [...attachments],
    removeAttachment,
  };
  return { value, requestDraftInitialization, focus, removeAttachment, attachments };
}

describe('instruction draft port', () => {
  it('queues a request until the conversation attaches, then applies once and focuses', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding();
    const controller = new AbortController();
    const pending = port.prepare('session-1', 'Plan this task.', controller.signal);
    expect(fake.requestDraftInitialization).not.toHaveBeenCalled();
    const detach = port.attach('session-1', fake.value);
    await expect(pending).resolves.toBe('applied');
    expect(fake.requestDraftInitialization).toHaveBeenCalledWith({ prompt: 'Plan this task.' });
    expect(fake.focus).toHaveBeenCalledOnce();
    detach();
  });

  it('reports preserved and blocked without focusing', async () => {
    const preservedPort = new InstructionDraftPortImpl();
    const preserved = binding('preserved');
    preservedPort.attach('session-1', preserved.value);
    await expect(preservedPort.prepare('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('preserved');
    expect(preserved.focus).not.toHaveBeenCalled();

    const blockedPort = new InstructionDraftPortImpl();
    const blocked = binding('blocked');
    blockedPort.attach('session-1', blocked.value);
    await expect(blockedPort.prepare('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('blocked');
    expect(blocked.focus).not.toHaveBeenCalled();
  });

  it('replaces text and attachments with an explicit clear', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding();
    port.attach('session-1', fake.value);
    await expect(port.replace('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('applied');
    expect(fake.removeAttachment).toHaveBeenCalledWith('attachment-1');
    expect(fake.requestDraftInitialization).toHaveBeenCalledWith({ prompt: 'Plan this task.', clearPreviousDraft: true });
    expect(fake.focus).toHaveBeenCalledOnce();
  });

  it('does not remove attachments when the native initialization blocks', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding('blocked');
    port.attach('session-1', fake.value);
    await expect(port.replace('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('blocked');
    expect(fake.requestDraftInitialization).toHaveBeenCalledWith({ prompt: 'Plan this task.', clearPreviousDraft: true });
    expect(fake.removeAttachment).not.toHaveBeenCalled();
    expect(fake.focus).not.toHaveBeenCalled();
  });

  it('reports blocked when an applied replace cannot remove every attachment', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding();
    const removeAttachment = vi.fn(() => false);
    fake.value.removeAttachment = removeAttachment;
    port.attach('session-1', fake.value);
    await expect(port.replace('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('blocked');
    expect(removeAttachment).toHaveBeenCalledWith('attachment-1');
    expect(fake.focus).not.toHaveBeenCalled();
  });

  it('resolves unavailable when aborted before attach and never applies later', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding();
    const controller = new AbortController();
    const pending = port.prepare('session-1', 'Plan this task.', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe('unavailable');
    port.attach('session-1', fake.value);
    expect(fake.requestDraftInitialization).not.toHaveBeenCalled();
  });

  it('keeps focus best effort and still reports applied', async () => {
    const port = new InstructionDraftPortImpl();
    const fake = binding();
    fake.value.focus = () => { throw new Error('composer unavailable'); };
    port.attach('session-1', fake.value);
    await expect(port.prepare('session-1', 'Plan this task.', new AbortController().signal)).resolves.toBe('applied');
  });

  it('keeps pending requests isolated per conversation', async () => {
    const port = new InstructionDraftPortImpl();
    const first = binding();
    const second = binding();
    const one = port.prepare('session-1', 'One', new AbortController().signal);
    const two = port.prepare('session-2', 'Two', new AbortController().signal);
    port.attach('session-2', second.value);
    await expect(two).resolves.toBe('applied');
    expect(first.requestDraftInitialization).not.toHaveBeenCalled();
    port.attach('session-1', first.value);
    await expect(one).resolves.toBe('applied');
  });
});
