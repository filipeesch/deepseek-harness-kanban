import type { Context } from '@deepseek-ai/cordis';
import type { ToolActivationContext, ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { KanbanError } from '../../shared/errors.js';
import type { TaskActivitySource } from '../../domain/task-activity.js';
import { discoveryTools } from './discovery.js';
import { cardTools } from './cards.js';
import { relationTools } from './relations.js';
import { noteTools } from './notes.js';
import { boardTools } from './boards.js';
import { questionTools } from './questions.js';
import { transitionTools } from './transitions.js';
import { autoModeTools } from './auto-mode.js';
import { teamFileTools } from './team-files.js';
import { messageTools } from './messages.js';
import { authoringTools } from './authoring.js';
import { deterministicTools } from './deterministic.js';
import { validationTools } from './validation.js';
import { sharingTools } from './sharing.js';
import { revisionTools } from './revisions.js';
import { insightsTools } from './insights.js';
import type { BoardRevisions } from '../revisions.js';
import type { WorkflowImagePort } from '../workflow-image.js';
import type { Rasterizer } from '../rasterizer.js';
import type { InterCardMessaging } from '../inter-card-messaging.js';

/** The optional services the workflow-design tools need; absent keeps the core tool surface. */
export interface ProductToolExtras {
 readonly revisions?:BoardRevisions;
 readonly images?:WorkflowImagePort;
 readonly rasterizer?:Rasterizer;
 /** The native activity source a card read reports; absent falls back to the app's own facts. */
 readonly activity?:TaskActivitySource;
}
export function productToolDefinitions(app:KanbanApp,boards:BoardAdministration=app.boards,messaging?:InterCardMessaging,extras:ProductToolExtras={}):ToolDefinition[]{
 return [
  ...discoveryTools(app,boards),
  ...cardTools(app,extras.activity),
  ...relationTools(app),
  ...noteTools(app),
  ...boardTools(app,boards),
  ...authoringTools(app,boards),
  ...deterministicTools(app),
  ...validationTools(),
  ...sharingTools(app),
  ...revisionTools(app,extras.revisions,boards),
  ...insightsTools(app,extras.rasterizer,extras.images),
  ...transitionTools(app),
  ...autoModeTools(app),
  ...teamFileTools(app),
  ...(messaging===undefined?[]:messageTools(messaging)),
  ...questionTools(),
 ];
}

/** The preset that owns the workflow-design tools. */
export const WORKFLOW_ARCHITECT_PRESET='kanban-workflow-architect';

/** The tools only the workflow architect sees; every other agent never receives them. */
export const WORKFLOW_DESIGN_TOOLS:readonly string[]=[
 'get_board_yaml','get_stage','set_stage_prompt','set_stage_routes','set_stage_script','set_layout','add_stage','remove_stage','get_script_execution','test_script','validate_workflow','diff_published_board',
 'get_route_stats','render_workflow_diagram','layout_metrics','list_board_revisions','diff_board_revisions','revert_board',
];

/**
 * The step-time gate for the workflow-design tools. The preset projection is the
 * only authority; an unavailable projection withholds the tools instead of
 * widening access, because a missing answer is not a permission.
 */
interface PresetRoster {
 presetForSession?(session:unknown):string|null;
 stateOf?(session:unknown):string|null;
}
export function workflowArchitectGate(ctx:Context):(context:ToolActivationContext)=>boolean{
 return ({agent})=>{
  let presets:PresetRoster|undefined;
  try{presets=ctx.get('agentPresets') as PresetRoster|undefined;}catch{return false;}
  const read=presets?.presetForSession??presets?.stateOf;
  if(read===undefined||presets===undefined)return false;
  try{return read.call(presets,agent.session)===WORKFLOW_ARCHITECT_PRESET;}catch{return false;}
 };
}

export function registerProductTools(ctx:Context,app:KanbanApp,messaging?:InterCardMessaging,extras:ProductToolExtras={}):()=>void{
 const disposers:Array<()=>void>=[];
 const gated=new Set(WORKFLOW_DESIGN_TOOLS);
 const gate=workflowArchitectGate(ctx);
 try{for(const definition of productToolDefinitions(app,app.boards,messaging,extras)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');disposers.push(ctx.tools.register(definition,gated.has(definition.name)?{when:gate}:{}));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}