/** The bounded bytes one stream may contribute to the result envelope. */
export const STDOUT_LIMIT = 32000;
export const STDERR_LIMIT = 3000;

/** One bounded stream: measured in full, retained only while it fits. */
export class BoundedCapture {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly limit: number) {}
  /** Bytes received, including bytes past the bound. */
  get bytes(): number { return this.size; }
  /** Returns false when the stream exceeded its bound and this chunk was dropped. */
  push(chunk: Buffer): boolean {
    this.size += chunk.length;
    if (this.size > this.limit) return false;
    this.chunks.push(chunk);
    return true;
  }
  text(): string { return Buffer.concat(this.chunks).toString('utf8'); }
}
