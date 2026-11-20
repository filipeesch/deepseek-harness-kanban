import { z } from 'zod';

/**
 * The one creation input shared by the wire command, the domain operation, the
 * legacy board store, and the card tool. Adding a creation option here keeps
 * the wire, persistence, and tool surfaces from drifting apart.
 */
export const newTaskSchema = z.strictObject({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  boardId: z.string().min(1).optional(),
  autoMode: z.boolean().optional(),
  /**
   * Absolute host paths to attach. The host resolves every one of them before the
   * task exists, so a creation never records a partial attachment set.
   */
  attachments: z.array(z.string().min(1)).optional(),
});

export type NewTask = z.infer<typeof newTaskSchema>;
