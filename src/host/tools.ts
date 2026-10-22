import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec, type InferArgs, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from './app.js';
import { json } from '../shared/json.js';
import { KanbanError, invariant } from '../shared/errors.js';
import { validateQuestionPage } from '../questions/validation.js';
function text(description:string,required:true):{type:'string';description:string;required:true};
function text(description:string,required?:undefined):{type:'string';description:string};
function text(description:string,required?:true){return {type:'string' as const,description,...(required?{required}: {})};}
function taskId(app:KanbanApp,args:{task_id?:string},exec:ToolRunContext):string{
 if(args.task_id){app.store.requireTask(args.task_id);return args.task_id;}
 const task=app.store.snapshot().tasks.find(t=>exec.agent&&t.sessionIds.includes(exec.agent.id));
 invariant(task,'MISSING_TASK_CONTEXT','Specify task_id or use a conversation belonging to a task.');return task.id;
}
function normal<S extends ParameterSchemaSpec>(name:string,description:string,parameters:S,execute:(args:InferArgs<S>,exec:ToolRunContext)=>Promise<unknown>,read=false):ToolDefinition{
 return defineTool({name,description,parameters,isConcurrencySafe:()=>read,output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();return json(await execute(args,exec));}});
}
export function productToolDefinitions(app:KanbanApp):ToolDefinition[]{
 const intent='Use ONLY when the user explicitly requests this board change. Never use board cards as unsolicited internal progress tracking. This is not a TODO tool. ';
 return [
 normal('list_boards','List the single global Kanban board.',{},async()=>[{id:'global',name:'Kanban'}],true),
 normal('list_projects','List registered Kanban projects and their distinct project/Git-root paths.',{},async()=>app.store.snapshot().projects,true),
 normal('get_board_summary','Summarize the global board without modifying tasks.',{},async()=>{const s=app.store.snapshot();return {id:'global',columns:s.workflow.columns.map(c=>({id:c.id,name:c.name,count:s.tasks.filter(t=>t.columnId===c.id).length}))};},true),
 normal('list_cards','Find tasks by title/description, project, or workflow stage.',{query:text('Case-insensitive title or description query.'),project_id:text('Registered project ID.'),workflow_state:text('Column ID.'),limit:{type:'integer',description:'Maximum results, between 1 and 200.'}},async args=>{const query=(args.query??'').toLowerCase();const limit=args.limit??50;invariant(Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_LIMIT','limit must be between 1 and 200.');return app.store.snapshot().tasks.filter(t=>(!args.project_id||t.projectId===args.project_id)&&(!args.workflow_state||t.columnId===args.workflow_state)&&(!query||(t.title+' '+t.description).toLowerCase().includes(query))).sort((a,b)=>a.position-b.position).slice(0,limit);},true),
 normal('get_card','Read one task and its project/context metadata.',{task_id:text('Task ID.',true)},async args=>{const task=app.store.requireTask(args.task_id);return {task,project:app.store.requireProject(task.projectId)};},true),
 normal('create_card',intent+'Create in the initial column without starting an agent. Use list_projects to select an existing project.',{project_id:text('Registered project ID.',true),title:text('Task title.',true),description:text('Markdown task description.')},async args=>{return app.createTask({projectId:args.project_id,title:args.title,description:args.description??''});}),
 normal('edit_card',intent+'Edit title/description at any stage without messaging or starting task conversations.',{task_id:text('Task ID.',true),title:text('Replacement title.'),description:text('Replacement Markdown description.')},async args=>{invariant(args.title!==undefined||args.description!==undefined,'INVALID_EDIT','Provide title or description.');await app.command({type:'task.edit',taskId:args.task_id,...(args.title!==undefined?{title:args.title}:{}),...(args.description!==undefined?{description:args.description}:{})});return app.store.requireTask(args.task_id);}),
 normal('create_note','Create a shared task Markdown note only when explicitly requested by the user. Not a checklist or decision record.',{task_id:text('Explicit task ID; optional in a task conversation.'),content:text('Markdown note.',true),tags:{type:'array',items:{type:'string'},description:'Optional note tags.'}},async(args,exec)=>{const id=taskId(app,args,exec);return app.saveNote({type:'note.save',taskId:id,content:args.content,tags:args.tags});}),
 normal('list_notes','Read shared notes for a task, regardless of which agent tab created them.',{task_id:text('Explicit task ID; optional in a task conversation.')},async(args,exec)=>{const id=taskId(app,args,exec);return app.store.snapshot().notes.filter(n=>n.taskId===id);},true),
 normal('update_note','Update a shared task note only when explicitly requested by the user.',{task_id:text('Explicit task ID; optional in a task conversation.'),id:text('Note ID.',true),content:text('Replacement Markdown content.',true),tags:{type:'array',items:{type:'string'},description:'Optional replacement tags.'}},async(args,exec)=>{const id=taskId(app,args,exec);await app.command({type:'note.save',taskId:id,noteId:args.id,content:args.content,tags:args.tags});return app.store.snapshot().notes.find(n=>n.id===args.id&&n.taskId===id);}),
 defineTool({name:'decision_request',description:'Add ONE structured question page to this conversation round. This tool returns immediately. Ask pages sequentially, then finish the native turn so the user can submit the complete round. The form is optional UX: users can close it and answer normally in chat. Never create decision records. Choices belong in options, not embedded in question text; freetext omits options. A recommendation must match an option title.',parameters:{question:{type:'string',required:true},type:{type:'string',enum:['exclusive','non_exclusive','freetext'],required:true},context:{type:'string'},weight:{type:'string',enum:['critical','medium','easy']},model_lean:{type:'string'},model_lean_reason:{type:'string'},answers_affect_followup:{type:'boolean'},options:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string',required:true},description:{type:'string',required:true}}}}},output:{schema:{type:'json'},render:()=>[{type:'text',text:'Question page added. Add any remaining questions, then finish this turn. The user will reply with one ordinary text message.'}],presentationMeta:(_args,value)=>value},isConcurrencySafe:()=>false,execute:async(args,exec)=>{invariant(exec.agent,'MISSING_SESSION','Question pages require an owning native conversation.');exec.signal.throwIfAborted();return json({kind:'kanban.question-page',version:1,page:validateQuestionPage(args)});}}),
 ];
}
export function registerProductTools(ctx:Context,app:KanbanApp):()=>void{
 const disposers:Array<()=>void>=[];
 try{for(const definition of productToolDefinitions(app)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');disposers.push(ctx.tools.register(definition));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}
