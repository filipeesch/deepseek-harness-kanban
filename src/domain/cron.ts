import { invariant } from '../shared/errors.js';

/**
 * A five-field cron expression evaluated in an explicit IANA time zone.
 *
 * The module is pure and shared by the host scheduler and the configuration
 * editor, so the occurrence preview and the actual schedule always agree. It
 * supports wildcards, lists, inclusive ranges, step values, three-letter month
 * and weekday names, and the symbolic expressions `@hourly`, `@daily`,
 * `@midnight`, and `@weekly`.
 */

const DAY = 86_400_000;
/** Long enough to cross an eight-year gap between leap days. */
const MAX_SEARCH_DAYS = 366 * 16;

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const WEEKDAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type FieldToken =
  | { readonly kind: 'all' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'range'; readonly from: number; readonly to: number; readonly step?: number }
  | { readonly kind: 'step'; readonly from: number; readonly to: number; readonly step: number };

interface ParsedField {
  readonly values: readonly number[];
  /** The authored field covers every value, whether by wildcard or by an explicit full range. */
  readonly all: boolean;
  /** The field was authored as a bare wildcard; that alone makes the day fields unrestricted. */
  readonly wildcard: boolean;
  readonly tokens: readonly FieldToken[];
}

/** One parsed expression. Values are sorted, unique, and in each field's range. */
export interface CronSpec {
  readonly expression: string;
  readonly minutes: ParsedField;
  readonly hours: ParsedField;
  readonly days: ParsedField;
  readonly months: ParsedField;
  readonly weekdays: ParsedField;
}

interface LocalParts { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number; readonly second: number }
interface LocalTime { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (value === undefined) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, value);
  }
  return value;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

function zoneOffset(instant: number, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.trunc(instant / 1000) * 1000;
}

/**
 * Map one local wall-clock time to the UTC instant it denotes.
 * A gap time has no instant. An overlap time maps to its earlier instant.
 */
function localInstant(time: LocalTime, timeZone: string): number | undefined {
  const asUtc = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute);
  const offsets = new Set([zoneOffset(asUtc - DAY, timeZone), zoneOffset(asUtc, timeZone), zoneOffset(asUtc + DAY, timeZone)]);
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    const observed = localParts(candidate, timeZone);
    if (observed.year === time.year && observed.month === time.month && observed.day === time.day
      && observed.hour === time.hour && observed.minute === time.minute) matches.push(candidate);
  }
  return matches.length === 0 ? undefined : Math.min(...matches);
}

function parseValue(raw: string, min: number, max: number, names: Record<string, number> | undefined, label: string): number {
  const name = raw.trim().toUpperCase();
  const named = names?.[name];
  const value = named ?? (/^\d+$/.test(name) ? Number(name) : NaN);
  invariant(Number.isInteger(value) && value >= min && value <= max, 'INVALID_CRON', 'Expected ' + label + ' between ' + min + ' and ' + max + ': ' + raw + '.');
  return value;
}

function parseStep(raw: string, source: string): number {
  const step = /^\d+$/.test(raw) ? Number(raw) : NaN;
  invariant(Number.isInteger(step) && step > 0, 'INVALID_CRON', 'A step must be a positive integer: ' + source + '.');
  return step;
}

function addRange(values: Set<number>, from: number, to: number, step: number): void {
  for (let value = from; value <= to; value += step) values.add(value);
}

function parseField(raw: string, min: number, max: number, names: Record<string, number> | undefined, label: string): ParsedField {
  const tokens: FieldToken[] = [];
  const values = new Set<number>();
  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    invariant(trimmed.length > 0, 'INVALID_CRON', 'A ' + label + ' entry is empty.');
    const [base, stepText, extra] = trimmed.split('/');
    invariant(extra === undefined, 'INVALID_CRON', 'Unsupported step syntax: ' + trimmed + '.');
    const step = stepText === undefined ? undefined : parseStep(stepText, trimmed);
    if (base === '*') {
      if (step === undefined) tokens.push({ kind: 'all' }); else tokens.push({ kind: 'step', from: min, to: max, step });
      addRange(values, min, max, step ?? 1);
      continue;
    }
    if (base!.includes('-')) {
      const [fromText, toText, rangeExtra] = base!.split('-');
      invariant(rangeExtra === undefined && fromText !== undefined && toText !== undefined, 'INVALID_CRON', 'Invalid range: ' + trimmed + '.');
      const from = parseValue(fromText!, min, max, names, label);
      const to = parseValue(toText!, min, max, names, label);
      invariant(from <= to, 'INVALID_CRON', 'A ' + label + ' range must ascend: ' + trimmed + '.');
      tokens.push({ kind: 'range', from, to, ...(step === undefined ? {} : { step }) });
      addRange(values, from, to, step ?? 1);
      continue;
    }
    const value = parseValue(base!, min, max, names, label);
    if (step === undefined) {
      tokens.push({ kind: 'value', value });
      values.add(value);
    } else {
      tokens.push({ kind: 'step', from: value, to: max, step });
      addRange(values, value, max, step);
    }
  }
  const sorted = [...values].sort((left, right) => left - right);
  return { values: sorted, all: sorted.length === max - min + 1, wildcard: raw.trim() === '*', tokens };
}

