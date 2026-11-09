/**
 * Bounds for the team file surface. The read and search bounds match the host's
 * native tools, so a model that already calibrated against those receives the
 * same shape here. Writing is deliberately unbounded, as the host's own write
 * tool is; a team document can legitimately be large.
 */
export const TEAM_FILE_READ_MAX_LINES = 2000;
export const TEAM_FILE_READ_MAX_BYTES = 50 * 1024;
export const TEAM_FILE_READ_MAX_LINE_LENGTH = 2000;
export const TEAM_FILE_SEARCH_MAX_PATHS = 100;
export const TEAM_FILE_SEARCH_MAX_MATCHES = 250;
export const TEAM_FILE_SEARCH_MAX_OUTPUT_BYTES = 50 * 1024;
/** The native search deadline; a content search that reaches it reports truncation. */
export const TEAM_FILE_SEARCH_DEADLINE_MS = 30_000;
/**
 * The largest text file any tool will load. It bounds the memory a single call
 * can use, because a deadline cannot interrupt a decode already in progress.
 */
export const TEAM_FILE_MAX_INPUT_BYTES = 8 * 1024 * 1024;
