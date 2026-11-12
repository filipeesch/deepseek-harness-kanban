import type { Socket } from 'node:net';

/** The largest frame one authenticated message may occupy. */
const FRAME_MAX_BYTES = 8192;

/** Write one newline-delimited JSON message. */
export function line(socket: Socket, value: unknown): void {
  socket.write(JSON.stringify(value) + '\n');
}

/** Read newline-delimited JSON messages; a malformed or oversized frame ends the channel. */
export function messages(socket: Socket, callback: (message: Record<string, unknown>) => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', text => {
    buffer += text;
    if (Buffer.byteLength(buffer) > FRAME_MAX_BYTES) { socket.destroy(); return; }
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let value: unknown;
      try { value = JSON.parse(frame); } catch { socket.destroy(); return; }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { socket.destroy(); return; }
      try { callback(value as Record<string, unknown>); } catch { socket.destroy(); }
    }
  });
}
