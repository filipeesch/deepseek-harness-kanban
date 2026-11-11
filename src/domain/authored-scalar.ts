/**
 * Authored YAML rendering shared by every text-range edit. Rendering one value as
 * the author would have written it keeps a change local to the span it describes.
 */

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 ._/@-]*$/;
const RESERVED_SCALAR = /^(true|false|null|yes|no|on|off|~)$/i;

/** Render one authored scalar, quoting only when the value needs it. */
export function scalar(value: string): string {
  if (PLAIN_SCALAR.test(value) && !RESERVED_SCALAR.test(value) && !/^-?\d/.test(value)) return value;
  if (/["\\\u0000-\u001f]/.test(value)) return JSON.stringify(value);
  return "'" + value.replace(/'/g, "''") + "'";
}

/** Render one authored text field, using a block scalar when the value spans lines. */
export function textField(key: string, value: string, indent: string, flow: boolean): string {
  // A flow mapping cannot hold a block scalar, so a multiline value is quoted there.
  if (flow) return key + ': ' + scalar(value);
  if (!value.includes('\n')) return key + ': ' + scalar(value);
  const lines = value.split('\n');
  const trailingNewline = value.endsWith('\n');
  const body = trailingNewline ? lines.slice(0, -1) : lines;
  const blockSafe = body.every(line => !line.startsWith(' ') && !line.endsWith(' ') && !line.includes(String.fromCharCode(9)) && !/[\u0000-\u0008\u000b-\u001f]/.test(line));
  if (!blockSafe) return key + ': ' + JSON.stringify(value);
  return key + ': ' + (trailingNewline ? '|' : '|-') + '\n' + body.map(line => indent + '  ' + line).join('\n');
}
