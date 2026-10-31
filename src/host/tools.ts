import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec, type InferArgs, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from './app.js';
import type { Board, HubState } from '../shared/types.js';
import { json } from '../shared/json.js';
import { KanbanError, invariant } from '../shared/errors.js';
import { validateQuestionPage } from '../questions/validation.js';
import type { LocatedTask } from './hub-repository.js';

function text(description:string,required:true):{type:'string';description:string;required:true};
function text(description:string,required?:undefined):{type:'string';description:string};
function text(description:string,required?:true){return {type:'string' as const,description,...(required?{required}: {})};}
function normal<S extends ParameterSchemaSpec>(name:string,description:string,parameters:S,execute:(args:InferArgs<S>,exec:ToolRunContext)=>Promise<unknown>,read=false):ToolDefinition{
 return defineTool({name,description,parameters,isConcurrencySafe:()=>read,output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();return json(await execute(args,exec));}});
}

interface ToolArgs { board_id?: string; hub_id?: string; task_id?: string }
function taskContext(app:KanbanApp,exec:ToolRunContext):LocatedTask|undefined{return exec.agent?app.locator.bySession(exec.agent.id):undefined;}
function requireTask(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):LocatedTask{
 if(args.task_id){const located=app.hubs.findTask(args.task_id);invariant(located,'TASK_NOT_FOUND','Task does not exist.');return located;}
 const located=taskContext(app,exec);invariant(located,'MISSING_TASK_CONTEXT','Specify task_id or use a conversation belonging to a task.');return located;
}
function resolveHub(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):{hubId:string;hub:HubState}{
 if(args.hub_id){const hub=app.hubs.requireHub(args.hub_id);return {hubId:hub.id,hub};}
 const located=taskContext(app,exec);if(located)return {hubId:located.hubId,hub:located.hub};
 const hubId=app.hubs.resolveHubId();return {hubId,hub:app.hubs.requireHub(hubId)};
}
function resolveBoard(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):{hubId:string;hub:HubState;board:Board}{
 const located=taskContext(app,exec);
 const boardId=args.board_id??located?.board.id;
 invariant(boardId,'BOARD_CONTEXT_REQUIRED','Discover a board with list_hubs and list_boards, then pass board_id.');
 if(args.hub_id){const hub=app.hubs.requireHub(args.hub_id);const board=hub.boards.find(value=>value.id===boardId);invariant(board,'BOARD_NOT_FOUND','Board does not exist in the selected Hub.');return {hubId:hub.id,hub,board};}
 const found=app.hubs.findBoard(boardId);
 invariant(found,'BOARD_NOT_FOUND','Board does not exist.',);
 return found;
}
function boardSummary(board:Board,hub:HubState){return {id:board.id,hubId:hub.id,name:board.name,columns:board.workflow.columns.map(column=>({id:column.id,name:column.name,count:hub.tasks.filter(task=>task.boardId===board.id&&task.columnId===column.id).length}))};}

