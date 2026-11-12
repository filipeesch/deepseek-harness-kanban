import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

/** One raster image a tool result carries beside its text. */
export interface WorkflowImage {
  readonly attachmentId: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

/** Commits a rendered image as an attachment the calling route can read. */
export interface WorkflowImagePort {
  attach(input: { readonly png: Uint8Array; readonly width: number; readonly height: number; readonly name: string }, exec: ToolRunContext): Promise<WorkflowImage | undefined>;
}

interface AttachmentService {
  saveImage?(input: { data: Uint8Array; mediaType: string; name: string }): Promise<unknown>;
  imageLimits?: { mediaTypes?: readonly string[] };
}

interface LlmService {
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }>;
}

interface RouteHeader {
  requestHeader?(): { config?: { provider?: string; model?: string } } | undefined;
  options?: { provider?: string; model?: string };
}

/**
 * Attach a rendered drawing only when the calling route can read images.
 *
 * The result always carries the file paths, so a text-only route loses the
 * inline picture and nothing else. Every check that cannot answer with certainty
 * declines instead of risking a provider rejection of the whole tool result.
 */
export function createWorkflowImagePort(ctx: Context): WorkflowImagePort {
  return {
    async attach(input, exec) {
      try {
        const attachments = ctx.get('attachments') as AttachmentService | undefined;
        if (attachments?.saveImage === undefined) return undefined;
        if (attachments.imageLimits?.mediaTypes !== undefined && !attachments.imageLimits.mediaTypes.includes('image/png')) return undefined;
        const llm = ctx.get('llm') as LlmService | undefined;
        if (llm?.resolveModelInfo === undefined) return undefined;
        const agent = exec.agent as unknown as { session?: RouteHeader; options?: { provider?: string; model?: string } } | undefined;
        const routed = agent?.session?.requestHeader?.()?.config;
        const provider = routed?.provider ?? agent?.options?.provider;
        const model = routed?.model ?? agent?.options?.model;
        if (provider === undefined || model === undefined) return undefined;
        const info = await llm.resolveModelInfo(provider, model, exec.signal);
        if (info.inputModalities === undefined || !info.inputModalities.includes('image')) return undefined;
        const ref = await attachments.saveImage({ data: input.png, mediaType: 'image/png', name: input.name }) as { attachmentId?: unknown; mediaType?: unknown; bytes?: unknown; width?: unknown; height?: unknown; name?: unknown };
        if (typeof ref?.attachmentId !== 'string' || typeof ref.bytes !== 'number' || typeof ref.width !== 'number' || typeof ref.height !== 'number') return undefined;
        return { attachmentId: ref.attachmentId, mediaType: 'image/png', bytes: ref.bytes, width: ref.width, height: ref.height, ...(typeof ref.name === 'string' ? { name: ref.name } : { name: input.name }) };
      } catch {
        return undefined;
      }
    },
  };
}
