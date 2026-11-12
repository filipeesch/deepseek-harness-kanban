import { describe, expect, it } from 'vitest';
import { STAGE_HEADER_HEIGHT, STAGE_CARD_GAP, STAGE_CARD_HEIGHT, estimateStageHeight } from '../../../src/domain/diagram/stage-height.js';
import { STAGE_MIN_SIZE } from '../../../src/domain/stage-size.js';

describe('stage height estimate', () => {
  it('keeps an empty stage at its authored height', () => {
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, 0)).toBe(STAGE_MIN_SIZE.height);
  });

  it('grows a stage by one card', () => {
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, 1)).toBe(154);
  });

  it('grows a stage by many cards', () => {
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, 5)).toBe(558);
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, 5)).toBeGreaterThan(estimateStageHeight(STAGE_MIN_SIZE.height, 1));
  });

  it('keeps the authored size as the floor the cards cannot shrink', () => {
    expect(estimateStageHeight(900, 0)).toBe(900);
    expect(estimateStageHeight(900, 1)).toBe(900);
  });

  it('treats a negative card count as none', () => {
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, -3)).toBe(STAGE_MIN_SIZE.height);
  });

  it('derives its constants from the diagram stylesheet numbers', () => {
    expect(STAGE_HEADER_HEIGHT).toBe(45);
    expect(STAGE_CARD_GAP).toBe(8);
    expect(STAGE_CARD_HEIGHT).toBe(93);
    expect(estimateStageHeight(STAGE_MIN_SIZE.height, 2)).toBe(45 + 8 + 2 * (93 + 8));
  });
});
