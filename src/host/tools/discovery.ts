import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { HubSharingView } from '../../shared/types.js';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { isProjectAllowed } from '../../domain/board-project-scope.js';
import { isPublishedProject } from '../../shared/project.js';
import { normal, text } from './support.js';
import { boardSummary, resolveBoard, resolveHub, type ToolArgs } from './scope.js';

function sharingSummary(view:HubSharingView|undefined,boardId:string){
 const board=view?.boards.find(entry=>entry.boardId===boardId);
 return {
  status:view?.status??'not-published',
  ...(view===undefined?{}:{syncMode:view.syncMode,updates:view.updates,conflicts:view.conflicts,blockers:view.blockers}),
  bound:board?.bound===true,
  ...(board===undefined?{}:{boardState:board.state}),
 };
}

export function discoveryTools(app:KanbanApp,boards:BoardAdministration):ToolDefinition[]{
 return [
  normal('list_hubs','List the Hubs available in this installation. Use this before discovering boards.',{},async()=>app.hubs.list().map(hub=>({id:hub.id,name:hub.name,boardCount:hub.boards.length})),true),
  normal('list_boards','List the boards of a Hub. Pass hub_id, or use this from a task conversation to infer its Hub.',{hub_id:text('Hub ID. Optional in a task conversation.')},async(args,exec)=>{const {hub}=resolveHub(app,args as ToolArgs,exec);return hub.boards.map(board=>({id:board.id,hubId:hub.id,name:board.name,columns:board.workflow.columns.map(column=>({id:column.id,name:column.name}))}));},true),
  normal('list_projects','List the projects owned by a board\'s Hub. Each project states whether the requested board allows it to create a card.',{board_id:text('Board ID. Optional in a task conversation.'),hub_id:text('Hub ID; only used to resolve a board when supplied with board_id.')},async(args,exec)=>{const {board,hub}=resolveBoard(app,args as ToolArgs,exec);return hub.projects.map(project=>({...project,allowed:!isPublishedProject(project)&&isProjectAllowed(board,project)}));},true),
  normal('get_board_summary','Summarize one board and its workflow columns without modifying tasks. Set include_workflow to read the exact authored workflow YAML, the parsed workflow, the Hub revision, and the publishing state before a board change.',{board_id:text('Board ID. Optional in a task conversation.'),include_workflow:{type:'boolean',description:'Include the exact workflow YAML, the parsed workflow, the Hub revision, and the publishing state.'}},async(args,exec)=>{
   const {board,hub}=resolveBoard(app,args as ToolArgs,exec);
   const view=boards.read(board.id,hub.id);
   const summary={...boardSummary(view.board,hub),hubRevision:view.hubRevision};
   if(args.include_workflow!==true)return summary;
   return {...summary,initialColumnId:view.board.workflow.initialColumnId,groups:view.board.workflow.groups,workflow:view.board.workflow,workflowYaml:view.board.workflowYaml,sharing:sharingSummary(boards.sharingView(hub.id),board.id)};
  },true),
 ];
}
