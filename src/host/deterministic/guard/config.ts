/** How the guard hosts one execution. */
export type GuardMode = 'bash' | 'watch';

/** What the host tells the guard through its private configuration file. */
export interface GuardConfig {
  /** The host's loopback lifetime endpoint. */
  port: number;
  /** The HMAC authorization that authenticates the lifetime channel. */
  authorization: string;
  mode: GuardMode;
  /** The ownership token every process of this run inherits. */
  marker: string;
  /** The private file that holds the reviewed program, in bash mode. */
  scriptPath?: string;
  /** The worker whose process group the guard supervises, in watch mode. */
  parent?: number;
}

const AUTHORIZATION = /^[a-f0-9]{64}$/;
const MARKER = /^[a-f0-9]{32}$/;

function invalid(reason: string): Error {
  return new Error('NATIVE_GUARD_CONFIG_INVALID: ' + reason);
}

/** Read and validate the configuration the host wrote; a malformed one is a hard failure. */
export function parseGuardConfig(value: unknown, parent?: number): GuardConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid('the configuration must be an object.');
  const config = value as Record<string, unknown>;
  if (!Number.isInteger(config.port) || (config.port as number) < 1 || (config.port as number) > 65535) throw invalid('the lifetime endpoint port is invalid.');
  if (typeof config.authorization !== 'string' || !AUTHORIZATION.test(config.authorization)) throw invalid('the lifetime authorization is invalid.');
  if (typeof config.marker !== 'string' || !MARKER.test(config.marker)) throw invalid('the ownership marker is invalid.');
  if (config.mode !== 'bash' && config.mode !== 'watch') throw invalid('the execution mode is invalid.');
  const mode: GuardMode = config.mode;
  if (mode === 'bash') {
    if (typeof config.scriptPath !== 'string' || config.scriptPath.length === 0) throw invalid('a bash guard requires its program file.');
    return { port: config.port as number, authorization: config.authorization, mode, marker: config.marker, scriptPath: config.scriptPath };
  }
  if (parent === undefined || !Number.isSafeInteger(parent) || parent < 1) throw invalid('a watch guard requires its worker pid.');
  return { port: config.port as number, authorization: config.authorization, mode, marker: config.marker, parent };
}
