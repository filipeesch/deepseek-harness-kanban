import { opendir, realpath as nodeRealpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface DirectoryEntry { name: string; directory: boolean }
export interface DirectoryListing { entries: DirectoryEntry[]; truncated: boolean }

/** The filesystem operations discovery needs; injectable so tests run without a real Drive. */
export interface DiscoveryFs {
  exists(value: string): Promise<boolean>;
  isDirectory(value: string): Promise<boolean>;
  /** Read at most `limit` entries; the flag reports whether more were present. */
  list(value: string, limit?: number): Promise<DirectoryListing>;
  realpath(value: string): Promise<string>;
}

export const nodeDiscoveryFs: DiscoveryFs = {
  async exists(value) {
    try { await stat(value); return true; } catch { return false; }
  },
  async isDirectory(value) {
    try { return (await stat(value)).isDirectory(); } catch { return false; }
  },
  async list(value, limit) {
    const entries: DirectoryEntry[] = [];
    let truncated = false;
    const handle = await opendir(value);
    try {
      for await (const entry of handle) {
        if (limit !== undefined && entries.length >= limit) { truncated = true; break; }
        entries.push({ name: entry.name, directory: entry.isDirectory() });
      }
    } finally { await handle.close().catch(() => undefined); }
    return { entries, truncated };
  },
  async realpath(value) {
    try { return await nodeRealpath(value); } catch { return path.resolve(value); }
  },
};
