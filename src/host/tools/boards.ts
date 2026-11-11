import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration, BoardWriteResult } from '../board-administration.js';
import { normal, text } from './support.js';
import { assertBoardWriteAllowed } from './scope.js';

const intent='Use ONLY when the user explicitly requests this board change. ';

function boardResult(value:BoardWriteResult){
 return {...value.board,hubId:value.hubId,hubRevision:value.hubRevision,sharing:value.sharing};
}

export function boardTools(app:KanbanApp,boards:BoardAdministration):ToolDefinition[]{
 return [
  normal('create_board',intent+'Create a board in a Hub with the default workflow or a supplied complete workflow YAML. Use list_hubs to discover the Hub. A bound Hub publishes the change automatically.',{
   hub_id:text('Hub ID. Optional when exactly one Hub exists.'),
   name:text('Board name.',true),
   workflow_yaml:text('Complete workflow YAML. Omit for the default workflow. A root model mapping with provider, model, and optional reasoning_effort names the board default model every new conversation of this board starts on; omit it to keep the DSH default.'),
  },async(args,exec)=>{
   await assertBoardWriteAllowed(app,exec);
   const value=await boards.create({...(args.hub_id===undefined?{}:{hubId:args.hub_id}),name:args.name,...(args.workflow_yaml===undefined?{}:{workflowYaml:args.workflow_yaml})},'when-bound');
   return boardResult(value);
  }),
  normal('update_board',intent+'Rename a board and/or replace its complete workflow YAML. Read the exact YAML with get_board_summary include_workflow first. Prefer edit_board_yaml for targeted prompt or transition changes. A bound Hub publishes the change automatically.',{
   board_id:text('Board ID.',true),
   hub_id:text('Hub ID. Optional when the board identifier is enough.'),
   name:text('Replacement board name.'),
   workflow_yaml:text('Complete replacement workflow YAML. Keep, add, or drop the root model mapping (provider, model, and optional reasoning_effort) to set or clear the board default model; read the current one with get_board_summary include_workflow defaultModel.'),
   expected_revision:{type:'integer',description:'Hub revision from a prior read; stale values are rejected.'},
  },async(args,exec)=>{
   await assertBoardWriteAllowed(app,exec);
   const value=await boards.update({boardId:args.board_id,...(args.hub_id===undefined?{}:{hubId:args.hub_id}),...(args.name===undefined?{}:{name:args.name}),...(args.workflow_yaml===undefined?{}:{workflowYaml:args.workflow_yaml}),...(args.expected_revision===undefined?{}:{expectedRevision:args.expected_revision})},'when-bound');
   return boardResult(value);
  }),
  normal('edit_board_yaml',intent+'Apply literal old/new text edits to a board workflow YAML. Each old text must occur exactly once at apply time; all edits are applied together and the result is validated before saving. Read the exact YAML with get_board_summary include_workflow first and copy the text, including indentation and comments. A bound Hub publishes the change automatically.',{
   board_id:text('Board ID.',true),
   hub_id:text('Hub ID. Optional when the board identifier is enough.'),
   edits:{type:'array',required:true,description:'Literal replacements applied in order. Each old text must occur exactly once.',items:{type:'object',additionalProperties:false,properties:{old:{type:'string',required:true},new:{type:'string',required:true}}}},
   expected_revision:{type:'integer',description:'Hub revision from a prior read; stale values are rejected.'},
  },async(args,exec)=>{
   await assertBoardWriteAllowed(app,exec);
   const value=await boards.editWorkflow({boardId:args.board_id,edits:args.edits,...(args.hub_id===undefined?{}:{hubId:args.hub_id}),...(args.expected_revision===undefined?{}:{expectedRevision:args.expected_revision})},'when-bound');
   return boardResult(value);
  }),
  normal('delete_board',intent+'Delete an empty board. Pass confirmed:true only after the user explicitly confirmed the deletion. A team-bound board also requires sharing local or team. Projects, worktrees, conversations, and native workspaces are kept.',{
   board_id:text('Board ID.',true),
   hub_id:text('Hub ID. Optional when the board identifier is enough.'),
   confirmed:{type:'boolean',required:true,description:'Explicit confirmation for this deletion.'},
   sharing:{type:'string',enum:['local','team'],description:'Removal scope for a team-bound board.'},
   expected_revision:{type:'integer',description:'Hub revision from a prior read; stale values are rejected.'},
  },async(args,exec)=>{
   await assertBoardWriteAllowed(app,exec);
   const value=await boards.remove({boardId:args.board_id,confirmed:args.confirmed,...(args.hub_id===undefined?{}:{hubId:args.hub_id}),...(args.sharing===undefined?{}:{sharing:args.sharing as 'local'|'team'}),...(args.expected_revision===undefined?{}:{expectedRevision:args.expected_revision})},'when-bound');
   return boardResult(value);
  }),
 ];
}