/**
 * Parse one expression.
 * @param expression - five fields or one supported symbolic expression.
 * @returns the parsed fields with their accepted values and authored tokens.
 */
export function parseCron(expression: string): CronSpec {
  invariant(typeof expression === 'string' && expression.trim().length > 0, 'INVALID_CRON', 'A cron expression is required.');
  const source = expression.trim();
  const macro = MACROS[source.toLowerCase()];
  const normalized = (macro ?? source).trim().replace(/\s+/g, ' ');
  const fields = normalized.split(' ');
  invariant(fields.length === 5, 'INVALID_CRON', 'A cron expression needs exactly five fields: ' + source + '.');
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields as [string, string, string, string, string];
  const weekdays = parseField(weekdayField, 0, 7, WEEKDAY_NAMES, 'weekday');
  const weekdayValues = new Set(weekdays.values.map(value => value === 7 ? 0 : value));
  return {
    expression: normalized,
    minutes: parseField(minuteField, 0, 59, undefined, 'minute'),
    hours: parseField(hourField, 0, 23, undefined, 'hour'),
    days: parseField(dayField, 1, 31, undefined, 'day of month'),
    months: parseField(monthField, 1, 12, MONTH_NAMES, 'month'),
    weekdays: { values: [...weekdayValues].sort((left, right) => left - right), all: weekdayValues.size === 7, wildcard: weekdays.wildcard, tokens: weekdays.tokens },
  };
}

/**
 * Whether the value is an explicit UTC or IANA Area/Location zone.
 * Numeric offsets are accepted by modern Intl but are not portable and are refused.
 */
