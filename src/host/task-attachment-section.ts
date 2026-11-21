/**
 * The attachment listing's own byte budget. It is separate from the workflow
 * map's budget on purpose: a task's files are context, not a replacement for
 * the stage and transition facts the agent needs to navigate.
 */
export const TASK_ATTACHMENT_BUDGET = 8 * 1024;

/** One attachment the task context reports, with the path an agent reads it by. */
export interface TaskContextAttachment {
  readonly name: string;
  readonly bytes: number;
  readonly path: string;
}

/** One attachment line: the name, its size, and the path an agent can read. */
function attachmentLine(attachment: TaskContextAttachment): string {
  return '- ' + attachment.name + ' (' + attachment.bytes + ' bytes): ' + attachment.path;
}

/**
 * Render the attachment section under its own budget. Files are never dropped
 * silently: when the section cannot hold them all, it states how many are left.
 */
export function buildAttachmentSection(attachments: readonly TaskContextAttachment[], budget = TASK_ATTACHMENT_BUDGET): string {
  if (attachments.length === 0) return '';
  const header = 'Task attachments (read each with your file tools):';
  const omittedLine = (count: number): string => '- ' + count + ' more attachments omitted for length; read the task with get_card.';
  const lines = attachments.map(attachmentLine);
  const render = (kept: number): string => {
    const omitted = attachments.length - kept;
    const body = kept === 0 ? [] : [lines.slice(0, kept).join('\n')];
    const footer = omitted === 0 ? [] : [omittedLine(omitted)];
    return [header, ...body, ...footer].join('\n');
  };
  // Everything fits: no footer and no reservation, so the common case spends nothing
  // on a line it does not need.
  const complete = render(attachments.length);
  if (Buffer.byteLength(complete) <= budget) return complete;
  // Otherwise keep the longest prefix whose rendered section, footer included, fits.
  // A single line that cannot fit is simply not kept: continuing past it lets a later
  // short name still be listed instead of hiding every file after one long path.
  // Otherwise keep every line that fits beside the footer, in order. An oversized line
  // is skipped rather than ending the list, so one long path cannot hide the short
  // names that follow it.
  const footerReserve = Buffer.byteLength(omittedLine(attachments.length)) + 1;
  const keptLines: string[] = [];
  let used = Buffer.byteLength(header) + 1;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + 1;
    if (used + footerReserve + size > budget) continue;
    used += size;
    keptLines.push(line);
  }
  const omitted = attachments.length - keptLines.length;
  const body = keptLines.length === 0 ? [] : [keptLines.join('\n')];
  return [header, ...body, omittedLine(omitted)].join('\n');
}
