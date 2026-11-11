import { stringify } from 'yaml';
import { createBoardLog, encodeBoardLog } from '../../src/domain/journal/log.js';

/** One board log file as a storage keeps it. */
export function exportBoardLogFixture(text: string): string {
  return stringify(encodeBoardLog(createBoardLog(text)), { lineWidth: 0 });
}
