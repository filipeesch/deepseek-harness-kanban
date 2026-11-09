import { useCallback, useRef, useState } from 'react';

/** How the board makes a newly created container the one the user is looking at. */
export interface UseCreationDialogsPort {
  /** Makes a newly created Hub active and remembers it in this browser. */
  readonly activateHub: (hubId: string) => void;
  /** Selects a newly created board within the active Hub. */
  readonly selectCreatedBoard: (boardId: string) => void;
}

export interface ContainerCreation {
  readonly newHub: boolean;
  readonly newBoard: boolean;
  openHub(): void;
  openBoard(): void;
  closeHub(): void;
  closeBoard(): void;
  onHubCreated(hubId: string): void;
  onBoardCreated(boardId: string): void;
}

/**
 * The open state of the New Hub and New Board dialogs and the handoff that selects
 * what they create. Deliberately separate from task creation: the two concerns
 * share nothing but being dialogs, and merging them would rebuild inside one hook
 * the aggregation the extraction exists to remove. Hub and board selection stay
 * with the board component, which owns them, and reach this hook through its port.
 */
export function useCreationDialogs(port: UseCreationDialogsPort): ContainerCreation {
  const portRef = useRef(port); portRef.current = port;
  const [newHub, setNewHub] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const openHub = useCallback(() => { setNewHub(true); }, []);
  const openBoard = useCallback(() => { setNewBoard(true); }, []);
  const closeHub = useCallback(() => { setNewHub(false); }, []);
  const closeBoard = useCallback(() => { setNewBoard(false); }, []);
  const onHubCreated = useCallback((hubId: string) => { portRef.current.activateHub(hubId); setNewHub(false); }, []);
  const onBoardCreated = useCallback((boardId: string) => { portRef.current.selectCreatedBoard(boardId); setNewBoard(false); }, []);
  return { newHub, newBoard, openHub, openBoard, closeHub, closeBoard, onHubCreated, onBoardCreated };
}
