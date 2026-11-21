import { expect } from 'vitest';

/** The first line of every orientation block a stage-instruction delivery opens with. */
export const ORIENTATION_OPENING = 'Stage orientation (facts from the active workflow):';

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The authored part of a delivered stage-instruction text: what follows the
 * orientation block. The block never holds a blank line, so the first one ends it.
 */
export function afterOrientation(text: string): string {
  expect(text.startsWith(ORIENTATION_OPENING), 'the delivery opens with the orientation block').toBe(true);
  const end = text.indexOf('\n\n');
  return end < 0 ? '' : text.slice(end + 2);
}

/** Matches a delivered text that opens with the orientation block and then carries exactly these blocks. */
export function oriented(...blocks: string[]): unknown {
  return expect.stringMatching(new RegExp('^' + escape(ORIENTATION_OPENING) + '[^]*?\\n\\n' + escape(blocks.join('\n\n')) + '$'));
}
