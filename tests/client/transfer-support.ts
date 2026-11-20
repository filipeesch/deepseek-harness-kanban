import type { WorkflowFilePort } from '../../src/client/settings/boards/transfer-files.js';

/** A fake browser transfer port that records requests and answers a selection. */
export function fakeFilePort(options: { chosen?: { fileName: string; bytes: Uint8Array } | null; failWith?: unknown } = {}): WorkflowFilePort & { downloads: Array<{ fileName: string; bytes: Uint8Array }>; chooseCalls: number } {
  const downloads: Array<{ fileName: string; bytes: Uint8Array }> = [];
  const port = {
    downloads,
    chooseCalls: 0,
    download(input: { fileName: string; bytes: Uint8Array }) { downloads.push(input); },
    async choose() {
      port.chooseCalls++;
      if (options.failWith !== undefined) throw options.failWith;
      return options.chosen ?? null;
    },
  };
  return port;
}
