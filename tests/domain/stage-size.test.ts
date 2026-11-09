import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { canonicalWorkflow, workflowMeaning } from '../../src/domain/schema-parts.js';
import { STAGE_MIN_SIZE, STAGE_SIZE_LIMIT, clampStageSize, effectiveStageSize, isAcceptedStageSize, sameStageSize } from '../../src/domain/stage-size.js';

describe('stage size policy', () => {
  it('renders an unstored stage at the accepted minimum', () => {
    expect(effectiveStageSize(undefined)).toEqual(STAGE_MIN_SIZE);
  });

  it('keeps a stored size above the minimum', () => {
    expect(effectiveStageSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });

  it('raises a stored size below the minimum instead of rendering it', () => {
    expect(effectiveStageSize({ width: 100, height: 20 })).toEqual(STAGE_MIN_SIZE);
  });

  it('clamps a dragged size into the accepted bounds', () => {
    expect(clampStageSize({ width: 40, height: 5000 })).toEqual({ width: STAGE_MIN_SIZE.width, height: 5000 });
    expect(clampStageSize({ width: 999_999, height: Number.NaN })).toEqual({ width: STAGE_SIZE_LIMIT, height: STAGE_MIN_SIZE.height });
  });

  it('rounds a dragged size to whole pixels', () => {
    expect(clampStageSize({ width: 300.4, height: 210.6 })).toEqual({ width: 300, height: 211 });
  });

  it('accepts only sizes inside the bounds', () => {
    expect(isAcceptedStageSize(STAGE_MIN_SIZE)).toBe(true);
    expect(isAcceptedStageSize({ width: STAGE_MIN_SIZE.width - 1, height: STAGE_MIN_SIZE.height })).toBe(false);
    expect(isAcceptedStageSize({ width: STAGE_SIZE_LIMIT + 1, height: STAGE_MIN_SIZE.height })).toBe(false);
    expect(isAcceptedStageSize({ width: Number.NaN, height: STAGE_MIN_SIZE.height })).toBe(false);
  });

  it('compares sizes by both dimensions', () => {
    expect(sameStageSize(undefined, undefined)).toBe(true);
    expect(sameStageSize({ width: 1, height: 2 }, undefined)).toBe(false);
    expect(sameStageSize({ width: 1, height: 2 }, { width: 1, height: 2 })).toBe(true);
    expect(sameStageSize({ width: 1, height: 2 }, { width: 1, height: 3 })).toBe(false);
  });
});

describe('stage size in the workflow identity', () => {
  const yaml = (size: string | undefined) => ['columns:', '  - id: one', '    label: One', ...(size === undefined ? [] : ['    size: ' + size]), ''].join(String.fromCharCode(10));

  it('keeps the stored identity of a stage size', () => {
    expect(canonicalWorkflow(parseWorkflow(yaml('{width: 400, height: 300}')))).toContain('"size":{"width":400,"height":300}');
    expect(canonicalWorkflow(parseWorkflow(yaml('{width: 400, height: 300}')))).not.toBe(canonicalWorkflow(parseWorkflow(yaml(undefined))));
  });

  it('excludes a stage size from the workflow meaning', () => {
    expect(workflowMeaning(parseWorkflow(yaml('{width: 400, height: 300}')))).toBe(workflowMeaning(parseWorkflow(yaml(undefined))));
  });

  it('keeps a meaning difference once the labels differ', () => {
    expect(workflowMeaning(parseWorkflow(yaml('{width: 400, height: 300}')))).not.toBe(workflowMeaning(parseWorkflow(['columns:', '  - id: one', '    label: Other', ''].join(String.fromCharCode(10)))));
  });
});