export function productToolDefinitions(app:KanbanApp):ToolDefinition[]{
 const intent='Use ONLY when the user explicitly requests this board change. Never use board cards as unsolicited internal progress tracking. This is not a TODO tool. ';
 return [
 normal('list_hubs','List the Hubs available in this installation. Use this before discovering boards.',{},async()=>app.hubs.list().map(hub=>({id:hub.id,name:hub.name,boardCount:hub.boards.length})),true),
 normal('list_boards','List the boards of a Hub. Pass hub_id, or use this from a task conversation to infer its Hub.',{hub_id:text('Hub ID. Optional in a task conversation.')},async(args,exec)=>{const {hub}=resolveHub(app,args as ToolArgs,exec);return hub.boards.map(board=>({id:board.id,hubId:hub.id,name:board.name,columns:board.workflow.columns.map(column=>({id:column.id,name:column.name}))}));},true),
 normal('list_projects','List the projects owned by a board\'s Hub.',{board_id:text('Board ID. Optional in a task conversation.'),hub_id:text('Hub ID; only used to resolve a board when supplied with board_id.')},async(args,exec)=>{const {hub}=resolveBoard(app,args as ToolArgs,exec);return hub.projects;},true),
 normal('get_board_summary','Summarize one board and its workflow columns without modifying tasks.',{board_id:text('Board ID. Optional in a task conversation.')},async(args,exec)=>{const {board,hub}=resolveBoard(app,args as ToolArgs,exec);return boardSummary(board,hub);},true),
 normal('list_cards','Find tasks on one board by title/description, project, or workflow stage.',{board_id:text('Board ID. Optional in a task conversation.'),query:text('Case-insensitive title or description query.'),project_id:text('Registered project ID.'),workflow_state:text('Column ID.'),limit:{type:'integer',description:'Maximum results, between 1 and 200.'}},async(args,exec)=>{const {board,hub}=resolveBoard(app,args as ToolArgs,exec);const query=(args.query??'').toLowerCase();const limit=args.limit??50;invariant(Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_LIMIT','limit must be between 1 and 200.');return hub.tasks.filter(task=>task.boardId===board.id).filter(task=>(!args.project_id||task.projectId===args.project_id)&&(!args.workflow_state||task.columnId===args.workflow_state)&&(!query||(task.title+' '+task.description).toLowerCase().includes(query))).sort((a,b)=>a.position-b.position).slice(0,limit).map(task=>({...task,hubId:hub.id}));},true),
 normal('get_card','Read one task with its project, board, and Hub context.',{task_id:text('Task ID. Optional in a task conversation.')},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);return {task:located.task,project:located.project,board:{id:located.board.id,name:located.board.name},hub:{id:located.hubId,name:located.hub.name}};},true),
 normal('create_card',intent+'Create in the board\'s initial column without starting an agent or creating a conversation. Use list_hubs, list_boards, and list_projects to select scope.',{board_id:text('Board ID. Optional in a task conversation.'),project_id:text('Registered project ID from the board\'s Hub.',true),title:text('Task title.',true),description:text('Markdown task description.')},async(args,exec)=>{const {board,hub}=resolveBoard(app,args as ToolArgs,exec);invariant(hub.projects.some(project=>project.id===args.project_id),'PROJECT_CONTEXT_MISMATCH','The project does not belong to the board\'s Hub.');const task=await app.createTask({boardId:board.id,projectId:args.project_id,title:args.title,description:args.description??''});return {...task,hubId:hub.id};}),
 normal('edit_card',intent+'Edit title/description at any stage without messaging or starting task conversations.',{task_id:text('Task ID. Optional in a task conversation.'),title:text('Replacement title.'),description:text('Replacement Markdown description.')},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);invariant(args.title!==undefined||args.description!==undefined,'INVALID_EDIT','Provide title or description.');await app.command({type:'task.edit',hubId:located.hubId,taskId:located.task.id,...(args.title!==undefined?{title:args.title}:{}),...(args.description!==undefined?{description:args.description}:{})});return {...app.hubs.requireTask(located.task.id).task,hubId:located.hubId};}),
 normal('create_note','Create a shared task Markdown note only when explicitly requested by the user. Not a checklist or decision record.',{task_id:text('Explicit task ID; optional in a task conversation.'),content:text('Markdown note.',true),tags:{type:'array',items:{type:'string'},description:'Optional note tags.'}},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);return app.saveNote({type:'note.save',hubId:located.hubId,taskId:located.task.id,content:args.content,tags:args.tags});}),
 normal('list_notes','Read shared notes for a task, regardless of which agent tab created them.',{task_id:text('Explicit task ID; optional in a task conversation.')},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);return app.hubs.requireHub(located.hubId).notes.filter(note=>note.taskId===located.task.id);},true),
 normal('update_note','Update a shared task note only when explicitly requested by the user.',{task_id:text('Explicit task ID; optional in a task conversation.'),id:text('Note ID.',true),content:text('Replacement Markdown content.',true),tags:{type:'array',items:{type:'string'},description:'Optional replacement tags.'}},async(args,exec)=>{const located=requireTask(app,args as ToolArgs,exec);await app.command({type:'note.save',hubId:located.hubId,taskId:located.task.id,noteId:args.id,content:args.content,tags:args.tags});return app.hubs.requireHub(located.hubId).notes.find(note=>note.id===args.id&&note.taskId===located.task.id);}),
 defineTool({name:'decision_request',description:'Add ONE structured question page to this conversation round. This tool returns immediately. Ask pages sequentially, then finish the native turn so the user can submit the complete round. The form is optional UX: users can dismiss the round from the footer and answer normally in chat; dismissal sends no chat message and persists across reload/replay. Never create decision records. Choices belong in options, not embedded in question text; freetext omits options. A recommendation must match an option title.',parameters:{question:{type:'string',required:true},type:{type:'string',enum:['exclusive','non_exclusive','freetext'],required:true},context:{type:'string'},weight:{type:'string',enum:['critical','medium','easy']},model_lean:{type:'string'},model_lean_reason:{type:'string'},answers_affect_followup:{type:'boolean'},options:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string',required:true},description:{type:'string',required:true}}}}},output:{schema:{type:'json'},render:()=>[{type:'text',text:'Question page added. Add any remaining questions, then finish this turn. The user will reply with one ordinary text message.'}],presentationMeta:(_args,value)=>value},isConcurrencySafe:()=>false,execute:async(args,exec)=>{invariant(exec.agent,'MISSING_SESSION','Question pages require an owning native conversation.');exec.signal.throwIfAborted();return json({kind:'kanban.question-page',version:1,page:validateQuestionPage(args)});}}),
 ];
}
export function registerProductTools(ctx:Context,app:KanbanApp):()=>void{
 const disposers:Array<()=>void>=[];
 try{for(const definition of productToolDefinitions(app)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');disposers.push(ctx.tools.register(definition));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}
