/**
 * A textual diff between two authored documents.
 *
 * A workflow write reports a semantic difference by field name; reviewing an exact
 * candidate also needs the bytes themselves. This is a plain line diff in unified
 * format: deterministic, independent of the YAML model, and bounded so a large
 * document cannot stall a tool call.
 */

/** How many unchanged lines surround one hunk. */
const CONTEXT = 3;

/**
 * The largest line-pair product the exact pass resolves. Beyond it the middle block
 * is reported as one removal followed by one insertion, which stays truthful about
 * the documents while keeping the comparison bounded.
 */
const EXACT_CELL_LIMIT = 1_000_000;

interface DiffRow { readonly kind: 'equal' | 'remove' | 'add'; readonly line: string }

interface HunkRow extends DiffRow { readonly oldLine: number; readonly newLine: number }

function coarseDiff(before: readonly string[], after: readonly string[]): DiffRow[] {
  return [
    ...before.map(line => ({ kind: 'remove' as const, line })),
    ...after.map(line => ({ kind: 'add' as const, line })),
  ];
}

/** The longest-common-subsequence line diff of a bounded middle block. */
function exactDiff(before: readonly string[], after: readonly string[]): DiffRow[] {
  const n = before.length;
  const m = after.length;
  if (n === 0) return after.map(line => ({ kind: 'add' as const, line }));
  if (m === 0) return before.map(line => ({ kind: 'remove' as const, line }));
  if (n * m > EXACT_CELL_LIMIT) return coarseDiff(before, after);
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { rows.push({ kind: 'equal', line: before[i]! }); i += 1; j += 1; continue; }
    if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) { rows.push({ kind: 'remove', line: before[i]! }); i += 1; continue; }
    rows.push({ kind: 'add', line: after[j]! }); j += 1;
  }
  for (; i < n; i += 1) rows.push({ kind: 'remove', line: before[i]! });
  for (; j < m; j += 1) rows.push({ kind: 'add', line: after[j]! });
  return rows;
}

/** The full line diff, with the unchanged prefix and suffix reported as equal runs. */
function diffRows(before: readonly string[], after: readonly string[]): DiffRow[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const leading: DiffRow[] = before.slice(0, prefix).map(line => ({ kind: 'equal' as const, line }));
  const trailing: DiffRow[] = before.slice(before.length - suffix).map(line => ({ kind: 'equal' as const, line }));
  const middleBefore = before.slice(prefix, before.length - suffix);
  const middleAfter = after.slice(prefix, after.length - suffix);
  return [...leading, ...exactDiff(middleBefore, middleAfter), ...trailing];
}

/** The hunk header range for one block of rows, counted the way unified diff counts it. */
function rangeOf(rows: readonly HunkRow[]): string {
  const oldCount = rows.filter(row => row.kind !== 'add').length;
  const newCount = rows.filter(row => row.kind !== 'remove').length;
  const firstOld = rows.find(row => row.kind !== 'add');
  const firstNew = rows.find(row => row.kind !== 'remove');
  const oldStart = oldCount === 0 ? (rows[0]!.oldLine - 1) : firstOld!.oldLine;
  const newStart = newCount === 0 ? (rows[0]!.newLine - 1) : firstNew!.newLine;
  return '-' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount;
}

function hunked(rows: readonly HunkRow[]): string[] {
  const changed: number[] = [];
  rows.forEach((row, index) => { if (row.kind !== 'equal') changed.push(index); });
  if (changed.length === 0) return [];
  const blocks: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(rows.length, index + CONTEXT + 1);
    const last = blocks.at(-1);
    if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
    else blocks.push({ start, end });
  }
  const lines: string[] = [];
  for (const block of blocks) {
    const slice = rows.slice(block.start, block.end);
    lines.push('@@ ' + rangeOf(slice) + ' @@');
    for (const row of slice) lines.push((row.kind === 'equal' ? ' ' : row.kind === 'remove' ? '-' : '+') + row.line);
  }
  return lines;
}

/** Labels the two sides of a diff; the defaults match a base document and its candidate. */
export interface TextDiffLabels {
  readonly before?: string;
  readonly after?: string;
}

/**
 * The unified textual diff from one document to another, or an empty string when
 * they are the same bytes. A document diff that finds no textual change is empty
 * even when the parser sees a semantic difference, and the reverse, which is why
 * the semantic report and this text are both returned.
 */
export function unifiedLineDiff(before: string, after: string, labels: TextDiffLabels = {}): string {
  if (before === after) return '';
  const rows = diffRows(before.split('\n'), after.split('\n'));
  let oldLine = 1;
  let newLine = 1;
  const numbered: HunkRow[] = rows.map(row => {
    const entry: HunkRow = { ...row, oldLine, newLine };
    if (row.kind !== 'add') oldLine += 1;
    if (row.kind !== 'remove') newLine += 1;
    return entry;
  });
  const body = hunked(numbered);
  if (body.length === 0) return '';
  return ['--- ' + (labels.before ?? 'base'), '+++ ' + (labels.after ?? 'candidate'), ...body].join('\n') + '\n';
}
