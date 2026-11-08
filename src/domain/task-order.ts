/** The ordering fields of a task inside one workflow stage. */
export interface TaskOrderFields {
  readonly position: number;
  readonly createdAt: string;
}

/** The display and placement order of tasks inside one workflow stage. */
export function compareTaskOrder(left: TaskOrderFields, right: TaskOrderFields): number {
  return left.position - right.position || left.createdAt.localeCompare(right.createdAt);
}
