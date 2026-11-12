/**
 * Cut text to a byte budget without splitting a UTF-8 sequence.
 *
 * Uses TextEncoder so the same rule works in the host and in the client bundle,
 * and takes the budget from the caller so no reader inherits a silent default.
 */
export function bounded(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const marker = '\n[output truncated]';
  const markerBytes = new TextEncoder().encode(marker).length;
  if (maxBytes <= markerBytes) return marker.slice(0, Math.max(0, maxBytes));
  const prefix = new TextDecoder().decode(bytes.subarray(0, maxBytes - markerBytes), { stream: true });
  return prefix + marker;
}

/** Keep the last bytes of a text, marking the cut at its beginning. */
export function boundedTail(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const marker = '[truncated]';
  const markerBytes = new TextEncoder().encode(marker).length;
  if (maxBytes <= markerBytes) return marker.slice(0, Math.max(0, maxBytes));
  const suffix = new TextDecoder().decode(bytes.subarray(bytes.length - (maxBytes - markerBytes)));
  return marker + suffix;
}

/** Byte length of one string, computed without a Node-only global. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
