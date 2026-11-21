import { useCallback, useRef, useState } from 'react';

/**
 * Store every file of one selection; reject to report a failed selection.
 *
 * @param files - the picked files, in source order.
 * @param selection - the rank the selection was started with, which a retry keeps so an
 *   accepted batch can still be placed where the person picked it.
 */
export type AttachmentAccept = (files: readonly File[], selection: number) => Promise<void>;

/** The live counts a surface presents while picks are being stored. */
export interface AttachmentPickState {
  /** How many picked files are being stored right now. */
  readonly pending: number;
  /** How many selections failed and still block the surface's action. */
  readonly failed: number;
  /** The first outstanding failure, for the surface to format. */
  readonly failure: unknown;
}

/** One surface's ordered, failure-aware attachment picks. */
export interface AttachmentPicks extends AttachmentPickState {
  /** Queue one selection; a retry reuses the selection it retries. */
  pick(files: readonly File[], accept: AttachmentAccept): void;
  /** Retry every failed selection with the files it already carried. */
  retryFailed(): void;
  /** Drop every failed selection so the surface's action can proceed without it. */
  discardFailed(): void;
  /**
   * Whether a selection is still reading or still needs a decision. Read live state
   * rather than the last render, so a handler created before the latest pick sees it.
   */
  outstanding(): boolean;
  /** Wait for every queued selection; never rejects. */
  waitForReads(): Promise<void>;
  /**
   * Wait for every queued selection, then report whether none still needs a decision.
   * The failure itself belongs to the surface's notice, so this never throws it twice.
   */
  settle(): Promise<boolean>;
}

interface Failure {
  /** One identity per pick, so a retry clears exactly the selection it retries. */
  readonly selection: number;
  readonly failure: unknown;
  readonly retry: () => void;
}

const EMPTY: AttachmentPickState = { pending: 0, failed: 0, failure: undefined };

/**
 * Own the read order and the failure gate of one attachment surface.
 *
 * Selections are stored one batch after another, so the order the person picked
 * survives asynchronous completion. A failed selection keeps its own identity and
 * blocks the surface's action until it is retried or discarded; a later successful
 * pick never releases an earlier failure. Storing the files, and cleaning up a batch
 * that failed partway, belong to the `accept` function the caller supplies.
 */
export function useAttachmentPicks(): AttachmentPicks {
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Reads in flight, counted per file so a multi-file pick is atomic. */
  const pendingFiles = useRef(0);
  const failures = useRef<Failure[]>([]);
  const selectionIds = useRef(0);
  const [state, setState] = useState<AttachmentPickState>(EMPTY);

  const publish = useCallback(() => {
    setState({ pending: pendingFiles.current, failed: failures.current.length, failure: failures.current[0]?.failure });
  }, []);

  const enqueue = useCallback((selection: number, files: readonly File[], accept: AttachmentAccept) => {
    pendingFiles.current += files.length;
    publish();
    const run = async (): Promise<void> => {
      try {
        await accept(files, selection);
        // This selection succeeded, so only its own failure clears. Other selections keep
        // theirs, because only the person retrying them may release the gate.
        failures.current = failures.current.filter(entry => entry.selection !== selection);
      } catch (failure) {
        // The batch reports one identity, so a retry replays exactly these files, and a
        // second click in the same breath cannot save one selection twice.
        failures.current = [...failures.current.filter(entry => entry.selection !== selection), {
          selection,
          failure,
          retry: () => {
            failures.current = failures.current.filter(entry => entry.selection !== selection);
            enqueue(selection, files, accept);
          },
        }];
      } finally {
        pendingFiles.current -= files.length;
        publish();
      }
    };
    // Batches run one after another, so a later fast pick cannot overtake an earlier one.
    queue.current = queue.current.then(run, run);
  }, [publish]);

  const pick = useCallback((files: readonly File[], accept: AttachmentAccept) => {
    if (files.length === 0) return;
    enqueue(++selectionIds.current, files, accept);
  }, [enqueue]);

  const retryFailed = useCallback(() => {
    for (const entry of [...failures.current]) entry.retry();
  }, []);

  const discardFailed = useCallback(() => {
    failures.current = [];
    publish();
  }, [publish]);

  const waitForReads = useCallback(async () => {
    let tail = queue.current;
    // A selection queued while the wait runs is part of the same settlement.
    while (true) {
      await tail;
      if (tail === queue.current) break;
      tail = queue.current;
    }
  }, []);

  const outstanding = useCallback(() => pendingFiles.current > 0 || failures.current.length > 0, []);

  const settle = useCallback(async () => {
    await waitForReads();
    return failures.current.length === 0;
  }, [waitForReads]);

  return { ...state, pick, retryFailed, discardFailed, outstanding, waitForReads, settle };
}
