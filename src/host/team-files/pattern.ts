import { KanbanError } from '../../shared/errors.js';

const SPECIAL = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
const MAX_PATTERN_LENGTH = 1024;

function escapeLiteral(value: string): string {
  let out = '';
  for (const character of value) out += SPECIAL.has(character) ? '\\' + character : character;
  return out;
}

interface ParsedClass { source: string; end: number }

/** Parse one `[...]` character class, or undefined when the bracket is literal. */
function classSource(segment: string, start: number): ParsedClass | undefined {
  let index = start + 1;
  let negated = false;
  if (segment[index] === '!' || segment[index] === '^') { negated = true; index++; }
  let body = '';
  let first = true;
  for (; index < segment.length; index++) {
    const character = segment[index]!;
    if (character === ']' && !first) break;
    if (character === '\\') { body += '\\\\'; first = false; continue; }
    if (character === '^') { body += '\\^'; first = false; continue; }
    if (character === ']') { body += '\\]'; first = false; continue; }
    body += character;
    first = false;
  }
  // An unclosed bracket, or an empty class, is a literal bracket in the path.
  if (index >= segment.length || body.length === 0) return undefined;
  // A class never matches a path separator, not even a negated one.
  return { source: '(?:(?!/)[' + (negated ? '^' : '') + body + '])', end: index };
}

function segmentSource(segment: string): string {
  let out = '';
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index]!;
    if (character === '*') { out += '[^/]*'; continue; }
    if (character === '?') { out += '[^/]'; continue; }
    if (character === '[') {
      const parsed = classSource(segment, index);
      if (parsed !== undefined) { out += parsed.source; index = parsed.end; continue; }
    }
    out += escapeLiteral(character);
  }
  return out;
}

/** Translate a path glob into an anchored regular-expression source. `**` crosses directories. */
export function teamGlobSource(pattern: string): string {
  const segments = pattern.split('/');
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segmentSource(segment);
    if (!last) source += '/';
  });
  return source;
}

/** Validate a path glob before it is used, naming the value that was refused. */
export function normalizeTeamGlob(value: unknown): string {
  if (typeof value !== 'string') throw new KanbanError('INVALID_INPUT', 'A team file pattern must be a string.');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new KanbanError('INVALID_INPUT', 'A team file pattern is required; omit it to match every path.');
  if (trimmed.length > MAX_PATTERN_LENGTH) throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file pattern is longer than ' + MAX_PATTERN_LENGTH + ' characters.', { pattern: trimmed });
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file pattern contains a control character.', { pattern: trimmed });
  if (trimmed.includes('\\')) throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file pattern must use "/" as the path separator.', { pattern: trimmed });
  if (trimmed.startsWith('/')) throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file pattern must be relative to the team files directory.', { pattern: trimmed });
  return trimmed;
}

/** Whether a relative team file path matches a path glob. */
export function matchesTeamGlob(pattern: string, value: string): boolean {
  let expression: RegExp;
  try { expression = new RegExp('^' + teamGlobSource(pattern) + '$'); }
  catch {
    // A malformed class, such as a reversed range, is the caller's error.
    throw new KanbanError('TEAM_FILE_PATH_INVALID', 'The team file pattern "' + pattern + '" is not valid glob syntax.', { pattern });
  }
  return expression.test(value);
}
