import { describe, expect, it } from 'vitest';
import {
  MISSING_SESSION_CODE,
  UNREADABLE_SESSION_CODE,
  classifySessionFailure,
  mergeSessionObservations,
  sameSessionObservation,
  sessionObservationAdvice,
  sessionObservationLabel,
} from '../../src/domain/session-observation.js';

describe('session observation classification', () => {
  it('classifies an unreadable log from the host code', () => {
    expect(classifySessionFailure({ code: UNREADABLE_SESSION_CODE, message: 'stored session "s1" failed validation: PTC dispatch repeats subCallId' }))
      .toEqual({ state: 'unreadable', cause: 'stored session "s1" failed validation: PTC dispatch repeats subCallId' });
  });

  it('classifies a missing log from the host code', () => {
    expect(classifySessionFailure({ code: MISSING_SESSION_CODE, message: 'session "s1" has no stored log' }))
      .toEqual({ state: 'missing', cause: 'session "s1" has no stored log' });
  });

  it('leaves an unrelated failure unclassified', () => {
    expect(classifySessionFailure({ code: 'SESSION_STATE_UNAVAILABLE', message: 'Projections are unavailable.' })).toBeNull();
  });

  it('leaves a failure without a code unclassified', () => {
    expect(classifySessionFailure({ message: 'Something failed.' })).toBeNull();
    expect(classifySessionFailure(undefined)).toBeNull();
    expect(classifySessionFailure(null)).toBeNull();
    expect(classifySessionFailure({ code: 42 })).toBeNull();
  });

  it('never classifies by message text alone', () => {
    expect(classifySessionFailure({ message: 'SESSION_QUERY_CORRUPT_SESSION' })).toBeNull();
  });

  it('supplies a cause when the host reports none', () => {
    expect(classifySessionFailure({ code: UNREADABLE_SESSION_CODE })).toEqual({ state: 'unreadable', cause: 'The stored Session log failed validation.' });
    expect(classifySessionFailure({ code: MISSING_SESSION_CODE, message: '   ' })).toEqual({ state: 'missing', cause: 'No stored Session log was found.' });
  });

  it('labels and explains each state differently', () => {
    expect(sessionObservationLabel('unreadable')).not.toBe(sessionObservationLabel('missing'));
    expect(sessionObservationAdvice('unreadable')).not.toBe(sessionObservationAdvice('missing'));
  });

  it('compares observations by state and cause', () => {
    expect(sameSessionObservation({ state: 'missing', cause: 'a' }, { state: 'missing', cause: 'a' })).toBe(true);
    expect(sameSessionObservation({ state: 'missing', cause: 'a' }, { state: 'unreadable', cause: 'a' })).toBe(false);
    expect(sameSessionObservation(undefined, undefined)).toBe(true);
    expect(sameSessionObservation({ state: 'missing', cause: 'a' }, undefined)).toBe(false);
  });

  it('aggregates a task to its dominant state', () => {
    expect(mergeSessionObservations([])).toBeUndefined();
    expect(mergeSessionObservations([{ state: 'missing', cause: 'a' }])).toEqual({ state: 'missing', cause: 'a' });
    expect(mergeSessionObservations([{ state: 'missing', cause: 'a' }, { state: 'unreadable', cause: 'b' }])).toEqual({ state: 'unreadable', cause: 'b' });
    expect(mergeSessionObservations([{ state: 'unreadable', cause: 'b' }, { state: 'missing', cause: 'a' }])).toEqual({ state: 'unreadable', cause: 'b' });
  });
});
