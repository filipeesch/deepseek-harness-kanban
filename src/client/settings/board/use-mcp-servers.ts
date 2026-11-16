import { useCallback, useEffect, useState } from 'react';
import type { ClientApi } from '../../../shared/types.js';

export interface McpServersState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly servers: readonly string[];
  readonly error: string | null;
  reload(): void;
}

/**
 * The MCP servers the host reports, for the board allowlist control. A host that
 * cannot list them is reported rather than treated as "none": the control keeps
 * every stored entry and still accepts a typed one.
 */
export function useMcpServers(api: ClientApi | undefined): McpServersState {
  const canList = api !== undefined && typeof api.mcpServers === 'function';
  const [servers, setServers] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(canList ? 'loading' : 'error');
  const [error, setError] = useState<string | null>(canList ? null : 'This host does not report its MCP servers.');
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(current => current + 1), []);
  useEffect(() => {
    if (!canList || api === undefined || api.mcpServers === undefined) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    void api.mcpServers().then(names => {
      if (cancelled) return;
      setServers(names);
      setStatus('ready');
    }, (failure: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(failure instanceof Error ? failure.message : 'The MCP server list is unavailable.');
    });
    return () => { cancelled = true; };
  }, [api, canList, attempt]);
  return { status, servers, error, reload };
}
