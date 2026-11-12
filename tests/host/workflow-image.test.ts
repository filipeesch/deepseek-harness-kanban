import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createWorkflowImagePort } from '../../src/host/workflow-image.js';

function context(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context;
}

function execution(): ToolRunContext {
  return { signal: new AbortController().signal, agent: { session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } } } as unknown as ToolRunContext;
}

function attachments() {
  return { saveImage: vi.fn(async () => ({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 4, width: 10, height: 10, name: 'diagram.png' })), imageLimits: { mediaTypes: ['image/png'] } };
}

const png = new Uint8Array([137, 80, 78, 71]);

describe('workflow image attachment', () => {
  it('attaches the drawing when the route declares image input', async () => {
    const store = attachments();
    const port = createWorkflowImagePort(context({ attachments: store, llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) } }));
    const result = await port.attach({ png, width: 10, height: 10, name: 'diagram.png' }, execution());
    expect(result).toMatchObject({ attachmentId: 'sha256:abc', mediaType: 'image/png', name: 'diagram.png' });
    expect(store.saveImage).toHaveBeenCalledTimes(1);
  });

  it('declines for a text-only route instead of failing the result', async () => {
    const store = attachments();
    const port = createWorkflowImagePort(context({ attachments: store, llm: { resolveModelInfo: async () => ({ inputModalities: ['text'] }) } }));
    await expect(port.attach({ png, width: 10, height: 10, name: 'diagram.png' }, execution())).resolves.toBeUndefined();
    expect(store.saveImage).not.toHaveBeenCalled();
  });

  it('declines without an attachment service or a resolvable route', async () => {
    const withLlm = createWorkflowImagePort(context({ llm: { resolveModelInfo: async () => ({ inputModalities: ['image'] }) } }));
    await expect(withLlm.attach({ png, width: 10, height: 10, name: 'diagram.png' }, execution())).resolves.toBeUndefined();
    const withoutRoute = createWorkflowImagePort(context({ attachments: attachments() }));
    await expect(withoutRoute.attach({ png, width: 10, height: 10, name: 'diagram.png' }, { signal: new AbortController().signal, agent: {} } as unknown as ToolRunContext)).resolves.toBeUndefined();
  });

  it('declines when the deployment does not accept PNG images', async () => {
    const store = { ...attachments(), imageLimits: { mediaTypes: ['image/jpeg'] } };
    const port = createWorkflowImagePort(context({ attachments: store, llm: { resolveModelInfo: async () => ({ inputModalities: ['image'] }) } }));
    await expect(port.attach({ png, width: 10, height: 10, name: 'diagram.png' }, execution())).resolves.toBeUndefined();
  });
});
