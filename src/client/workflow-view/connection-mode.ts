/**
 * How the diagram treats the editing surface of a connection.
 *
 * The layout lock is the product concept; this mode is the projection of that
 * lock onto connection interaction. Every connection consumer reads the mode
 * instead of testing the lock on its own, so the rule that decides what is
 * presented and what may change lives in this one place.
 */
export type ConnectionMode = 'inspect' | 'edit';

/** The mode the layout lock projects onto the connection surface. */
export function connectionMode(locked: boolean): ConnectionMode {
  return locked ? 'inspect' : 'edit';
}

/** The mode of a surface that publishes no handlers, which is a reading surface. */
export const ABSENT_MODE: ConnectionMode = 'inspect';

/** Whether a gesture may change a connection in this mode. */
export function editable(mode: ConnectionMode): boolean {
  return mode === 'edit';
}

/** Whether the marks that move a connection are presented on it. */
export interface MarkState {
  /** The pointer is on the connection's line or on one of its marks. */
  readonly hovered: boolean;
  /** The connection is the selected one. */
  readonly selected: boolean;
}

/**
 * The marks are presented only while the connection can be edited, and only on
 * the connection the pointer or the selection is on. A locked diagram presents
 * no mark, even for the selected connection.
 */
export function marksPresented(mode: ConnectionMode, state: MarkState): boolean {
  return editable(mode) && (state.hovered || state.selected);
}

/** Whether the condition editor is available in this mode. */
export function conditionEditingAllowed(mode: ConnectionMode): boolean {
  return editable(mode);
}

/**
 * Whether focusing a connection end selects the connection. While inspecting,
 * the keyboard is the only way to read a route, so focus selects it; while
 * editing, focus keeps its current meaning and does not change the selection.
 */
export function selectsOnFocus(mode: ConnectionMode): boolean {
  return mode === 'inspect';
}
