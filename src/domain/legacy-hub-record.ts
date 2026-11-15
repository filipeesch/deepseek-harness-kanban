/**
 * Stored-record compatibility with the release that renamed the deterministic
 * execution fields to scripted ones.
 *
 * The workflow parser already accepts the previous YAML spelling, but a Hub record
 * also persists the normalized workflow, the task's control and handoff, and the
 * task-history kinds. The storage facility validates every record before the
 * repository can open it, so those persisted names have to be readable for an
 * upgrade to keep the board. The conversion is identity preserving, so a current
 * record is opened without work and an already converted record is never converted
 * twice.
 */

/** The task-history kinds the rename replaced, keyed by their stored spelling. */
const LEGACY_HISTORY_KINDS: Readonly<Record<string, string>> = {
  'deterministic-execution': 'scripted-execution',
  'deterministic-handoff': 'scripted-handoff',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rename one stored field, keeping the current name when a record already carries both. */
function renamed(value: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (!(from in value)) return value;
  const { [from]: previous, ...rest } = value;
  if (!(to in rest)) rest[to] = previous;
  return rest;
}

/** Convert every object of one stored collection; the same array comes back when nothing converted. */
function converted(list: unknown, convert: (value: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map(value => {
    if (!isObject(value)) return value;
    const result = convert(value);
    if (result !== value) changed = true;
    return result;
  });
  return changed ? next : list;
}

function convertColumn(column: Record<string, unknown>): Record<string, unknown> {
  return renamed(column, 'deterministic', 'scripted');
}

function convertBoard(board: Record<string, unknown>): Record<string, unknown> {
  const workflow = board.workflow;
  if (!isObject(workflow)) return board;
  const columns = converted(workflow.columns, convertColumn);
  return columns === workflow.columns ? board : { ...board, workflow: { ...workflow, columns } };
}

function convertHistoryEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const kind = typeof entry.kind === 'string' ? LEGACY_HISTORY_KINDS[entry.kind] : undefined;
  return kind === undefined ? entry : { ...entry, kind };
}

function convertTask(task: Record<string, unknown>): Record<string, unknown> {
  const current = renamed(renamed(task, 'deterministic', 'scripted'), 'deterministicHandoff', 'scriptedHandoff');
  const history = converted(current.history, convertHistoryEntry);
  return history === current.history ? current : { ...current, history };
}

/**
 * Convert one stored Hub record from the previous execution field names to the
 * current ones. A record that already uses the current names comes back as the same
 * value, and the converted record is persisted by the next ordinary save.
 */
export function normalizeLegacyHubRecord(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const boards = converted(raw.boards, convertBoard);
  const tasks = converted(raw.tasks, convertTask);
  return boards === raw.boards && tasks === raw.tasks ? raw : { ...raw, boards, tasks };
}
