import { describe, expect, it, vi } from 'vitest';
import { answerFile, createAnswerFileDelivery, decodeBase64, uploadAnswerFile, type AnswerFileUploadPort } from '../../src/client/answer-files.js';

const session = 'session-1' as never;

/** One recording port; the call shape is the contract this adapter must keep. */
function port(outcome: Awaited<ReturnType<NonNullable<AnswerFileUploadPort['upload']>>> = { ok: true, value: { receiptId: 'receipt-1' } }) {
  const calls: Array<{ sessionId: unknown; data: unknown; name?: string }> = [];
  const upload = vi.fn(async (sessionId: never, data: Blob, name?: string) => {
    calls.push({ sessionId, data, name });
    return outcome;
  });
  return { calls, upload, port: { upload } as AnswerFileUploadPort };
}

describe('answer file delivery', () => {
  it('decodes canonical base64 into the exact bytes', () => {
    // Bytes above the ASCII range prove the decoder does not go through a text codec.
    expect([...decodeBase64('AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect([...decodeBase64('YWJj')]).toEqual([97, 98, 99]);
  });

  it('builds a generic file with the recorded name', async () => {
    const file = answerFile('spec.pdf', 'YWJj');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('spec.pdf');
    expect(file.type).toBe('application/octet-stream');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([97, 98, 99]);
  });

  it('uploads the file as a browser file, never as exact bytes', async () => {
    const recorded = port();
    const receipt = await uploadAnswerFile(recorded.port, session, { name: 'spec.pdf', data: 'YWJj' });
    expect(receipt).toBe('receipt-1');
    expect(recorded.calls).toHaveLength(1);
    const [call] = recorded.calls;
    expect(call!.sessionId).toBe('session-1');
    expect(call!.name).toBe('spec.pdf');
    // The host's exact-bytes branch resolves a Remote namespace the plugin does not
    // inject, so a regression here would break every answer carrying a file.
    expect(call!.data).not.toBeInstanceOf(Uint8Array);
    expect(call!.data).toBeInstanceOf(File);
    expect([...new Uint8Array(await (call!.data as File).arrayBuffer())]).toEqual([97, 98, 99]);
  });

  it('refuses when the host exposes no upload service', async () => {
    await expect(uploadAnswerFile(undefined, session, { name: 'a.txt', data: 'YWJj' }))
      .rejects.toThrow('This host cannot upload a file for an answer.');
  });

  it('reports the host refusal', async () => {
    const recorded = port({ ok: false, error: { message: 'The selected file is too large.' } });
    await expect(uploadAnswerFile(recorded.port, session, { name: 'a.txt', data: 'YWJj' }))
      .rejects.toThrow('The selected file is too large.');
  });

  it('refuses a receipt-less success instead of sending a prompt that cites nothing', async () => {
    const recorded = port({ ok: true, value: {} });
    await expect(uploadAnswerFile(recorded.port, session, { name: 'a.txt', data: 'YWJj' }))
      .rejects.toThrow('The file could not be uploaded for this answer.');
  });
});

describe('answer file delivery', () => {
  /** A delivery over a recording prompt; the prompt shape is what the conversation reads. */
  function delivery(outcome: { ok: boolean; error?: { message?: unknown } } = { ok: true }) {
    const prompts: Array<{ content: unknown[]; mode: string }> = [];
    const uploads = port();
    const built = createAnswerFileDelivery({
      uploads: () => uploads.port,
      conversation: () => ({ prompt: async (content, mode) => { prompts.push({ content, mode }); return outcome; } }),
    });
    return { built, prompts, uploads };
  }

  it('sends the whole answer as one prompt carrying every receipt, then the text', async () => {
    const { built, prompts } = delivery();
    await built.submit('session-1', 'Answer text', ['receipt-1', 'receipt-2']);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.mode).toBe('queue');
    expect(prompts[0]!.content).toEqual([
      { type: 'file', receiptId: 'receipt-1' },
      { type: 'file', receiptId: 'receipt-2' },
      { type: 'text', text: 'Answer text' },
    ]);
  });

  it('omits the text part for a reply that has none', async () => {
    const { built, prompts } = delivery();
    await built.submit('session-1', '', ['receipt-1']);
    expect(prompts[0]!.content).toEqual([{ type: 'file', receiptId: 'receipt-1' }]);
  });

  it('uploads through the port and returns the receipt the prompt cites', async () => {
    const { built, uploads } = delivery();
    await expect(built.upload('session-1', { name: 'spec.pdf', data: 'YWJj' })).resolves.toBe('receipt-1');
    expect(uploads.calls).toHaveLength(1);
    expect(uploads.calls[0]!.name).toBe('spec.pdf');
  });

  it('refuses an answer when the conversation is unavailable', async () => {
    const built = createAnswerFileDelivery({ uploads: () => port().port, conversation: () => undefined });
    await expect(built.submit('session-1', 'text', [])).rejects.toThrow('The native conversation is not available. Reopen this conversation and retry.');
  });

  it('reports the refusal the conversation returned', async () => {
    const { built } = delivery({ ok: false, error: { message: 'The session is closed.' } });
    await expect(built.submit('session-1', 'text', [])).rejects.toThrow('The answer could not be submitted: The session is closed.');
  });
});
