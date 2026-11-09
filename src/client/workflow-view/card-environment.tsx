import { createContext, useContext, type ReactNode } from 'react';

/**
 * The diagram renders the board's own task card. The environment supplies the
 * card for one task id, so a stage never builds a reduced card of its own.
 */
export interface CardEnvironment {
  renderCard(taskId: string): ReactNode;
}

export const CardEnvironmentContext = createContext<CardEnvironment | null>(null);

export function useCardEnvironment(): CardEnvironment | null {
  return useContext(CardEnvironmentContext);
}
