import type { SharingProviderId } from './provider.js';

/** One file in the team files directory, addressed by its POSIX relative path. */
export interface TeamFileEntry { path: string; size: number; modifiedAt: string }

/** The bytes of one team file. Text rules are applied above this boundary. */
export interface TeamFileContent { path: string; bytes: Uint8Array; size: number; modifiedAt: string }

/** The outcome of one team file write, including the version it produced. */
export interface TeamFileWrite { path: string; size: number; head?: string }

/** What the write did, so a transport can name it in its own record. */
export interface TeamFileWriteOptions { operation: 'create' | 'edit' | 'delete' }

export interface TeamFileReadOptions {
  /** Refuse an entry larger than this, before loading it. */
  maxBytes?: number;
}

/**
 * The file-shaped transport boundary, a sibling of the document-shaped
 * `SharedConfigStore`. A provider implements only what its storage can honestly
 * serve: listing, reading bytes, writing bytes, and moving one entry. Path
 * safety, text rules, search, and the trash layout live above it.
 */
export interface TeamFileStore {
  /** Create the owned directory when it is absent and verify the location is usable. */
  ensure(): Promise<void>;
  list(): Promise<TeamFileEntry[]>;
  read(relative: string, options?: TeamFileReadOptions): Promise<TeamFileContent | null>;
  /** Create a file that must not exist; a replacement is refused by the transport itself. */
  create(relative: string, content: string): Promise<TeamFileWrite>;
  /** Replace an existing file's content. */
  write(relative: string, content: string, options: TeamFileWriteOptions): Promise<TeamFileWrite>;
  /** Move one entry and return where it actually landed, relative to the directory. */
  move(from: string, to: string, options: TeamFileWriteOptions): Promise<{ path: string }>;
  /** The version the last read observed, when the transport has one. */
  head?(): Promise<string | undefined>;
}

/** A bound Hub's team file surface, resolved by the sharing layer. */
export interface TeamFileStoreResolution {
  store: TeamFileStore;
  provider: SharingProviderId;
  label: string;
  address: string;
}

/**
 * What the team file service needs from the sharing layer: a store per Hub and
 * the lane that keeps a whole read-modify-write atomic against publishing.
 */
export interface TeamFileStoreSource {
  store(hubId: string): TeamFileStoreResolution;
  exclusive<T>(hubId: string, operation: () => Promise<T>): Promise<T>;
}