export function isTimeZone(value: string): boolean {
  if (typeof value !== 'string') return false;
  const zone = value.trim();
  if (zone !== 'UTC' && !zone.includes('/')) return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Store one expression in its canonical form: a macro expanded, spacing collapsed. */
export function normalizeCron(expression: string): string {
  const source = expression.trim();
  const macro = MACROS[source.toLowerCase()];
  return macro ?? parseCron(source).expression;
}

function pad(value: number): string { return String(value).padStart(2, '0'); }

function single(field: ParsedField): number | undefined {
  return field.tokens.length === 1 && field.tokens[0]?.kind === 'value' ? field.tokens[0].value : undefined;
}

function stepToken(field: ParsedField): { from: number; to: number; step: number } | undefined {
  const token = field.tokens.length === 1 ? field.tokens[0] : undefined;
  return token?.kind === 'step' ? token : undefined;
}

function rangeText(values: readonly number[], labels: readonly string[], offset: number): string {
  if (values.length === 1) return labels[values[0]! - offset] ?? String(values[0]);
  const contiguous = values.every((value, index) => index === 0 || value === values[index - 1]! + 1);
  if (contiguous && values.length > 2) {
    return (labels[values[0]! - offset] ?? String(values[0])) + ' through ' + (labels[values[values.length - 1]! - offset] ?? String(values[values.length - 1]));
  }
  return values.map(value => labels[value - offset] ?? String(value)).join(', ');
}

/** A plain-language English description of the expression. */
export function describeCron(expression: string): string {
  const spec = parseCron(expression);
  const { minutes, hours, days, months, weekdays } = spec;
  const minute = single(minutes);
  const hour = single(hours);
  const time = minute !== undefined && hour !== undefined ? pad(hour) + ':' + pad(minute) : undefined;
  const simpleDay = days.all && months.all && weekdays.all;
  if (simpleDay && minutes.all && hours.all) return 'Every minute';
  const minuteStep = stepToken(minutes);
  if (simpleDay && hours.all && minuteStep !== undefined && minuteStep.from === 0 && minuteStep.to === 59) {
    return minuteStep.step === 1 ? 'Every minute' : 'Every ' + minuteStep.step + ' minutes';
  }
  const hourStep = stepToken(hours);
  if (simpleDay && minute !== undefined && hourStep !== undefined && hourStep.from === 0 && hourStep.to === 23) {
    return 'Every ' + hourStep.step + (hourStep.step === 1 ? ' hour' : ' hours') + ' at minute ' + pad(minute);
  }
  if (simpleDay && minute === 0 && hours.all) return 'Every hour';
  // Both day fields authored: Vixie semantics match either one, never both at once.
  if (time !== undefined && !days.wildcard && !weekdays.wildcard && months.all) {
    return 'At ' + time + ' on day ' + days.values.join(', ') + ' or ' + rangeText(weekdays.values, WEEKDAY_LABELS, 0);
  }
  if (time !== undefined && simpleDay) return 'Every day at ' + time;
  if (time !== undefined && days.all && months.all) return 'Every ' + rangeText(weekdays.values, WEEKDAY_LABELS, 0) + ' at ' + time;
  if (time !== undefined && months.all && weekdays.all) return 'On day ' + days.values.join(', ') + ' of every month at ' + time;
  const minuteText = minutes.all ? 'every minute' : 'minute ' + minutes.values.join(', ');
  const hourText = hours.all ? 'every hour' : 'hour ' + hours.values.join(', ');
  const dayText = days.all ? '' : ' on day ' + days.values.join(', ');
  const monthText = months.all ? '' : ' in ' + rangeText(months.values, MONTH_LABELS, 1);
  const weekdayText = weekdays.all ? '' : ' on ' + rangeText(weekdays.values, WEEKDAY_LABELS, 0);
  return 'At ' + minuteText + ' of ' + hourText + dayText + monthText + weekdayText;
}

function dayMatches(spec: CronSpec, day: number, weekday: number): boolean {
  const dayRestricted = !spec.days.wildcard;
  const weekdayRestricted = !spec.weekdays.wildcard;
  const dayAllowed = spec.days.values.includes(day);
  const weekdayAllowed = spec.weekdays.values.includes(weekday);
  if (dayRestricted && weekdayRestricted) return dayAllowed || weekdayAllowed;
  if (dayRestricted) return dayAllowed;
  if (weekdayRestricted) return weekdayAllowed;
  return true;
}

/**
 * The next occurrences strictly after `from`, ascending, one per wall-clock time.
 * A gap time yields no occurrence; an overlap time yields its earlier instant once.
 */
export function nextOccurrences(expression: string, timeZone: string, from: Date, count = 1): Date[] {
  const spec = parseCron(expression);
  invariant(isTimeZone(timeZone), 'INVALID_TIME_ZONE', 'Expected an IANA time zone: ' + timeZone + '.');
  invariant(Number.isInteger(count) && count > 0 && count <= 100, 'INVALID_CRON', 'A preview needs between 1 and 100 occurrences.');
  const start = from.getTime();
  invariant(Number.isFinite(start), 'INVALID_CRON', 'The reference time is invalid.');
  const occurrences: Date[] = [];
  const first = localParts(start, timeZone);
  let cursor = Date.UTC(first.year, first.month - 1, first.day);
  for (let scanned = 0; scanned < MAX_SEARCH_DAYS && occurrences.length < count; scanned += 1) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = date.getUTCDay();
    if (spec.months.values.includes(month) && dayMatches(spec, day, weekday)) {
      for (const hour of spec.hours.values) {
        for (const minute of spec.minutes.values) {
          const instant = localInstant({ year, month, day, hour, minute }, timeZone);
          if (instant === undefined || instant <= start) continue;
          occurrences.push(new Date(instant));
          if (occurrences.length >= count) break;
        }
        if (occurrences.length >= count) break;
      }
    }
    cursor += DAY;
  }
  return occurrences;
}

/** Format one instant the way a schedule's zone reads it: `YYYY-MM-DD HH:mm`. */
export function formatOccurrence(date: Date, timeZone: string): string {
  const parts = formatter(timeZone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
  return value('year') + '-' + value('month') + '-' + value('day') + ' ' + value('hour') + ':' + value('minute');
}

/** The next occurrence strictly after `from`, or undefined when the expression never fires. */
export function nextOccurrence(expression: string, timeZone: string, from: Date): Date | undefined {
  return nextOccurrences(expression, timeZone, from, 1)[0];
}

/**
 * Reject an expression that is malformed, uses an unknown zone, or would never
 * fire, so a stored enabled schedule always has a future occurrence.
 */
export function assertSchedulable(expression: string, timeZone: string, from = new Date()): string {
  const normalized = normalizeCron(expression);
  invariant(isTimeZone(timeZone), 'INVALID_TIME_ZONE', 'Expected an IANA time zone: ' + timeZone + '.');
  invariant(nextOccurrence(normalized, timeZone.trim(), from) !== undefined, 'INVALID_CRON', 'The cron expression never fires: ' + expression + '.');
  return normalized;
}
