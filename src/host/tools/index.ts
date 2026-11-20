import type { Context } from '@deepseek-ai/cordis';
import type { ToolActivationContext, ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { KanbanError } from '../../shared/errors.js';
import type { TaskActivitySource } from '../../domain/task-activity.js';
import { discoveryTools } from './discovery.js';
import { cardTools } from './cards.js';
import { cardDeletionTools } from './deletion.js';
import { relationTools } from './relations.js';
import { noteTools } from './notes.js';
import { boardTools } from './boards.js';
import { questionTools } from './questions.js';
import { transitionTools } from './transitions.js';
import { autoModeTools } from './auto-mode.js';
import { teamFileTools } from './team-files.js';
import { messageTools } from './messages.js';
import { authoringTools } from './authoring.js';
import { scriptedTools } from './scripted.js';
import { validationTools } from './validation.js';
import { sharingTools } from './sharing.js';
import { revisionTools } from './revisions.js';
import { insightsTools } from './insights.js';
import { planTools } from './plan-files.js';
import type { BoardRevisions } from '../revisions.js';
import type { WorkflowImagePort } from '../workflow-image.js';
import type { Rasterizer } from '../rasterizer.js';
import type { InterCardMessaging } from '../inter-card-messaging.js';
import type { PlanFilePort } from '../../shared/ports.js';

/** The optional services the workflow-design tools need; absent keeps the core tool surface. */
export interface ProductToolExtras {
 readonly revisions?:BoardRevisions;
 readonly images?:WorkflowImagePort;
 readonly rasterizer?:Rasterizer;
 /** The native activity source a card read reports; absent falls back to the app's own facts. */
 readonly activity?:TaskActivitySource;
 /** The confined plan-file port; absent withholds the plan tools from every agent. */
 readonly plans?:PlanFilePort;
 /** Read the directory a conversation was created in; the plan authority anchors there. */
 readonly sessionOrigin?:(session:unknown)=>string|undefined;
 /** Read a session parent, so a delegated child resolves the task that owns it. */
 readonly sessionParent?:(session:unknown)=>string|undefined;
}
export function productToolDefinitions(app:KanbanApp,boards:BoardAdministration=app.boards,messaging?:InterCardMessaging,extras:ProductToolExtras={}):ToolDefinition[]{
 return [
  ...discoveryTools(app,boards),
  ...cardTools(app,extras.activity),
  ...cardDeletionTools(app),
  ...relationTools(app),
  ...noteTools(app),
  ...boardTools(app,boards),
  ...authoringTools(app,boards),
  ...scriptedTools(app),
  ...validationTools(),
  ...sharingTools(app),
  ...revisionTools(app,extras.revisions,boards),
  ...insightsTools(app,extras.rasterizer,extras.images),
  ...transitionTools(app),
  ...autoModeTools(app),
  ...teamFileTools(app),
  ...(messaging===undefined?[]:messageTools(messaging)),
  ...(extras.plans===undefined?[]:planTools({source:app,plans:extras.plans,origin:extras.sessionOrigin??(()=>undefined),parentOf:extras.sessionParent??(()=>undefined)})),
  ...questionTools(),
 ];
}

/** The preset that owns the workflow-design tools. */
export const WORKFLOW_ARCHITECT_PRESET='kanban-workflow-architect';

/** The preset that owns the plan-file tools. */
export const PROJECT_PLANNER_PRESET='kanban-project-planner';

/** The tools only the workflow architect sees; every other agent never receives them. */
export const WORKFLOW_DESIGN_TOOLS:readonly string[]=[
 'get_board_yaml','get_stage','set_stage_prompt','set_stage_routes','set_stage_script','set_stage_decision','set_layout','add_stage','remove_stage','get_script_execution','test_script','validate_workflow','diff_published_board',
 'get_route_stats','render_workflow_diagram','layout_metrics','list_board_revisions','diff_board_revisions','revert_board',
];

/** The tools only the project planner sees; every other agent never receives them. */
export const PLAN_TOOLS:readonly string[]=['write_plan','patch_plan'];

/**
 * The step-time gate for a preset's tools. The preset projection is the only
 * authority; an unavailable projection withholds the tools instead of widening
 * access, because a missing answer is not a permission. One factory serves every
 * preset-scoped tool set, so a second role cannot inherit a gate that forgot
 * that rule.
 */
interface PresetRoster {
 presetForSession?(session:unknown):string|null;
 stateOf?(session:unknown):string|null;
}
export function presetGate(ctx:Context,presetId:string):(context:ToolActivationContext)=>boolean{
 return ({agent})=>{
  // The service lookup, the method lookup, and the call all sit inside one
  // guard: reading the accessor off the service can itself throw, and a step
  // admission must withhold these tools rather than abort the whole catalog.
  try{
   const presets=ctx.get('agentPresets') as PresetRoster|undefined;
   const read=presets?.presetForSession??presets?.stateOf;
   if(presets===undefined||typeof read!=='function')return false;
   return read.call(presets,agent.session)===presetId;
  }catch{return false;}
 };
}

/** The step-time gate for the workflow-design tools. */
export function workflowArchitectGate(ctx:Context):(context:ToolActivationContext)=>boolean{
 return presetGate(ctx,WORKFLOW_ARCHITECT_PRESET);
}

export function registerProductTools(ctx:Context,app:KanbanApp,messaging?:InterCardMessaging,extras:ProductToolExtras={}):()=>void{
 const disposers:Array<()=>void>=[];
 const architectGate=workflowArchitectGate(ctx);
 const plannerGate=presetGate(ctx,PROJECT_PLANNER_PRESET);
 const design=new Set(WORKFLOW_DESIGN_TOOLS);
 const plan=new Set(PLAN_TOOLS);
 const gateOf=(name:string)=>design.has(name)?architectGate:plan.has(name)?plannerGate:undefined;
 try{for(const definition of productToolDefinitions(app,app.boards,messaging,extras)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');const gate=gateOf(definition.name);disposers.push(ctx.tools.register(definition,gate===undefined?{}:{when:gate}));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}