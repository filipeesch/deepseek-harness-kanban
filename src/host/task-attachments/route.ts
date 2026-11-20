import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection';
import { KanbanError } from '../../shared/errors.js';
import type { KanbanApp } from '../app.js';

/**
 * The exact path the browser downloads one task attachment from. It sits on the
 * shared API channel, so the physical carrier applies its trust and authentication
 * policy first and only the owner peer reaches it.
 */
export const TASK_ATTACHMENT_PATH = '/api/kanban/attachments';
/** The same path as the browser writes it, without the leading slash. */
export const TASK_ATTACHMENT_ROUTE = TASK_ATTACHMENT_PATH.slice(1);

/** Failure codes the browser may see; anything else becomes a generic refusal. */
const SAFE_CODES = new Set(['ATTACHMENT_MISSING', 'ATTACHMENT_CORRUPT', 'ATTACHMENT_NOT_A_FILE', 'TASK_NOT_FOUND', 'ATTACHMENTS_UNAVAILABLE']);

/**
 * Build the disposition header for one download.
 *
 * A Fetch header is a byte string, so a name outside ASCII cannot be sent as the
 * plain quoted `filename`. The header therefore carries an ASCII fallback plus the
 * RFC 5987 `filename*` form, which is how a browser receives a Unicode name intact.
 *
 * @param name - the recorded display name.
 * @returns the header value.
 */
export function contentDisposition(name: string): string {
  // Control characters and quotes would break the header or smuggle a second one.
  const cleaned = name.replace(/[\r\n]/g, ' ').replace(/["\\]/g, '_');
  // eslint-disable-next-line no-control-regex -- non-ASCII is exactly what is replaced.
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'file';
  // The RFC 5987 marker is held in a double-quoted literal so the two quotes survive.
  const rfc5987 = "UTF-8''";
  return 'attachment; filename="' + fallback + '"; filename*=' + rfc5987 + encodeURIComponent(cleaned);
}

/**
 * Serve one stored task attachment as a browser-native download.
 *
 * A download cannot use Remote invocation: the browser needs the bytes under a
 * disposition header, not a JSON payload. The route is registered inside the
 * connection authentication fence, so only the owner peer reaches it, and neither a
 * success nor a failure discloses a host path.
 *
 * @param ctx - host context owning the route lifetime.
 * @param app - the Kanban application that reads the stored bytes.
 * @param report - reports an underlying failure that the browser must not see.
 * @returns a disposer removing the route, or undefined when the host has no connection.
 */
export function registerTaskAttachmentRoute(ctx: Context, app: KanbanApp, report?: (error: unknown) => void): (() => Promise<void>) | undefined {
  // The service is optional on the context, so it is read defensively instead of assumed.
  const connection = ctx.connection as { fetch?: { register?: (route: ConnectionFetchRoute) => () => Promise<void> } } | undefined;
  const register = connection?.fetch?.register;
  if (register === undefined) return undefined;
  return register.call(connection!.fetch, {
    path: TASK_ATTACHMENT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const taskId = url.searchParams.get('taskId');
      const attachmentId = url.searchParams.get('attachmentId');
      const hubId = url.searchParams.get('hubId') ?? undefined;
      if (taskId === null || attachmentId === null) {
        return Response.json({ code: 'INVALID_INPUT', message: 'A task and an attachment are required.' }, { status: 400 });
      }
      try {
        const read = await app.readTaskAttachment(hubId, taskId, attachmentId);
        // The bytes are wrapped in a Blob so the body is a standard BodyInit while the
        // response still carries exactly what was stored.
        return new Response(new Blob([new Uint8Array(read.data)]), {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(read.bytes),
            'content-disposition': contentDisposition(read.name),
            'cache-control': 'no-store',
          },
        });
      } catch (error) {
        // A filesystem error can name the absolute object path, so the underlying cause
        // is reported on the host and the browser receives only a safe explanation.
        report?.(error);
        const code = (error as { code?: unknown }).code;
        const known = typeof code === 'string' && SAFE_CODES.has(code);
        const status = code === 'ATTACHMENT_MISSING' || code === 'TASK_NOT_FOUND' ? 404 : 400;
        return Response.json(
          { code: known ? code : 'ATTACHMENT_UNAVAILABLE', message: known && error instanceof KanbanError ? error.message : 'The file could not be read.' },
          { status },
        );
      }
    },
  });
}
