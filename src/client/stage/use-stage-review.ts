import { useCallback, useRef, useState } from 'react';
import type { ClientApi } from '../../shared/types.js';
import type { ScriptedStageReview } from '../../shared/scripted.js';

export interface StageReviewInput {
  readonly api: ClientApi;
  readonly boardId: string;
  /** The identifier the board stores for the edited stage; a saved rename moves it. */
  readonly initialStageId: string;
}

/**
 * The stored executable version of one stage, and the approval of it.
 *
 * The editor asks this unit for two things it must not conflate: what the board
 * stores right now, and what the user did about it. A draft is never part of the
 * answer, so an edited draft is never presented as approved.
 */
export function useStageReview({ api, boardId, initialStageId }: StageReviewInput) {
  const [review, setReview] = useState<ScriptedStageReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [storedStageId, setStoredStageId] = useState(initialStageId);
  const request = useRef(0);
  const load = useCallback(async (stageId = storedStageId): Promise<ScriptedStageReview | null> => {
    if (!api.scriptedReview) { setReviewChecked(true); return null; }
    const requestId = ++request.current;
    setReviewError(null);
    try {
      const value = await api.scriptedReview({ boardId, stageId });
      if (requestId !== request.current) return null;
      setReview(value);
      return value;
    } catch (error) {
      if (requestId !== request.current) return null;
      setReview(null);
      setReviewError(error instanceof Error ? error.message : 'The stored version could not be read.');
      return null;
    } finally {
      if (requestId === request.current) setReviewChecked(true);
    }
  }, [api, boardId, storedStageId]);
  return { review, reviewError, reviewChecked, storedStageId, setStoredStageId, load };
}
