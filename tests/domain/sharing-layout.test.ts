import { describe, expect, it } from 'vitest';
import {
  boardLogPath, driveBoardFileName,
  readLayoutStamp, serializeLayoutStamp, SHARED_BOARD_KEY_PATTERN, SHARED_LAYOUT_VERSION,
} from '../../src/domain/sharing/layout.js';

const NL = String.fromCharCode(10);

describe('published layout stamp', () => {
  it('states the layout version and nothing else', () => {
    const text = serializeLayoutStamp();
    expect(readLayoutStamp(text)).toEqual({ version: SHARED_LAYOUT_VERSION });
    expect(text.trim()).toBe('version: ' + SHARED_LAYOUT_VERSION);
    expect(text).not.toContain('boards');
  });

  it('reads the version an older layout declares, so the connection can report it', () => {
    expect(readLayoutStamp('version: 3' + NL)).toEqual({ version: 3 });
    expect(readLayoutStamp('version: 1' + NL + 'boards: []' + NL)).toEqual({ version: 1 });
  });

  it('refuses a stamp that states no supported version', () => {
    expect(() => readLayoutStamp('boards: []' + NL)).toThrow(expect.objectContaining({ name: 'SHARING_INVALID_DOCUMENT' }));
    expect(() => readLayoutStamp('version: 0' + NL)).toThrow(expect.objectContaining({ name: 'SHARING_INVALID_DOCUMENT' }));
  });

  it('names one event log per board', () => {
    expect(boardLogPath('delivery')).toBe('kanban-boards/delivery.jsonl');
    expect(driveBoardFileName('delivery')).toBe('kanban-board-delivery.jsonl');
    expect(SHARED_BOARD_KEY_PATTERN.test('delivery-2')).toBe(true);
    expect(SHARED_BOARD_KEY_PATTERN.test('../escape')).toBe(false);
  });

});
