import type { SessionId } from '@deepseek-ai/dsh-session/types';

/**
 * The browser upload outcome the composition root reads. Only the receipt matters
 * here: the host owns storage, validation, and the file reference the prompt cites.
 */
export interface AnswerFileUploadOutcome {
  readonly ok: boolean;
  readonly value?: { readonly receiptId?: unknown };
  readonly error?: { readonly message?: unknown };
}

/**
 * The one upload call this adapter needs from the host's browser upload service.
 * It is declared structurally so the adapter never depends on the host service's
 * module, and a test can supply its own port.
 */
export interface AnswerFileUploadPort {
  upload?(sessionId: SessionId, data: Blob, name?: string): Promise<AnswerFileUploadOutcome>;
}

/**
 * Decode one canonical base64 payload into the exact bytes it encodes.
 *
 * @param data - base64 text of a stored draft copy.
 * @returns the decoded bytes.
 */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Rebuild the browser file a picker would have produced from a stored draft copy.
 *
 * @param name - display name the draft recorded.
 * @param data - base64 text of the draft copy.
 * @returns a generic file, never an image part.
 */
export function answerFile(name: string, data: string): File {
  return new File([decodeBase64(data)], name, { type: 'application/octet-stream' });
}

/** One part of the native prompt an answer becomes. */
export type AnswerPromptPart =
  | { readonly type: 'file'; readonly receiptId: never }
  | { readonly type: 'text'; readonly text: string };

/** The native prompt result the answer reads. */
export interface AnswerPromptResult {
  readonly ok: boolean;
  readonly error?: { readonly message?: unknown };
}

/** The native conversation one answer is sent to. */
export interface AnswerFileConversation {
  prompt(content: AnswerPromptPart[], mode: 'queue'): Promise<AnswerPromptResult>;
}

/** Everything one conversation's answer delivery needs. */
export interface AnswerFileDeliveryDeps {
  /**
   * The host upload service, or undefined when the host exposes none. Read when an
   * answer actually needs it, so the delivery never depends on the host being fully
   * wired at composition time.
   */
  uploads(): AnswerFileUploadPort | undefined;
  /** The native conversation that will receive the answer, or undefined when it is unavailable. */
  conversation(sessionId: string): AnswerFileConversation | undefined;
}

/** How one conversation receives an answer that carries files. */
export interface AnswerFileDelivery {
  upload(sessionId: string, file: { name: string; data: string }): Promise<string>;
  submit(sessionId: string, text: string, receipts: readonly string[]): Promise<void>;
}

/**
 * Build the delivery the question dock hands to a round: upload one file to get the
 * receipt a prompt cites, then send the whole answer as one prompt carrying those
 * receipts. The native session lookup stays with the caller, so this adapter never
 * depends on the host's session registry.
 *
 * @param deps - the upload port and the conversation lookup.
 * @returns the delivery the dock uses.
 */
export function createAnswerFileDelivery(deps: AnswerFileDeliveryDeps): AnswerFileDelivery {
  return {
    upload: (sessionId, file) => uploadAnswerFile(deps.uploads(), sessionId as never, file),
    submit: async (sessionId, text, receipts) => {
      const conversation = deps.conversation(sessionId);
      if (conversation === undefined) throw new Error('The native conversation is not available. Reopen this conversation and retry.');
      const result = await conversation.prompt(
        [
          // The receipt identity is minted by the host, so only the adapter may assert it.
          ...receipts.map(receiptId => ({ type: 'file' as const, receiptId: receiptId as never })),
          ...(text === '' ? [] : [{ type: 'text' as const, text }]),
        ],
        'queue',
      );
      if (!result.ok) throw new Error('The answer could not be submitted: ' + String(result.error?.message ?? 'the conversation refused the reply'));
    },
  };
}

/**
 * Upload one answer file for a conversation and return the receipt a prompt cites.
 *
 * The file travels as a `File`, which the host's browser upload service carries over
 * its authenticated upload route. Exact bytes are deliberately avoided: that branch
 * resolves a Remote namespace against the caller's inject list, which a plugin does
 * not declare, and fails before the host ever sees the file.
 *
 * @param port - the host upload service, or undefined when the host exposes none.
 * @param sessionId - the conversation that will own the staged receipt.
 * @param file - the draft's display name and exact base64 bytes.
 * @returns the staged receipt identity.
 */
export async function uploadAnswerFile(
  port: AnswerFileUploadPort | undefined,
  sessionId: SessionId,
  file: { name: string; data: string },
): Promise<string> {
  if (port?.upload === undefined) throw new Error('This host cannot upload a file for an answer.');
  const result = await port.upload(sessionId, answerFile(file.name, file.data), file.name);
  if (!result.ok || typeof result.value?.receiptId !== 'string') {
    throw new Error(typeof result.error?.message === 'string' ? result.error.message : 'The file could not be uploaded for this answer.');
  }
  return result.value.receiptId;
}
