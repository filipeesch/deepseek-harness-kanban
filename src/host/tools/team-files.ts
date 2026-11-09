import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { KanbanError } from '../../shared/errors.js';
import type { KanbanApp } from '../app.js';
import type { TeamFiles } from '../team-files/service.js';
import { normal, text } from './support.js';
import { resolveHub, type ToolArgs } from './scope.js';

function teamFiles(app: KanbanApp): TeamFiles {
  if (app.teamFiles === undefined) throw new KanbanError('TEAM_FILES_UNAVAILABLE', 'Team files are unavailable in this host.');
  return app.teamFiles;
}

const integer = (description: string) => ({ type: 'integer' as const, description });
const pathArgument = text('Path relative to the Hub team files directory, using "/" separators.', true);

/**
 * The team file surface. Reads are concurrency-safe; the three writes are the
 * only tools here that change shared content, and each states in its own
 * description that the user must have asked for the change.
 */
export function teamFileTools(app: KanbanApp): ToolDefinition[] {
  return [
    normal('search_team_files', 'Search the Hub team files: match a path pattern, find text inside the files, or both. Read-only.', {
      hub_id: text('Hub ID. Optional in a task conversation.'),
      path: text('Glob for the path relative to the team files directory, such as "docs/**/*.md". Omit to match every path.'),
      content: text('Text to find inside the matching files. Omit to list paths only.'),
      limit: integer('Maximum number of matching paths, at most 100.'),
    }, async (args, exec) => {
      const { hubId } = resolveHub(app, args as ToolArgs, exec);
      return teamFiles(app).search(hubId, {
        ...(args.path === undefined ? {} : { path: args.path }),
        ...(args.content === undefined ? {} : { content: args.content }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
    }, true),
    normal('read_team_file', 'Read one text file from the Hub team files, with line numbers and an optional offset and limit. Read-only.', {
      hub_id: text('Hub ID. Optional in a task conversation.'),
      path: pathArgument,
      offset: integer('First line to return, counting from 1.'),
      limit: integer('Maximum number of lines to return, at most 2000.'),
    }, async (args, exec) => {
      const { hubId } = resolveHub(app, args as ToolArgs, exec);
      return teamFiles(app).read(hubId, {
        path: args.path,
        ...(args.offset === undefined ? {} : { offset: args.offset }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
    }, true),
    normal('create_team_file', 'Create a text file in the Hub team files only when the user explicitly requests that file. Fails when the path already exists; use this instead of a task note for shared documents.', {
      hub_id: text('Hub ID. Optional in a task conversation.'),
      path: pathArgument,
      content: text('Complete UTF-8 text of the new file.', true),
    }, async (args, exec) => {
      const { hubId } = resolveHub(app, args as ToolArgs, exec);
      return teamFiles(app).create(hubId, { path: args.path, content: args.content });
    }),
    normal('edit_team_file', 'Edit a text file in the Hub team files only when the user explicitly requests the change. Each existing text must occur exactly once and every replacement is applied together, or nothing is written.', {
      hub_id: text('Hub ID. Optional in a task conversation.'),
      path: pathArgument,
      edits: {
        type: 'array' as const,
        required: true as const,
        description: 'Replacements applied together; each existing text must occur exactly once.',
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            old: text('Existing text to replace; must occur exactly once in the file.', true),
            new: text('Replacement text; an empty string deletes the existing text.', true),
          },
        },
      },
    }, async (args, exec) => {
      const { hubId } = resolveHub(app, args as ToolArgs, exec);
      return teamFiles(app).edit(hubId, { path: args.path, edits: args.edits });
    }),
    normal('delete_team_file', 'Delete a text file from the Hub team files only when the user explicitly requests the deletion. The file moves into the trash rather than disappearing, and the call requires confirmed: true.', {
      hub_id: text('Hub ID. Optional in a task conversation.'),
      path: pathArgument,
      confirmed: { type: 'boolean' as const, description: 'Confirmation of the deletion; the call is refused without it.', required: true as const },
    }, async (args, exec) => {
      const { hubId } = resolveHub(app, args as ToolArgs, exec);
      return teamFiles(app).remove(hubId, { path: args.path, confirmed: args.confirmed });
    }),
  ];
}
