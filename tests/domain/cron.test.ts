import { describe, expect, it } from 'vitest';
import { assertSchedulable, describeCron, isTimeZone, nextOccurrence, nextOccurrences, normalizeCron, parseCron } from '../../src/domain/cron.js';

const iso = (value: Date | undefined): string | undefined => value?.toISOString();

describe('cron parsing', () => {
  it('accepts wildcards, lists, ranges, steps, and names', () => {
    expect(parseCron('* * * * *').minutes.all).toBe(true);
    expect(parseCron('5,35 * * * *').minutes.values).toEqual([5, 35]);
    expect(parseCron('0 9 * * MON-FRI').weekdays.values).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('0 0 1 JAN,JUL *').months.values).toEqual([1, 7]);
    expect(parseCron('*/15 * * * *').minutes.values).toEqual([0, 15, 30, 45]);
    expect(parseCron('10-40/10 * * * *').minutes.values).toEqual([10, 20, 30, 40]);
    expect(parseCron('0 0 * * 7').weekdays.values).toEqual([0]);
  });

  it('expands the symbolic expressions', () => {
    expect(normalizeCron('@hourly')).toBe('0 * * * *');
    expect(normalizeCron('@daily')).toBe('0 0 * * *');
    expect(normalizeCron('@midnight')).toBe('0 0 * * *');
    expect(normalizeCron('@weekly')).toBe('0 0 * * 0');
  });

  it('rejects malformed expressions', () => {
    expect(() => parseCron('* * * *')).toThrowError(/five fields/);
    expect(() => parseCron('61 * * * *')).toThrowError(/minute/);
    expect(() => parseCron('0 24 * * *')).toThrowError(/hour/);
    expect(() => parseCron('0 0 0 * *')).toThrowError(/day of month/);
    expect(() => parseCron('0 0 * 13 *')).toThrowError(/month/);
    expect(() => parseCron('0 0 * * 8')).toThrowError(/weekday/);
    expect(() => parseCron('*/0 * * * *')).toThrowError(/step/);
    expect(() => parseCron('5/2/1 * * * *')).toThrowError(/step syntax/);
    expect(() => parseCron('10-5 * * * *')).toThrowError(/ascend/);
    expect(() => parseCron('   ')).toThrowError(/required/);
  });

  it('validates time zones', () => {
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Europe/Lisbon')).toBe(true);
    expect(isTimeZone('Etc/GMT-1')).toBe(true);
    expect(isTimeZone('+01:00')).toBe(false);
    expect(isTimeZone('-03:00')).toBe(false);
    expect(isTimeZone('GMT')).toBe(false);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('cron description', () => {
  it('describes the common shapes', () => {
    expect(describeCron('* * * * *')).toBe('Every minute');
    expect(describeCron('*/3 * * * *')).toBe('Every 3 minutes');
    expect(describeCron('0 * * * *')).toBe('Every hour');
    expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
    expect(describeCron('0 9 * * 1-5')).toBe('Every Monday through Friday at 09:00');
    expect(describeCron('30 6 * * 0,3')).toBe('Every Sunday, Wednesday at 06:30');
    expect(describeCron('0 3 1 * *')).toBe('On day 1 of every month at 03:00');
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours at minute 00');
    expect(describeCron('5,35 * * * *')).toBe('At minute 5, 35 of every hour');
    expect(describeCron('0 9 1-31 * MON')).toContain('or Monday');
    expect(describeCron('0 9 1-31 * MON')).toContain('09:00');
  });
});

describe('cron occurrences', () => {
  it('returns the next occurrences in UTC', () => {
    const from = new Date('2026-01-01T10:05:30Z');
    expect(nextOccurrences('*/15 * * * *', 'UTC', from, 3).map(iso)).toEqual([
      '2026-01-01T10:15:00.000Z',
      '2026-01-01T10:30:00.000Z',
      '2026-01-01T10:45:00.000Z',
    ]);
  });

  it('treats an explicit full-range day field as restricted, matching either day field', () => {
    const from = new Date('2026-01-05T01:00:00Z');
    expect(iso(nextOccurrence('0 0 1-31 * MON', 'UTC', from))).toBe('2026-01-06T00:00:00.000Z');
    expect(iso(nextOccurrence('0 0 1,15 * MON', 'UTC', new Date('2026-01-06T01:00:00Z')))).toBe('2026-01-12T00:00:00.000Z');
  });

  it('respects weekdays and the day-of-month or weekday rule', () => {
    const friday = new Date('2026-01-02T10:00:00Z');
    expect(iso(nextOccurrence('0 9 * * MON-FRI', 'UTC', friday))).toBe('2026-01-05T09:00:00.000Z');
    expect(iso(nextOccurrence('0 0 1 * MON', 'UTC', friday))).toBe('2026-01-05T00:00:00.000Z');
    expect(iso(nextOccurrence('0 0 1 * MON', 'UTC', new Date('2026-01-06T00:00:00Z')))).toBe('2026-01-12T00:00:00.000Z');
    expect(iso(nextOccurrence('0 0 1 * MON', 'UTC', new Date('2026-02-02T00:00:00Z')))).toBe('2026-02-09T00:00:00.000Z');
  });

  it('evaluates in the requested zone', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(iso(nextOccurrence('0 9 * * *', 'Europe/Lisbon', from))).toBe('2026-01-01T09:00:00.000Z');
    expect(iso(nextOccurrence('0 9 * * *', 'America/New_York', from))).toBe('2026-01-01T14:00:00.000Z');
  });

  it('skips a gap local time', () => {
    const from = new Date('2026-03-07T08:00:00Z');
    expect(nextOccurrences('30 2 * * *', 'America/New_York', from, 2).map(iso)).toEqual([
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
    ]);
  });

  it('uses the earlier instant of a repeated local time', () => {
    const from = new Date('2026-10-31T12:00:00Z');
    expect(nextOccurrences('30 1 * * *', 'America/New_York', from, 2).map(iso)).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
  });

  it('finds the next leap day', () => {
    expect(iso(nextOccurrence('0 0 29 2 *', 'UTC', new Date('2020-03-01T00:00:00Z')))).toBe('2024-02-29T00:00:00.000Z');
  });

  it('never fires for an impossible date', () => {
    expect(nextOccurrence('0 0 30 2 *', 'UTC', new Date('2026-01-01T00:00:00Z'))).toBeUndefined();
    expect(() => assertSchedulable('0 0 30 2 *', 'UTC')).toThrowError(/never fires/);
    expect(assertSchedulable('@daily', 'UTC')).toBe('0 0 * * *');
    expect(() => assertSchedulable('@daily', 'Mars/Olympus')).toThrowError(/time zone/);
    expect(() => assertSchedulable('@daily', '+01:00')).toThrowError(/time zone/);
  });

  it('rejects an occurrence count outside the supported range', () => {
    expect(() => nextOccurrences('* * * * *', 'UTC', new Date(), 0)).toThrowError(/between 1 and 100/);
  });
});