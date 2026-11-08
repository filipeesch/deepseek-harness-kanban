import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Command } from '../../shared/types.js';
import type { KanbanApp } from '../app.js';
import { assertNoteTags, normalizeNoteTags, noteTagsOf } from '../../domain/note.js';
import { normal, text } from './support.js';
import { requireTask, type ToolArgs } from './scope.js';

export function noteTools(app:KanbanApp):ToolDefinition[]{
 return [
  normal('create_note','Create a shared task Markdown note only when explicitly requested by the user. Not a checklist or decision record.',{task_id:text('Explicit task ID; optional in a task conversation.'),content:text('Markdown note.',true),tags:{type:'array',items:{type:'string'},description:'Optional note tags.'}},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);return app.saveNote({type:'note.save',hubId:located.hubId,taskId:located.task.id,content:args.content,tags:args.tags});}),
  normal('list_notes','Read shared notes for a task, regardless of which agent tab created them. Pass tags to return the notes that have any of those tags; an empty list applies no filter.',{task_id:text('Explicit task ID; optional in a task conversation.'),tags:{type:'array',items:{type:'string'},description:'Optional tags; returns notes that have any of them. An empty list applies no filter.'}},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);const notes=app.hubs.requireHub(located.hubId).notes.filter(note=>note.taskId===located.task.id);if(args.tags===undefined)return notes;assertNoteTags(args.tags);const tags=normalizeNoteTags(args.tags);if(tags.length===0)return notes;return notes.filter(note=>noteTagsOf(note.tags).some(tag=>tags.includes(tag)));},true),
  normal('update_note','Update a shared task note only when explicitly requested by the user. Provide content and/or tags; omitted tags are preserved and an empty list clears them.',{task_id:text('Explicit task ID; optional in a task conversation.'),id:text('Note ID.',true),content:text('Replacement Markdown content.'),tags:{type:'array',items:{type:'string'},description:'Optional replacement tags; an empty list clears them.'}},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);const command:Command={type:'note.save',hubId:located.hubId,taskId:located.task.id,noteId:args.id,...(args.content!==undefined?{content:args.content}:{}),...(args.tags!==undefined?{tags:args.tags}:{})};await app.command(command);return app.hubs.requireHub(located.hubId).notes.find(note=>note.id===args.id&&note.taskId===located.task.id);}),
 ];
}
