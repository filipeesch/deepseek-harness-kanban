import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientApi, ModelCatalog, Problem } from '../../shared/types.js';
import { asProblem } from '../problem.js';

/** The host catalog one surface reads, with its failure and its retry. */
export interface ModelCatalogState {
  readonly catalog: ModelCatalog | null;
  readonly error: Problem | null;
  readonly loading: boolean;
  /** Re-read the catalog; the request token keeps a slower earlier answer from winning. */
  readonly reload: () => void;
}

/**
 * Read the host model catalog for a configuration surface. One request token is
 * shared by mount and retry, so two reads of the same moment cannot overwrite each
 * other with the older answer.
 */
export function useModelCatalog(api: ClientApi | undefined): ModelCatalogState {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(api !== undefined);
  const request = useRef(0);
  const load = useCallback((): void => {
    if (api === undefined) return;
    const token = ++request.current;
    setLoading(true);
    void api.modelCatalog(true).then(
      value => { if (request.current !== token) return; setCatalog(value); setError(null); setLoading(false); },
      failure => { if (request.current !== token) return; setCatalog(null); setError(asProblem(failure)); setLoading(false); },
    );
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { catalog, error, loading, reload: load };
}
